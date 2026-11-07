/**
 * The collaborators the window builds from its hooks' outputs, rather
 * than once up front like {@link WindowServices}: each needs something a
 * hook returns (a state setter, the transcript view, the controller).
 *
 * Every hook here memoises on the members it reads, never on a whole
 * hook result, so a collaborator is rebuilt only when one of them
 * changes — which, for the setters and the services, is never.
 */

import { useMemo } from "react";

import { host } from "../lib/host";
import { PushChannelRouter } from "./pushChannelRouter";
import { RunSettingsSwitcher } from "./runSettingsSwitcher";
import { SessionStartup } from "./sessionStartup";
import { ShellActions, type PageServiceData } from "./shellActions";
import type { ShellPort } from "./shellPort";
import type { TranscriptState } from "./useTranscriptState";
import type { ChatController } from "./useChatController";
import type { ShellStatus } from "./useShellStatus";
import type { WindowServices } from "./windowServices";

type StatusHandles = Pick<
  ShellStatus,
  "setStatus" | "setSessions" | "refreshStatus" | "refreshSessions"
>;

/** What the chat controllers are handed: where pushes go, and the shell. */
export function useChatPorts(
  services: WindowServices,
  transcript: Pick<TranscriptState, "view" | "setItems">,
  status: StatusHandles,
  openModelMenu: () => void,
): { pushRouter: PushChannelRouter; shell: ShellPort } {
  const { windowModel, notifier } = services.core;
  const { chatItems } = services.chat;
  const { navigator, seeder } = services.shell;
  const { view, setItems } = transcript;
  const { setStatus, setSessions, refreshStatus, refreshSessions } = status;
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
    [windowModel, chatItems, view, setItems, setStatus, notifier, refreshSessions],
  );
  const shell = useMemo<ShellPort>(
    () => ({
      setStatus,
      setSessions,
      refreshStatus,
      refreshSessions,
      goPage: navigator.openPage,
      openModelMenu,
      seedComposer: seeder.seed,
    }),
    [setStatus, setSessions, refreshStatus, refreshSessions, navigator, openModelMenu, seeder],
  );
  return { pushRouter, shell };
}

/** What a bound window asks its session for (see ``sessionStartup.ts``). */
export function useSessionStartup(
  services: WindowServices,
  status: Pick<ShellStatus, "refreshStatus" | "refreshSessions">,
  loadCatalog: () => Promise<void>,
  checkUpdate: (silent: boolean) => Promise<void>,
): SessionStartup {
  const { statusSource } = services.shell;
  const { refreshStatus, refreshSessions } = status;
  return useMemo(
    () =>
      new SessionStartup({
        source: statusSource,
        refreshStatus,
        refreshSessions,
        loadCatalog,
        checkUpdate,
      }),
    [statusSource, refreshStatus, refreshSessions, loadCatalog, checkUpdate],
  );
}

export interface ShellHandlers {
  actions: ShellActions;
  switcher: RunSettingsSwitcher;
  pageServices: ReturnType<ShellActions["pageServices"]>;
}

/** What the person does to the shell, the composer's run settings, and
 *  what an extension page is handed. */
export function useShellHandlers(
  services: WindowServices,
  view: TranscriptState["view"],
  controller: ChatController,
  refreshStatus: () => Promise<void>,
  pageData: PageServiceData,
): ShellHandlers {
  const { client, windowModel } = services.core;
  const { folderPicker } = services.chat;
  const { navigator, seeder } = services.shell;
  const actions = useMemo(
    () =>
      new ShellActions({
        client,
        windowModel,
        view,
        controller,
        folderPicker,
        navigator,
        seeder,
        refreshStatus,
      }),
    [client, windowModel, view, controller, folderPicker, navigator, seeder, refreshStatus],
  );
  const switcher = useMemo(
    () => new RunSettingsSwitcher({ client, view, refreshStatus }),
    [client, view, refreshStatus],
  );
  const { extensions, setExtensions, skills, maxContext } = pageData;
  const pageServices = useMemo(
    () => actions.pageServices({ extensions, setExtensions, skills, maxContext }),
    [actions, extensions, setExtensions, skills, maxContext],
  );
  return { actions, switcher, pageServices };
}
