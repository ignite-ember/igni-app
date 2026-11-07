import { describe, expect, it, vi } from "vitest";

import { PICK_DIR_TIMEOUT_MS, ProjectFolderPicker } from "./projectFolderPicker";

const client = (answer: unknown | Error) => ({
  rpc: vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  }),
});

describe("ProjectFolderPicker", () => {
  it("takes the shell's dialog first", async () => {
    const c = client({});
    const pick = await new ProjectFolderPicker(c as never, async () => "/a").pick("/cur");
    expect(pick).toEqual({ kind: "picked", path: "/a" });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("stops when the shell's dialog is cancelled", async () => {
    const pick = await new ProjectFolderPicker(client({}) as never, async () => null).pick("");
    expect(pick).toEqual({ kind: "cancelled" });
  });

  it("asks the backend's dialog without a shell, and waits for the person", async () => {
    const c = client({ path: "/b", cancelled: false, error: "" });
    const pick = await new ProjectFolderPicker(c as never, async () => undefined).pick("");
    expect(pick).toEqual({ kind: "picked", path: "/b" });
    expect(c.rpc).toHaveBeenCalledWith("pick_dir_native", {}, PICK_DIR_TIMEOUT_MS);
  });

  it("stops when the backend's dialog is cancelled", async () => {
    const c = client({ path: "", cancelled: true, error: "" });
    expect(await new ProjectFolderPicker(c as never, async () => undefined).pick("")).toEqual({
      kind: "cancelled",
    });
  });

  it("falls back to the in-app picker when no dialog can open", async () => {
    const failing = client(new Error("headless"));
    expect(await new ProjectFolderPicker(failing as never, async () => undefined).pick("")).toEqual({
      kind: "in-app",
    });
    const erroring = client({ path: "", cancelled: false, error: "no display" });
    expect(await new ProjectFolderPicker(erroring as never, async () => undefined).pick("")).toEqual({
      kind: "in-app",
    });
  });
});
