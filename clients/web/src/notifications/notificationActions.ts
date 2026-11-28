/**
 * The one place a notification earns a button: from where it points,
 * checked against what is there now.
 *
 * A decision ("Needs you") only while one is actually waiting: the
 * notification names the chat (`session_id`) or the approval
 * (`requirement_id`), and that chat still has a paused run or that
 * approval is still open. A chat only while it is in the list, a page
 * only while it is installed, an update only while one is waiting. What
 * cannot be resolved gets no button, and its card opens nothing.
 */

import type { PageRoute } from "../chat/pageStack";
import type { ChatState } from "../chat/sessionStates";
import type { ModelToast } from "../clientState";
import type { HITLRequest } from "../protocol/messages";
import type { UpdateInfo } from "../update/updateInfo";
import { NotificationAction } from "./notificationAction";
import type { FloorNotification } from "./model";

/** A chat as the sidebar lists it. */
export interface ChatEntry {
  session_id: string;
  name: string;
  has_paused_run?: boolean;
}

/** An open approval in the chat on screen. */
export type OpenApproval = Pick<HITLRequest, "requirement_id" | "tool_name" | "friendly_name">;

/** What there is right now to point at. */
export interface ActionWorld {
  chats: readonly ChatEntry[];
  /** What each chat is doing (`session_states_changed`). */
  states: { of(sessionId: string): ChatState };
  /** The chat on screen. */
  currentChat: string;
  /** The approvals open in the chat on screen. */
  approvals: readonly OpenApproval[] | null;
  /** Whether a page exists, and what it is called. */
  pages: {
    has(kind: string): boolean;
    /** The name on a button: "Code review › Findings". */
    label(kind: string): string | null;
    /** The name in a breadcrumb: "Findings". */
    routeLabel(kind: string): string | null;
  };
  /** The update waiting, if one is. */
  update: UpdateInfo | null;
}

/** What following an action does. */
export interface ActionEffects {
  openChat: (sessionId: string) => void;
  openPage: (route: PageRoute) => void;
  showUpdate: (info: UpdateInfo) => void;
}

/** Pages that are a chat: a target there opens the chat itself. */
const CHAT_PAGES = new Set(["session", "chat"]);
const UNTITLED = "Untitled chat";

export class NotificationActions {
  constructor(
    private readonly world: ActionWorld,
    private readonly effects: ActionEffects,
  ) {}

  /** Resolves nothing: every card informational. */
  static readonly NONE = new NotificationActions(
    {
      chats: [],
      states: { of: () => ({ activity: "idle", unread: false }) },
      currentChat: "",
      approvals: null,
      pages: { has: () => false, label: () => null, routeLabel: () => null },
      update: null,
    },
    { openChat: () => {}, openPage: () => {}, showUpdate: () => {} },
  );

  /** A floor row's button, or `null`. */
  forFloor(row: Pick<FloorNotification, "target">): NotificationAction | null {
    if (!row.target) return null;
    const { page, params } = row.target;
    return this.about(page, params) ?? this.place(page, params);
  }

  /** A toast's button, or `null`. */
  forToast(toast: Pick<ModelToast, "target" | "category">): NotificationAction | null {
    const target = toast.target ?? null;
    if (target) {
      const action =
        this.about(target.kind, target.params) ?? this.place(target.kind, target.params, target.label);
      if (action) return action;
    }
    return toast.category === "update" ? this.update() : null;
  }

  /** The decision a target is about, if it is about one: a chat, or a
   *  target that names the requirement. An extension's own page that
   *  happens to carry a session id is still its page. */
  private about(page: string, params: Record<string, string> | undefined): NotificationAction | null {
    const named = params ?? {};
    const aboutDecision = CHAT_PAGES.has(page) || !!named.requirement_id;
    return aboutDecision ? this.decision(named) : null;
  }

  /** The decision `params` names, while it is still waiting. */
  decision(params: Record<string, string> = {}): NotificationAction | null {
    const requirement = params.requirement_id ?? "";
    const open = this.world.approvals ?? [];
    const onScreen = requirement ? open.some((a) => a.requirement_id === requirement) : false;
    const chatId = params.session_id || (onScreen ? this.world.currentChat : "");
    if (!chatId) return null;
    const chat = this.world.chats.find((c) => c.session_id === chatId);
    if (!chat) return null;
    const name = chat.name || UNTITLED;
    const go = () => this.effects.openChat(chatId);

    if (chatId === this.world.currentChat) {
      const waiting = requirement ? open.filter((a) => a.requirement_id === requirement) : open;
      if (waiting.length === 0) return null;
      if (open.length === 1) {
        const tool = open[0].friendly_name || open[0].tool_name;
        return NotificationAction.named("decision", `Approve ${tool} in `, name, "", go);
      }
      return NotificationAction.named("decision", `Review ${open.length} approvals in `, name, "", go);
    }
    const paused = this.world.states.of(chatId).activity === "waiting" || chat.has_paused_run === true;
    return paused ? NotificationAction.named("decision", "Answer the approval in ", name, "", go) : null;
  }

  /** The chat or page a target names, while it exists. `ownLabel` is
   *  the name a toast's target carries with it. */
  private place(
    page: string,
    params: Record<string, string> | undefined,
    ownLabel?: string,
  ): NotificationAction | null {
    if (CHAT_PAGES.has(page)) {
      const chat = this.world.chats.find((c) => c.session_id === params?.session_id);
      if (!chat) return null;
      return NotificationAction.named("chat", "Open chat ", chat.name || UNTITLED, "", () =>
        this.effects.openChat(chat.session_id),
      );
    }
    if (!this.world.pages.has(page)) return null;
    const pageName = ownLabel || this.world.pages.label(page) || page;
    const route: PageRoute = {
      kind: page,
      label: ownLabel || this.world.pages.routeLabel(page) || pageName,
      ...(params ? { params } : {}),
    };
    const go = () => this.effects.openPage(route);
    if (params?.name) return NotificationAction.named("page", "Show ", params.name, ` in ${pageName}`, go);
    return NotificationAction.plain("page", `Open ${pageName}`, go);
  }

  /** Installing the update that is waiting, if one is. */
  private update(): NotificationAction | null {
    const info = this.world.update;
    if (!info?.available || !info.latestVersion) return null;
    return NotificationAction.plain("update", `Restart to update to ${info.latestVersion}`, () =>
      this.effects.showUpdate(info),
    );
  }
}
