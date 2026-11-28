import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
// Aliased: ``Icons`` exports a ``MenuIcon`` too, and that one is the
// hamburger. This is the glyph set the panels draw from.
import { MenuIcon as Glyph } from "@ignite-ember/ui-react";

import type { PageRoute } from "../chat/pageStack";
import type { ExtensionSummary } from "../extensions/ExtensionPage";
import { host } from "../lib/host";
import type { NotificationCounts } from "../notifications/model";
import type { ConnectionState, IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import { HeaderStatusChips } from "./HeaderStatusChips";
import { TopBlur } from "./page/TopBlur";
import { FolderIcon, PanelLeftIcon, TerminalIcon } from "./Icons";

/** The most the bell's count says before it gives up counting. */
const BELL_COUNT_CAP = 99;

/** The space kept between the open search pill and the sidebar toggle. */
const SEARCH_PILL_CLEARANCE = 8;

export interface AppHeaderProps {
  conn: ConnectionState;
  groupName: string;
  groupMark: string | null;
  onToggleSidebar: () => void;
  /** Whether the sidebar is open — drives the toggle icon's two states. */
  sidebarOpen: boolean;
  /** Whether there is a conversation to search. */
  canSearch: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  /** The open search's body (``ChatSearchBar``), shown inside the pill
   *  the search icon grows into. */
  searchBar?: ReactNode;
  /** Whether the Files split is docked open — drives the folder button. */
  filesOpen: boolean;
  onToggleFiles: () => void;
  /** Whether the terminal is open in the dock — drives its button. */
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  status: StatusUpdate | null;
  /** Unread notifications: the bell's count. */
  waiting: number;
  /** Whether the notifications sheet is open — lights the bell. */
  notificationsOpen?: boolean;
  onToggleNotifications: () => void;
  /** Installed extensions — their status chips sit left in the header,
   *  after igni's own, right of the sidebar toggle. */
  extensions: ExtensionSummary[];
  notificationCounts: NotificationCounts;
  onOpenPage: (route: PageRoute) => void;
  client: IgniClient;
}

/**
 * The main column's header: the sidebar toggle, then the status chips
 * (the watcher, then extensions'), the open page's breadcrumb; on the
 * right find, what is waiting, and the files and terminal toggles.
 *
 * It is also the desktop window's drag region: ``data-tauri-drag-region``
 * and the stylesheet's ``-webkit-app-region`` where WebKit honours
 * them, and ``host.bindDragRegion`` where it does not. All of it is
 * inert outside Tauri.
 */
export function AppHeader(props: AppHeaderProps) {
  const { conn, status, waiting } = props;
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    return el ? host.bindDragRegion(el) : undefined;
  }, []);
  const searchOpen = props.searchOpen && !!props.searchBar;
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchIconRef = useRef<HTMLButtonElement>(null);
  useSearchPillRoom(searchOpen, sidebarToggleRef, searchRef);
  useFocusBackOnClose(searchOpen, searchRef, searchIconRef);

  return (
    <header ref={headerRef} className="app-header" data-tauri-drag-region>
      {/* The opaque panel behind the header content, so messages
          scrolling under it disappear at its edge; also the drag area. */}
      <div className="app-header-blur" aria-hidden="true">
        <TopBlur />
      </div>
      <button
        ref={sidebarToggleRef}
        className="icon-btn"
        title={props.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        aria-label={props.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        aria-pressed={props.sidebarOpen}
        onClick={props.onToggleSidebar}
      >
        <PanelLeftIcon open={props.sidebarOpen} />
      </button>
      {/* The open page's breadcrumb (``Chat / Plugins``) renders here,
          portaled in from ``PageShell`` so the trail sits to the right of
          the sidebar toggle. Empty when no page is open. */}
      <div className="header-crumbs" id="app-header-crumbs" />
      {/* Status chips, left to right after the breadcrumb: igni's own,
          then extensions' in the order they came. */}
      <HeaderStatusChips
        status={status}
        extensions={props.extensions}
        notificationCounts={props.notificationCounts}
        onOpenPage={props.onOpenPage}
        client={props.client}
      />
      {/* The igni flame, wordmark and version live at the foot of the
          account menu now, not here — the top bar stays clean. */}
      <div className="header-spacer" />
      {/* Find: the icon's own outline grows leftward into the search
          field, over the chips and breadcrumb, and shrinks back on close. */}
      {props.canSearch && (
        <div ref={searchRef} className="header-search" data-open={searchOpen || undefined}>
          <div className="header-search-pill">
            <button
              ref={searchIconRef}
              type="button"
              className="header-search-icon"
              title={searchOpen ? "Close find (⌘F)" : "Find in conversation (⌘F)"}
              aria-label="Find in conversation"
              aria-expanded={searchOpen}
              onClick={props.onToggleSearch}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ display: "block" }}
              >
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L13.5 13.5" />
              </svg>
            </button>
            {searchOpen && props.searchBar}
          </div>
        </div>
      )}
      {(status?.cloud_connected || waiting > 0) && (
        <>
          <button
            className={`chip chip-bell${waiting ? " has-waiting" : ""}${props.notificationsOpen ? " active" : ""}`}
            title={
              waiting
                ? `${waiting} unread ${waiting === 1 ? "notification" : "notifications"}`
                : "Nothing is waiting on you"
            }
            aria-label="Notifications"
            aria-expanded={!!props.notificationsOpen}
            onClick={props.onToggleNotifications}
          >
            <Glyph name="bell" />
            {/* The count, not a dot: "three people are waiting" and
                "somebody is waiting" are different amounts of urgency. */}
            {!!waiting && (
              <span className="chip-bell-count">
                {waiting > BELL_COUNT_CAP ? `${BELL_COUNT_CAP}+` : waiting}
              </span>
            )}
          </button>
          {/* What is waiting, set apart from the dock's two toggles. */}
          <span className="chip-divider" aria-hidden="true" />
        </>
      )}
      {/* The project's files, as a read-only split beside the chat —
          opened and closed here, after what is waiting. */}
      <button
        className={`chip chip-files${props.filesOpen ? " active" : ""}`}
        title={props.filesOpen ? "Close files" : "Browse project files"}
        aria-label="Files"
        aria-pressed={props.filesOpen}
        onClick={props.onToggleFiles}
      >
        <FolderIcon size={15} />
      </button>
      {/* A shell where igni runs — this machine, or the cloud VM — in
          the same dock, below the files when both are open. */}
      <button
        className={`chip chip-terminal${props.terminalOpen ? " active" : ""}`}
        title={props.terminalOpen ? "Close terminal" : "Open terminal"}
        aria-label="Terminal"
        aria-pressed={props.terminalOpen}
        onClick={props.onToggleTerminal}
      >
        <TerminalIcon size={15} />
      </button>
      {conn === "replaced" && (
        <button
          className="chip"
          title="This chat was opened in another tab/window. Click to take over here."
          onClick={() => props.client.connect()}
        >
          <span className="dot disconnected" />
          <span className="chip-label">opened elsewhere — reconnect</span>
        </button>
      )}
    </header>
  );
}

