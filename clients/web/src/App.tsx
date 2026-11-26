import { useMemo } from "react";
import { SidebarLayout } from "./chat/sidebarLayout";
import { useChatController } from "./chat/useChatController";
import { useChatSearch } from "./chat/useChatSearch";
import { useCommands } from "./chat/useCommands";
import { useHitl } from "./chat/useHitl";
import { useObserver } from "./chat/useObserver";
import { useRunPhase } from "./chat/useRunPhase";
import { useSessionBinding } from "./chat/useSessionBinding";
import { useSessionStates } from "./chat/sessionStates";
import { useBotAvatarLook } from "./chat/botAvatarLook";
import { useChatPorts, useSessionStartup, useShellHandlers } from "./chat/useShellCollaborators";
import { useShellStatus, useStatusPoll } from "./chat/useShellStatus";
import { useStampCancelledReply, useTranscriptState } from "./chat/useTranscriptState";
import { useTranscriptScroll } from "./chat/useTranscriptScroll";
import { useVisiblePages } from "./chat/windowNavigator";
import { useWindowPlace } from "./chat/useWindowPlace";
import { useWindowServices } from "./chat/windowServices";
import { BackendStateContext } from "./cloud/backendContext";
import { useBackendState } from "./cloud/useBackendState";
import { useLocalActivity } from "./cloud/useLocalActivity";
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
import { BackendBanner } from "./components/BackendBanner";
import { ChatSearchBar } from "./components/ChatSearchBar";
import { ConversationFrame } from "./components/ConversationFrame";
import { SideDock } from "./components/SideDock";
import { useTerminalToggle } from "./components/terminal/useTerminalToggle";
import { useTerminals } from "./components/terminal/useTerminals";
import { useFilesSession } from "./components/pages/files/useFilesSession";
import { FileViewerContext } from "./components/pages/files/viewerContext";
import { FPSCounterOverlay } from "./components/FPSCounter";
import { ScrollIndicator } from "./components/ScrollIndicator";
import { SignedOutApp } from "./components/SignedOutApp";
import { StatusLine } from "./components/StatusLine";
import { WakingOverlay } from "./components/WakingOverlay";

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
  // The desktop's cloud switch (null elsewhere). A cloud igni that needs
  // its person to sign in again takes no message until they have.
  const backend = useBackendState();
  const composerReady = connected && sessionBound && backend?.state !== "cloud_needs_sign_in";
  useLocalActivity(sessionId, run.processing, hitl.pending?.length ?? 0);
  // Which chats are working, waiting or unread — the sidebar's marks.
  const sessionStates = useSessionStates(client, connected, sessionId);
  const avatarLook = useBotAvatarLook(run.runPhase, sessionStates, sessionId);

  const { groupName, groupMark } = useGroupBranding(status?.theme);

  // The Files viewer's open tabs, active file and per-file scroll — held
  // here, above the dock, so closing it keeps them; a different project
  // starts over.
  const filesSession = useFilesSession(projectDir);
  const filesOpen = panel?.kind === "files";
  // The terminal opens beside the files, so it is not a panel. Its
  // shells are the window's: hiding the dock leaves them running.
  const { terminalOpen, toggleTerminal, closeTerminal } = useTerminalToggle();
  const terminals = useTerminals(client, connected);

  // Opening a file in the read-only viewer from a chat pill, wherever it
  // is. It docks the Files split open at that file, over whichever
  // backend is live — the local project or a cloud VM's.
  const fileViewer = useMemo(
    () => ({
      open: (path: string) => {
        filesSession.open(path);
        windowModel.write("panel", { kind: "files" });
      },
    }),
    [windowModel, filesSession.open],
  );

  // The floor's notifications per extension; the backend pushes
  // ``notifications_changed`` and this only listens.
  const [notificationCounts, setNotificationCounts] = useNotificationCounts(client, connected);
  const { contributions, extensions, setExtensions, extensionNames } = useExtensions(
    client,
    connected,
    windowModel,
  );
  // "Trust this folder?" while the folder's decision is ``ask``.
  useWorkspaceTrust(client, connected, projectDir, windowModel, dialog, sessionId);
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

  useHostBindings({
    windowModel,
    newChat: actions.newChat,
    updateCheck,
    page,
    signedIn: auth === "signed-in",
    projectDir,
    org: status?.cloud_org || "",
  });

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
    <BackendStateContext.Provider value={backend}>
    <FileViewerContext.Provider value={fileViewer}>
    <div className="shell" style={SidebarLayout.styleFor(sidebar)}>
      {/* Live FPS overlay, hidden by default: Ctrl/Cmd+Alt+Shift+F. */}
      <FPSCounterOverlay />
      <AppSidebar
        sidebar={sidebar}
        layout={layout}
        sessions={sessions}
        states={sessionStates}
        avatar={avatarLook}
        currentId={sessionId}
        contributions={contributions}
        notificationCounts={notificationCounts}
        activeKind={page?.kind}
        onOpenPage={navigator.openPage}
        onNewChat={actions.newChat}
        onNewChatInFolder={(folder) =>
          folder ? actions.attachFolder(folder) : actions.newChat()
        }
        onPickSession={actions.pickSession}
        status={status}
        client={client}
        auth={auth}
        onLogIn={actions.openLogin}
        onLogOut={actions.logOut}
      />

      {/* The window's one <main>: without it nothing on the page was in a
          landmark but the sidebar (axe: landmark-one-main, region). R683. */}
      <main className={`main${page ? " main--paged" : ""}`}>
        <AppHeader
          conn={conn}
          groupName={groupName}
          groupMark={groupMark}
          onToggleSidebar={layout.toggle}
          sidebarOpen={sidebar.open}
          canSearch={items.length > 0 && !page}
          searchOpen={search.searchOpen}
          onToggleSearch={search.toggleSearch}
          filesOpen={filesOpen}
          onToggleFiles={() => windowModel.togglePanel("files")}
          terminalOpen={terminalOpen}
          onToggleTerminal={toggleTerminal}
          status={status}
          waiting={notificationCounts.unread}
          onToggleNotifications={() => windowModel.togglePanel("notifications")}
          extensions={extensions}
          notificationCounts={notificationCounts}
          onOpenPage={navigator.openPage}
          client={client}
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
            onOpenSession={actions.pickSession}
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
            onRoute={navigator.navigate}
          />
        )}

        {/* Waking the VM dims the chat but keeps the composer: the
            gateway buffers what is typed meanwhile. */}
        <WakingOverlay backend={backend} />
        <BackendBanner backend={backend} />
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
          backend={backend}
          projectDir={projectDir}
          onPickProject={() => void actions.pickProject()}
          sessionId={sessionId}
          onSend={scroll.scrollToBottom}
        />
        <StatusLine
          status={status}
          client={client}
          pendingUpdate={updateCheck.pendingUpdate}
          onShowUpdate={updateCheck.showUpdate}
          onOpen={navigator.openPage}
        />
      </main>

      {/* The read-only Files viewer and the terminal, docked as a split
          to the right of the chat rather than over it. Toggled by the
          header's folder and terminal buttons; a chat pill opens the
          files at a file. */}
      {(filesOpen || terminalOpen) && (
        <SideDock
          client={client}
          connected={connected}
          filesSession={filesSession}
          terminals={terminals}
          filesOpen={filesOpen}
          terminalOpen={terminalOpen}
          onCloseFiles={() => windowModel.closePanel()}
          onCloseTerminal={closeTerminal}
        />
      )}

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
    </FileViewerContext.Provider>
    </BackendStateContext.Provider>
    </ExtensionNamesContext.Provider>
  );
}
