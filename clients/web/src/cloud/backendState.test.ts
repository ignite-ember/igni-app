import { describe, expect, it } from "vitest";

import { BackendSnapshot, windowBackendKey, windowSide } from "./backendState";
import { badgeText, chipLabel, chipTone, noticeText, refusalText, unreachableText } from "./backendTexts";
import { shellSnapshot } from "./testing";

const parse = (o: Record<string, unknown> = {}) => BackendSnapshot.parse(shellSnapshot(o))!;

describe("BackendSnapshot.parse", () => {
  it("reads every field the shell sends", () => {
    const s = parse({
      side: "cloud",
      state: "cloud_unreachable",
      reason: "busy",
      detail: "x",
      retry_in_ms: 4000,
      backend_key: "cloud-0123456789ab",
      local_activity: { runs: 1, approvals: 2 },
      notice: { kind: "moving_to_cloud", approvals: 2 },
    });
    expect(s.side).toBe("cloud");
    expect(s.state).toBe("cloud_unreachable");
    expect(s.reason).toBe("busy");
    expect(s.retryInMs).toBe(4000);
    expect(s.backendKey).toBe("cloud-0123456789ab");
    expect(s.localActivity).toEqual({ runs: 1, approvals: 2 });
    expect(s.notice).toEqual({ kind: "moving_to_cloud", approvals: 2, afterWait: false, approvalsDropped: 0 });
    expect(s.groupName).toBe("Engineering");
  });

  it("reads what an older or odd shell sends as the safe fallback", () => {
    const s = BackendSnapshot.parse({ state: "melting", side: "elsewhere", notice: { kind: "unknown" } })!;
    expect(s.side).toBe("local");
    expect(s.state).toBe("local");
    expect(s.switchVisible).toBe(false);
    expect(s.chipVisible).toBe(false);
    expect(s.notice).toBeNull();
    expect(s.retryInMs).toBeNull();
    expect(BackendSnapshot.parse(null)).toBeNull();
    expect(BackendSnapshot.parse("x")).toBeNull();
  });

  it("knows which states are the waking overlay's", () => {
    expect(parse({ side: "cloud", state: "dialing" }).connecting).toBe(true);
    expect(parse({ side: "cloud", state: "waking" }).connecting).toBe(true);
    expect(parse({ side: "cloud", state: "cloud_ready" }).connecting).toBe(false);
  });
});

describe("the window's side and backend key from its URL", () => {
  it("reads side=cloud and a well-formed key, and falls back to local", () => {
    expect(windowSide("?side=cloud&backend=cloud-0123456789ab")).toBe("cloud");
    expect(windowSide("?side=local")).toBe("local");
    expect(windowSide("")).toBe("local");
    expect(windowBackendKey("?backend=cloud-0123456789ab")).toBe("cloud-0123456789ab");
    expect(windowBackendKey("?backend=cloud")).toBe("cloud");
    expect(windowBackendKey("?backend=local")).toBe("local");
    expect(windowBackendKey("?backend=../../x")).toBe("local");
    expect(windowBackendKey("?backend=cloud-XYZ")).toBe("local");
    expect(windowBackendKey("")).toBe("local");
  });
});

describe("what the chip and banners say", () => {
  it("labels the chip per state", () => {
    expect(chipLabel(parse())).toBe("This computer");
    expect(chipLabel(parse({ side: "cloud", state: "cloud_ready" }))).toBe("Cloud");
    expect(chipLabel(parse({ side: "cloud", state: "waking" }))).toBe("Cloud · waking…");
    expect(chipLabel(parse({ side: "cloud", state: "dialing" }))).toBe("Cloud · waking…");
    expect(chipLabel(parse({ side: "cloud", state: "cloud_needs_sign_in" }))).toBe("Cloud · sign in");
    expect(chipLabel(parse({ side: "cloud", state: "needs_desktop_sign_in" }))).toBe("Cloud · sign in");
    expect(chipLabel(parse({ side: "cloud", state: "cloud_unreachable" }))).toBe("Cloud · offline");
    expect(chipLabel(parse({ side: "cloud", state: "refused" }))).toBe("Cloud · refused");
    expect(chipTone(parse({ side: "cloud", state: "cloud_ready", credential_warning: true }))).toBe("warn");
    expect(chipTone(parse({ side: "cloud", state: "cloud_ready" }))).toBe("good");
    expect(chipTone(parse({ side: "cloud", state: "cloud_unreachable" }))).toBe("bad");
    expect(chipTone(parse())).toBe("muted");
  });

  it("names each unreachable cause", () => {
    const u = (o: Record<string, unknown>) => unreachableText(parse({ side: "cloud", state: "cloud_unreachable", ...o }));
    expect(u({ reason: "network", retry_in_ms: 3500 })).toBe("Can't reach your cloud igni. Retrying in 4 s…");
    expect(u({ reason: "network" })).toBe("Can't reach your cloud igni. Retrying…");
    expect(u({ reason: "busy" })).toBe("Your cloud is busy. Retrying…");
    expect(u({ reason: "could_not_start", detail: "the VM did not start" })).toBe("Your cloud igni could not start: the VM did not start");
    expect(u({ reason: "could_not_start" })).toBe("Your cloud igni could not start.");
    expect(u({ reason: "certificate" })).toMatch(/certificate could not be verified/);
    expect(u({ reason: "gateway", detail: "pin" })).toBe("Can't reach your cloud igni: pin");
    expect(u({ reason: "gateway" })).toBe("Can't reach your cloud igni.");
  });

  it("names each refusal, and an unknown one plainly", () => {
    expect(refusalText("group_local_only")).toBe("Your organisation runs igni on this computer.");
    expect(refusalText("inactive")).toMatch(/not active/);
    expect(refusalText("not_licensed")).toMatch(/licence/);
    expect(refusalText("licence")).toMatch(/licence/);
    expect(refusalText("gateway_refused")).toMatch(/not one this computer may use/);
    expect(refusalText("not_supported")).toMatch(/does not offer/);
    expect(refusalText("fleet_not_configured")).toMatch(/has not set up/);
    expect(refusalText("brand_new_reason")).toBe("Your cloud igni is unavailable.");
  });

  it("words the notices and the badge", () => {
    expect(noticeText({ kind: "moving_to_cloud", approvals: 1, afterWait: false, approvalsDropped: 0 })).toBe(
      "Your organisation moved igni to the cloud. Switching when the current run ends. 1 approval on this computer will be dropped.",
    );
    expect(noticeText({ kind: "moving_to_cloud", approvals: 0, afterWait: false, approvalsDropped: 0 })).toBe(
      "Your organisation moved igni to the cloud. Switching when the current run ends.",
    );
    expect(noticeText({ kind: "moved_to_cloud", approvals: 0, afterWait: true, approvalsDropped: 2 })).toBe(
      "Your organisation moved igni to the cloud. The run on this computer was still going after ten minutes. 2 approvals on this computer were dropped.",
    );
    expect(noticeText({ kind: "moved_to_local", approvals: 0, afterWait: false, approvalsDropped: 0 })).toBe(
      "Your organisation now runs igni on this computer.",
    );
    expect(badgeText(parse({ side: "cloud", local_activity: { runs: 1, approvals: 0 } }))).toBe("1 waiting on this computer");
    expect(badgeText(parse({ side: "cloud" }))).toBe("");
  });
});