/**
 * Give the open search pill the room between the sidebar toggle and the
 * search icon's right edge, as ``--header-search-room``, so it covers
 * the chips and breadcrumb but never the toggle.
 */
function useSearchPillRoom(
  open: boolean,
  toggleRef: RefObject<HTMLButtonElement | null>,
  searchRef: RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const toggle = toggleRef.current;
      const search = searchRef.current;
      if (!toggle || !search) return;
      const room =
        search.getBoundingClientRect().right -
        toggle.getBoundingClientRect().right -
        SEARCH_PILL_CLEARANCE;
      if (room > 0) search.style.setProperty("--header-search-room", `${Math.floor(room)}px`);
    };
    measure();
    // The header changes width with the window and with the sidebar.
    const header = searchRef.current?.parentElement;
    const observer =
      header && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (header) observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, toggleRef, searchRef]);
}

/** When the pill closes with focus inside it (or lost with the field),
 *  hand focus back to the search icon it shrank into. */
function useFocusBackOnClose(
  open: boolean,
  searchRef: RefObject<HTMLDivElement | null>,
  iconRef: RefObject<HTMLButtonElement | null>,
) {
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (wasOpen.current && !open) {
      const active = document.activeElement;
      if (!active || active === document.body || searchRef.current?.contains(active)) {
        iconRef.current?.focus();
      }
    }
    wasOpen.current = open;
  }, [open, searchRef, iconRef]);
}
