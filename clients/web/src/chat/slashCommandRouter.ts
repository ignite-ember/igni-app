/**
 * Runs a slash command and acts on the backend's answer: one method per
 * action that does more than open a page, picked from a table, and one
 * table for the actions that only open a page.
 *
 * ``/workflows`` is intercepted before the backend sees it
 * (``workflowLauncher.ts``). ``echo=false`` is the UI-affordance path —
 * a menu or a button — where the command runs without appearing as a
 * typed message.
 */

import type { WindowModel } from "../clientState";
import type { IgniClient } from "../protocol/client";
import type { CommandAction, CommandResult, ServerMessage } from "../protocol/messages";
import type { PageRoute } from "./pageStack";
import type { RunStreamer } from "./runStreamer";
import type { SessionSwitcher } from "./sessionSwitcher";
import type { ShellPort } from "./shellPort";
import type { TranscriptView } from "./transcriptView";
import type { RunControls } from "./useRunPhase";
import { WorkflowLauncher } from "./workflowLauncher";

/** The actions whose whole effect is a page. ``showContent`` pages also
 *  put the backend's text in the chat when the command was typed. */
export const PAGE_FOR_ACTION: Partial<
  Record<CommandAction, { route: PageRoute; showContent?: boolean }>
> = {
  mcp: { route: { kind: "mcp", label: "MCP servers" } },
  loop: { route: { kind: "loop", label: "Loop" }, showContent: true },
  schedule: { route: { kind: "schedule", label: "Scheduled tasks" }, showContent: true },
  agents: { route: { kind: "agents", label: "Agents" } },
  skills: { route: { kind: "skills", label: "Skills" } },
  plugins: { route: { kind: "plugins", label: "Plugins" } },
  extensions: { route: { kind: "extensions", label: "Extensions" } },
  hooks: { route: { kind: "hooks", label: "Hooks" } },
  watcher: { route: { kind: "watcher", label: "Watcher" } },
  help: { route: { kind: "help", label: "Help" } },
  ctx: { route: { kind: "context", label: "Context" } },
  programs: { route: { kind: "programs", label: "Programs" } },
};

const LOOP_ITERATION_PREFIX = "<loop-iteration ";

/**
 * One command as issued. ``/clear`` and ``/fork`` empty the transcript
 * when the answer arrives, a round trip after the click; a message sent
 * inside that window must survive it. So the clear keeps what was added
 * after ``boundary`` (the highest item id at issue time), and the view
 * generation bumps at issue time, when the person asked for a new view.
 */
export class IssuedCommand {
  readonly clearsTheView: boolean;

  constructor(
    readonly text: string,
    readonly echo: boolean,
    readonly boundary: number,
  ) {
    this.clearsTheView = /^\/(clear|fork)\b/.test(text.trim());
  }
}

export interface SlashCommandRouterDeps {
  client: Pick<IgniClient, "handleCommand">;
  view: TranscriptView;
  run: Pick<RunControls, "bumpViewGen">;
  streamer: Pick<RunStreamer, "send" | "sendLoopIteration">;
  sessions: Pick<SessionSwitcher, "followRenewed" | "followFork">;
  workflows: Pick<WorkflowLauncher, "start">;
  windowModel: Pick<WindowModel, "get" | "write" | "openPanel">;
  shell: Pick<ShellPort, "goPage" | "openModelMenu" | "refreshStatus" | "refreshSessions">;
  /** A non-``command_result`` answer, or one no action claims. */
  onEvent: (m: ServerMessage) => void;
}

type ActionHandler = (result: CommandResult, issued: IssuedCommand) => void | Promise<void>;

export class SlashCommandRouter {
  private readonly actions: Partial<Record<CommandAction, ActionHandler>> = {
    clear: (_r, issued) => this.onClear(issued),
    fork: (r, issued) => this.onFork(r, issued),
    sessions: () => this.onSessions(),
    model: () => this.deps.shell.openModelMenu(),
    model_switched: (r) => this.onModelSwitched(r),
    login: () => this.deps.windowModel.openPanel("login"),
    run_prompt: (r) => this.onRunPrompt(r),
    compact: (r) => this.onCompact(r),
    quit: () => this.deps.view.info("Use the window/tab close button to quit."),
  };

  constructor(private readonly deps: SlashCommandRouterDeps) {}

