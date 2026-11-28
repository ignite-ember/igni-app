import { useCallback, useEffect, useRef, useState } from "react";

/** Mode badge — small chip rendered in the status line when
 *  ``permission_mode`` is any non-default value. Different
 *  styling per mode so the user can tell at a glance whether
 *  the sandbox is tightened (plan, dontAsk) or loosened
 *  (acceptEdits, bypassPermissions). Hidden in ``default`` mode
 *  so the badge has signal value (you only see it when it
 *  matters).
 *
 *  CC parity:
 *  * row 50 — ``plan`` (read-only sandbox)
 *  * row 51 — ``acceptEdits`` (auto-approve edits)
 *  * row 7  — ``dontAsk`` / ``bypassPermissions`` future modes
 *
 *  ``PlanBadge`` is kept as a legacy alias — call sites that only
 *  care about plan mode can use it. New surfaces should use
 *  ``ModeBadge``. */
type ModeBadgeStyle = {
  className: string;
  label: string;
  title: string;
};

const MODE_BADGE_STYLES: Record<string, ModeBadgeStyle> = {
  plan: {
    className: "plan-badge",
    label: "PLAN MODE",
    title:
      "In plan mode — the agent can read + search but cannot edit files or run mutating commands. Type /plan again to exit.",
  },
  acceptEdits: {
    className: "plan-badge mode-badge--accept",
    label: "ACCEPT EDITS",
    title:
      "In acceptEdits mode — file-edit tools auto-approve. Use /accept off to leave.",
  },
  dontAsk: {
    className: "plan-badge mode-badge--dontask",
    label: "STRICT (DONT-ASK)",
    title:
      "In dontAsk mode — anything without an explicit allow rule is denied. Strictest non-plan mode.",
  },
  bypassPermissions: {
    className: "plan-badge mode-badge--bypass",
    label: "AUTO",
    title:
      "In Auto mode — most permission gates skipped. Scoped denies still hold (e.g. .env protection).",
  },
};

export function ModeBadge({ mode }: { mode: string }) {
  const style = MODE_BADGE_STYLES[mode];
  if (!style) return null;
  return (
    <span className={style.className} title={style.title}>
      <span className="plan-badge-dot" /> {style.label}
    </span>
  );
}

/** Legacy alias — same behaviour as the previous plan-only
 *  badge. Existing call sites kept working without touching them. */
export const PlanBadge = ModeBadge;

/** Footer "Auto-approve" switch — one-click toggle into
 *  ``bypassPermissions`` mode. When ON, the agent runs any tool
 *  without asking (HITL prompts skipped); when OFF, the default
 *  per-tool ask policy applies. Scoped denies (e.g. ``.env``)
 *  still block in either state. The switch is intentionally
 *  loud when active — red pill + dot — so the user can't forget
 *  it's on. Session-only: every new session starts OFF. */
export function AutoApproveSwitch({
  mode,
  onToggle,
}: {
  mode: string;
  onToggle: (next: boolean) => void;
}) {
  const active = mode === "bypassPermissions";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      className={`auto-approve-switch${active ? " is-on" : ""}`}
      title={
        active
          ? "Auto-approve is ON — every tool runs without asking. Click to turn off."
          : "Auto-approve is OFF — tools ask for permission. Click to let the agent continue without prompts."
      }
      onClick={() => onToggle(!active)}
    >
      <span className="auto-approve-track">
        <span className="auto-approve-thumb" />
      </span>
      <span className="auto-approve-label">
        Auto-approve{active ? " ON" : ""}
      </span>
    </button>
  );
}

/** Backend-version chip for the desktop app — renders only when the
 *  Tauri shell puts ``expected_cli`` + ``actual_cli`` + ``backend_source``
 *  query params on the page URL. In a plain browser the params are
 *  absent and this component paints nothing.
 *
 *  Three visual states:
 *
 *   * ``ok``       — actual == expected AND managed venv is active.
 *                    Small neutral chip: "cli · vX.Y.Z".
 *   * ``dev``      — running through IGNI_DEV_BACKEND override.
 *                    Amber chip; hover text names the env var.
 *   * ``mismatch`` — actual != expected. Red chip; tooltip suggests
 *                    Diagnose Backend.
 *
 *  The chip is a passive display — it doesn't need RPC roundtripping
 *  or dependency on the running BE, because the shell embeds the
 *  values it *already* resolved at bootstrap. If we can't render this
 *  because the BE is down, that's exactly when the chip is useful:
 *  a bootstrap failure often leaves the shell sitting on a stale
 *  interpreter, and the chip is the fastest way for the reader to
 *  see it.
 */
export function BackendVersionChip() {
  const info = readBackendVersionParams();
  if (!info) return null;
  // On the desktop's cloud side the backend is the VM's igni, whose
  // version the relay cannot see: its `welcome` carries none (design §5).
  if (info.source === "cloud") {
    return (
      <span className="backend-version-chip tone-ok" title="igni in your cloud">
        cloud
      </span>
    );
  }

  const mismatch =
    info.actual && info.expected && info.actual !== info.expected;
  const dev = info.source === "dev_override";
  const tone = mismatch ? "danger" : dev ? "warn" : "ok";

  // Compact form — sits next to the ``igni`` wordmark in the
  // brand row, so it needs to read as a subtitle, not a pill.
  // ``ok`` renders as bare grey text ("v0.9.0"); ``warn`` and
  // ``danger`` keep the coloured pill so the failure states
  // still stand out.
  const label =
    info.actual === "unknown" ? "<probe failed>" : `v${info.actual}`;

  const title = mismatch
    ? `Running igni-core v${info.actual}, expected v${info.expected}. ` +
      "Diagnose Backend for details."
    : dev
      ? `Dev override active — running the interpreter set in your ` +
        `environment (v${info.actual}). Managed venv is bypassed.`
      : `igni-core v${info.actual}, managed venv.`;

  return (
    <span className={`backend-version-chip tone-${tone}`} title={title}>
      {label}
    </span>
  );
}

