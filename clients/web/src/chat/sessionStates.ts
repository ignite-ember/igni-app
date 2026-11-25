/**
 * Which chats are running, waiting on the person, or finished unseen —
 * the sidebar's marks. Asked once with ``list_session_states`` when the
 * connection opens, then moved only by ``session_states_changed``.
 *
 * Read state is the person's, kept by the backend across windows and
 * devices: the chat on screen is marked seen with ``mark_session_seen``
 * whenever it has news and the window is visible.
 */

import { useEffect, useRef, useState } from "react";

import type { IgniClient } from "../protocol/client";
import type { ServerMessage } from "../protocol/messages";
import { WirePayload } from "../protocol/wirePayload";

/** The push the backend sends whenever a chat's state or read mark moves. */
export const STATES_CHANNEL = "session_states_changed";

/** What a chat is doing. */
export type ChatActivity = "running" | "waiting" | "idle";

export interface ChatState {
  activity: ChatActivity;
  /** A run finished after the person last looked at the chat. */
  unread: boolean;
}

const IDLE: ChatState = { activity: "idle", unread: false };

/** A chat entry's place in the list: its last message, newest first. */
interface Placed {
  session_id: string;
  last_message_at?: number;
}

function activityOf(value: unknown): ChatActivity {
  return value === "running" || value === "waiting" ? value : "idle";
}

export class SessionStates {
  static readonly NONE = new SessionStates(new Map(), new Map());

  constructor(
    private readonly byId: ReadonlyMap<string, ChatState>,
    /** The newest last-message time told for each chat. Kept after the
     *  chat leaves the list (idle and read), so it keeps its place. */
    private readonly lastMessage: ReadonlyMap<string, number>,
  ) {}

  /** The states an answer or a push carries; `null` when it is not that shape. */
  static parse(raw: unknown): SessionStates | null {
    const payload = new WirePayload(raw);
    if (!Array.isArray(payload.value("sessions"))) return null;
    const byId = new Map<string, ChatState>();
    const lastMessage = new Map<string, number>();
    for (const row of payload.list("sessions")) {
      const r = new WirePayload(row);
      const id = r.text("session_id");
      if (!id) continue;
      byId.set(id, { activity: activityOf(r.value("state")), unread: r.value("unread") === true });
      const at = Number(r.value("last_message_at")) || 0;
      if (at > 0) lastMessage.set(id, at);
    }
    return new SessionStates(byId, lastMessage);
  }

  /** The states `session_states_changed` carries, or `null` for anything else. */
  static fromPush(message: ServerMessage): SessionStates | null {
    if (message.type !== "push_notification" || message.channel !== STATES_CHANNEL) return null;
    return SessionStates.parse(message.payload);
  }

  /** A chat not listed is idle and read. */
  of(sessionId: string): ChatState {
    return this.byId.get(sessionId) ?? IDLE;
  }

  /** The chats other than ``currentId`` that are running or waiting. */
  activeElsewhere(currentId: string): string[] {
    return [...this.byId]
      .filter(([id, s]) => id !== currentId && s.activity !== "idle")
      .map(([id]) => id);
  }

  /** What the other chats are doing: waiting when any waits on the
   *  person, else running when any runs. */
  elsewhere(currentId: string): ChatActivity {
    const others = this.activeElsewhere(currentId).map((id) => this.of(id).activity);
    if (others.includes("waiting")) return "waiting";
    return others.length > 0 ? "running" : "idle";
  }

  /** These states, told after this: its marks, and the newest time of each chat. */
  followedBy(next: SessionStates): SessionStates {
    const lastMessage = new Map(this.lastMessage);
    for (const [id, at] of next.lastMessage) {
      if (at > (lastMessage.get(id) ?? 0)) lastMessage.set(id, at);
    }
    return new SessionStates(next.byId, lastMessage);
  }

  /** ``entries`` newest conversation first: each by the later of its own
   *  last message and the newest one told here. Stable on a tie. */
  ordered<T extends Placed>(entries: T[]): T[] {
    const at = (e: T) => Math.max(e.last_message_at ?? 0, this.lastMessage.get(e.session_id) ?? 0);
    return entries
      .map((entry, index) => ({ entry, index, at: at(entry) }))
      .sort((a, b) => b.at - a.at || a.index - b.index)
      .map(({ entry, at: time }) => ({ ...entry, last_message_at: time }));
  }
}

/**
 * The chats' states, kept current by the backend's pushes, with the chat
 * on screen marked seen whenever it has news and the window is visible.
 */
export function useSessionStates(
  client: Pick<IgniClient, "rpc" | "onEvent">,
  connected: boolean,
  currentId: string,
): SessionStates {
  const [states, setStates] = useState<SessionStates>(SessionStates.NONE);
  // A push newer than the answer to the first ask wins over it.
  const pushed = useRef(false);

  useEffect(() => {
    if (!connected) return;
    let alive = true;
    pushed.current = false;
    void client
      .rpc<unknown>("list_session_states")
      .then((answer) => {
        const next = SessionStates.parse(answer);
        if (alive && next && !pushed.current) setStates((prev) => prev.followedBy(next));
      })
      .catch(() => {
        // An older backend without the method: no chat is marked.
      });
    return () => {
      alive = false;
    };
  }, [client, connected]);

  useEffect(() => {
    if (!connected) return;
    return client.onEvent((message) => {
      const next = SessionStates.fromPush(message);
      if (!next) return;
      pushed.current = true;
      setStates((prev) => prev.followedBy(next));
    });
  }, [client, connected]);

  // The chat on screen has news: the person is looking at it. Once per
  // finish — a mark already asked for is not asked again until it lands.
  const asked = useRef("");
  const unreadHere = connected && !!currentId && states.of(currentId).unread;
  useEffect(() => {
    if (!unreadHere) {
      asked.current = "";
      return;
    }
    const mark = () => {
      if (document.hidden || asked.current === currentId) return;
      asked.current = currentId;
      void client.rpc("mark_session_seen", { session_id: currentId }).catch(() => {
        asked.current = "";
      });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [client, currentId, unreadHere]);

  return states;
}
