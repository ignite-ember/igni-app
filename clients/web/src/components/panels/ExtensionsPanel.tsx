import { useMemo, useState, type ReactNode } from "react";
import { Button, Field, Input, Select, Switch, Text } from "@ignite-ember/ui-react";
import { EntityGlyph } from "../EntityGlyph";
import { FilterIcon, SortIcon } from "../Icons";
import type { PanelLevels } from "../PageShell";
import type { IgniClient } from "../../protocol/client";
import type { ExtensionSummary } from "../../extensions/ExtensionPage";
import { OpenOnWeb } from "../../extensions/OpenOnWeb";
import { ControlMenu } from "./ControlMenu";
import { Drawer } from "./Drawer";
import { PanelSearch } from "./PanelSearch";
import { useMasonry } from "./useMasonry";
import { EntityHero } from "../page/EntityHero";
import { PageEmpty } from "../page/PageEmpty";

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
      {extension.settings.map((setting) => {
        const id = `ext-set-${extension.id}-${setting.key}`;
        // Rendering an unknown type as text would be a guess, and a guess
        // that saves is worse than one that does not.
        if (!KNOWN_TYPES.has(setting.type)) {
          return (
            <Field key={setting.key} label={setting.label}>
              <Text tone="muted">
                needs a newer igni — this one does not know the type “{setting.type}”
              </Text>
            </Field>
          );
        }
        if (setting.type === "boolean") {
          return (
            <Switch
              key={setting.key}
              checked={draft[setting.key] === true}
              onChange={(next) => set(setting.key, next)}
              label={setting.label}
            />
          );
        }
        if (setting.type === "enum") {
          return (
            <Field key={setting.key} label={setting.label} htmlFor={id}>
              <Select
                id={id}
                value={String(draft[setting.key] ?? "")}
                onChange={(e) => set(setting.key, e.target.value)}
              >
                {setting.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        if (setting.type === "number") {
          // A cleared number input reads as `NaN`; sending it would store
          // `null` and look like a reset, so name the field and refuse.
          const bad = Number.isNaN(draft[setting.key]);
          return (
            <Field
              key={setting.key}
              label={setting.label}
              htmlFor={id}
              error={bad ? `${setting.label} needs a number` : undefined}
            >
              <Input
                id={id}
                type="number"
                value={bad ? "" : String(draft[setting.key])}
                onChange={(e) => set(setting.key, e.target.valueAsNumber)}
              />
            </Field>
          );
        }
        return (
          <Field key={setting.key} label={setting.label} htmlFor={id}>
            <Input
              id={id}
              type="text"
              value={String(draft[setting.key] ?? "")}
              onChange={(e) => set(setting.key, e.target.value)}
            />
          </Field>
        );
      })}
      <div className="ext-settings-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={!dirty || busy || broken.length > 0}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
        {dirty && !busy && (
          <Button variant="default" size="sm" onClick={() => setDraft(saved)}>
            Revert
          </Button>
        )}
        {error && (
          <Text tone="muted" className="ext-settings-error">
            {error}
          </Text>
        )}
      </div>
      <Text tone="faint">
        Applied the next time this extension’s page is opened. A frame already up
        keeps the values it launched with.
      </Text>
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

/** One section of the extension's page — Pages, Commands, Tools — in the
 *  same vocabulary the plugin detail page lists a plugin's contents. */
function ContentSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="plugins-content-section">
      <div className="plugins-content-head">
        {title} <span className="plugins-content-count">{count}</span>
      </div>
      {children}
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
    <button type="button" className="entity-card ext-card" onClick={onOpen}>
      <span className="entity-card-icon" aria-hidden="true">
        <EntityGlyph name={extension.name} size={38} />
      </span>
      <span className="entity-card-body">
        <span className="entity-card-top">
          <span className="plugins-name name">
            {extension.name} <span className="meta">· {extension.version}</span>
          </span>
          <span className={stateClass(extension.state)}>{extension.state}</span>
        </span>
        {desc && <span className="entity-card-desc">{desc}</span>}
        <span className="entity-card-foot">
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
  const tools = extension.tools ?? [];
  const hasContents =
    extension.pages.length > 0 ||
    extension.menu.length > 0 ||
    tools.length > 0 ||
    extension.settings.length > 0 ||
    !!extension.web_url;
  return (
    <div className="entity-detail">
      <EntityHero
        name={extension.name}
        meta={
          <>
            <span className={stateClass(extension.state)}>{extension.state}</span>
            {extension.version && <span className="plugins-version">{extension.version}</span>}
            <span className="plugins-source">{extension.id}</span>
          </>
        }
        description={extension.reason}
      />

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

      {hasContents && (
        <div className="plugins-contents">
          <ContentSection title="Pages" count={extension.pages.length}>
            {extension.pages.map((p) => (
              <div className="plugins-content-row" key={p.kind}>
                <span className="plugins-content-name">{p.label}</span>
                {p.sidebar && <span className="plugins-content-meta">in the sidebar</span>}
              </div>
            ))}
          </ContentSection>

          <ContentSection title="Commands" count={extension.menu.length}>
            {extension.menu.map((c) => (
              <div className="plugins-content-row" key={c.command}>
                <code className="plugins-content-name">{c.command}</code>
                <span className="plugins-content-desc">{c.desc}</span>
              </div>
            ))}
          </ContentSection>

          <ContentSection title="Tools for the agent" count={tools.length}>
            {tools.map((t) => (
              <div className="plugins-content-row" key={t.name}>
                <code className="plugins-content-name">{t.name}</code>
                <span className="plugins-content-desc">{t.hints}</span>
              </div>
            ))}
          </ContentSection>

          <OpenOnWeb url={extension.web_url} name={extension.name} />

          {extension.settings.length > 0 && (
            <div className="plugins-content-section">
              <div className="plugins-content-head">Settings</div>
              <SettingsForm extension={extension} onSave={onSave} />
            </div>
          )}
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
  const flow = useMasonry();

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
          <div className="page-controls">
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
            <PageEmpty
              title="No extensions installed"
              hint="They arrive from your organisation's services when you are signed in to igni."
            />
          )}
          {extensions.length > 0 && shown.length === 0 && (
            <PageEmpty title="No extensions match" />
          )}
          <div className="card-grid card-grid--flow" ref={flow}>
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
