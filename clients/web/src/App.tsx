import { SidebarLayout } from "./chat/sidebarLayout";
import { useChatController } from "./chat/useChatController";
import { useChatSearch } from "./chat/useChatSearch";
import { useCommands } from "./chat/useCommands";
import { useHitl } from "./chat/useHitl";
import { useObserver } from "./chat/useObserver";
import { useRunPhase } from "./chat/useRunPhase";
import { useSessionBinding } from "./chat/useSessionBinding";
import { useChatPorts, useSessionStartup, useShellHandlers } from "./chat/useShellCollaborators";
import { useShellStatus, useStatusPoll } from "./chat/useShellStatus";
import { useStampCancelledReply, useTranscriptState } from "./chat/useTranscriptState";
import { useTranscriptScroll } from "./chat/useTranscriptScroll";
import { useVisiblePages } from "./chat/windowNavigator";
import { useWindowPlace } from "./chat/useWindowPlace";
import { useWindowServices } from "./chat/windowServices";
import { ExtensionNamesContext } from "./extensions/extensionNames";
import { useDocumentTheme } from "./extensions/useDocumentTheme";
import { useExtensions } from "./extensions/useExtensions";
import { useExtensionTraffic } from "./extensions/useExtensionTraffic";
import { useNotificationCounts } from "./notifications/model";
import { useUpdateCheck } from "./update/useUpdateCheck";
import { useWorkspaceTrust } from "./workspaceTrust/model";
import { useGroupBranding } from "./lib/useGroupBranding";
import { useHostBindings } from "./lib/useHostBindings";
import { AppComposer } from "./components/AppComposer";
import { AppHeader } from "./components/AppHeader";
import { AppOverlays } from "./components/AppOverlays";
import { AppPages } from "./components/AppPages";
import { AppSidebar } from "./components/AppSidebar";
import { ChatSearchBar } from "./components/ChatSearchBar";
import { ConversationFrame } from "./components/ConversationFrame";
import { FPSCounterOverlay } from "./components/FPSCounter";
import { ScrollIndicator } from "./components/ScrollIndicator";
import { SignedOutApp } from "./components/SignedOutApp";
import { StatusLine } from "./components/StatusLine";

/**
 * The window: it builds the collaborators that live as long as it does,
 * hands them to one hook per concern, and lays the result out. The run,
 * the commands, the session, the status and the observer each live in
 * ``chat/``; nothing here keeps a copy of their state.
 */
