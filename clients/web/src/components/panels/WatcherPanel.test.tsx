// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WatcherIndicator } from "../WatcherIndicator";
import { WatcherPanel } from "./WatcherPanel";

afterEach(cleanup);

function fakeClient(rpc: (method: string) => unknown) {
  return { rpc: vi.fn(async (method: string) => rpc(method)), onEvent: () => () => {} } as never;
}

const running = { pid: 9, cmd: "sleep 600", elapsed_seconds: 1, is_running: true, exit_code: null };

describe("the watcher panel", () => {
  it("says when a kill fails", async () => {
    const client = fakeClient((m) => {
      if (m === "list_background_processes") return [running];
      throw new Error("no such process");
    });
    render(<WatcherPanel client={client} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /kill/i }));
    expect(await screen.findByText(/Could not stop PID 9: no such process/)).toBeTruthy();
  });

  it("says when the list cannot be read", async () => {
    const client = fakeClient(() => {
      throw new Error("offline");
    });
    render(<WatcherPanel client={client} onClose={() => {}} />);
    expect(await screen.findByText(/Could not list the background processes: offline/)).toBeTruthy();
  });

  it("opens a row's log from its toggle button, with Kill beside it rather than inside", async () => {
    const client = fakeClient((m) => {
      if (m === "list_background_processes") return [running];
      return { output: "hello", is_running: true, exit_code: null };
    });
    render(<WatcherPanel client={client} onClose={() => {}} />);
    const toggle = await screen.findByRole("button", { name: "PID 9: sleep 600" });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.contains(screen.getByRole("button", { name: /kill/i }))).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(await screen.findByText("hello")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("the watcher pill", () => {
  it("counts only the processes that are running", async () => {
    const client = fakeClient(() => [
      running,
      { pid: 10, cmd: "make", elapsed_seconds: 1, is_running: false, exit_code: 0 },
    ]);
    render(<WatcherIndicator client={client} onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText("1 running")).toBeTruthy());
  });
});
