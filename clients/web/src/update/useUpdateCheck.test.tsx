// @vitest-environment jsdom
/**
 * What the update check tells the person. The menu's explicit check
 * (silent = false) always answers: a policy with checks off is said as
 * such, not as "up to date", and a failed check (a refused mirror) is
 * said too (R628). The background check says nothing but an update.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { host } from "../lib/host";
import { useUpdateCheck } from "./useUpdateCheck";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rig(answer: unknown) {
  vi.spyOn(host, "checkUpdate").mockImplementation(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
  );
  const notify = vi.spyOn(host, "notify").mockResolvedValue(undefined as never);
  const windowModel = { openDialog: vi.fn() };
  const hook = renderHook(() => useUpdateCheck({ rpc: vi.fn() } as never, windowModel as never));
  return { hook, notify, windowModel };
}

const disabled = { available: false, current_version: "1.0.4", latest_version: "", checks_disabled: true };

describe("useUpdateCheck", () => {
  it("says checks are off, not 'up to date', when the policy turned them off", async () => {
    const { hook, notify } = rig(disabled);
    await act(() => hook.result.current.check(false));
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0][0]).toMatchObject({ title: "Update checks are off" });
  });

  it("says a check that failed failed, when asked from the menu", async () => {
    const { hook, notify } = rig(new Error("the update endpoint must use https"));
    await act(() => hook.result.current.check(false));
    expect(notify).toHaveBeenCalledWith({
      title: "Couldn't check for updates",
      body: "the update endpoint must use https",
    });
  });

  it("stays quiet in the background about everything but an update", async () => {
    for (const answer of [disabled, new Error("offline"), { available: false, current_version: "1.0.4" }]) {
      const { hook, notify } = rig(answer);
      await act(() => hook.result.current.check(true));
      expect(notify).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it("still says 'up to date' after a real check found nothing", async () => {
    const { hook, notify } = rig({ available: false, current_version: "1.0.4", latest_version: "1.0.4" });
    await act(() => hook.result.current.check(false));
    expect(notify.mock.calls[0][0]).toMatchObject({ title: "Up to date" });
  });
});
