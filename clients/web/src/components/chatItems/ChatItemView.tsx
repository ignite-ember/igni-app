/**
 * One transcript row, rendered by its item's kind. The renderer table is
 * typed over every ``ChatItem`` kind, so a new kind does not compile
 * until it has a renderer.
 */

import { memo, type ComponentType } from "react";

import type { ChatItem } from "../../chat/chatItem";
import { WorkflowRun } from "../WorkflowRun";
import { AssistantMessage } from "./AssistantMessage";
import type { ChatItemHandlers, ItemRendererProps } from "./handlers";
import { OrchestrateLog } from "./OrchestrateLog";
import { PlanCard } from "./PlanCard";
import { AgentLine, AttachmentsLine, ErrorLine, InfoLine, StatsLine } from "./SimpleItems";
import { ToolCard } from "./ToolCardView";
import { CompactCard, LoopIterationCard, ShellBlock, ThinkingBlock } from "./TranscriptCards";
import { UserMessage } from "./UserMessage";
import { VisualizationCard } from "./VisualizationCard";

/** A plan card whose caller wired no decision: its buttons do nothing
 *  rather than throw. */
const IGNORE_PLAN_DECISION = (_id: number) => {};

const NO_HANDLERS: ChatItemHandlers = Object.freeze({});

type ChatItemRenderers = {
  [K in ChatItem["kind"]]: ComponentType<ItemRendererProps<K>>;
};

const CHAT_ITEM_RENDERERS: ChatItemRenderers = {
  attachments: AttachmentsLine,
  user: ({ item, handlers }) => <UserMessage item={item} handlers={handlers.user} />,
  assistant: ({ item, handlers }) => <AssistantMessage item={item} handlers={handlers.interrupted} />,
  thinking: ({ item }) => <ThinkingBlock text={item.text} />,
  tool: ({ item }) => <ToolCard item={item} />,
  agent: AgentLine,
  orchestrate: ({ item, handlers }) => <OrchestrateLog item={item} handlers={handlers.team} />,
  workflow: ({ item, handlers }) => (
    <WorkflowRun run={item.run} onRerun={handlers.workflow?.rerun} onCancel={handlers.workflow?.cancel} />
  ),
  loop: ({ item }) => <LoopIterationCard item={item} />,
  compact: ({ item }) => <CompactCard item={item} />,
  plan: ({ item, handlers }) => (
    <PlanCard
      item={item}
      onApprove={handlers.plan?.approve ?? IGNORE_PLAN_DECISION}
      onReject={handlers.plan?.reject ?? IGNORE_PLAN_DECISION}
    />
  ),
  stats: StatsLine,
  info: InfoLine,
  error: ErrorLine,
  shell: ({ item }) => <ShellBlock item={item} />,
  visualization: ({ item, handlers }) => (
    <VisualizationCard item={item} handlers={handlers.visualization} />
  ),
};

function rendererFor<K extends ChatItem["kind"]>(kind: K): ComponentType<ItemRendererProps<K>> {
  return CHAT_ITEM_RENDERERS[kind];
}

/**
 * Memoised, so a streamed token (a new list with one changed item)
 * re-renders only that item's row. ``handlers`` must be one stable
 * object (``useMemo`` in App.tsx) for the shallow compare to hit.
 */
export const ChatItemView = memo(function ChatItemView({
  item,
  handlers = NO_HANDLERS,
  copyResponseText,
}: {
  item: ChatItem;
  handlers?: ChatItemHandlers;
  /** The reply a ``stats`` row's copy button copies: App finds the
   *  assistant turn of the same run. */
  copyResponseText?: string;
}) {
  const Render = rendererFor(item.kind);
  return <Render item={item} handlers={handlers} copyResponseText={copyResponseText} />;
});