export default function App() {
  const services = useWindowServices();
  const { client, windowModel, notifier } = services.core;
  const { chatItems, historyLoader, workflows, opening } = services.chat;
  const { statusSource, navigator, layout, composerRef } = services.shell;

  const transcript = useTranscriptState(chatItems);
  const { items, historyIndexToItemIndex, view } = transcript;
  const run = useRunPhase(client);
  useStampCancelledReply(run.runPhase, view);
  const hitl = useHitl(client, run.controls);
  const commands = useCommands(client);
  const shellStatus = useShellStatus(statusSource, windowModel);
  const { status, sessions, auth, refreshStatus } = shellStatus;
  const { panel, route, sidebar, sessionId, projectDir, dialog } = useWindowPlace(windowModel);
  const updateCheck = useUpdateCheck(client, windowModel);
  // Followed rather than read once, so an extension frame is told when
  // the document's theme changes.
  const frameTheme = useDocumentTheme();

  const { openModelMenu, loadCatalog } = commands;
  const { pushRouter, shell } = useChatPorts(services, transcript, shellStatus, openModelMenu);
  const controller = useChatController({
    client,
    windowModel,
    view,
    hitl: hitl.requests,
    run: run.controls,
    historyLoader,
    workflows,
    notifier,
    pushRouter,
    shell,
  });
  useObserver(client, controller.mirror);

  const startup = useSessionStartup(services, shellStatus, loadCatalog, updateCheck.checkNow);
  const { conn, sessionBound } = useSessionBinding({
    client,
    windowModel,
    sessions: controller.sessions,
    opening,
    onBound: startup.run,
  });
  const connected = conn === "connected";
  const composerReady = connected && sessionBound;

  useHostBindings({
    client,
    windowModel,
    view,
    updateCheck,
    arrival: opening.arrival,
    signedIn: auth === "signed-in",
    projectDir,
    org: status?.cloud_org || "",
  });
  const { groupName, groupMark } = useGroupBranding(status?.theme);

  // The floor's notifications per extension; the backend pushes
  // ``notifications_changed`` and this only listens.
  const [notificationCounts, setNotificationCounts] = useNotificationCounts(client, connected);
  const { contributions, extensions, setExtensions, extensionNames } = useExtensions(
    client,
    connected,
    windowModel,
  );
  // "Trust this folder?" while the folder's decision is ``ask``.
  useWorkspaceTrust(client, connected, projectDir, windowModel, dialog);
  // Events and host-model signals for installed extensions.
  const extensionTraffic = useExtensionTraffic(client, connected);
  useStatusPoll(refreshStatus, connected);

  const { pages, page } = useVisiblePages(route, contributions.pages);

  // Where the transcript is scrolled (``ui.scroll``), and finding in it.
  const scroll = useTranscriptScroll(windowModel, items);
  const search = useChatSearch(windowModel, items, scroll.virtuosoRef, panel);

  const pageData = {
    extensions,
    setExtensions,
    skills: commands.skills,
    maxContext: status?.max_context ?? 0,
  };
  const handlers = useShellHandlers(services, view, controller, refreshStatus, pageData);
  const { actions, switcher, pageServices } = handlers;

  // ── Render ────────────────────────────────────────────────────────
  if (auth === "signed-out") {
    return (
      <SignedOutApp
        client={client}
        panel={panel}
        onSignIn={actions.openLogin}
        onClosePanel={() => windowModel.closePanel()}
        onSignedIn={refreshStatus}
        onFailed={actions.wallLoginFailed}
      />
    );
  }

  return (
    <ExtensionNamesContext.Provider value={extensionNames}>
    <div className="shell" style={SidebarLayout.styleFor(sidebar)}>
      {/* Live FPS overlay, hidden by default: Ctrl/Cmd+Alt+Shift+F. */}
      <FPSCounterOverlay />
      <AppSidebar
        sidebar={sidebar}
        layout={layout}
        sessions={sessions}
        currentId={sessionId}
        contributions={contributions}
        notificationCounts={notificationCounts}
        activeKind={page?.kind}
        onOpenPage={navigator.openPage}
        onNewChat={actions.newChat}
        onPickSession={actions.pickSession}
      />

      <div className={`main${page ? " main--paged" : ""}`}>
        <AppHeader
          conn={conn}
          groupName={groupName}
          groupMark={groupMark}
          onToggleSidebar={layout.toggle}
          canSearch={items.length > 0}
          searchOpen={search.searchOpen}
          onToggleSearch={search.toggleSearch}
          projectDir={projectDir}
          onPickProject={() => void actions.pickProject()}
          status={status}
          waiting={notificationCounts.unread}
          onToggleNotifications={() => windowModel.togglePanel("notifications")}
          client={client}
          onLogIn={actions.openLogin}
          onLogOut={actions.logOut}
        />

        {/* The scroll indicator stands in for the hidden native
            scrollbar, outside ``.conversation`` so the header blur does
            not cover it. */}
        <ScrollIndicator element={scroll.scrollEl} />
        {search.searchOpen && sessionId && items.length > 0 && (
          <ChatSearchBar
            client={client}
            sessionId={sessionId}
            historyIndexToItemIndex={historyIndexToItemIndex}
            liveItemCount={items.length}
            onJumpTo={search.onSearchJump}
            onClose={() => windowModel.closePanel()}
          />
        )}
        <ConversationFrame
          items={items}
          transcript={view.transcript}
          runPhase={run.runPhase}
          processing={run.processing}
          pulsingItemId={search.pulsingItemId}
          handlers={controller.handlers}
          scroll={scroll}
          atBottomNow={() => windowModel.get("scroll").at_bottom}
          groupName={groupName}
          groupMark={groupMark}
          status={status}
          onLogin={actions.openLogin}
          onCommand={actions.runCommand}
        />

        {page && (
          <AppPages
            page={page}
            trail={pages}
            onCrumb={(index) => navigator.toCrumb(pages, index)}
            onBack={() => navigator.back(pages)}
            registry={contributions.pages}
            homeWindow={windowModel.clientId}
            theme={frameTheme}
            signals={extensionTraffic.signals}
            services={pageServices}
          />
        )}

        <AppComposer
          composerRef={composerRef}
          client={client}
          windowModel={windowModel}
          ready={composerReady}
          brandName={groupName}
          status={status}
          run={run}
          commands={commands}
          contributions={contributions}
          hitl={hitl}
          onResolveHitl={controller.resolveHitl}
          actions={actions}
          switcher={switcher}
        />
        <StatusLine
          status={status}
          sessionId={sessionId}
          client={client}
          extensions={extensions}
          notificationCounts={notificationCounts}
          pendingUpdate={updateCheck.pendingUpdate}
          onShowUpdate={updateCheck.showUpdate}
          onOpen={navigator.openPage}
        />
      </div>

      <AppOverlays
        client={client}
        windowModel={windowModel}
        notifier={notifier}
        contributions={contributions}
        extensions={extensions}
        projectDir={projectDir}
        onOpen={navigator.openPage}
        onPickFolder={actions.attachFolder}
        onCountsChanged={setNotificationCounts}
        onSignedIn={actions.signedIn}
        onLoginFailed={actions.loginFailed}
      />
    </div>
    </ExtensionNamesContext.Provider>
  );
}
