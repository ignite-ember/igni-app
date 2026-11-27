/** Hooks: one soft card per lifecycle event, its hooks as rows inside;
 *  a row opens that hook's own page — its facts and its script — a
 *  level down. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { Drawer } from "./Drawer";
import { CardGrid } from "../page/CardGrid";
import { CardGridSkeleton } from "../page/CardGridSkeleton";
import { EntityCard } from "../page/EntityCard";
import { PageEmpty } from "../page/PageEmpty";
import { HookDetail } from "./hooks/HookDetail";
import { EventIcon, ScriptIcon, WebhookIcon } from "./hooks/HookIcons";
import { EVENT_BLURB, dedupeHooks, groupHooks, identOf, isWebhook, sourceOf, type HookEntry } from "./hooks/hooksView";

export function HooksPanel({
  client,
  onClose,
}: {
  client: IgniClient;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<HookEntry[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<HookEntry | null>(null);
  // Where the list was scrolled when a hook opened, to land there again.
  const anchor = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const scroller = () => anchor.current?.closest<HTMLElement>(".page-body, .drawer-body") ?? null;

  useLayoutEffect(() => {
    const el = scroller();
    if (el) el.scrollTop = selected ? 0 : listScroll.current;
  }, [selected]);

  const open = (hook: HookEntry) => {
    listScroll.current = scroller()?.scrollTop ?? 0;
    setSelected(hook);
  };

  const refresh = useCallback(async () => {
    setError("");
    try {
      const r = (await client.rpc<HookEntry[]>("get_hooks_details")) || [];
      setRows(Array.isArray(r) ? r : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deduped = useMemo(() => (rows ? dedupeHooks(rows) : null), [rows]);
  const groups = useMemo(() => (deduped ? groupHooks(deduped) : null), [deduped]);
  const total = deduped?.length ?? 0;

  return (
    <Drawer
      title="Hooks"
      onClose={onClose}
      levels={{
        labels: selected ? [selected.matcher ? `${selected.event} · ${selected.matcher}` : selected.event] : [],
        onTruncate: () => setSelected(null),
      }}
      // The hook's page opens with its event in the hero.
      titleInBody={selected !== null}
      headerExtras={
        deduped !== null && !selected ? (
          <span className="hooks-count">
            {total} {total === 1 ? "hook" : "hooks"}
          </span>
        ) : null
      }
    >
      <div ref={anchor} className="hooks-page">
        {error && <div className="msg-error msg-error--banner">{error}</div>}
        {selected ? (
          <HookDetail hook={selected} client={client} />
        ) : groups === null ? (
          <CardGridSkeleton count={4} />
        ) : groups.length === 0 ? (
          <EmptyHero />
        ) : (
          <CardGrid flow className="hooks-groups">
            {groups.map(({ event, hooks }) => (
              <HookGroup key={event} event={event} hooks={hooks} onOpen={open} />
            ))}
          </CardGrid>
        )}
      </div>
    </Drawer>
  );
}

function HookGroup({
  event,
  hooks,
  onOpen,
}: {
  event: string;
  hooks: HookEntry[];
  onOpen: (hook: HookEntry) => void;
}) {
  const blurb = EVENT_BLURB[event];
  return (
    <EntityCard
      className="hooks-group"
      icon={
        <span className="entity-glyph hooks-glyph">
          <EventIcon />
        </span>
      }
      name={event}
      action={<span className="hooks-event-count">{hooks.length}</span>}
      description={blurb && <span className="hooks-event-blurb">{blurb}</span>}
    >
      <div className="hooks-list">
        {hooks.map((h, i) => (
          <HookRow key={i} hook={h} onOpen={() => onOpen(h)} />
        ))}
      </div>
    </EntityCard>
  );
}

/** One hook in its event's card: what it runs, and its tags. The whole
 *  row opens the hook's page. */
function HookRow({ hook, onOpen }: { hook: HookEntry; onOpen: () => void }) {
  const ident = identOf(hook);
  const tags: { label: string; tone?: string }[] = [];
  if (hook.matcher) tags.push({ label: `matches: ${hook.matcher}` });
  if (hook.background) tags.push({ label: "background", tone: "tone-good" });
  if (hook.timeout_ms && hook.timeout_ms !== 10000) {
    tags.push({ label: `${(hook.timeout_ms / 1000).toFixed(0)}s timeout` });
  }
  const source = sourceOf(hook);
  if (source !== "project") tags.push({ label: source });

  return (
    <button type="button" className="hooks-row hooks-row-link" title={`Open ${ident}`} onClick={onOpen}>
      <div className="hooks-row-icon" aria-hidden="true">
        {isWebhook(hook) ? <WebhookIcon /> : <ScriptIcon />}
      </div>
      <div className="hooks-row-main">
        <code className="hooks-row-ident">{ident}</code>
        {tags.length > 0 && (
          <div className="hooks-row-tags">
            {tags.map((t, i) => (
              <span key={i} className={`hooks-tag ${t.tone || ""}`.trim()}>
                {t.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function EmptyHero() {
  return (
    <PageEmpty
      title="No hooks configured"
      hint={
        <>
          Drop scripts into <code>.igni/hooks/</code> or declare hooks under{" "}
          <code>hooks</code> in <code>.igni/settings.json</code>. Each hook binds
          a lifecycle event (e.g. <code>PreToolUse</code>) to a script or webhook
          — see the docs for matcher patterns and the JSON payload shape.
        </>
      }
    />
  );
}
