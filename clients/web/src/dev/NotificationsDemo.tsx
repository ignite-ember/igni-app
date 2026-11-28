/**
 * UI sandbox for the notifications (``?demo=notifications``, see main.tsx).
 * The real sheet over a mock floor, and the real toast stack in each of
 * its severities, over a stand-in chat and composer so the stack's
 * clearance can be seen. ``&sheet=0`` leaves the sheet closed;
 * ``&empty=1`` gives the floor nothing.
 */

import { useState } from "react";

import type { ModelToast } from "../clientState";
import { NotificationsPanel } from "../components/NotificationsPanel";
import { TopBlur } from "../components/page/TopBlur";
import { Toasts } from "../components/Toasts";
import type { FloorNotification } from "../notifications/model";
import type { IgniClient } from "../protocol/client";

const params = new URLSearchParams(window.location.search);
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

const ROWS: FloorNotification[] = [
  {
    id: "n1",
    origin: "local",
    source: "igni",
    kind: "approval",
    title: "A run is waiting for your approval",
    body: "igni wants to run npm test in igni-app. Open the session to approve or deny.",
    actor: "",
    target: { page: "session", params: { session_id: "ebbc7eff" } },
    created_at: ago(2),
    read: false,
  },
  {
    id: "n2",
    origin: "server",
    source: "Code review",
    kind: "review",
    title: "3 findings on feat/account-menu-in-sidebar",
    body: "1 correctness issue, 2 nits. Open to review and apply the fixes.",
    actor: "Code Review",
    target: { page: "extension", params: { id: "reviewer" } },
    created_at: ago(18),
    read: false,
    org_name: "Acme Engineering",
  },
  {
    id: "n3",
    origin: "server",
    source: "CI",
    kind: "ci",
    title: "CI passed on main",
    body: "All 20 checks green for commit 9f04153b.",
    actor: "CI",
    target: { page: "extension", params: { id: "ci" } },
    created_at: ago(63),
    read: true,
  },
  {
    id: "n4",
    origin: "server",
    source: "Chat",
    kind: "mention",
    title: "Ada Lovelace mentioned you",
    body: "Can you take a look at the gateway retry logic before the release?",
    actor: "Ada Lovelace",
    target: { page: "extension", params: { id: "chat" } },
    created_at: ago(26 * 60),
    read: true,
    org_name: "Acme Engineering",
  },
  {
    id: "n6",
    origin: "local",
    source: "igni",
    kind: "process_failed",
    title: "Background process failed (exit 1)",
    body: "pytest tests/ -q — 3 failed, 211 passed in 41.2s",
    actor: "",
    target: { page: "session", params: { session_id: "ebbc7eff" } },
    created_at: ago(40),
    read: false,
  },
  {
    id: "n7",
    origin: "local",
    source: "igni",
    kind: "scheduler_completed",
    title: "Scheduled task completed",
    body: "Nightly dependency audit: no new advisories.",
    actor: "",
    target: { page: "schedule", params: {} },
    created_at: ago(5 * 60),
    read: false,
  },
  {
    id: "n8",
    origin: "server",
    source: "Releases",
    kind: "release",
    title: "igni 0.9.2 is out",
    body: "Faster startup and the new notifications. Restart to update.",
    actor: "",
    target: { page: "extension", params: { id: "releases" } },
    created_at: ago(27 * 60),
    read: true,
  },
  {
    id: "n9",
    origin: "local",
    source: "Code index",
    kind: "index.note",
    title: "Index rebuilt",
    body: "igni-app: 4,812 files, 61k symbols.",
    actor: "",
    target: null,
    created_at: ago(3 * 24 * 60),
    read: true,
  },
  {
    id: "n5",
    origin: "local",
    source: "Scanner",
    kind: "done",
    title: "Background workflow finished",
    body: "review-changes completed: 2 issues found across 9 files.",
    actor: "",
    target: null,
    created_at: ago(4 * 24 * 60),
    read: true,
  },
];

/** One toast per category: igni's own name theirs, an extension's
 *  falls to its severity or to "Extensions". */
const TOASTS: ModelToast[] = [
  { id: "t1", text: "igni is waiting for your approval", kind: "info", category: "approval", body: "Run npm test in igni-app?", target: { kind: "session", label: "Trace the billing flow" } },
  { id: "t2", text: "Background process failed (exit 1) · 12.4s", kind: "error", category: "failed", body: "pytest tests/ -q", target: { kind: "session", label: "Trace the billing flow" } },
  { id: "t3", text: "Export ready", kind: "success", source: "Scanner", body: "Runbook.pdf was saved to Downloads." },
  { id: "t4", text: "Scheduled task completed", kind: "info", category: "background", body: "Nightly dependency audit: no new advisories.", target: { kind: "schedule", label: "Scheduled tasks" } },
  { id: "t5", text: "Up to date", kind: "info", category: "update", body: "You're on the latest version (0.9.2)." },
  { id: "t6", text: "Index is still preparing", kind: "warning", source: "Code index", body: "Search results may be incomplete for a few minutes." },
  { id: "t7", text: "Reviewer left 3 comments", kind: "info", source: "Code review", body: "Open the review to see them.", target: { kind: "extension", label: "Code review" } },
];

/** Which toasts to show: `&toasts=t1,t4` picks, `&toasts=0` none. */
function initialToasts(): ModelToast[] {
  const pick = params.get("toasts");
  if (pick === "0") return [];
  if (!pick) return TOASTS.slice(0, 4);
  const ids = new Set(pick.split(","));
  return pick === "all" ? TOASTS : TOASTS.filter((t) => ids.has(t.id));
}

function floorClient(initial: FloorNotification[]): IgniClient {
  let rows = initial.map((r) => ({ ...r }));
  const counts = () => {
    const by_source: Record<string, number> = {};
    for (const r of rows) if (!r.read) by_source[r.source] = (by_source[r.source] ?? 0) + 1;
    return { unread: Object.values(by_source).reduce((a, b) => a + b, 0), by_source };
  };
  return {
    rpc: async (method: string, args: { ids?: string[] } = {}) => {
      if (method === "notifications_mark_read") {
        rows = rows.map((r) => (!args.ids || args.ids.includes(r.id) ? { ...r, read: true } : r));
        return { counts: counts() };
      }
      return { notifications: rows, counts: counts() };
    },
    onEvent: () => () => {},
  } as unknown as IgniClient;
}

const CLIENT = floorClient(params.get("empty") === "1" ? [] : ROWS);

export function NotificationsDemo() {
  const [sheet, setSheet] = useState(params.get("sheet") !== "0");
  const [toasts, setToasts] = useState<ModelToast[]>(initialToasts);

  return (
    <div className="shell">
      <main className="main" style={{ position: "relative" }}>
        <header className="app-header">
          <div className="app-header-blur" aria-hidden="true">
            <TopBlur />
          </div>
          <div className="header-spacer" />
          <button className="chip" onClick={() => setSheet(true)}>
            Open sheet
          </button>
          <button className="chip" onClick={() => setToasts(initialToasts())}>
            Show toasts
          </button>
        </header>
        <div className="conversation" style={{ flex: 1 }} />
        <div style={{ padding: "0 16px 16px" }}>
          <div className="composer">
            <div style={{ minHeight: 64, color: "var(--fg-faint)", padding: "4px 6px" }}>Reply to igni…</div>
          </div>
        </div>
      </main>
      <Toasts items={toasts} onDismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))} />
      {sheet && (
        <NotificationsPanel
          client={CLIENT}
          sourceName={(id) => id}
          onClose={() => setSheet(false)}
        />
      )}
    </div>
  );
}
