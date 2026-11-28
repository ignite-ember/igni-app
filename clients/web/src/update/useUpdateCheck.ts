/**
 * The update check: the version waiting, the sheet to act on it
 * (``ui.dialog``), and the OS notification that alerts about it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { WindowModel } from "../clientState";
import { host } from "../lib/host";
import type { Notifier } from "../notifications/notifier";
import type { IgniClient } from "../protocol/client";
import { UpdateInfo } from "./updateInfo";

export interface UpdateCheck {
  /** The update waiting, as the last check reported it. */
  pendingUpdate: UpdateInfo | null;
  /** Open the sheet for it. */
  showUpdate: (info: UpdateInfo) => void;
  /** Check now. ``silent`` says nothing when there is no update; the
   *  menu's explicit check passes ``false`` so a click always answers. */
  check: (silent?: boolean) => Promise<void>;
  /** The latest {@link check}, under one identity for the window's
   *  life: for a listener mounted once. */
  checkNow: (silent?: boolean) => Promise<void>;
}

export function useUpdateCheck(
  client: IgniClient,
  windowModel: Pick<WindowModel, "openDialog">,
  notifier: Pick<Notifier, "notify">,
): UpdateCheck {
  const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);
  const showUpdate = useCallback(
    (info: UpdateInfo) => windowModel.openDialog(info.toDialogSpec()),
    [windowModel],
  );
  const announce = useCallback(
    (info: UpdateInfo) => {
      setPendingUpdate(info);
      showUpdate(info);
      // The OS alert reaches a backgrounded app; the sheet takes over
      // once the window has focus again.
      void host.notify({
        title: "Update available",
        body: `igni ${info.latestVersion} is ready to install.`,
      });
    },
    [showUpdate],
  );
  const check = useCallback(
    async (silent = false) => {
      try {
        const raw = await (host.checkUpdate() ?? client.rpc<unknown>("check_for_update"));
        const info = UpdateInfo.parse(raw);
        if (!info) return;
        if (info.available) {
          announce(info);
        } else if (silent) {
          return;
        } else if (info.checksDisabled) {
          // Nothing was asked: "up to date" would be a guess (R628).
          void notifier.notify({
            category: "update",
            title: "Update checks are off",
            body: "This install's update policy turns checking off, so igni did not look for a new version.",
          });
        } else {
          void notifier.notify({
            category: "update",
            title: "Up to date",
            body: `You're on the latest version (${info.currentVersion}).`,
          });
        }
      } catch (e) {
        // The background check stays quiet; a click always answers, a
        // refused mirror included (R628).
        if (!silent) {
          void notifier.notify({
            category: "failed",
            title: "Couldn't check for updates",
            body: e instanceof Error ? e.message : String(e),
          });
        }
      }
    },
    [announce, client, notifier],
  );
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);
  const checkNow = useCallback((silent?: boolean) => checkRef.current(silent), []);
  return { pendingUpdate, showUpdate, check, checkNow };
}
