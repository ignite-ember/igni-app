import { describe, expect, it } from "vitest";

import { ToastTone } from "./toastTone";

describe("ToastTone", () => {
  it.each([
    ["info", "info", "status"],
    ["success", "success", "status"],
    ["warning", "warning", "alert"],
    ["error", "error", "alert"],
  ])("reads %s as a %s mark announced as %s", (kind, severity, role) => {
    const tone = ToastTone.of(kind);
    expect(tone.severity).toBe(severity);
    expect(tone.role).toBe(role);
  });

  it("reads a kind it does not know, or none, as quiet news", () => {
    for (const kind of ["schedule", "", null, undefined]) {
      expect(ToastTone.of(kind)).toMatchObject({ severity: "info", role: "status" });
    }
  });
});
