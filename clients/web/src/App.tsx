import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Arrivals } from "./chat/arrival";
import { ChatItemFactory } from "./chat/chatItemFactory";
import { ChatItemIds } from "./chat/chatItemIds";
import { HistoryLoader } from "./chat/historyLoader";
import { HistoryTurnMapper } from "./chat/historyTurnMapper";
import {
  current as currentPage,
  openRoot,
  pop as popPage,
  truncateTo,
  visible as visiblePages,
  type PageRoute,
} from "./chat/pageStack";
import { ProjectFolderPicker } from "./chat/projectFolderPicker";
import { PushChannelRouter } from "./chat/pushChannelRouter";
import { SessionRow } from "./chat/sessionRow";
import type { ShellPort } from "./chat/shellPort";
import { useChatController } from "./chat/useChatController";
import { useChatSearch } from "./chat/useChatSearch";
import { useCommands } from "./chat/useCommands";
import { useHitl } from "./chat/useHitl";
import { useObserver } from "./chat/useObserver";
import { useRunPhase } from "./chat/useRunPhase";
import { useSessionBinding } from "./chat/useSessionBinding";
import { useStampCancelledReply, useTranscriptState } from "./chat/useTranscriptState";
import { useTranscriptScroll } from "./chat/useTranscriptScroll";
import { WorkflowLauncher } from "./chat/workflowLauncher";
import { useDocumentTheme } from "./extensions/useDocumentTheme";
import { useExtensions } from "./extensions/useExtensions";
import {
  SIDEBAR_BREAKPOINT_PX,
  WindowModel,
  ensureClientId,
  useWindowField,
} from "./clientState";
import { useExtensionTraffic } from "./extensions/useExtensionTraffic";
import { ChatSearchBar } from "./components/ChatSearchBar";
import { Composer } from "./components/composer/Composer";
import { ComposerDraft } from "./components/composer/composerDraft";
import { modeSwitchCommand, type PermissionMode } from "./components/composer/permissionModes";
import { FPSCounterOverlay } from "./components/FPSCounter";
import { HitlDialog, type HitlDecision } from "./components/HitlDialog";
import { useNotificationCounts, unreadFor } from "./notifications/model";
import { Notifier } from "./notifications/notifier";
import { useWorkspaceTrust } from "./workspaceTrust/model";
import { ScrollIndicator } from "./components/ScrollIndicator";
import { SignInWall } from "./components/SignInWall";
import { Sidebar, type SessionEntry } from "./components/Sidebar";
import { AppHeader } from "./components/AppHeader";
import { AppOverlays } from "./components/AppOverlays";
import { AppPages } from "./components/AppPages";
import { ConversationList } from "./components/ConversationList";
import { LoginDialog } from "./components/LoginDialog";
import { StatusLine } from "./components/StatusLine";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { host } from "./lib/host";
import { useGroupBranding } from "./lib/useGroupBranding";
import { useHostBindings } from "./lib/useHostBindings";
import { IgniClient } from "./protocol/client";
import type { StatusUpdate } from "./protocol/messages";
import { ExtensionNamesContext } from "./extensions/extensionNames";
import { useUpdateCheck } from "./update/useUpdateCheck";

/**
 * The window: it builds the collaborators that live as long as it does,
 * hands them to one hook per concern, and lays the result out. The run,
 * the commands, the session and the observer each live in ``chat/``;
 * nothing here keeps a copy of their state.
 */
