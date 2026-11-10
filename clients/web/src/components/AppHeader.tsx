import { useEffect, useRef } from "react";
// Aliased: ``Icons`` exports a ``MenuIcon`` too, and that one is the
// hamburger. This is the glyph set the panels draw from.
import { MenuIcon as Glyph } from "@ignite-ember/ui-react";

import { host } from "../lib/host";
import type { ConnectionState, IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import { AccountMenu } from "./AccountMenu";
import { BrandMark } from "./BrandMark";
import { MenuIcon } from "./Icons";
import { ProjectChip } from "./ProjectChip";
import { BackendVersionChip } from "./StatusBits";

/** The most the bell's count says before it gives up counting. */
const BELL_COUNT_CAP = 99;

export interface AppHeaderProps {
  conn: ConnectionState;
  groupName: string;
  groupMark: string | null;
  onToggleSidebar: () => void;
  /** Whether there is a conversation to search. */
  canSearch: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  projectDir: string;
  onPickProject: () => void;
  status: StatusUpdate | null;
  /** Unread notifications: the bell's count. */
  waiting: number;
  onToggleNotifications: () => void;
  client: Pick<IgniClient, "rpc" | "connect">;
  onLogIn: () => void;
  onLogOut: () => void;
}

/**
 * The main column's header: the sidebar toggle, the brand with the
 * connection, find, the project, what is waiting, the account.
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
      <button className="icon-btn" title="Toggle sessions" onClick={props.onToggleSidebar}>
        <MenuIcon />
      </button>
      <div className="brand">
        <BrandMark mark={props.groupMark} size={20} />
        <span>{props.groupName}</span>
        <span
          className={`dot conn-dot ${conn === "replaced" ? "disconnected" : conn}`}
          title={`backend ${conn}`}
        />
        {/* Last in the row: ``igni ● v0.9.0``. Paints only where a host
            embedded the version. */}
        <BackendVersionChip />
      </div>
      <div className="header-spacer" />
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
      <ProjectChip projectDir={props.projectDir} onPick={props.onPickProject} />
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
      <AccountMenu status={status} client={props.client} onLogIn={props.onLogIn} onLogOut={props.onLogOut} />
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
