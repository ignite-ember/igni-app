/**
 * The window's composition root: the collaborators that live as long as
 * it does, built once, in one place.
 *
 * Grouped by who uses them: ``core`` is what every part of the shell
 * talks to; ``chat`` is what the chat controllers are built from;
 * ``shell`` is what the layout around the chat acts through.
 */

import { createRef, useMemo, type RefObject } from "react";

import { WindowModel, ensureClientId } from "../clientState";
import type { ComposerHandle } from "../components/composer/composerContract";
import { host, type Host } from "../lib/host";
import { Notifier } from "../notifications/notifier";
import { IgniClient } from "../protocol/client";
import { Arrivals } from "./arrival";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { ComposerSeeder } from "./composerSeeder";
import { HistoryLoader } from "./historyLoader";
import { HistoryTurnMapper } from "./historyTurnMapper";
import { ProjectFolderPicker } from "./projectFolderPicker";
import type { WindowOpening } from "./sessionSwitcher";
import { SidebarLayout } from "./sidebarLayout";
import { StatusSource } from "./statusSource";
import { WindowNavigator } from "./windowNavigator";
import { WorkflowLauncher } from "./workflowLauncher";

/** What a window is opened into. */
export interface WindowEnvironment {
  host: Pick<Host, "viewKey" | "kind" | "notify">;
  /** The query string the window was opened with. */
  search: string;
  innerWidth: number;
}

export interface CoreServices {
  readonly client: IgniClient;
  /** This window's model (see ``clientState.ts``): the host owns it
   *  (``host.ui`` to an extension), the views bind to it and keep no
   *  copy. */
  readonly windowModel: WindowModel;
  readonly notifier: Notifier;
}

export interface ChatServices {
  /** The one id allocator for this window's list: the ids are React
   *  keys, so every item in it must come from here. */
  readonly chatItems: ChatItemFactory;
  readonly historyLoader: HistoryLoader;
  readonly folderPicker: ProjectFolderPicker;
  readonly workflows: WorkflowLauncher;
  readonly opening: WindowOpening;
}

export interface ShellServices {
  readonly statusSource: StatusSource;
  readonly navigator: WindowNavigator;
  readonly layout: SidebarLayout;
  /** The handle the Composer fills in while it is mounted. */
  readonly composerRef: RefObject<ComposerHandle | null>;
  readonly seeder: ComposerSeeder;
}

/** How long the model waits before it sends a burst of writes. */
const WINDOW_MODEL_DEBOUNCE_MS = 250;

export class WindowServices {
  constructor(
    readonly core: CoreServices,
    readonly chat: ChatServices,
    readonly shell: ShellServices,
  ) {}

  static create(env: WindowEnvironment): WindowServices {
    const client = new IgniClient();
    const chatItems = new ChatItemFactory(new ChatItemIds());
    const composerRef = createRef<ComposerHandle>();
    // Keyed by ``host.viewKey`` so two Tauri windows, which share
    // localStorage, are two distinct models.
    const windowModel = new WindowModel(
      client,
      ensureClientId(env.host.viewKey),
      WINDOW_MODEL_DEBOUNCE_MS,
      env.host.kind,
      { sidebar: SidebarLayout.initialFor(env.innerWidth) },
    );
    return new WindowServices(
      { client, windowModel, notifier: new Notifier(windowModel, env.host) },
      {
        chatItems,
        historyLoader: new HistoryLoader(client, new HistoryTurnMapper(chatItems), chatItems),
        folderPicker: new ProjectFolderPicker(client),
        workflows: new WorkflowLauncher(client),
        opening: WindowServices.openingFrom(env.search),
      },
      {
        statusSource: new StatusSource(client),
        navigator: new WindowNavigator(windowModel),
        layout: new SidebarLayout(windowModel),
        composerRef,
        seeder: new ComposerSeeder(windowModel, composerRef),
      },
    );
  }

  /** The folder from New Window (``?dir=``) and a page from the link
   *  that opened this window (``?open=``, see ``arrival.ts``). Read
   *  once: following a link is an arrival, not a place. */
  static openingFrom(search: string): WindowOpening {
    return {
      wantedDir: new URLSearchParams(search).get("dir") ?? "",
      arrival: Arrivals.fromSearch(search),
    };
  }
}

/** This window's services, built on its first render. */
export function useWindowServices(): WindowServices {
  return useMemo(
    () =>
      WindowServices.create({
        host,
        search: window.location.search,
        innerWidth: window.innerWidth,
      }),
    [],
  );
}
