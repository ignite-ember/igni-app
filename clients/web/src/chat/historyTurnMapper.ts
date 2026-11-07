/**
 * Turns a persisted history turn back into the item the live stream
 * would have produced.
 */

import type {
  AssistantTurn,
  HistoryTurn,
  PlanTurn,
  StatsTurn,
  ThinkingTurn,
  ToolTurn,
  UserTurn,
  VisualizationTurn,
} from "../protocol/historyTurns";
import type { ChatItem, StatsItem } from "./chatItem";
import type { ChatItemFactory } from "./chatItemFactory";
import { PlanTaskList } from "./planTasks";
import { estimateTokens } from "./runCompletion";
import { UserMessageText } from "./userMessageText";

type Mappers = {
  [K in HistoryTurn["role"]]?: (turn: Extract<HistoryTurn, { role: K }>) => ChatItem | null;
};

const PLAN_STATES = ["pending", "approved", "dismissed"] as const;

export class HistoryTurnMapper {
  private readonly mappers: Mappers = {
    user: (turn) => this.fromUser(turn),
    assistant: (turn) => this.fromAssistant(turn),
    thinking: (turn) => this.fromThinking(turn),
    tool: (turn) => this.fromTool(turn),
    plan: (turn) => this.fromPlan(turn),
    visualization: (turn) => this.fromVisualization(turn),
  };

  constructor(private readonly items: ChatItemFactory) {}

  /** The item for ``turn``, or ``null`` when nothing is left to show
   *  or the role is not rendered (``stats`` goes through ``stats``). */
  map(turn: HistoryTurn): ChatItem | null {
    const mapTurn = this.mappers[turn.role] as ((turn: HistoryTurn) => ChatItem | null) | undefined;
    return mapTurn ? mapTurn(turn) : null;
  }

  /** ``visibleOutText`` is the reply text the run rendered. Thinking is
   *  not restored, and no ``count_context_tokens`` will follow, so the
   *  line lands corrected with no think estimate. */
  stats(turn: StatsTurn, visibleOutText: string): StatsItem {
    return this.items.stats({
      runId: turn.run_id,
      inputTokens: turn.input_tokens,
      outputTokens: turn.output_tokens,
      reasoningTokens: turn.reasoning_tokens,
      visibleThinkTokens: 0,
      visibleOutTokens: estimateTokens(visibleOutText),
      duration: turn.duration,
      corrected: true,
    });
  }

  private fromUser(turn: UserTurn): ChatItem | null {
    const text = new UserMessageText(turn.content).visible();
    if (!text) return null;
    const message = new UserMessageText(text);
    if (message.isLoopIteration()) return this.items.loop(text);
    const posted = message.extensionMessage();
    return posted ? this.items.user(posted.body, posted.from) : this.items.user(text);
  }

  private fromAssistant(turn: AssistantTurn): ChatItem | null {
    const text = UserMessageText.stripThinkBlocks(turn.content);
    return text ? this.items.assistant(text) : null;
  }

  private fromThinking(turn: ThinkingTurn): ChatItem | null {
    const text = turn.content.trim();
    return text ? this.items.thinking(text) : null;
  }

  /** Already complete: history keeps no diff rows. */
  private fromTool(turn: ToolTurn): ChatItem {
    return {
      kind: "tool",
      id: this.items.ids.next(),
      runId: turn.run_id,
      name: turn.name,
      args: turn.args,
      status: turn.is_rejected ? "rejected" : turn.is_error ? "error" : "done",
      result: turn.content,
      isError: turn.is_error,
      diffRows: null,
    };
  }

  private fromPlan(turn: PlanTurn): ChatItem | null {
    const plan = turn.plan.trim();
    if (!plan) return null;
    return this.items.plan({
      plan,
      tasks: PlanTaskList.parse(turn.tasks).tasks,
      runId: turn.run_id,
      state: PLAN_STATES.find((s) => s === turn.state) ?? "pending",
    });
  }

  private fromVisualization(turn: VisualizationTurn): ChatItem | null {
    if (!turn.spec_id || !turn.spec || typeof turn.spec !== "object") return null;
    return this.items.visualization({
      spec: turn.spec,
      title: turn.title,
      sourceAgent: turn.source_agent,
      specId: turn.spec_id,
      fromExtension: turn.extension_id || undefined,
    });
  }
}
