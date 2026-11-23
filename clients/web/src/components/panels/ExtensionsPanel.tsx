import { useMemo, useState } from "react";
import { EntityGlyph } from "../EntityGlyph";
import { FilterIcon, SortIcon } from "../Icons";
import type { PanelLevels } from "../PageShell";
import type { IgniClient } from "../../protocol/client";
import type { ExtensionSummary } from "../../extensions/ExtensionPage";
import { OpenOnWeb } from "../../extensions/OpenOnWeb";
import { ControlMenu } from "./ControlMenu";
import { Drawer } from "./Drawer";
import { PanelSearch } from "./PanelSearch";

type ExtSort = "default" | "name-asc" | "name-desc";
type ExtFilter = "all" | "ready" | "failed" | "busy";

const EXT_SORTS: readonly { key: ExtSort; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "name-asc", label: "Name A→Z" },
  { key: "name-desc", label: "Name Z→A" },
];
const EXT_FILTERS: readonly { key: ExtFilter; label: string }[] = [
  { key: "all", label: "All extensions" },
  { key: "ready", label: "Ready" },
  { key: "failed", label: "Failed" },
  { key: "busy", label: "Starting" },
];

/**
 * What is installed, why it is not working, and what it can be set to.
 *
 * `contributes.settings` has been modelled, validated, stored beside
 * the bundle and carried on `list_extensions` for a while — and the
 * only way to change one was to call `set_extension_settings` by
 * hand. A declared setting nobody can reach is a declaration, not a
 * setting.
 *
 * It is also the one place the host says what state an extension is
 * in. Before this, a FAILED extension showed as a sidebar entry that
 * opened onto its own reason; there was nowhere to see the three
 * installed extensions together and notice that one of them had been
 * down since boot.
 */

/** One setting's current value — what the control is bound to. */
type Value = string | number | boolean;

/** The four `Setting.type` values the manifest allows. */
const KNOWN_TYPES = new Set(["string", "number", "boolean", "enum"]);

/**
 * What the form should start at.
 *
 * `values` already has defaults filled in by the backend, so this is
 * a fallback for a setting added by an upgrade that has not been
 * saved since — not the normal path.
 */
function initial(extension: ExtensionSummary): Record<string, Value> {
  const start: Record<string, Value> = {};
  for (const setting of extension.settings) {
    const held = extension.values[setting.key] ?? setting.default;
    if (setting.type === "boolean") start[setting.key] = held === true;
    else if (setting.type === "number") start[setting.key] = Number(held ?? 0);
    else
      start[setting.key] =
        held === undefined || held === null ? "" : String(held);
  }
  return start;
}

function sameValues(
  a: Record<string, Value>,
  b: Record<string, Value>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** A state, as a word and a tone the stylesheet already has. */
function stateClass(state: string): string {
  if (state === "ready") return "ext-state ext-state-ready";
  if (state === "failed") return "ext-state ext-state-failed";
  return "ext-state ext-state-busy";
}

function SettingsForm({
  extension,
  onSave,
}: {
  extension: ExtensionSummary;
  onSave: (values: Record<string, Value>) => Promise<void>;
}) {
  const saved = useMemo(() => initial(extension), [extension]);
  const [draft, setDraft] = useState<Record<string, Value>>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (key: string, value: Value) =>
    setDraft((current) => ({ ...current, [key]: value }));

  // A number input that has been cleared reads as `NaN`, and sending
  // that would store `null` and look like the setting was reset.
  // Named rather than silently dropped: the administrator typed
  // something, and the form should say which field it cannot use.
  const broken = extension.settings
    .filter((s) => s.type === "number" && Number.isNaN(draft[s.key]))
    .map((s) => s.label);

  const dirty = !sameValues(draft, saved);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(draft);
    } catch (problem: unknown) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ext-settings">
      {extension.settings.map((setting) => (
        <label className="ext-setting" key={setting.key}>
          <span className="ext-setting-label">{setting.label}</span>
          {setting.type === "boolean" && (
            <input
              type="checkbox"
              checked={draft[setting.key] === true}
              onChange={(e) => set(setting.key, e.target.checked)}
            />
          )}
          {setting.type === "number" && (
            <input
              className="panel-input"
              type="number"
              value={
                Number.isNaN(draft[setting.key])
                  ? ""
                  : String(draft[setting.key])
              }
              onChange={(e) => set(setting.key, e.target.valueAsNumber)}
            />
          )}
          {setting.type === "string" && (
            <input
              className="panel-input"
              type="text"
              value={String(draft[setting.key] ?? "")}
              onChange={(e) => set(setting.key, e.target.value)}
            />
          )}
          {setting.type === "enum" && (
            <select
              className="panel-input"
              value={String(draft[setting.key] ?? "")}
              onChange={(e) => set(setting.key, e.target.value)}
            >
              {setting.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
          {!KNOWN_TYPES.has(setting.type) && (
            // Rendered as text would be a guess, and a guess that
            // saves is worse than one that does not. The same rule
            // the indicator follows for a tone it does not have.
            <span className="meta">
              needs a newer igni — this one does not know the type “
              {setting.type}”
            </span>
          )}
        </label>
      ))}
      <div className="ext-settings-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={!dirty || busy || broken.length > 0}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {dirty && !busy && (
          <button className="btn btn-sm" onClick={() => setDraft(saved)}>
            Revert
          </button>
        )}
        {broken.length > 0 && (
          <span className="meta">{broken.join(", ")} needs a number</span>
        )}
        {error && <span className="meta ext-settings-error">{error}</span>}
      </div>
      <div className="meta">
        Applied the next time this extension’s page is opened. A frame already
        up keeps the values it launched with.
      </div>
    </div>
  );
}

