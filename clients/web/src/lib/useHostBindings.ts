/**
 * What this window tells, and is told by, the shell it runs in: the
 * desktop's native menu, its title, files opened in the editor, the
 * selection, focus, and the address bar.
 */

import { useEffect, useRef } from "react";

import { Arrivals } from "../chat/arrival";
import type { PageRoute } from "../chat/pageStack";
import type { WindowModel } from "../clientState";
import type { UpdateCheck } from "../update/useUpdateCheck";
import { host } from "./host";

export interface HostBindingsDeps {
  windowModel: WindowModel;
  /** The sidebar's New chat: ``/clear``, a new session on the backend. */
  newChat: () => void;
  updateCheck: Pick<UpdateCheck, "checkNow">;
  /** The page on top, whose place the address bar shows. */
  page: PageRoute | null;
  signedIn: boolean;
  projectDir: string;
  org: string;
}

export function useHostBindings(deps: HostBindingsDeps): void {
  const { windowModel, newChat, updateCheck, page, signedIn, projectDir, org } = deps;

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
        // The sidebar's New chat, not a blanked view over the same
        // session and model context (R624).
        if (id === "new_chat") newChat();
        else if (id === "check_update") void checkNow(false); // answers either way
        // Restart Backend is the shell's own: it restarts the backend
        // and reloads every window onto the new one (R619).
      }),
    [newChat, checkNow],
  );

  // The desktop window's title follows the folder and the org.
  useEffect(() => {
    host.setAppTitle(projectDir, org);
  }, [projectDir, org]);

  // The address bar shows where the window is: a followed link gives way
  // to the place, the page on top and its location (setLocation), so a
  // reload, a bookmark or the same link opened elsewhere comes back to it
  // (R459). After sign-in, because before it the link is still where this
  // window is going. ``dir`` stays: it says which folder this window
  // belongs to. Replaced, not pushed (see ``chat/arrival.ts``).
  useEffect(() => {
    if (!signedIn) return;
    const url = new URL(window.location.href);
    const search = Arrivals.placeSearch(url.search, page);
    if (search === url.search) return;
    window.history.replaceState(window.history.state, "", `${url.pathname}${search}${url.hash}`);
  }, [page, signedIn]);

  // An ``igni://open?…`` link the desktop shell was handed: at launch,
  // or while running (the shell brings the window forward and says so).
  // Read with a web link's rules, so an unknown page opens the chat.
  // After sign-in, like a web link.
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const take = async () => {
      const link = await host.takeOpenLink();
      if (!alive || link === null) return;
      const arrival = Arrivals.fromDeepLink(link);
      windowModel.write("route", arrival ? Arrivals.route(arrival) : []);
    };
    void take();
    const off = host.onOpenLink(() => void take());
    return () => {
      alive = false;
      off();
    };
  }, [signedIn, windowModel]);

  // An older address the browser goes back or forward to is a link like
  // any other: the window goes where it says, or to the chat. A fragment
  // change fires it too, on the address the window already wrote, and
  // that is no move: the trail below the page stays.
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  useEffect(() => {
    const onPopState = () => {
      const here = Arrivals.placeSearch(window.location.search, pageRef.current);
      if (here === window.location.search) return;
      const arrival = Arrivals.fromSearch(window.location.search);
      windowModel.write("route", arrival ? Arrivals.route(arrival) : []);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [windowModel]);

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
