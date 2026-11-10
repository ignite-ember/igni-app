import type { Dispatch, ReactNode, SetStateAction } from "react";

import type { BasePageKind, PageRegistry, PageRoute } from "../chat/pageStack";
import type { SlashCommand } from "../chat/slashCommands";
import type { ExtensionPageProps, ExtensionSummary } from "../extensions/ExtensionPage";
import { ExtensionPageHost } from "../extensions/ExtensionPageHost";
import type { IgniClient } from "../protocol/client";
import { ContextPage } from "./pages/ContextPage";
import { HelpPage } from "./pages/HelpPage";
import { WorkflowsPage } from "./pages/WorkflowsPage";
import { PageContext } from "./PageShell";
import { AgentsPanel } from "./panels/AgentsPanel";
import { ExtensionsPanel } from "./panels/ExtensionsPanel";
import { HooksPanel } from "./panels/HooksPanel";
import { LoopPanel } from "./panels/LoopPanel";
import { McpPanel } from "./panels/McpPanel";
import { PluginsPanel } from "./panels/PluginsPanel";
import { ProgramsPanel } from "./panels/ProgramsPanel";
import { SchedulePanel } from "./panels/SchedulePanel";
import { SkillsPanel } from "./panels/SkillsPanel";
import { WatcherPanel } from "./panels/WatcherPanel";

/** What a page can ask of the app. */
export interface PageServices {
  client: IgniClient;
  /** Back to the chat. */
  close: () => void;
  /** Back to the chat with ``text`` in the composer, to edit and send:
   *  reading about something is not deciding to run it, and most of
   *  these take arguments. */
  seed: (text: string) => void;
  compact: () => void;
  /** Back to the chat to watch a loop's next iteration stream. */
  resumeLoop: (prompt: string) => void;
  extensions: ExtensionSummary[];
  /** ``set_extension_settings`` answers with the whole list, so the
   *  panel hands it straight back. */
  setExtensions: Dispatch<SetStateAction<ExtensionSummary[]>>;
  skills: SlashCommand[];
  maxContext: number;
}

/** igni's own pages, by kind. */
const BASE_PAGES: Record<BasePageKind, (s: PageServices) => ReactNode> = {
  plugins: (s) => <PluginsPanel client={s.client} onClose={s.close} />,
  extensions: (s) => (
    <ExtensionsPanel client={s.client} extensions={s.extensions} onChanged={s.setExtensions} onClose={s.close} />
  ),
  agents: (s) => <AgentsPanel client={s.client} onClose={s.close} />,
  schedule: (s) => <SchedulePanel client={s.client} onClose={s.close} />,
  watcher: (s) => <WatcherPanel client={s.client} onClose={s.close} />,
  hooks: (s) => <HooksPanel client={s.client} onClose={s.close} />,
  programs: (s) => <ProgramsPanel client={s.client} onClose={s.close} />,
  workflows: (s) => <WorkflowsPage client={s.client} onRun={s.seed} onClose={s.close} />,
  help: (s) => <HelpPage skills={s.skills} onRun={s.seed} onClose={s.close} />,
  context: (s) => (
    <ContextPage client={s.client} maxContext={s.maxContext} onCompact={s.compact} onClose={s.close} />
  ),
  loop: (s) => <LoopPanel client={s.client} onClose={s.close} onResume={s.resumeLoop} />,
  mcp: (s) => <McpPanel client={s.client} onClose={s.close} onAddServer={s.seed} />,
  skills: (s) => <SkillsPanel client={s.client} onRun={s.seed} onClose={s.close} />,
};

function isBasePage(kind: string): kind is BasePageKind {
  return Object.prototype.hasOwnProperty.call(BASE_PAGES, kind);
}

/**
 * The page on top of the route, over the conversation rather than in
 * its place — the transcript keeps its box and its scroll offset, so
 * coming back lands where you left. Every panel still draws its own
 * ``Drawer``; the context is what makes that page chrome.
 *
 * An extension's page is matched by ownership, not by name: asking the
 * registry who owns the kind keeps igni's pages and extensions' from
 * having to know about each other.
 */
export function AppPages({
  page,
  trail,
  onCrumb,
  onBack,
  registry,
  services,
  homeWindow,
  theme,
  signals,
}: {
  page: PageRoute;
  trail: PageRoute[];
  onCrumb: (index: number) => void;
  onBack: () => void;
  registry: PageRegistry;
  services: PageServices;
  homeWindow: string;
  theme: string;
  signals: Record<string, ExtensionPageProps["signals"]>;
}) {
  return (
    <PageContext.Provider value={{ trail, onCrumb, onBack, onClose: services.close }}>
      {isBasePage(page.kind) ? BASE_PAGES[page.kind](services) : extensionPage()}
    </PageContext.Provider>
  );

  function extensionPage(): ReactNode {
    const owner = registry.ownerOf(page.kind);
    if (owner === null || owner === "igni") return null;
    const extension = services.extensions.find((e) => e.id === owner);
    if (extension === undefined) return null;
    return (
      <ExtensionPageHost
        extension={extension}
        page={page}
        client={services.client}
        homeWindow={homeWindow}
        theme={theme}
        signals={signals[extension.id]}
        onClose={services.close}
      />
    );
  }
}
