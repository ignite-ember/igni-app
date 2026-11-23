// @vitest-environment jsdom
/**
 * Where the switch reaches the rest of the app: the push hook, the
 * account menu (whose calls go to this computer's backend on the cloud),
 * Log out and the folder picker on the cloud side, the read-only
 * project chip, the version chip, and the local activity report.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

import { ShellActions, type ShellActionsDeps } from "../chat/shellActions";
import { StatusSource } from "../chat/statusSource";
import { useShellStatus } from "../chat/useShellStatus";
import { AccountMenu } from "../components/AccountMenu";
import { ComposerDock } from "../components/ComposerDock";
import { ProjectChip } from "../components/ProjectChip";
import { BackendVersionChip } from "../components/StatusBits";
import { BackendSnapshot } from "./backendState";
import { shellSnapshot } from "./testing";
import { useBackendState } from "./useBackendState";
import { useLocalActivity } from "./useLocalActivity";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function desktop(invoke: Invoke, search = "") {
  window.history.replaceState(null, "", `/${search}`);
  window.__TAURI__ = { core: { invoke } };
}

afterEach(() => {
  cleanup();
  delete window.__TAURI__;
  window.history.replaceState(null, "", "/");
});

const push = (payload: unknown) =>
  window.dispatchEvent(new CustomEvent("igni-host", { detail: { type: "igni:backend-state", payload } }));

describe("useBackendState", () => {
  it("asks once, then follows every push", async () => {
    desktop(async (cmd) => (cmd === "backend_state" ? shellSnapshot({ state: "local" }) : null));
    const { result } = renderHook(() => useBackendState());
    await waitFor(() => expect(result.current?.state).toBe("local"));
    act(() => push(shellSnapshot({ side: "cloud", state: "waking" })));
    expect(result.current?.state).toBe("waking");
    act(() => push("garbage"));
    expect(result.current?.state).toBe("waking");
  });

  it("is null outside the desktop app", async () => {
    const { result } = renderHook(() => useBackendState());
    await act(async () => undefined);
    expect(result.current).toBeNull();
  });

  it("lets a push that arrives first win over the slower first answer", async () => {
    let answer: (v: unknown) => void = () => {};
    desktop(() => new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useBackendState());
    act(() => push(shellSnapshot({ side: "cloud", state: "cloud_ready" })));
    await act(async () => answer(shellSnapshot({ state: "local" })));
    expect(result.current?.state).toBe("cloud_ready");
  });
});

describe("the account menu", () => {
  const status = { cloud_email: "ada@acme.example", cloud_org: "Acme" } as never;

  it("offers the switch under the composer when the shell allows it", () => {
    // The switch moved out of the menu into the composer dock.
    const backend = BackendSnapshot.parse(shellSnapshot())!;
    render(<ComposerDock backend={backend} projectDir="/work" onPickProject={() => {}} sessionId="s1" status={null} />);
    fireEvent.click(screen.getByTitle("Where igni runs"));
    expect(screen.getByRole("radiogroup", { name: "Where igni runs" })).toBeTruthy();
  });

  it("asks this computer's backend for the name while on the cloud", async () => {
    const invoke = vi.fn<Invoke>(async () => ({ full_name: "Ada Lovelace" }));
    desktop(invoke, "?side=cloud&backend=cloud-0123456789ab");
    const rpc = vi.fn(async () => ({ full_name: "the VM's answer" }));
    render(<AccountMenu status={status} client={{ rpc: rpc as never }} onLogIn={() => {}} onLogOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /ada@acme\.example/ }));
    await waitFor(() => expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0));
    expect(invoke).toHaveBeenCalledWith("account_rpc", { method: "get_cloud_plan", args: {} });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks the window's own backend on this computer", async () => {
    const rpc = vi.fn(async () => ({ full_name: "Ada L" }));
    render(<AccountMenu status={status} client={{ rpc: rpc as never }} onLogIn={() => {}} onLogOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /ada@acme\.example/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_cloud_plan"));
  });
});

describe("the account chip right after a switch to the cloud", () => {
  // R691 G: the VM's igni names nobody (its status has no address), and
  // this computer's account-only backend answers a few seconds after the
  // switch. For those seconds the chip said "Log in" to a person who was
  // signed in all along. The chip is the account menu's, which sits at
  // the foot of the sidebar; rendering it directly is what these go by.
  function header(status: unknown, auth: "unknown" | "signed-in" | "signed-out") {
    return (
      <AccountMenu
        status={status as never}
        auth={auth}
        client={{ rpc: vi.fn(async () => ({})) } as never}
        onLogIn={() => {}}
        onLogOut={() => {}}
      />
    );
  }

  it("is neutral until this computer says who is signed in, then names them", async () => {
    let answer: (v: unknown) => void = () => {};
    const vm = { rpc: vi.fn(async (m: string) => (m === "get_status" ? { cloud_email: "", context_tokens: 0 } : null)) };
    const source = new StatusSource(vm as never, () => new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useShellStatus(source, { write: vi.fn() } as never));
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshStatus();
    });
    await waitFor(() => expect(result.current.status).not.toBeNull());

    const { rerender } = render(header(result.current.status, result.current.auth));
    expect(result.current.auth).toBe("unknown");
    expect(screen.queryByText("Log in")).toBeNull();
    expect(screen.getByRole("button", { name: "Account" }).getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      answer({ cloud_email: "ada@acme.example", cloud_connected: true });
      await refresh;
    });
    rerender(header(result.current.status, result.current.auth));
    expect(screen.getByRole("button", { name: /ada@acme\.example/ })).toBeTruthy();
    expect(screen.queryByText("Log in")).toBeNull();
  });

  it("stays neutral, not Log in, while this computer cannot be asked yet", async () => {
    const vm = { rpc: vi.fn(async (m: string) => (m === "get_status" ? { cloud_email: "" } : null)) };
    const source = new StatusSource(vm as never, () => Promise.reject(new Error("account backend starting")));
    const { result } = renderHook(() => useShellStatus(source, { write: vi.fn() } as never));
    await act(() => result.current.refreshStatus());
    render(header(result.current.status, result.current.auth));
    expect(screen.queryByText("Log in")).toBeNull();
    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
  });

  it("still offers Log in once this computer says nobody is signed in", async () => {
    const vm = { rpc: vi.fn(async (m: string) => (m === "get_status" ? { cloud_email: "" } : null)) };
    const source = new StatusSource(vm as never, async () => ({ cloud_email: "", cloud_connected: false }));
    const { result } = renderHook(() => useShellStatus(source, { write: vi.fn() } as never));
    await act(() => result.current.refreshStatus());
    render(header(result.current.status, result.current.auth));
    expect(screen.getByText("Log in")).toBeTruthy();
  });

  it("goes by the status alone where the window's own backend names the account", () => {
    render(header({ cloud_email: "" }, "signed-out"));
    expect(screen.getByText("Log in")).toBeTruthy();
  });
});

function shellActions(overrides: Partial<ShellActionsDeps> = {}) {
  const run = vi.fn(async () => undefined);
  const pick = vi.fn(async () => ({ kind: "cancelled" as const }));
  const error = vi.fn();
  const deps = {
    client: {} as never,
    windowModel: { get: () => "", openPanel: vi.fn() } as never,
    view: { info: vi.fn(), error } as never,
    controller: { commands: { run }, sessions: { attachFolder: vi.fn(), pick: vi.fn() }, submitter: {}, streamer: {} } as never,
    folderPicker: { pick } as never,
    navigator: {} as never,
    seeder: {} as never,
    refreshStatus: async () => undefined,
    ...overrides,
  } satisfies ShellActionsDeps;
  return { actions: new ShellActions(deps), run, pick, error };
}

describe("Log out and the folder picker", () => {
  it("signs the desktop out through this computer's backend on the cloud", async () => {
    const invoke = vi.fn<Invoke>(async () => null);
    desktop(invoke, "?side=cloud");
    const { actions, run } = shellActions();
    actions.logOut();
    expect(invoke).toHaveBeenCalledWith("account_rpc", { method: "clear_cloud_credentials", args: {} });
    expect(run).not.toHaveBeenCalled();
  });

  it("says when that failed", async () => {
    desktop(async () => {
      throw new Error("this computer's backend is still starting");
    }, "?side=cloud");
    const { actions, error } = shellActions();
    actions.logOut();
    await waitFor(() => expect(error).toHaveBeenCalledWith("Log out failed: this computer's backend is still starting"));
  });

  it("runs /logout on this computer", () => {
    const { actions, run } = shellActions();
    actions.logOut();
    expect(run).toHaveBeenCalledWith("/logout", false);
  });

  it("opens no folder dialog on the cloud", async () => {
    desktop(async () => null, "?side=cloud");
    const { actions, pick } = shellActions();
    await actions.pickProject();
    expect(pick).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/?side=local");
    await actions.pickProject();
    expect(pick).toHaveBeenCalledTimes(1);
  });
});

describe("the header's chips on the cloud", () => {
  it("shows the VM's workspace read-only", () => {
    const onPick = vi.fn();
    render(<ProjectChip projectDir="/workspace" onPick={onPick} readOnly />);
    const chip = screen.getByRole("button");
    expect(chip.getAttribute("title")).toBe("Your cloud igni's workspace: /workspace");
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(chip);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("labels the version chip cloud", () => {
    window.history.replaceState(null, "", "/?expected_cli=1.0.5&actual_cli=cloud&backend_source=cloud&side=cloud");
    render(<BackendVersionChip />);
    expect(screen.getByText("cloud").getAttribute("title")).toBe("igni in your cloud");
  });
});

describe("useLocalActivity", () => {
  it("reports this window's run and approvals on this computer", () => {
    const invoke = vi.fn<Invoke>(async () => null);
    desktop(invoke, "?side=local");
    const { rerender } = renderHook(({ p, a }) => useLocalActivity("s1", p, a), { initialProps: { p: true, a: 0 } });
    rerender({ p: false, a: 1 });
    expect(invoke.mock.calls).toEqual([
      ["report_local_activity", { report: { session_id: "s1", runs: 1, approvals: 0 } }],
      ["report_local_activity", { report: { session_id: "s1", runs: 0, approvals: 1 } }],
    ]);
  });

  it("reports nothing from the cloud or outside the desktop app", () => {
    const invoke = vi.fn<Invoke>(async () => null);
    desktop(invoke, "?side=cloud");
    renderHook(() => useLocalActivity("s1", true, 2));
    expect(invoke).not.toHaveBeenCalled();
  });
});
