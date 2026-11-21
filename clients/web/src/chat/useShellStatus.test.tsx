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

function mount(answers: Record<string, unknown>, account?: () => Promise<unknown> | null) {
  const windowModel = { write: vi.fn() };
  const source = new StatusSource(client(answers) as never, account);
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

describe("useShellStatus on the desktop's cloud side", () => {
  // The VM's igni runs on its own credential and names nobody: its
  // status has an empty cloud_email. Who is signed in is this computer's.
  const vm = { cloud_email: "", cloud_org: "", cloud_connected: false, model: "gemini" };
  const mine = { cloud_email: "rita@acme.test", cloud_name: "Rita", cloud_org: "Acme", cloud_connected: true, model: "local" };

  it("lays this computer's account over the VM's status, so the wall stays down", async () => {
    const { hook } = mount({ get_status: vm, get_project_dir: "/workspace" }, async () => mine);
    expect(hook.result.current.auth).toBe("unknown");
    await act(() => hook.result.current.refreshStatus());
    expect(hook.result.current.auth).toBe("signed-in");
    expect(hook.result.current.status).toEqual({
      cloud_email: "rita@acme.test",
      cloud_name: "Rita",
      cloud_org: "Acme",
      cloud_connected: true,
      model: "gemini",
    });
  });

  it("keeps this computer's account over a status the VM pushes later", async () => {
    const { hook } = mount({ get_status: vm, get_project_dir: "/workspace" }, async () => mine);
    await act(() => hook.result.current.refreshStatus());
    act(() => hook.result.current.setStatus({ ...vm, model: "pushed" } as never));
    expect(hook.result.current.auth).toBe("signed-in");
    expect(hook.result.current.status?.cloud_email).toBe("rita@acme.test");
    expect(hook.result.current.status?.model).toBe("pushed");
  });

  it("shows the wall when this computer is signed out, whatever the VM says", async () => {
    const { hook } = mount({ get_status: { ...vm, cloud_email: "vm@x" } }, async () => ({ cloud_email: "" }));
    await act(() => hook.result.current.refreshStatus());
    expect(hook.result.current.auth).toBe("signed-out");
  });

  it("is not signed out while this computer has not answered", async () => {
    const { hook } = mount({ get_status: vm }, async () => {
      throw new Error("not reachable");
    });
    await act(() => hook.result.current.refreshStatus());
    expect(hook.result.current.status?.cloud_email).toBe("");
    expect(hook.result.current.auth).toBe("unknown");
  });

  it("reads only the account's fields from this computer", async () => {
    const source = new StatusSource(client({}) as never, async () => mine);
    expect(await source.account()).toEqual({
      ok: true,
      account: { cloud_email: "rita@acme.test", cloud_name: "Rita", cloud_org: "Acme", cloud_connected: true },
    });
    expect(await new StatusSource(client({}) as never).account()).toBeNull();
    expect(await new StatusSource(client({}) as never, () => null).account()).toBeNull();
  });
});

describe("authPhaseOf", () => {
  it("does not know before the first status, so the wall does not flash", () => {
    expect(authPhaseOf(null)).toBe("unknown");
    expect(authPhaseOf({ cloud_email: "" } as never)).toBe("signed-out");
    expect(authPhaseOf({ cloud_email: "a@b" } as never)).toBe("signed-in");
  });
});
