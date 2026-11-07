/** What a plugin bundles, section by section, and its README. */

import type { ReactNode } from "react";
import { ReadmeMarkdown } from "../../markdown/ReadmeMarkdown";
import type { MarketplacePlugin } from "./marketplace";
import type { ContentsLoad, PluginContents } from "./pluginContents";
import { ContentsSkeleton, SourceLink } from "./PluginParts";

/** ``preview`` is the catalog entry being previewed, or ``null`` for an
 *  installed copy: it decides whether the root is a source or a path. */
export function PluginContentsView({
  contents,
  preview,
}: {
  contents: ContentsLoad;
  preview: MarketplacePlugin | null;
}) {
  if (contents.kind === "loading") return <ContentsSkeleton />;
  if (contents.kind === "failed") {
    return <div className="plugins-contents msg-error">{contents.reason}</div>;
  }
  return <LoadedContents contents={contents.contents} preview={preview} />;
}

function LoadedContents({
  contents,
  preview,
}: {
  contents: PluginContents;
  preview: MarketplacePlugin | null;
}) {
  const { agents, mcpServers, hooks, tools } = contents.parts;
  return (
    <div className="plugins-contents">
      {contents.rootPath && (
        <div className="plugins-content-path">
          <span className="plugins-content-label">{preview ? "Source" : "Path"}</span>
          {preview ? <SourceLink raw={contents.rootPath} /> : <code>{contents.rootPath}</code>}
        </div>
      )}
      {preview?.branch && (
        <div className="plugins-content-path">
          <span className="plugins-content-label">Branch</span>
          <code>{preview.branch}</code>
        </div>
      )}

      {/* Skills are not listed: the README covers them in context. */}

      {agents.length > 0 && (
        <ContentSection label="Agents" count={agents.length}>
          {agents.map((a) => (
            <div key={a.name} className="plugins-content-row">
              <code className="plugins-content-name">{a.name}</code>
              {a.description && <span className="plugins-content-desc">{a.description}</span>}
            </div>
          ))}
        </ContentSection>
      )}

      {mcpServers.length > 0 && (
        <ContentSection label="MCP servers" count={mcpServers.length}>
          {mcpServers.map((m) => (
            <div key={m.name} className="plugins-content-row">
              <code className="plugins-content-name">{m.name}</code>
              <span className="plugins-content-meta">{m.transport}</span>
              {m.command && <code className="plugins-content-cmd">{m.command}</code>}
            </div>
          ))}
        </ContentSection>
      )}

      {hooks.length > 0 && (
        <ContentSection label="Hooks" count={hooks.length}>
          {hooks.map((h) => (
            <div key={h.event} className="plugins-content-row">
              <code className="plugins-content-name">{h.event}</code>
              <span className="plugins-content-meta">
                {h.count} handler{h.count === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </ContentSection>
      )}

      {tools.length > 0 && (
        <ContentSection label="Tools" count={tools.length}>
          {tools.map((t) => (
            <div key={t.name} className="plugins-content-row">
              <code className="plugins-content-name">{t.name}</code>
            </div>
          ))}
        </ContentSection>
      )}

      {contents.readme && (
        <ContentSection label="README" count={null}>
          <div className="plugins-readme markdown-body">
            <ReadmeMarkdown text={contents.readme} />
          </div>
        </ContentSection>
      )}

      {contents.isEmpty && (
        <div className="plugins-empty-hint">
          This plugin doesn't bundle any skills, agents, hooks, MCP servers, or tools.
        </div>
      )}
    </div>
  );
}

function ContentSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number | null;
  children: ReactNode;
}) {
  return (
    <div className="plugins-content-section">
      <div className="plugins-content-head">
        <span>{label}</span>
        {count != null && <span className="plugins-content-count">{count}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}
