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
    const toggle = await screen.findByRole("button", { name: "sleep 600" });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.contains(screen.getByRole("button", { name: /kill/i }))).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(await screen.findByText("hello")).toBeTruthy();
    // The process's own page: its command as the heading, Kill still offered.
    expect(screen.getByRole("heading", { name: "sleep 600" })).toBeTruthy();
    expect(screen.getByText(/PID 9 · running/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /kill/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Running/ })).toBeNull();
  });

  it("kills from a process's own page", async () => {
    const client = fakeClient((m) => {
      if (m === "list_background_processes") return [running];
      if (m === "read_process_tail") return { output: "", is_running: true, exit_code: null };
      return null;
    });
    render(<WatcherPanel client={client} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "sleep 600" }));
    await screen.findByRole("heading", { name: "sleep 600" });
    fireEvent.click(screen.getByRole("button", { name: /kill/i }));
    await waitFor(() =>
      expect((client as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("stop_background_process", {
        pid: 9,
      }),
    );
  });

  it("counts running and stopped processes on tabs, and filters by them", async () => {
    const client = fakeClient(() => [
      running,
      { pid: 10, cmd: "make", elapsed_seconds: 1, is_running: false, exit_code: 2 },
    ]);
    render(<WatcherPanel client={client} onClose={() => {}} />);
    await screen.findByRole("button", { name: "make" });
    expect(screen.getByRole("button", { name: /^All/ }).textContent).toBe("All2");
    expect(screen.getByRole("button", { name: /^Running/ }).textContent).toBe("Running1");
    expect(screen.getByRole("button", { name: /^Stopped/ }).textContent).toBe("Stopped1");
    fireEvent.click(screen.getByRole("button", { name: /^Running/ }));
    expect(screen.queryByRole("button", { name: "make" })).toBeNull();
    expect(screen.getByRole("button", { name: "sleep 600" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Stopped/ }));
    expect(screen.queryByRole("button", { name: "sleep 600" })).toBeNull();
    expect(screen.getByText("exit 2")).toBeTruthy();
  });

  it("says when a tab has nothing in it", async () => {
    const client = fakeClient(() => [running]);
    render(<WatcherPanel client={client} onClose={() => {}} />);
    await screen.findByRole("button", { name: "sleep 600" });
    fireEvent.click(screen.getByRole("button", { name: /^Stopped/ }));
    expect(screen.getByText("Nothing has stopped yet")).toBeTruthy();
  });

  it("says how processes get here when there are none, without tabs", async () => {
    const client = fakeClient(() => []);
    render(<WatcherPanel client={client} onClose={() => {}} />);
    expect(await screen.findByText("Nothing has run here yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Running/ })).toBeNull();
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
