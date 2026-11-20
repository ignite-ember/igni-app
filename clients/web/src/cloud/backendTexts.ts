/**
 * What the switch's chip and banners say, per state (design §4.2, §8).
 * Person-facing text only; none of it reaches a model.
 */

import { countOf } from "../lib/plural";
import type { BackendNotice, BackendSnapshot } from "./backendState";

/** The chip in the status line: the active side, and the cloud's state. */
export function chipLabel(s: BackendSnapshot): string {
  if (s.side === "local") return "This computer";
  switch (s.state) {
    case "dialing":
    case "waking":
      return "Cloud · waking…";
    case "cloud_needs_sign_in":
    case "needs_desktop_sign_in":
      return "Cloud · sign in";
    case "cloud_unreachable":
      return "Cloud · offline";
    case "refused":
      return "Cloud · refused";
    default:
      return "Cloud";
  }
}

export type ChipTone = "good" | "warn" | "bad" | "muted";

export function chipTone(s: BackendSnapshot): ChipTone {
  if (s.side === "local") return "muted";
  if (s.state === "cloud_ready") return s.credentialWarning ? "warn" : "good";
  if (s.state === "cloud_unreachable" || s.state === "refused") return "bad";
  return "warn";
}

export function chipTitle(s: BackendSnapshot): string {
  if (s.side === "local") return "igni is running on this computer";
  if (s.credentialWarning) {
    return "Your cloud igni can't reach igni server right now. Runs that need it will fail until it can.";
  }
  if (s.mode === "cloud") return "Your organisation runs igni for you in the cloud";
  return "igni is running in your cloud";
}

/** Why a refusal happened, in words. */
export function refusalText(reason: string): string {
  switch (reason) {
    case "group_local_only":
      return "Your organisation runs igni on this computer.";
    case "inactive":
      return "Your account is not active in your organisation's cloud.";
    case "not_licensed":
    case "licence":
      return "Your organisation's licence does not cover a cloud igni for you.";
    case "gateway_refused":
      return "The cloud gateway igni server named is not one this computer may use.";
    case "not_supported":
      return "Your igni server does not offer a cloud igni yet.";
    case "fleet_not_configured":
      return "Your organisation has not set up a cloud igni.";
    default:
      return "Your cloud igni is unavailable.";
  }
}

/** The unreachable banner's sentence, by cause. */
export function unreachableText(s: BackendSnapshot): string {
  const retry = s.retryInMs !== null && s.retryInMs > 0 ? ` Retrying in ${Math.ceil(s.retryInMs / 1000)} s…` : " Retrying…";
  switch (s.reason) {
    case "busy":
      return `Your cloud is busy.${retry}`;
    case "could_not_start":
      return s.detail ? `Your cloud igni could not start: ${s.detail}` : "Your cloud igni could not start.";
    case "certificate":
      return "Your cloud's certificate could not be verified, so igni will not connect to it. Ask whoever runs your igni server.";
    case "gateway":
      return s.detail ? `Can't reach your cloud igni: ${s.detail}` : "Can't reach your cloud igni.";
    default:
      return `Can't reach your cloud igni.${retry}`;
  }
}

/** A notice's sentence. */
export function noticeText(n: BackendNotice): string {
  const approvals = (count: number, tense: "will be" | "were") =>
    count > 0 ? ` ${countOf(count, "approval")} on this computer ${tense} dropped.` : "";
  switch (n.kind) {
    case "moving_to_cloud":
      return `Your organisation moved igni to the cloud. Switching when the current run ends.${approvals(n.approvals, "will be")}`;
    case "moved_to_cloud":
      return (
        "Your organisation moved igni to the cloud." +
        (n.afterWait ? " The run on this computer was still going after ten minutes." : "") +
        approvals(n.approvalsDropped, "were")
      );
    case "moved_to_local":
      return "Your organisation now runs igni on this computer.";
  }
}

/** The badge on the switch: what still waits on this computer. */
export function badgeText(s: BackendSnapshot): string {
  const waiting = s.localActivity.runs + s.localActivity.approvals;
  return waiting > 0 ? `${waiting} waiting on this computer` : "";
}