interface BackendVersionInfo {
  expected: string;
  actual: string;
  source: string;
}

/** Parse the version-info the host embedded on the current page:
 *  URL query params (``?expected_cli=…&actual_cli=…&backend_source=…``),
 *  which the Tauri shell sets on the top-level URL.
 *
 *  Kept as a plain function (not a hook) so it runs once at mount
 *  — the values don't change over the tool-window / panel lifetime.
 */
function readBackendVersionParams(): BackendVersionInfo | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const expected = params.get("expected_cli");
  const actual = params.get("actual_cli");
  const source = params.get("backend_source");
  // All three must be present. Absence = "no host embedded them,
  // don't render the chip".
  if (!expected || !actual || !source) return null;
  return { expected, actual, source };
}

/** What the session readout can do to the open chat. */
export interface SessionContextActions {
  compact: () => void;
  openContext: () => void;
  clear: () => void;
  fork: () => void;
}

/** The tooltip on an operation that waits for the running reply. */
const WAIT_FOR_REPLY = "Wait for the reply to finish";

/** Session + context in one control: a ring that fills as the session's
 *  context does (calm → warning → danger), with the short session id
 *  beside it, opening one readout — the session (click to copy its full
 *  id) and how full the context window is. igni has no rate limits to
 *  show, so this one dial is the whole story of the session's memory.
 *
 *  **Every number is checked before it is formatted.** The types say
 *  they are numbers; they come off a status message from the backend,
 *  where a field can be absent, and ``undefined`` has no
 *  ``toLocaleString``. There is no error boundary above this, so one
 *  status update without a token count must not unmount the window. */
export function SessionContext({
  sessionId,
  tokens,
  max,
  pct,
  actions,
  busy = false,
}: {
  sessionId: string;
  tokens: number;
  max: number;
  pct: number;
  /** The context operations listed under the bar; absent lists none. */
  actions?: SessionContextActions;
  /** A reply is running: the operations that change the chat wait. */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const used = Number.isFinite(tokens) ? tokens : 0;
  const ceiling = Number.isFinite(max) ? max : 0;
  const safe = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  const tone = safe >= 90 ? "danger" : safe >= 70 ? "warn" : "ok";
  // First 8 chars — the id the backend uses everywhere; copy ships the
  // full string for consumers that kept the longer original.
  const short = sessionId ? sessionId.slice(0, 8) : "—";

  // Ring geometry: a 16-px circle whose arc is the share used, drawn
  // from the top (the −90° rotation) clockwise.
  const r = 6.9;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * (safe / 100);

  const copyId = async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API blocked (insecure context, etc.); silently ignore.
    }
  };

  return (
    <span className="session-ctx-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`session-ctx tone-${tone}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Session ${short}, context ${safe}% full`}
        title={
          ceiling
            ? `Context: ${used.toLocaleString()} of ${ceiling.toLocaleString()} tokens (${safe}%)`
            : `Context: ${used.toLocaleString()} tokens`
        }
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: "block" }}>
          <circle className="ctx-ring-track" cx="8" cy="8" r={r} fill="none" strokeWidth="2.2" />
          <circle
            className="ctx-ring-fill"
            cx="8"
            cy="8"
            r={r}
            fill="none"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
        <code className="session-ctx-id">{short}</code>
      </button>
      {open && (
        <>
          <span className="ctx-backdrop" onClick={close} />
          <div className={`dropdown ctx-pop tone-${tone}`} role="dialog" aria-label="Session and context">
            <button
              type="button"
              className="session-ctx-copy"
              onClick={copyId}
              disabled={!sessionId}
              title={sessionId ? (copied ? "Copied!" : `Copy ${sessionId}`) : undefined}
            >
              <span className="session-ctx-copy-head">Session</span>
              <code>{copied ? "copied" : short}</code>
            </button>
            <div className="ctx-pop-divider" />
            <div className="ctx-pop-head">
              <span>Context window</span>
              <span className="ctx-pop-pct">{safe}%</span>
            </div>
            <div className="ctx-pop-bar">
              <span className="ctx-pop-bar-fill" style={{ width: `${safe}%` }} />
            </div>
            <div className="ctx-pop-sub">
              {ceiling
                ? `${used.toLocaleString()} of ${ceiling.toLocaleString()} tokens`
                : `${used.toLocaleString()} tokens`}
            </div>
            {actions && (
              <>
                <div className="ctx-pop-divider" />
                <div className="ctx-pop-actions" role="group" aria-label="Context operations">
                  {[
                    { label: "Compact conversation", run: actions.compact, waits: true },
                    { label: "Context details", run: actions.openContext, waits: false },
                    { label: "Clear conversation", run: actions.clear, waits: true },
                    { label: "Fork conversation", run: actions.fork, waits: true },
                  ].map(({ label, run, waits }) => (
                    <button
                      key={label}
                      type="button"
                      className="ctx-pop-action"
                      disabled={waits && busy}
                      title={waits && busy ? WAIT_FOR_REPLY : undefined}
                      onClick={() => {
                        close();
                        run();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </span>
  );
}
