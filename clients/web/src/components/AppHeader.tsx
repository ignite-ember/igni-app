import { useEffect, useRef } from "react";
// Aliased: ``Icons`` exports a ``MenuIcon`` too, and that one is the
// hamburger. This is the glyph set the panels draw from.
import { MenuIcon as Glyph } from "@ignite-ember/ui-react";

import type { PageRoute } from "../chat/pageStack";
import { ExtensionIndicator } from "../extensions/ExtensionIndicator";
import type { ExtensionSummary } from "../extensions/ExtensionPage";
import { host } from "../lib/host";
import { unreadFor, type NotificationCounts } from "../notifications/model";
import type { ConnectionState, IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import { FolderIcon, PanelLeftIcon, TerminalIcon } from "./Icons";

/** The most the bell's count says before it gives up counting. */
const BELL_COUNT_CAP = 99;

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
  /** Whether the Files split is docked open — drives the folder button. */
  filesOpen: boolean;
  onToggleFiles: () => void;
  /** Whether the terminal is open in the dock — drives its button. */
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  status: StatusUpdate | null;
  /** Unread notifications: the bell's count. */
  waiting: number;
  onToggleNotifications: () => void;
  /** Installed extensions — their status chips sit in the header now,
   *  beside igni's own controls, rather than in the footer. */
  extensions: ExtensionSummary[];
  notificationCounts: NotificationCounts;
  onOpenPage: (route: PageRoute) => void;
  client: Pick<IgniClient, "connect" | "asExtension">;
}

/**
 * The main column's header: the sidebar toggle, the brand with the
 * connection, find, and what is waiting. The folder and the environment
 * sit under the composer, and the account at the foot of the sidebar.
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

  return (
    <header ref={headerRef} className="app-header" data-tauri-drag-region>
      {/* The opaque panel behind the header content, so messages
          scrolling under it disappear at its edge; also the drag area. */}
      <div className="app-header-blur" aria-hidden="true" />
      <button
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
      {/* The igni flame, wordmark and version live at the foot of the
          account menu now, not here — the top bar stays clean. */}
      <div className="header-spacer" />
      {/* Extensions' status chips — data the host draws, moved up from the
          footer so they sit beside igni's own header controls. */}
      {status &&
        props.extensions.flatMap((extension) =>
          extension.indicators.map((indicator) => (
            <ExtensionIndicator
              key={indicator.id}
              extensionId={extension.id}
              indicator={indicator}
              unread={unreadFor(props.notificationCounts, extension.id)}
              onCall={(method, args) => props.client.asExtension(extension.id).rpc(method, args)}
              onOpen={(kind) => {
                const page = extension.pages.find((p) => p.kind === kind);
                if (page) props.onOpenPage({ kind: page.kind, label: page.label });
              }}
            />
          )),
        )}
      {props.canSearch && (
        <button
          className={`chip chip-search${props.searchOpen ? " active" : ""}`}
          title="Find in conversation (⌘F)"
          aria-label="Find in conversation"
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
      )}
      {/* The project's files, as a read-only split beside the chat —
          opened and closed here, next to what is waiting. */}
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
      {(status?.cloud_connected || waiting > 0) && (
        <button
          className={waiting ? "chip chip-bell has-waiting" : "chip chip-bell"}
          title={
            waiting
              ? `${waiting} unread ${waiting === 1 ? "notification" : "notifications"}`
              : "Nothing is waiting on you"
          }
          aria-label="Notifications"
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
      )}
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
