/**
 * The update check: the version waiting, the sheet to act on it
 * (``ui.dialog``), and the OS notification that alerts about it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { WindowModel } from "../clientState";
import { host } from "../lib/host";
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

export function useUpdateCheck(client: IgniClient, windowModel: WindowModel): UpdateCheck {
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
        } else if (!silent) {
          void host.notify({
            title: "Up to date",
            body: `You're on the latest version (${info.currentVersion}).`,
          });
        }
      } catch {
        /* best-effort */
      }
    },
    [announce, client],
  );
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);
  const checkNow = useCallback((silent?: boolean) => checkRef.current(silent), []);
  return { pendingUpdate, showUpdate, check, checkNow };
}
