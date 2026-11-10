/**
 * Markdown as the agent's replies render it: repaired, then every fence
 * routed by its kind. Shared by the agent's replies and the messages an
 * extension posts, so both are rendered and sanitised alike.
 */

import type { ReactNode } from "react";
import type { Components } from "react-markdown";

import { MermaidBlock } from "@ignite-ember/ui-react";
import { CodeBlock, MarkdownBlock, PreformattedBlock } from "./CodeBlock";
import { FencedBlock, type FenceKind } from "./fencedBlock";
import { MarkdownRepair } from "./markdownRepair";
import { PlainMarkdown } from "./PlainMarkdown";

type FenceRenderer = (props: { block: FencedBlock; children?: ReactNode }) => ReactNode;

const FENCE_RENDERERS: Readonly<Record<FenceKind, FenceRenderer>> = {
  mermaid: ({ block }) => <MermaidBlock source={block.source} />,
  preformatted: ({ block }) => <PreformattedBlock block={block} />,
  markdown: ({ block }) => <MarkdownBlock source={block.source} />,
  code: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

/** ``components.pre``: the fence inside, by its kind. */
function MarkdownPre({ children }: { children?: ReactNode }) {
  const block = FencedBlock.fromChildren(children);
  if (!block) return <CodeBlock>{children}</CodeBlock>;
  const Render = FENCE_RENDERERS[block.kind];
  return <Render block={block}>{children}</Render>;
}

const ASSISTANT_MD_COMPONENTS: Components = { pre: MarkdownPre };

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <PlainMarkdown text={MarkdownRepair.standard.apply(text)} components={ASSISTANT_MD_COMPONENTS} />
  );
}
