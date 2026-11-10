import { describe, expect, it } from "vitest";

import { PERMISSION_MODE_NAMES } from "../../protocol/messages";
import { modeSwitch, PERMISSION_MODES, permissionModeOption } from "./permissionModes";

describe("modeSwitch", () => {
  it.each([
    ["default", "plan", "/plan on"],
    ["default", "acceptEdits", "/accept on"],
    ["plan", "bypassPermissions", "/bypass on"],
    ["plan", "default", "/plan off"],
    ["acceptEdits", "default", "/accept off"],
    ["bypassPermissions", "default", "/bypass off"],
  ] as const)("%s -> %s is %s", (current, next, command) => {
    expect(modeSwitch(current, next)).toEqual({ kind: "command", command });
  });

  it("does nothing for the mode already on", () => {
    expect(modeSwitch("plan", "plan")).toEqual({ kind: "unchanged" });
    expect(modeSwitch("default", "default")).toEqual({ kind: "unchanged" });
  });

  it("leaves a mode it cannot reach alone, and says which one", () => {
    // ``dontAsk`` has no slash command, so there is nothing to send.
    expect(modeSwitch("dontAsk", "default")).toEqual({ kind: "unreachable", from: "dontAsk" });
    expect(modeSwitch("somethingNew", "default")).toEqual({
      kind: "unreachable",
      from: "somethingNew",
    });
  });

  it("still reaches a mode with a command from one without", () => {
    expect(modeSwitch("dontAsk", "plan")).toEqual({ kind: "command", command: "/plan on" });
  });

  it("treats a session that has reported no mode as the default one", () => {
    expect(modeSwitch(undefined, "plan")).toEqual({ kind: "command", command: "/plan on" });
  });
});

describe("permissionModeOption", () => {
  it("describes every mode the wire contract knows", () => {
    for (const name of PERMISSION_MODE_NAMES) {
      expect(permissionModeOption(name)?.value).toBe(name);
    }
  });

  it("does not read a mode it does not know as the default", () => {
    expect(permissionModeOption("nope")).toBeNull();
  });

  it("reads the modes it knows as themselves", () => {
    expect(permissionModeOption("plan")?.value).toBe("plan");
    expect(permissionModeOption("dontAsk")?.value).toBe("dontAsk");
  });

  it("offers the picker's own default before the backend reports one", () => {
    expect(permissionModeOption(undefined)?.value).toBe("default");
  });
});

describe("the modes on offer", () => {
  it("offers every mode the composer can pick, and not the one it cannot", () => {
    expect(PERMISSION_MODES.map((m) => m.value)).toEqual([
      "default",
      "plan",
      "acceptEdits",
      "bypassPermissions",
    ]);
  });
});