export default function App() {
  const client = useMemo(() => new IgniClient(), []);
  // The one id allocator for this window's list: the ids are React keys,
  // so every item in it must come from here.
  const chatItems = useMemo(() => new ChatItemFactory(new ChatItemIds()), []);
  const historyLoader = useMemo(
    () => new HistoryLoader(client, new HistoryTurnMapper(chatItems), chatItems),
    [client, chatItems],
  );
  // This window's model (see ``clientState.ts``): the host owns it
  // (``host.ui`` to an extension), the views bind to it and keep no copy.
  // Keyed by ``host.viewKey`` so two Tauri windows, which share
  // localStorage, are two distinct models.
  const windowModel = useMemo(
    () =>
      new WindowModel(client, ensureClientId(host.viewKey), 250, host.kind, {
        // Until the model answers: a wide window with its sidebar out.
        sidebar: { open: window.innerWidth > SIDEBAR_BREAKPOINT_PX, width: null, section: null },
      }),
    [client],
  );
  const notifier = useMemo(() => new Notifier(windowModel, host), [windowModel]);
  const folderPicker = useMemo(() => new ProjectFolderPicker(client), [client]);
  const workflows = useMemo(() => new WorkflowLauncher(client), [client]);
  // The folder from New Window (``?dir=``) and a page from the link that
  // opened this window (``?open=``, see ``chat/arrival.ts``). Read once:
  // following a link is an arrival, not a place.
  const opening = useMemo(
    () => ({
      wantedDir: new URLSearchParams(window.location.search).get("dir") ?? "",
      arrival: Arrivals.fromSearch(window.location.search),
    }),
    [],
  );

  const { items, historyIndexToItemIndex, view, setItems } = useTranscriptState(chatItems);
  const run = useRunPhase(client);
  useStampCancelledReply(run.runPhase, view);
  const hitl = useHitl(client, run.controls);
  const commands = useCommands(client);
  const { loadCatalog, openModelMenu } = commands;
  const [status, setStatus] = useState<StatusUpdate | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const panel = useWindowField(windowModel, "panel");
  // Where this window is: ``ui.route``. Empty means the chat is showing.
  const route = useWindowField(windowModel, "route");
  const sidebar = useWindowField(windowModel, "sidebar");
  // The session this window shows — ``sessions.current`` to an extension.
  const sessionId = useWindowField(windowModel, "session");
  // The directory this window's session is locked to (tools + shell cwd).
  const projectDir = useWindowField(windowModel, "project_dir");
  const dialog = useWindowField(windowModel, "dialog");
  const updateCheck = useUpdateCheck(client, windowModel);
  const { checkRef } = updateCheck;
  // Followed rather than read once, so an extension frame is told when
  // the document's theme changes.
  const frameTheme = useDocumentTheme();

  // A skill picked from a panel, a message to edit and resend: the text
  // is the model's (``ui.composer``); the caret is the editor's, reached
  // through the handle the Composer fills in.
  const composerFocus = useRef<(() => void) | null>(null);
  const seedComposer = useCallback(
    (entry: string) => {
      // A pre-fill enters the mode its prefix asks for, as typing it would.
      windowModel.write("composer", ComposerDraft.fromWire(entry).toModel(), { force: true });
      composerFocus.current?.();
    },
    [windowModel],
  );
  const setSidebarOpen = useCallback(
    (open: boolean) => windowModel.write("sidebar", { ...windowModel.get("sidebar"), open }),
    [windowModel],
  );

  // igni is self-hosted: a session with no account has nowhere to put
  // anything. ``status`` is null until the first push; treating that as
  // signed-out would flash the wall at somebody who is signed in.
  const signedIn = Boolean(status?.cloud_email);
  const knowYet = status !== null;

  const refreshStatus = useCallback(async () => {
    try {
      const s = await client.rpc<StatusUpdate>("get_status");
      if (s) setStatus(s);
    } catch {
      /* disconnected */
    }
    try {
      windowModel.write("project_dir", await client.rpc<string>("get_project_dir"));
    } catch {
      /* older BE */
    }
  }, [client, windowModel]);
  const refreshSessions = useCallback(async () => {
    try {
      setSessions(SessionRow.listFrom(await client.rpc<unknown>("list_sessions")).map((row) => row.toEntry()));
    } catch {
      /* older BE or empty */
    }
  }, [client]);

  // Navigation: every move is a write of ``ui.route``, which an
  // extension's ``navigate`` writes too. "Take me to X" means the top of
  // X, even when X already shows one of its own sub-views.
  const navigate = useCallback((next: PageRoute[]) => windowModel.write("route", next), [windowModel]);
  const goPage = useCallback((to: PageRoute) => navigate(openRoot(to)), [navigate]);
  const goChat = useCallback(() => navigate([]), [navigate]);

  const pushRouter = useMemo(
    () =>
      new PushChannelRouter({
        windowModel,
        chatItems,
        transcript: view.transcript,
        setItems,
        setStatus,
        notifier,
        host,
        refreshSessions,
        events: window,
      }),
    [windowModel, chatItems, view, setItems, notifier, refreshSessions],
  );
  const shell = useMemo<ShellPort>(
    () => ({ setStatus, setSessions, refreshStatus, refreshSessions, goPage, openModelMenu, seedComposer }),
    [refreshStatus, refreshSessions, goPage, openModelMenu, seedComposer],
  );
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

  // What a bound window asks its session for. Re-tokenised first, so the
  // footer does not start from a count an older run inflated; the update
  // check is silent unless there is something newer.
  const onBound = useCallback(async () => {
    try {
      await client.rpc<unknown>("count_context_tokens");
    } catch {
      /* tokenizer not ready / older BE */
    }
    void refreshStatus();
    void refreshSessions();
    await loadCatalog();
    void checkRef.current(true);
  }, [client, refreshStatus, refreshSessions, loadCatalog, checkRef]);
  const { conn, sessionBound } = useSessionBinding({
    client,
    windowModel,
    sessions: controller.sessions,
    opening,
    onBound,
  });
  const connected = conn === "connected";

  useHostBindings({
    client,
    windowModel,
    view,
    updateCheck,
    arrival: opening.arrival,
    signedIn,
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

  // Status poll — mirrors the TUI status-bar cadence.
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(refreshStatus, 5_000);
    return () => clearInterval(t);
  }, [connected, refreshStatus]);

  // The part of the route this window can draw: an extension's page
  // appears once its extension is listed. Computed each render because
  // the page registry fills in place as extensions install.
  const pages = visiblePages(route, contributions.pages);
  const page = currentPage(pages);
  const goBack = () => navigate(popPage(pages));
  const goCrumb = (index: number) => navigate(truncateTo(pages, index));

  // Where the transcript is scrolled (``ui.scroll``), and finding in it.
  const scroll = useTranscriptScroll(windowModel, items);
  const search = useChatSearch(windowModel, items, scroll.virtuosoRef, panel);

  const resolveHitl = (decisions: HitlDecision[]) => {
    hitl.requests.clear();
    void controller.streamer.resume(decisions);
  };

  const pickProject = async () => {
    const pick = await folderPicker.pick(projectDir);
    if (pick.kind === "picked") void controller.sessions.attachFolder(pick.path);
    else if (pick.kind === "in-app") windowModel.openPanel("dir-picker");
  };

  const pickModel = async (name: string) => {
    try {
      const res = await client.switchModel(name);
      if (res.type === "info") view.info(res.text);
      void refreshStatus();
    } catch (e) {
      view.error(String(e));
    }
  };

  // The permission-mode picker flips the backend through its slash
  // command directly: a mode picked from the UI needs no chat line. The
  // ``permission_mode_changed`` push moves the badge.
  const pickMode = useCallback(
    (mode: PermissionMode) => {
      const cmd = modeSwitchCommand(status?.permission_mode ?? "default", mode);
      if (!cmd) return;
      void client.handleCommand(cmd).catch((e) => {
        view.error(`Mode switch failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    },
    [client, status?.permission_mode, view],
  );

  const sidebarOpen = sidebar.open;
  const { runPhase, processing } = run;

  // ── Render ────────────────────────────────────────────────────────
  if (knowYet && !signedIn) {
    return (
      <>
        <SignInWall client={client} onSignIn={() => windowModel.openPanel("login")} />
        {/* The login dialog belongs to this branch too: the overlays at
            the foot of the app are not drawn here. */}
        {panel?.kind === "login" && (
          <LoginDialog
            client={client}
            onClose={() => windowModel.closePanel()}
            // The wall is gated on ``status.cloud_email``; asked for
            // rather than waited on, so the app opens as soon as it can.
            onSignedIn={() => void refreshStatus()}
            onFailed={(detail) => view.error(`Login failed: ${detail}`)}
          />
        )}
      </>
    );
  }

  return (
    <ExtensionNamesContext.Provider value={extensionNames}>
    <div
      className="shell"
      // ``ui.sidebar.width``: an extension (or a future resize handle)
      // sizes the sidebar; ``null`` keeps the stylesheet's.
      style={
        sidebar.width
          ? ({ "--sidebar-w": `${sidebar.width}px` } as React.CSSProperties)
          : undefined
      }
    >
      {/* Live FPS overlay, hidden by default: Ctrl/Cmd+Alt+Shift+F. */}
      <FPSCounterOverlay />
      <Sidebar
        open={sidebarOpen}
        sessions={sessions}
        currentId={sessionId}
        links={contributions.sidebar()}
        activeLink={page?.kind}
        // Each entry an extension contributed carries that extension's
        // unread count.
        badges={Object.fromEntries(
          contributions
            .sidebar()
            .map((link) => [
              link.kind,
              unreadFor(notificationCounts, contributions.pages.ownerOf(link.kind)),
            ]),
        )}
        onLink={(kind) => {
          const link = contributions.sidebar().find((l) => l.kind === kind);
          if (link) goPage({ kind: link.kind, label: link.label });
        }}
        onNewChat={() => void controller.commands.run("/clear", false)}
        onPick={(id) => void controller.sessions.pick(id)}
        onClose={() => setSidebarOpen(false)}
        section={sidebar.section}
        onSection={(section) =>
          windowModel.write("sidebar", { ...windowModel.get("sidebar"), section })
        }
      />

      <div className={`main${page ? " main--paged" : ""}`}>
        <AppHeader
          conn={conn}
          groupName={groupName}
          groupMark={groupMark}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          canSearch={items.length > 0}
          searchOpen={search.searchOpen}
          onToggleSearch={search.toggleSearch}
          projectDir={projectDir}
          onPickProject={() => void pickProject()}
          status={status}
          waiting={notificationCounts.unread}
          onToggleNotifications={() => windowModel.togglePanel("notifications")}
          client={client}
          onLogIn={() => windowModel.openPanel("login")}
          onLogOut={() => void controller.commands.run("/logout", false)}
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
        <div className="conversation-frame">
          {/* See `.sr-only` in theme.css: the level message content
              sits under, so a heading the model wrote cannot skip from
              the page down to an h3. F138. */}
          <h2 className="sr-only">Conversation</h2>
          {items.length === 0 ? (
            <WelcomeScreen
              groupName={groupName}
              groupMark={groupMark}
              status={status}
              onLogin={() => windowModel.openPanel("login")}
              onCommand={(cmd) => void controller.commands.run(cmd, false)}
            />
          ) : (
            <ConversationList
              items={items}
              transcript={view.transcript}
              runPhase={runPhase}
              processing={processing}
              pulsingItemId={search.pulsingItemId}
              handlers={controller.handlers}
              scroll={scroll}
              atBottomNow={() => windowModel.get("scroll").at_bottom}
            />
          )}
        </div>

        {page && (
          <AppPages
            page={page}
            trail={pages}
            onCrumb={goCrumb}
            onBack={goBack}
            registry={contributions.pages}
            homeWindow={windowModel.clientId}
            theme={frameTheme}
            signals={extensionTraffic.signals}
            services={{
              client,
              close: goChat,
              seed: (text) => {
                goChat();
                seedComposer(text);
              },
              compact: () => {
                goChat();
                void controller.commands.run("/compact", false);
              },
              resumeLoop: (prompt) => {
                goChat();
                void controller.streamer.sendLoopIteration(prompt);
              },
              extensions,
              setExtensions,
              skills: commands.skills,
              maxContext: status?.max_context ?? 0,
            }}
          />
        )}

        <Composer
          brandName={groupName}
          hitlSlot={
            hitl.pending ? (
              <HitlDialog
                requirements={hitl.pending}
                onResolve={resolveHitl}
                currentMode={status?.permission_mode}
                onAcceptEditsThisRun={() => {
                  // ``streaming_done`` turns it back off, so the gate
                  // does not quietly outlive this task. The flip itself
                  // rides on the HITL decision
                  // (``HITLDecision.set_permission_mode``).
                  run.controls.autoAcceptForRunRef.current = true;
                }}
              />
            ) : null
          }
          client={client}
          connected={conn === "connected" && sessionBound}
          processing={processing}
          skills={commands.skills}
          backendCommands={commands.backendCommands}
          tools={contributions.tools()}
          focusRef={composerFocus}
          windowModel={windowModel}
          model={status?.model}
          modelMenuSignal={commands.modelMenuSignal}
          onPickModel={(name) => void pickModel(name)}
          onTool={(cmd) => void controller.commands.run(cmd, false)}
          onSubmit={(t) => void controller.submitter.submit(t)}
          onStop={run.cancel}
          permissionMode={status?.permission_mode}
          onPickMode={pickMode}
        />
        <StatusLine
          status={status}
          sessionId={sessionId}
          client={client}
          extensions={extensions}
          notificationCounts={notificationCounts}
          pendingUpdate={updateCheck.pendingUpdate}
          onShowUpdate={updateCheck.showUpdate}
          onOpen={goPage}
        />
      </div>

      <AppOverlays
        client={client}
        windowModel={windowModel}
        notifier={notifier}
        contributions={contributions}
        extensions={extensions}
        projectDir={projectDir}
        onOpen={goPage}
        onPickFolder={(dir) => void controller.sessions.attachFolder(dir)}
        onCountsChanged={setNotificationCounts}
        onSignedIn={(who) => {
          view.info(`Logged in as ${who}`);
          void refreshStatus();
        }}
        onLoginFailed={(detail) => {
          view.error(`Login failed: ${detail}`);
          void refreshStatus();
        }}
      />
    </div>
    </ExtensionNamesContext.Provider>
  );
}
