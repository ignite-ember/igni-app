import type { PageRoute } from "../chat/pageStack";
import type { SidebarLayout } from "../chat/sidebarLayout";
import type { AuthPhase } from "../chat/useShellStatus";
import type { Sidebar as SidebarModel } from "../clientState";
import type { SessionStates } from "../chat/sessionStates";
import type { AvatarLook } from "../chat/botAvatarLook";
import type { Contributions } from "../extensions/contributions";
import type { NotificationCounts } from "../notifications/model";
import type { IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import { Sidebar, type SessionEntry } from "./Sidebar";

export interface AppSidebarProps {
  /** ``ui.sidebar``. */
  sidebar: SidebarModel;
  layout: SidebarLayout;
  sessions: SessionEntry[];
  /** What each chat is doing, and which are unread. */
  states: SessionStates;
  currentId: string;
  contributions: Contributions;
  notificationCounts: NotificationCounts;
  /** The page showing, if any. */
  activeKind: string | undefined;
  onOpenPage: (route: PageRoute) => void;
  onNewChat: () => void;
  onNewChatInFolder: (folder: string) => void;
  onPickSession: (id: string) => void;
  /** Compact the open chat, from its row's right-click menu. */
  onCompact?: () => void;
  /** A reply is running in the open chat. */
  busy?: boolean;
  /** The account menu lives at the foot of the sidebar. */
  status: StatusUpdate | null;
  client: Pick<IgniClient, "rpc">;
  auth?: AuthPhase;
  onLogIn: () => void;
  onLogOut: () => void;
  /** What the cat beside New chat shows. */
  avatar?: AvatarLook;
}

/** The window's sidebar: igni's and the extensions' destinations, each
 *  with its unread count, above the sessions. Read from the
 *  contributions every render, because they fill in place. */
export function AppSidebar({
  sidebar,
  layout,
  sessions,
  states,
  currentId,
  contributions,
  notificationCounts,
  activeKind,
  onOpenPage,
  onNewChat,
  onNewChatInFolder,
  onPickSession,
  onCompact,
  busy,
  status,
  client,
  auth,
  onLogIn,
  onLogOut,
  avatar,
}: AppSidebarProps) {
  const openLink = (kind: string) => {
    const link = contributions.sidebar().find((l) => l.kind === kind);
    if (link) onOpenPage({ kind: link.kind, label: link.label });
  };
  return (
    <Sidebar
      open={sidebar.open}
      sessions={states.ordered(sessions).map((s) => ({ ...s, ...states.of(s.session_id) }))}
      currentId={currentId}
      links={contributions.sidebar()}
      activeLink={activeKind}
      badges={contributions.sidebarBadges(notificationCounts)}
      onLink={openLink}
      onNewChat={onNewChat}
      onNewChatInFolder={onNewChatInFolder}
      onPick={onPickSession}
      onCompact={onCompact}
      busy={busy}
      onClose={layout.close}
      section={sidebar.section}
      onSection={layout.setSection}
      status={status}
      client={client}
      auth={auth}
      onLogIn={onLogIn}
      onLogOut={onLogOut}
      avatar={avatar}
    />
  );
}
