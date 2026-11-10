/**
 * Where this window is and what it shows, read from its model: each
 * field followed, so the shell re-renders when an extension (or another
 * part of the shell) moves it.
 */

import { useWindowField, type WindowModel, type WindowState } from "../clientState";

export interface WindowPlace {
  panel: WindowState["panel"];
  /** ``ui.route``. Empty means the chat is showing. */
  route: WindowState["route"];
  sidebar: WindowState["sidebar"];
  /** The session this window shows — ``sessions.current`` to an extension. */
  sessionId: WindowState["session"];
  /** The directory this window's session is locked to (tools + shell cwd). */
  projectDir: WindowState["project_dir"];
  dialog: WindowState["dialog"];
}

export function useWindowPlace(windowModel: WindowModel): WindowPlace {
  return {
    panel: useWindowField(windowModel, "panel"),
    route: useWindowField(windowModel, "route"),
    sidebar: useWindowField(windowModel, "sidebar"),
    sessionId: useWindowField(windowModel, "session"),
    projectDir: useWindowField(windowModel, "project_dir"),
    dialog: useWindowField(windowModel, "dialog"),
  };
}
