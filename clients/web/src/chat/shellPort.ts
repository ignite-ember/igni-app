/**
 * What the chat controllers ask of the app shell around them: the
 * footer's status, the sidebar's session list, navigation, the composer.
 *
 * Every member must keep its identity for the window's life (a React
 * setter, a ``useCallback`` over setters): the controllers are built
 * once and hold it.
 */

import type { Dispatch, SetStateAction } from "react";

import type { SessionEntry } from "../components/Sidebar";
import type { StatusUpdate } from "../protocol/messages";
import type { PageRoute } from "./pageStack";

export interface ShellPort {
  readonly setStatus: (status: StatusUpdate) => void;
  readonly setSessions: Dispatch<SetStateAction<SessionEntry[]>>;
  readonly refreshStatus: () => Promise<void>;
  readonly refreshSessions: () => Promise<void>;
  /** Open a page at its top. */
  readonly goPage: (route: PageRoute) => void;
  /** Open the composer's model menu: the one model picker. */
  readonly openModelMenu: () => void;
  /** Put text in the composer and give it the caret. */
  readonly seedComposer: (text: string) => void;
}