/**
 * What an extension does not get because another extension claims the
 * same thing — a prompt section, a command, an agent. Shown, because
 * "my section is not in the prompt" is otherwise a mystery to whoever
 * installed it.
 */
function SwitchedOff({
  entries,
  title = "Switched off:",
}: {
  entries: { claim: string; reason: string }[];
  title?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="ext-switched-off" role="note">
      <div className="meta">{title}</div>
      <ul>
        {entries.map((entry) => (
          <li key={entry.claim}>
            <code>{entry.claim}</code> <span className="meta">{entry.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Problems({ entries }: { entries: string[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="ext-switched-off" role="note">
      <div className="meta">Working, with a problem its author should fix:</div>
      <ul>
        {entries.map((entry) => (
          <li key={entry}>
            <span className="meta">{entry}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentTools({ tools }: { tools: { name: string; hints: string }[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="ext-tools">
      <div className="meta">Tools for the agent:</div>
      <ul>
        {tools.map((tool) => (
          <li key={tool.name}>
            <code>{tool.name}</code> <span className="meta">{tool.hints}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A compact extension card. The whole card is one control: clicking it
 *  opens the extension's own page, the way a plugin card does. Collapsed,
 *  it is just name, version, state and a one-line summary, so the grid
 *  reads as a row of cards rather than a stack of open forms. */
function ExtensionCard({
  extension,
  onOpen,
}: {
  extension: ExtensionSummary;
  onOpen: () => void;
}) {
  // A real line only — the reason it failed, or what its command does.
  // Not the id, which already sits in the foot.
  const desc = extension.reason || extension.menu[0]?.desc || "";
  return (
    <button type="button" className="plugins-gcard ext-card" onClick={onOpen}>
      <span className="plugins-gcard-icon" aria-hidden="true">
        <EntityGlyph name={extension.name} size={38} />
      </span>
      <span className="plugins-gcard-body">
        <span className="plugins-gcard-top">
          <span className="plugins-name name">
            {extension.name} <span className="meta">· {extension.version}</span>
          </span>
          <span className={stateClass(extension.state)}>{extension.state}</span>
        </span>
        {desc && <span className="plugins-gcard-desc">{desc}</span>}
        <span className="plugins-gcard-foot">
          <span className="meta ext-card-id">{extension.id}</span>
          <span className="plugins-chevron-end" aria-hidden="true">
            ›
          </span>
        </span>
      </span>
    </button>
  );
}

/** One extension in full: its state, why it is not working, what it
 *  contributes, and its settings — the page a card opens onto. */
function ExtensionDetailPage({
  extension,
  onSave,
}: {
  extension: ExtensionSummary;
  onSave: (values: Record<string, Value>) => Promise<void>;
}) {
  const failed = extension.state === "failed";
  return (
    <div className="ext-detail">
      <div className="ext-detail-hero">
        <span className="ext-detail-icon" aria-hidden="true">
          <EntityGlyph name={extension.name} size={46} />
        </span>
        <div className="ext-detail-head">
          <div className="ext-detail-title-row">
            <h2 className="ext-detail-title">{extension.name}</h2>
            <span className={stateClass(extension.state)}>{extension.state}</span>
          </div>
          <div className="meta">
            {extension.id} · {extension.version}
          </div>
        </div>
      </div>

      {extension.reason && (
        <div className={failed ? "msg-error" : "msg-info"}>{extension.reason}</div>
      )}
      <SwitchedOff entries={extension.switched_off ?? []} />
      <SwitchedOff
        entries={extension.dropped ?? []}
        title="Prompt edits that land nowhere — another extension's override has no such section:"
      />
      {extension.faulty && (
        <div className="ext-switched-off" role="alert">
          <div className="meta">Not responding: {extension.faulty}</div>
        </div>
      )}
      <Problems entries={extension.problems ?? []} />

      {extension.pages.length > 0 && (
        <div className="ext-detail-section">
          <div className="ext-detail-section-title">Pages</div>
          <ul className="ext-detail-list">
            {extension.pages.map((p) => (
              <li key={p.kind}>
                {p.label}
                {p.sidebar && <span className="meta"> · in the sidebar</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {extension.menu.length > 0 && (
        <div className="ext-detail-section">
          <div className="ext-detail-section-title">Commands</div>
          <ul className="ext-detail-list">
            {extension.menu.map((c) => (
              <li key={c.command}>
                <code>{c.command}</code> <span className="meta">{c.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AgentTools tools={extension.tools ?? []} />
      <OpenOnWeb url={extension.web_url} name={extension.name} />

      {extension.settings.length > 0 && (
        <div className="ext-detail-section">
          <div className="ext-detail-section-title">Settings</div>
          <SettingsForm extension={extension} onSave={onSave} />
        </div>
      )}
    </div>
  );
}

/** Installed extensions, their state, and their settings. */
export function ExtensionsPanel({
  client,
  extensions,
  onChanged,
  onClose,
}: {
  client: IgniClient;
  extensions: ExtensionSummary[];
  /** The whole list, as `set_extension_settings` returns it. */
  onChanged: (extensions: ExtensionSummary[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<ExtSort>("default");
  const [filterBy, setFilterBy] = useState<ExtFilter>("all");
  const [openMenu, setOpenMenu] = useState<"sort" | "filter" | null>(null);
  // Which extension's page is open, by id. `null` is the grid.
  const [selected, setSelected] = useState<string | null>(null);

  const save = (id: string) => async (values: Record<string, Value>) => {
    const result = await client.rpc<{ extensions: ExtensionSummary[] }>(
      "set_extension_settings",
      { extension_id: id, values },
    );
    onChanged(result.extensions);
  };

  // Resolved live so a settings save (a fresh list) re-reads the open one.
  const current = selected ? (extensions.find((e) => e.id === selected) ?? null) : null;

  // One crumb below "Extensions" while a page is open, so the trail reads
  // "… / Extensions / <name>" and back returns to the grid.
  const levels = useMemo<PanelLevels | undefined>(
    () =>
      current ? { labels: [current.name], onTruncate: () => setSelected(null) } : undefined,
    [current],
  );

  const term = query.trim().toLowerCase();
  const matchesFilter = (e: ExtensionSummary): boolean => {
    if (filterBy === "all") return true;
    if (filterBy === "busy") return e.state !== "ready" && e.state !== "failed";
    return e.state === filterBy;
  };
  let shown = extensions.filter(
    (e) =>
      (!term || e.name.toLowerCase().includes(term) || e.id.toLowerCase().includes(term)) &&
      matchesFilter(e),
  );
  if (sortBy === "name-asc") shown = [...shown].sort((a, b) => a.name.localeCompare(b.name));
  else if (sortBy === "name-desc") shown = [...shown].sort((a, b) => b.name.localeCompare(a.name));

  return (
    <Drawer
      title="Extensions"
      levels={levels}
      onClose={onClose}
      headerExtras={
        !current && extensions.length > 0 ? (
          <div className="plugins-controls">
            <PanelSearch
              value={query}
              onChange={setQuery}
              label="Search extensions"
              placeholder={`Search ${extensions.length} extension${extensions.length === 1 ? "" : "s"}…`}
            />
            <ControlMenu
              label="Filter"
              icon={<FilterIcon />}
              active={filterBy !== "all"}
              open={openMenu === "filter"}
              onToggle={() => setOpenMenu(openMenu === "filter" ? null : "filter")}
              onClose={() => setOpenMenu(null)}
              options={EXT_FILTERS}
              current={filterBy}
              onPick={setFilterBy}
            />
            <ControlMenu
              label="Sort"
              icon={<SortIcon />}
              active={sortBy !== "default"}
              open={openMenu === "sort"}
              onToggle={() => setOpenMenu(openMenu === "sort" ? null : "sort")}
              onClose={() => setOpenMenu(null)}
              options={EXT_SORTS}
              current={sortBy}
              onPick={setSortBy}
            />
          </div>
        ) : undefined
      }
    >
      {current ? (
        <ExtensionDetailPage extension={current} onSave={save(current.id)} />
      ) : (
        <>
          {extensions.length === 0 && (
            <div className="msg-info">
              No extensions installed. They arrive from your organisation&apos;s
              services when you are signed in to igni.
            </div>
          )}
          {extensions.length > 0 && shown.length === 0 && (
            <div className="plugins-empty">
              <div className="plugins-empty-title">No extensions match</div>
            </div>
          )}
          <div className="plugins-grid plugins-grid--start">
            {shown.map((extension) => (
              <ExtensionCard
                key={extension.id}
                extension={extension}
                onOpen={() => setSelected(extension.id)}
              />
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}
