/** One agent's page: what it is and where it comes from in the hero,
 *  then its tools, MCP servers, tags, file and system prompt, each in
 *  its own section. */

import { useEffect } from "react";

import { EntityGlyph } from "../../EntityGlyph";
import { PlainMarkdown } from "../../markdown/PlainMarkdown";
import { DetailFacts } from "../../page/DetailFacts";
import { DetailMarkdown } from "../../page/DetailMarkdown";
import { DetailSection } from "../../page/DetailSection";
import { EntityHero } from "../../page/EntityHero";
import { HeroChip } from "../../page/HeroChip";
import { AgentKeepActions, type KeepChoice } from "./AgentKeepActions";
import {
  agentPlugin,
  agentShortName,
  agentSource,
  SOURCE_LABELS,
  toolsSummary,
  type AgentRow,
} from "./agentRecord";

export function AgentDetailPage({
  agent: a,
  busy,
  onKeep,
}: {
  agent: AgentRow;
  busy: boolean;
  onKeep: (choice: KeepChoice) => void;
}) {
  // The page body keeps its scroll position across view switches —
  // start the agent's page at the top.
  useEffect(() => {
    document.querySelector(".page-body, .drawer-body")?.scrollTo?.(0, 0);
  }, [a.name]);
  const unknown = new Set(a.unknown_tools ?? []);
  const plugin = agentPlugin(a);
  return (
    <div className="entity-detail agent-detail">
      <EntityHero
        name={a.name || "Agent"}
        icon={<EntityGlyph name={agentShortName(a) || "Agent"} size={52} />}
        meta={
          <>
            <span className="entity-meta">{a.model || "Default model"}</span>
            <span className="entity-meta">{toolsSummary(a)}</span>
          </>
        }
        description={a.description}
        chips={
          <>
            <HeroChip>
              {plugin ? `${SOURCE_LABELS.plugin} · ${plugin}` : SOURCE_LABELS[agentSource(a)]}
            </HeroChip>
            {a.can_orchestrate && <HeroChip>orchestrates</HeroChip>}
          </>
        }
        actions={
          a.is_ephemeral && <AgentKeepActions variant="buttons" busy={busy} onPick={onKeep} />
        }
      />

      {!!a.tools?.length && (
        <DetailSection title="Tools" count={a.tools.length}>
          <Pills items={a.tools} flagged={unknown} />
          {unknown.size > 0 && (
            <div className="detail-note is-danger">
              igni can't find {[...unknown].join(", ")}; the agent fails when it is called.
            </div>
          )}
        </DetailSection>
      )}
      {!!a.mcp_servers?.length && (
        <DetailSection title="MCP servers" count={a.mcp_servers.length}>
          <Pills items={a.mcp_servers} />
        </DetailSection>
      )}
      {!!a.tags?.length && (
        <DetailSection title="Tags" count={a.tags.length}>
          <Pills items={a.tags} />
        </DetailSection>
      )}
      {a.source_path && (
        <DetailSection title="Source">
          <DetailFacts facts={[{ label: "File", value: a.source_path, mono: true }]} />
        </DetailSection>
      )}
      {a.system_prompt && (
        <DetailSection title="System prompt">
          <DetailMarkdown>
            <PlainMarkdown text={a.system_prompt} />
          </DetailMarkdown>
        </DetailSection>
      )}
    </div>
  );
}

function Pills({ items, flagged }: { items: string[]; flagged?: Set<string> }) {
  return (
    <div className="detail-pills">
      {items.map((t) => (
        <span key={t} className={`detail-pill${flagged?.has(t) ? " is-flagged" : ""}`}>
          {t}
        </span>
      ))}
    </div>
  );
}
