/** A world for the notification actions' tests and the
 *  `?demo=notifications` sandbox: a few chats, one waiting, the chat on
 *  screen with its approvals, and every page installed. */

import type { PageRoute } from "../chat/pageStack";
import type { ChatState } from "../chat/sessionStates";
import type { UpdateInfo } from "../update/updateInfo";
import { NotificationActions, type ActionWorld, type ChatEntry, type OpenApproval } from "./notificationActions";

export interface WorldOptions {
  chats?: ChatEntry[];
  /** Chats whose run is paused on an approval (`session_states_changed`). */
  waiting?: string[];
  currentChat?: string;
  approvals?: OpenApproval[] | null;
  /** Pages that exist, by kind; every page when not given. */
  pages?: Record<string, string>;
  update?: UpdateInfo | null;
}

/** What following an action did, in order. */
export type Followed =
  | { to: "chat"; sessionId: string }
  | { to: "page"; route: PageRoute }
  | { to: "update"; version: string };

export const DEMO_CHATS: ChatEntry[] = [
  { session_id: "cv", name: "CV review" },
  { session_id: "billing", name: "Trace the billing flow through the gateway and the ledger" },
  { session_id: "infra", name: "Infra cleanup" },
];

export function actionWorld(options: WorldOptions = {}): { actions: NotificationActions; followed: Followed[] } {
  const followed: Followed[] = [];
  const waiting = new Set(options.waiting ?? []);
  const pages = options.pages;
  const world: ActionWorld = {
    chats: options.chats ?? DEMO_CHATS,
    states: {
      of: (id: string): ChatState => ({ activity: waiting.has(id) ? "waiting" : "idle", unread: false }),
    },
    currentChat: options.currentChat ?? "cv",
    approvals: options.approvals ?? null,
    pages: {
      has: (kind) => (pages ? kind in pages : true),
      label: (kind) => (pages ? (pages[kind] ?? null) : kind),
    },
    update: options.update ?? null,
  };
  const actions = new NotificationActions(world, {
    openChat: (sessionId) => followed.push({ to: "chat", sessionId }),
    openPage: (route) => followed.push({ to: "page", route }),
    showUpdate: (info) => followed.push({ to: "update", version: info.latestVersion }),
  });
  return { actions, followed };
}
