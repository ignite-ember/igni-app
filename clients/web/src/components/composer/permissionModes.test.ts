import { describe, expect, it } from "vitest";

import { modeSwitchCommand, permissionModeOption } from "./permissionModes";

describe("modeSwitchCommand", () => {
  it.each([
    ["default", "plan", "/plan on"],
    ["default", "acceptEdits", "/accept on"],
    ["plan", "bypassPermissions", "/bypass on"],
    ["plan", "default", "/plan off"],
    ["acceptEdits", "default", "/accept off"],
    ["bypassPermissions", "default", "/bypass off"],
  ] as const)("%s -> %s is %s", (current, next, command) => {
    expect(modeSwitchCommand(current, next)).toBe(command);
  });

  it("does nothing for the mode already on", () => {
    expect(modeSwitchCommand("plan", "plan")).toBeNull();
    expect(modeSwitchCommand("default", "default")).toBeNull();
  });

  it("has nothing to turn off from a mode it does not know", () => {
    expect(modeSwitchCommand("somethingNew", "default")).toBeNull();
  });
});

describe("permissionModeOption", () => {
  it("reads an unknown mode as the default", () => {
    expect(permissionModeOption("nope").value).toBe("default");
    expect(permissionModeOption("plan").value).toBe("plan");
  });
});