  async run(text: string, echo = true): Promise<void> {
    if (await this.runWorkflowCommand(text)) return;
    const { client, view, run } = this.deps;
    if (echo) view.append(view.chatItems.user(text));
    const issued = new IssuedCommand(text, echo, view.chatItems.ids.last());
    if (issued.clearsTheView) run.bumpViewGen();
    try {
      const result = await client.handleCommand(text);
      if (result.type === "command_result") await this.dispatch(result, issued);
      else this.deps.onEvent(result);
    } catch (e) {
      view.error(String(e));
    }
  }

  private async dispatch(result: CommandResult, issued: IssuedCommand): Promise<void> {
    const handler = this.actions[result.action];
    if (handler) return handler(result, issued);
    const content = SlashCommandRouter.contentOf(result);
    const page = PAGE_FOR_ACTION[result.action];
    if (page) {
      if (page.showContent && content && issued.echo) {
        this.deps.view.append(this.deps.view.chatItems.assistant(content));
      }
      this.deps.shell.goPage(page.route);
      return;
    }
    if (content) this.deps.onEvent(result);
  }

  /** ``true`` when ``text`` was a ``/workflows`` command, handled here.
   *  The listing is a place, not a message; a run streams into the
   *  conversation that asked for it. */
  private async runWorkflowCommand(text: string): Promise<boolean> {
    const command = WorkflowLauncher.parseCommand(text);
    const { view, shell, workflows } = this.deps;
    switch (command.kind) {
      case "none":
        return false;
      case "list":
        shell.goPage({ kind: "workflows", label: "Workflows" });
        return true;
      case "invalid":
        view.error(`/workflows: invalid JSON args: ${command.error}`);
        return true;
      case "run":
        try {
          const resp = await workflows.start(command.name, command.args);
          view.update((t) => t.startWorkflow(resp.name, resp.workflowRunId));
        } catch (err) {
          view.error(`/workflows: run failed: ${err}`);
        }
        return true;
    }
  }

  /** The text did not say clear (a skill that expands to one): the
   *  generation bumps now instead. */
  private startOver(issued: IssuedCommand): void {
    if (!issued.clearsTheView) this.deps.run.bumpViewGen();
    this.deps.view.keepAfter(issued.boundary);
  }

  /** No info line: an empty list renders the welcome hero. */
  private async onClear(issued: IssuedCommand): Promise<void> {
    this.startOver(issued);
    // The new conversation has 0 context.
    void this.deps.shell.refreshStatus();
    await this.deps.sessions.followRenewed();
    void this.deps.shell.refreshSessions();
  }

  private async onFork(result: CommandResult, issued: IssuedCommand): Promise<void> {
    const { view, shell, sessions } = this.deps;
    const newId = SlashCommandRouter.contentOf(result).trim();
    if (!newId) {
      view.error("Fork failed: backend returned no session id");
      return;
    }
    this.startOver(issued);
    await sessions.followFork(newId);
    view.info("Forked to a new session — continuing the dialogue.");
    void shell.refreshStatus();
    void shell.refreshSessions();
  }

  private onSessions(): void {
    const { windowModel, shell } = this.deps;
    windowModel.write("sidebar", { ...windowModel.get("sidebar"), open: true });
    void shell.refreshSessions();
  }

  private onModelSwitched(result: CommandResult): void {
    const content = SlashCommandRouter.contentOf(result);
    if (content) this.deps.view.info(content);
    void this.deps.shell.refreshStatus();
  }

  /** A skill expands to a bare prompt; ``/loop``'s first iteration
   *  carries the wrapped prompt and gets the iteration card. */
  private async onRunPrompt(result: CommandResult): Promise<void> {
    const { streamer } = this.deps;
    if (typeof result.content === "string" && result.content.startsWith(LOOP_ITERATION_PREFIX)) {
      await streamer.sendLoopIteration(result.content);
      return;
    }
    const content = SlashCommandRouter.contentOf(result);
    if (content) await streamer.send(content);
  }

  /** Status in ``content``, the model's summary in ``display_content``. */
  private onCompact(result: CommandResult): void {
    const status = String(result.content ?? "Context compacted.");
    const summary = String(result.display_content ?? "");
    this.deps.view.append(this.deps.view.chatItems.compact(status, summary));
    // The context just shrunk: the footer's meter follows.
    void this.deps.shell.refreshStatus();
  }

  private static contentOf(result: CommandResult): string {
    return result.display_content || result.content;
  }
}
