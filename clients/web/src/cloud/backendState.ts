/**
 * The desktop shell's cloud switch, as a window sees it.
 *
 * The shell owns one app-wide side, *This computer* or *Cloud*, and
 * pushes its state to every window (`igni-backend-state`, answered by
 * the `backend_state` command). igni-core's
 * `docs/design/local-cloud-switch.md` §4.2 is the state machine; this
 * file only reads what the shell sends, at the boundary, so a field an
 * older shell leaves out reads as its safe fallback.
 *
 * A window also knows its side before anything is pushed: the shell
 * loads it with `side=` and `backend=` in its URL, and re-loads it on
 * every switch, so hidden features never flash.
 */

import { WirePayload } from "../protocol/wirePayload";

export type Side = "local" | "cloud";

export const BACKEND_STATES = [
  "local",
  "dialing",
  "waking",
  "cloud_ready",
  "cloud_needs_sign_in",
  "needs_desktop_sign_in",
  "cloud_unreachable",
  "refused",
] as const;
export type BackendStateName = (typeof BACKEND_STATES)[number];

export type GroupMode = "local" | "cloud" | "local_and_cloud";

export type NoticeKind = "moving_to_cloud" | "moved_to_cloud" | "moved_to_local";

export interface BackendNotice {
  kind: NoticeKind;
  /** Approvals still waiting on this computer (moving_to_cloud). */
  approvals: number;
  /** The move went after the ten-minute wait, with a run still going. */
  afterWait: boolean;
  /** Approvals on this computer the move left behind. */
  approvalsDropped: number;
}

export interface LocalActivity {
  runs: number;
  approvals: number;
}

/** One push from the shell. */
export class BackendSnapshot {
  constructor(
    readonly side: Side,
    readonly state: BackendStateName,
    /** An unreachable cause (`network`, `busy`, `could_not_start`,
     *  `certificate`, `gateway`) or a refusal's reason. */
    readonly reason: string,
    readonly detail: string,
    readonly credentialWarning: boolean,
    readonly mode: GroupMode,
    readonly cloud: "unknown" | "available" | "unavailable",
    readonly switchVisible: boolean,
    readonly chipVisible: boolean,
    readonly canUseLocal: boolean,
    readonly backendKey: string,
    readonly localActivity: LocalActivity,
    readonly notice: BackendNotice | null,
    readonly retryInMs: number | null,
    readonly groupName: string,
  ) {}

  static parse(raw: unknown): BackendSnapshot | null {
    if (!WirePayload.isRecord(raw)) return null;
    const p = new WirePayload(raw);
    const activity = new WirePayload(p.value("local_activity"));
    const noticeRaw = p.plainObject("notice");
    const notice = noticeRaw ? BackendSnapshot.noticeFrom(new WirePayload(noticeRaw)) : null;
    return new BackendSnapshot(
      p.oneOf<Side>("side", ["local", "cloud"], "local"),
      p.oneOf<BackendStateName>("state", BACKEND_STATES, "local"),
      p.string("reason"),
      p.string("detail"),
      p.flag("credential_warning"),
      p.oneOf<GroupMode>("mode", ["local", "cloud", "local_and_cloud"], "local_and_cloud"),
      p.oneOf("cloud", ["unknown", "available", "unavailable"] as const, "unknown"),
      p.flag("switch_visible"),
      p.flag("chip_visible"),
      p.flag("can_use_local"),
      p.string("backend_key", "local"),
      { runs: activity.optionalNumber("runs") ?? 0, approvals: activity.optionalNumber("approvals") ?? 0 },
      notice,
      p.optionalNumber("retry_in_ms") ?? null,
      p.string("group_name"),
    );
  }

  private static noticeFrom(p: WirePayload): BackendNotice | null {
    const kind = p.oneOf<NoticeKind | "">("kind", ["moving_to_cloud", "moved_to_cloud", "moved_to_local", ""], "");
    if (!kind) return null;
    return {
      kind,
      approvals: p.optionalNumber("approvals") ?? 0,
      afterWait: p.flag("after_wait"),
      approvalsDropped: p.optionalNumber("approvals_dropped") ?? 0,
    };
  }

  /** Whether the chat shows the waking overlay's states. */
  get connecting(): boolean {
    return this.state === "dialing" || this.state === "waking";
  }
}

/** The side this window was loaded on (`?side=`), `local` when the
 *  shell named none (a browser, or an older shell). */
export function windowSide(search: string = typeof window === "undefined" ? "" : window.location.search): Side {
  return new URLSearchParams(search).get("side") === "cloud" ? "cloud" : "local";
}

/** The storage key of this window's backend (`?backend=`, §4.4):
 *  `local`, or `cloud-<12 hex>` for one account on one gateway. */
export function windowBackendKey(search: string = typeof window === "undefined" ? "" : window.location.search): string {
  const key = new URLSearchParams(search).get("backend") ?? "";
  return /^(local|cloud(-[0-9a-f]{12})?)$/.test(key) ? key : "local";
}

/** Whether this window is on the cloud side. */
export function onCloud(): boolean {
  return windowSide() === "cloud";
}
