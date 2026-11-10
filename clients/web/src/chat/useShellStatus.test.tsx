// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { StatusSource } from "./statusSource";
import { authPhaseOf, useShellStatus } from "./useShellStatus";

afterEach(cleanup);

function client(answers: Record<string, unknown>) {
  return {
    rpc: vi.fn(async (method: string) => {
      const answer = answers[method];
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
}

function mount(answers: Record<string, unknown>) {
  const windowModel = { write: vi.fn() };
  const source = new StatusSource(client(answers) as never);
  const hook = renderHook(() => useShellStatus(source, windowModel as never));
  return { hook, windowModel };
}

describe("useShellStatus", () => {
  it("still writes the folder when the status cannot be read", async () => {
    const { hook, windowModel } = mount({
      get_status: new Error("disconnected"),
      get_project_dir: "/work",
    });
    await act(() => hook.result.current.refreshStatus());
    expect(hook.result.current.status).toBeNull();
    expect(windowModel.write).toHaveBeenCalledWith("project_dir", "/work");
  });

  it("still shows the status when the folder cannot be read", async () => {
    const { hook, windowModel } = mount({
      get_status: { cloud_email: "a@b" },
      get_project_dir: new Error("older backend"),
    });
    await act(() => hook.result.current.refreshStatus());
    expect(hook.result.current.status).toEqual({ cloud_email: "a@b" });
    expect(hook.result.current.auth).toBe("signed-in");
    expect(windowModel.write).not.toHaveBeenCalled();
  });

  it("keeps the last sessions when the list cannot be read", async () => {
    const { hook } = mount({ list_sessions: new Error("gone") });
    await act(() => hook.result.current.refreshSessions());
    expect(hook.result.current.sessions).toEqual([]);
  });

  it("keeps its refreshers' identity across renders", () => {
    const { hook } = mount({});
    const first = hook.result.current;
    hook.rerender();
    expect(hook.result.current.refreshStatus).toBe(first.refreshStatus);
    expect(hook.result.current.refreshSessions).toBe(first.refreshSessions);
  });
});

describe("authPhaseOf", () => {
  it("does not know before the first status, so the wall does not flash", () => {
    expect(authPhaseOf(null)).toBe("unknown");
    expect(authPhaseOf({ cloud_email: "" } as never)).toBe("signed-out");
    expect(authPhaseOf({ cloud_email: "a@b" } as never)).toBe("signed-in");
  });
});
