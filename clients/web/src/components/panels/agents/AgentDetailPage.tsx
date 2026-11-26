/** One agent's page: what it is and where it comes from in the hero,
 *  then its tools, MCP servers, tags, file and system prompt, each in
 *  its own soft card. */

import { useEffect, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { EntityGlyph } from "../../EntityGlyph";
import { EntityHero } from "../../page/EntityHero";
import { AgentChips } from "./AgentChips";
import { AgentKeepActions, type KeepChoice } from "./AgentKeepActions";
import { agentShortName, toolsSummary, type AgentRow } from "./agentRecord";

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
  return (
    <div className="entity-detail agent-detail">
      <EntityHero
        name={a.name || "Agent"}
        icon={<EntityGlyph name={agentShortName(a) || "Agent"} size={52} />}
        meta={
          <>
            <span className="plugins-version">{a.model || "Default model"}</span>
            <span className="entity-meta">{toolsSummary(a)}</span>
          </>
        }
        description={a.description}
        chips={<AgentChips agent={a} />}
        actions={
          a.is_ephemeral && <AgentKeepActions variant="buttons" busy={busy} onPick={onKeep} />
        }
      />

      <div className="agent-sections">
        {!!a.tools?.length && (
          <Section label="Tools" count={a.tools.length}>
            <Pills items={a.tools} flagged={unknown} />
            {unknown.size > 0 && (
              <div className="agent-section-note">
                igni can't find {[...unknown].join(", ")}; the agent fails when it is called.
              </div>
            )}
          </Section>
        )}
        {!!a.mcp_servers?.length && (
          <Section label="MCP servers" count={a.mcp_servers.length}>
            <Pills items={a.mcp_servers} />
          </Section>
        )}
        {!!a.tags?.length && (
          <Section label="Tags" count={a.tags.length}>
            <Pills items={a.tags} />
          </Section>
        )}
        {a.source_path && (
          <Section label="Source">
            <code className="agent-source-path">{a.source_path}</code>
          </Section>
        )}
        {a.system_prompt && (
          <Section label="System prompt">
            <div className="agent-prompt-md">
              <ReactMarkdown>{a.system_prompt}</ReactMarkdown>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="agent-section" aria-label={label}>
      <div className="plugins-content-head">
        <span>{label}</span>
        {count !== undefined && <span className="plugins-content-count">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function Pills({ items, flagged }: { items: string[]; flagged?: Set<string> }) {
  return (
    <div className="agent-pills">
      {items.map((t) => (
        <span key={t} className={`agent-pill${flagged?.has(t) ? " is-unknown" : ""}`}>
          {t}
        </span>
      ))}
    </div>
  );
}
