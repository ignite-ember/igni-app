import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccountMenu } from "./AccountMenu";
import { BlocksIcon, ChevronIcon, CircleIcon, McpIcon, NamedIcon, PuzzleIcon } from "./Icons";
import { useGroupBadge } from "./GroupIndicator";
import { ScrollIndicator } from "./ScrollIndicator";
import type { AuthPhase } from "../chat/useShellStatus";
import { badgeText } from "../notifications/model";
import type { IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import type { ChatActivity } from "../chat/sessionStates";

export interface SessionEntry {
  session_id: string;
  name: string;
  detail?: string;
  /** True when this session has a run waiting for the person to answer
   *  an approval. The backend sends it with ``list_sessions``; a
   *  backend that does not send it says nothing, so no row claims to
   *  be waiting. */
  has_paused_run?: boolean;
  /** The project folder the chat is bound to; the sidebar groups by it.
   *  Empty when the backend reports none. */
  folder?: string;
  /** What the chat is doing now (``session_states_changed``); idle when
   *  the backend does not say. */
  activity?: ChatActivity;
  /** A run finished after the person last looked at the chat. */
  unread?: boolean;
}

export interface SidebarLink {
  kind: string;
  label: string;
}

/** A folder's chats, in the order the backend listed them (newest
 *  first), with the folder's most-recent chat deciding the group's
 *  place in the list. */
interface SessionGroup {
  folder: string;
  label: string;
  sessions: SessionEntry[];
}

/** The folder's short name: the last path segment, or "Local" when the
 *  chat is not bound to a folder. */
function folderLabel(folder: string): string {
  if (!folder) return "Local";
  const parts = folder.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || folder;
}

/** Group chats by folder, keeping the backend's recency order — a
 *  folder's first appearance (its most-recent chat) fixes its place. */
function groupByFolder(sessions: SessionEntry[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  const byFolder = new Map<string, SessionGroup>();
  for (const s of sessions) {
    const folder = s.folder ?? "";
    let g = byFolder.get(folder);
    if (!g) {
      g = { folder, label: folderLabel(folder), sessions: [] };
      byFolder.set(folder, g);
      groups.push(g);
    }
    g.sessions.push(s);
  }
  return groups;
}

/** The glyph for a destination; a quiet dot stands in for an
 *  extension-contributed page igni does not know by name. */
function linkIcon(kind: string): ReactNode {
  if (kind === "plugins") return <PuzzleIcon size={15} />;
  if (kind === "mcp") return <McpIcon size={15} />;
  if (kind === "extensions") return <BlocksIcon size={15} />;
  return <CircleIcon size={7} />;
}

export function Sidebar({
  open,
  sessions,
  currentId,
  links,
  activeLink,
  badges = {},
  onLink,
  onNewChat,
  onNewChatInFolder,
  onPick,
  onClose,
  section = null,
  onSection,
  status,
  client,
  auth,
  onLogIn,
  onLogOut,
}: {
  open: boolean;
  sessions: SessionEntry[];
  currentId: string;
  /** Destinations that sit above the chats — plugins, extensions,
   *  agents. Above the list because that is what they are: places,
   *  not conversations. */
  links: SidebarLink[];
  /** Which one is open, if any. */
  activeLink?: string;
  /** Unread notifications per link kind — the floor's count for the
   *  extension that contributed the page. Absent or zero draws nothing. */
  badges?: Record<string, number>;
  onLink: (kind: string) => void;
  onNewChat: () => void;
  /** Start a new chat in a specific folder — the "+" on a folder group's
   *  header. */
  onNewChatInFolder?: (folder: string) => void;
  onPick: (id: string) => void;
  onClose: () => void;
  /** The part of the list in view — ``ui.sidebar.section``: `links`
   *  (the destinations) or `sessions`. Set from outside, the list
   *  scrolls there. */
  section?: "links" | "sessions" | null;
  /** The person scrolled the list into the other part. */
  onSection?: (section: "links" | "sessions") => void;
  /** The account menu's inputs — it sits at the foot of the sidebar,
   *  under the chats, the way most apps place "who is signed in". */
  status: StatusUpdate | null;
  client: Pick<IgniClient, "rpc">;
  /** Whether anybody is known to be signed in; derived from ``status``
   *  when not given. */
  auth?: AuthPhase;
  onLogIn: () => void;
  onLogOut: () => void;
}) {
  const groupBadge = useGroupBadge(client);
  // Which folder groups are collapsed (by folder key).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleGroup = (folder: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  const groups = groupByFolder(sessions);
  const listRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<HTMLDivElement>(null);
  // What this list last said it shows, so a section it reported itself
  // is not scrolled to again under the person's hand.
  const reportedRef = useRef<"links" | "sessions" | null>(null);

  const sectionInView = (): "links" | "sessions" => {
    const list = listRef.current;
    const header = sessionsRef.current;
    if (!list || !header) return "links";
    const top = parseFloat(getComputedStyle(list).paddingTop) || 0;
    return list.scrollTop + top >= header.offsetTop ? "sessions" : "links";
  };

  useEffect(() => {
    if (!section || section === reportedRef.current) return;
    reportedRef.current = section;
    const list = listRef.current;
    if (!list) return;
    if (section === "links") list.scrollTo({ top: 0 });
    else {
      const top = parseFloat(getComputedStyle(list).paddingTop) || 0;
      list.scrollTo({ top: (sessionsRef.current?.offsetTop ?? 0) - top });
    }
  }, [section]);

  // The floating cluster's height is also the list's top padding and
  // the blur strip's height — one measurement, three uses. It used to
  // be the literal 118 in two CSS rules that had to be changed
  // together; adding these links made it 230 and would have left both
  // stale, tucking the first session row up under the label.
  //
  // Measured rather than written down, so whatever the cluster grows
  // or loses next is accounted for without anyone remembering to.
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const apply = () =>
      el.parentElement?.style.setProperty("--sidebar-top-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      {open && window.innerWidth <= 700 && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 55, background: "rgba(0,0,0,0.35)" }}
          onClick={onClose}
        />
      )}
      <nav className={`sidebar ${open ? "" : "closed"}`}>
        {/* Solid strip sitting between the scrollable list (z:1)
            and the "Sessions" cluster (z:10) — hides items
            scrolling into the cluster's 118 px zone. */}
        <div className="sidebar-blur" aria-hidden="true" />
        {/* Floating top — head row and the New-chat button. The
            section links and "Sessions" label sit in the scrollable
            list below instead. Pulled out of normal flow so the list
            extends up behind it. Mirrors the ``.app-header`` /
            ``.conversation`` overlap pattern. */}
        <div className="sidebar-top" ref={topRef}>
          {/* The primary action sits at the top of the sidebar, where the
              theme toggle used to be — the theme control moved to the
              account menu at the foot. On macOS this row is also the
              title bar (traffic-light gutter + drag region); the button
              is excluded from the drag region so it stays clickable. */}
          <div className="sidebar-head">
            <button className="btn sidebar-new-chat" onClick={onNewChat}>
              + New chat
            </button>
          </div>
        </div>
        {/* Scroll-position overlay — same reason as the conversation:
            native scrollbar is hidden so the cluster blur doesn't
            frost it; this renders the thumb above the blur at z:30. */}
        <ScrollIndicator scrollRef={listRef} />
        <div
          className="sidebar-list"
          ref={listRef}
          onScroll={() => {
            const now = sectionInView();
            if (now === reportedRef.current) return;
            reportedRef.current = now;
            onSection?.(now);
          }}
        >
          {/* Links and the "Sessions" label scroll with the list
              rather than riding in the pinned cluster above. They are
              the head of one surface — destinations, then the chats
              under them — and pinning the label while the links
              scrolled past it would have read as two separate things. */}
          {links.length > 0 && (
            <nav className="sidebar-links" aria-label="Sections">
              {links.map((link) => (
                <button
                  key={link.kind}
                  className={`sidebar-link${activeLink === link.kind ? " active" : ""}`}
                  aria-current={activeLink === link.kind ? "page" : undefined}
                  onClick={() => onLink(link.kind)}
                  aria-label={
                    badges[link.kind]
                      ? `${link.label}, ${badges[link.kind]} unread`
                      : undefined
                  }
                >
                  <span className="sidebar-link-icon" aria-hidden="true">
                    {linkIcon(link.kind)}
                  </span>
                  <span className="sidebar-link-label">{link.label}</span>
                  {!!badges[link.kind] && (
                    <span className="extension-badge" aria-hidden="true">
                      {badgeText(badges[link.kind])}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          )}
          <div className="session-groups" ref={sessionsRef}>
            {sessions.length === 0 && (
              <>
                <div className="sidebar-section">Sessions</div>
                <div className="session-item" style={{ cursor: "default" }}>
                  No past sessions
                </div>
              </>
            )}
            {/* Chats grouped by their folder; the group with the most
                recent chat comes first (the backend lists newest-first,
                so a folder's place follows its first chat). */}
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.folder);
              return (
                <div className="session-group" key={g.folder || "__local__"}>
                  <div className="session-group-head">
                    <button
                      type="button"
                      className="session-group-toggle"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleGroup(g.folder)}
                    >
                      <span className="session-group-chevron" aria-hidden="true">
                        <ChevronIcon down={!isCollapsed} size={12} />
                      </span>
                      <span className="session-group-name" title={g.folder || g.label}>
                        {g.label}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="session-group-add"
                      title={`New chat in ${g.label}`}
                      aria-label={`New chat in ${g.label}`}
                      onClick={() =>
                        onNewChatInFolder ? onNewChatInFolder(g.folder) : onNewChat()
                      }
                    >
                      <NamedIcon name="plus" size={13} />
                    </button>
                  </div>
                  {!isCollapsed &&
                    g.sessions.map((s) => {
                      const current = s.session_id === currentId;
                      const running = s.activity === "running";
                      const waiting = !running && (s.has_paused_run || s.activity === "waiting");
                      // The chat on screen is being read as it finishes.
                      const unread = !!s.unread && !current && !running && !waiting;
                      return (
                        <div
                          key={s.session_id}
                          className={`session-item${current ? " current" : ""}${unread ? " unread" : ""}`}
                          title={s.detail || s.name}
                          onClick={() => onPick(s.session_id)}
                        >
                          <span className="session-name">{s.name || s.session_id}</span>
                          {running && (
                            <span
                              className="session-running"
                              role="img"
                              aria-label="Working"
                              title="Working"
                            />
                          )}
                          {waiting && (
                            <span
                              className="session-waiting"
                              role="img"
                              aria-label="Waiting for your answer"
                              title="Waiting for your answer"
                            >
                              waiting
                            </span>
                          )}
                          {unread && (
                            <span
                              className="session-unread"
                              role="img"
                              aria-label="New reply"
                              title="Finished — not opened yet"
                            />
                          )}
                          <span className="session-id">{s.session_id.slice(0, 8)}</span>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
        {/* The account at the foot of the sidebar, under the chats —
            where most apps keep "who am I signed in as". The group this
            person's agents come from is its second line, so the two read
            as one control. Outside the scrolling list so it stays put as
            the chats scroll; the menu rises upward out of this strip. */}
        <div className="sidebar-footer">
          <AccountMenu
            status={status}
            client={client}
            auth={auth}
            group={groupBadge}
            onLogIn={onLogIn}
            onLogOut={onLogOut}
          />
        </div>
      </nav>
    </>
  );
}
