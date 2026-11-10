import type { PageRoute } from "../chat/pageStack";
import type { SidebarLayout } from "../chat/sidebarLayout";
import type { Sidebar as SidebarModel } from "../clientState";
import type { Contributions } from "../extensions/contributions";
import type { NotificationCounts } from "../notifications/model";
import { Sidebar, type SessionEntry } from "./Sidebar";

export interface AppSidebarProps {
  /** ``ui.sidebar``. */
  sidebar: SidebarModel;
  layout: SidebarLayout;
  sessions: SessionEntry[];
  currentId: string;
  contributions: Contributions;
  notificationCounts: NotificationCounts;
  /** The page showing, if any. */
  activeKind: string | undefined;
  onOpenPage: (route: PageRoute) => void;
  onNewChat: () => void;
  onPickSession: (id: string) => void;
}

/** The window's sidebar: igni's and the extensions' destinations, each
 *  with its unread count, above the sessions. Read from the
 *  contributions every render, because they fill in place. */
export function AppSidebar({
  sidebar,
  layout,
  sessions,
  currentId,
  contributions,
  notificationCounts,
  activeKind,
  onOpenPage,
  onNewChat,
  onPickSession,
}: AppSidebarProps) {
  const openLink = (kind: string) => {
    const link = contributions.sidebar().find((l) => l.kind === kind);
    if (link) onOpenPage({ kind: link.kind, label: link.label });
  };
  return (
    <Sidebar
      open={sidebar.open}
      sessions={sessions}
      currentId={currentId}
      links={contributions.sidebar()}
      activeLink={activeKind}
      badges={contributions.sidebarBadges(notificationCounts)}
      onLink={openLink}
      onNewChat={onNewChat}
      onPick={onPickSession}
      onClose={layout.close}
      section={sidebar.section}
      onSection={layout.setSection}
    />
  );
}
