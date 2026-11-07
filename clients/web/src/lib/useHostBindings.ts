/**
 * What this window tells, and is told by, the shell it runs in: the
 * desktop's native menu, its title, files opened in the editor, the
 * selection, focus, and the address bar.
 */

import { useEffect } from "react";

import { Arrivals, type Arrival } from "../chat/arrival";
import type { TranscriptView } from "../chat/transcriptView";
import type { WindowModel } from "../clientState";
import type { IgniClient } from "../protocol/client";
import type { UpdateCheck } from "../update/useUpdateCheck";
import { host } from "./host";

export interface HostBindingsDeps {
  client: Pick<IgniClient, "close">;
  windowModel: WindowModel;
  view: TranscriptView;
  updateCheck: Pick<UpdateCheck, "checkNow">;
  arrival: Arrival | null;
  signedIn: boolean;
  projectDir: string;
  org: string;
}

export function useHostBindings(deps: HostBindingsDeps): void {
  const { client, windowModel, view, updateCheck, arrival, signedIn, projectDir, org } = deps;

  useEffect(() => host.stampPlatform(document.documentElement), []);

  // The preview is ``ui.preview``, so an extension can open one too; a
  // file opened anywhere is the file picked, ``ui.selection.file``.
  useEffect(() => {
    host.setPreviewFallback((p) => windowModel.write("preview", { path: p }));
    return host.onOpen((p) =>
      windowModel.write("selection", { ...windowModel.get("selection"), file: p }),
    );
  }, [windowModel]);

  // The desktop shell's native menu items.
  const { checkNow } = updateCheck;
  useEffect(
    () =>
      host.onMenu((id) => {
        if (id === "new_chat") view.reset(); // the same effect as ``/clear``
        else if (id === "check_update") void checkNow(false); // answers either way
        else if (id === "restart_backend") {
          // The shell restarts the backend; drop the dead socket so the
          // client reconnects rather than sitting on it.
          try {
            client.close();
          } catch {
            /* already closed */
          }
        }
      }),
    [client, view, checkNow],
  );

  // The desktop window's title follows the folder and the org.
  useEffect(() => {
    host.setAppTitle(projectDir, org);
  }, [projectDir, org]);

  // A followed link leaves the address bar once read — after sign-in,
  // because before it the link is still where this window is going.
  // ``dir`` stays: it says which folder this window belongs to.
  useEffect(() => {
    if (!arrival || !signedIn) return;
    const url = new URL(window.location.href);
    window.history.replaceState(null, "", `${url.pathname}${Arrivals.withoutArrival(url.search)}${url.hash}`);
  }, [arrival, signedIn]);

  // Text selected in the transcript is ``ui.selection.text``, told when
  // the gesture that made it ends rather than at every step of a drag.
  useEffect(() => {
    const settle = () => {
      const picked = window.getSelection();
      const frame = document.querySelector(".conversation-frame");
      const inside =
        picked && picked.rangeCount > 0 && frame
          ? frame.contains(picked.getRangeAt(0).commonAncestorContainer)
          : false;
      const next = (inside ? picked!.toString().trim() : "") || null;
      const current = windowModel.get("selection");
      if (current.text !== next) windowModel.write("selection", { ...current, text: next });
    };
    document.addEventListener("mouseup", settle);
    document.addEventListener("keyup", settle);
    return () => {
      document.removeEventListener("mouseup", settle);
      document.removeEventListener("keyup", settle);
    };
  }, [windowModel]);

  // Whether this window has focus is ``windows.focused``.
  useEffect(() => {
    const focus = () => windowModel.write("focused", true);
    const blur = () => windowModel.write("focused", false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, [windowModel]);
}
