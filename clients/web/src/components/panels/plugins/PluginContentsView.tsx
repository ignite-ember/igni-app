/** What a plugin bundles, section by section, and its README. */

import { ReadmeMarkdown } from "../../markdown/ReadmeMarkdown";
import { DetailFacts, type DetailFact } from "../../page/DetailFacts";
import { DetailMarkdown } from "../../page/DetailMarkdown";
import { DetailSection } from "../../page/DetailSection";
import type { MarketplacePlugin } from "./marketplace";
import type { ContentsLoad, PluginContents } from "./pluginContents";
import { ContentsSkeleton } from "./PluginParts";
import { SourceRef } from "./sourceRef";

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
    return <div className="msg-error">{contents.reason}</div>;
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
    <>
      <SourceSection rootPath={contents.rootPath} preview={preview} />

      {/* Skills are not listed: the README covers them in context. */}

      {agents.length > 0 && (
        <DetailSection title="Agents" count={agents.length}>
          {agents.map((a) => (
            <div key={a.name} className="plugins-content-row">
              <code className="plugins-content-name">{a.name}</code>
              {a.description && <span className="plugins-content-desc">{a.description}</span>}
            </div>
          ))}
        </DetailSection>
      )}

      {mcpServers.length > 0 && (
        <DetailSection title="MCP servers" count={mcpServers.length}>
          {mcpServers.map((m) => (
            <div key={m.name} className="plugins-content-row">
              <code className="plugins-content-name">{m.name}</code>
              <span className="plugins-content-meta">{m.transport}</span>
              {m.command && <code className="plugins-content-cmd">{m.command}</code>}
            </div>
          ))}
        </DetailSection>
      )}

      {hooks.length > 0 && (
        <DetailSection title="Hooks" count={hooks.length}>
          {hooks.map((h) => (
            <div key={h.event} className="plugins-content-row">
              <code className="plugins-content-name">{h.event}</code>
              <span className="plugins-content-meta">
                {h.count} handler{h.count === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </DetailSection>
      )}

      {tools.length > 0 && (
        <DetailSection title="Tools" count={tools.length}>
          {tools.map((t) => (
            <div key={t.name} className="plugins-content-row">
              <code className="plugins-content-name">{t.name}</code>
            </div>
          ))}
        </DetailSection>
      )}

      {contents.readme && (
        <DetailSection title="README">
          <DetailMarkdown>
            <ReadmeMarkdown text={contents.readme} />
          </DetailMarkdown>
        </DetailSection>
      )}

      {contents.isEmpty && (
        <div className="page-empty-hint">
          This plugin doesn't bundle any skills, agents, hooks, MCP servers, or tools.
        </div>
      )}
    </>
  );
}

/** Where the plugin comes from: a catalog entry's source (a link when it
 *  is http), its subdirectory and branch, or an installed copy's path. */
function SourceSection({ rootPath, preview }: { rootPath: string; preview: MarketplacePlugin | null }) {
  const ref = preview && rootPath ? SourceRef.parse(rootPath) : null;
  const facts: (DetailFact | false)[] = ref
    ? [
        {
          label: "Source",
          value: ref.isHttp ? (
            <a href={ref.url} target="_blank" rel="noreferrer">
              {ref.displayUrl}
            </a>
          ) : (
            ref.displayUrl
          ),
          mono: !ref.isHttp,
        },
        !!ref.subdir && { label: "Subdir", value: ref.subdir, mono: true },
      ]
    : [!!rootPath && { label: "Path", value: rootPath, mono: true }];
  if (preview?.branch) facts.push({ label: "Branch", value: preview.branch, mono: true });
  if (!facts.some(Boolean)) return null;
  return (
    <DetailSection title="Source">
      <DetailFacts facts={facts} />
    </DetailSection>
  );
}
