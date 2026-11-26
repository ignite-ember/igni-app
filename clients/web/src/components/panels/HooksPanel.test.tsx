// @vitest-environment jsdom
/**
 * The hooks page: which lifecycle events run what, read-only.
 *
 * Pinned: the backend's duplicates (the same hook from a project file
 * and a plugin) show once, events come in lifecycle order with unknown
 * ones after, and a failed call says why. A hook's row opens the hook's
 * own page: its facts, and its script read from the project — or the
 * command itself when there is no file to read — and back lands on the
 * list where it was left.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PageContext } from "../PageShell";
import { HooksPanel } from "./HooksPanel";
import { host } from "../../lib/host";
import { formatTimeout, scriptPath, sourceOf, type HookEntry } from "./hooks/hooksView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function hook(over: Partial<HookEntry> = {}): HookEntry {
  return {
    event: "PreToolUse",
    type: "command",
    command: ".igni/hooks/guard.sh",
    url: "",
    matcher: "",
    timeout_ms: 10000,
    background: false,
    ...over,
  };
}

const SCRIPT = "#!/bin/sh\n# refuse live payment keys\ngrep -q sk_live && exit 2\n";

function panelWith(
  answer: unknown,
  { files = {}, asPage = false }: { files?: Record<string, unknown>; asPage?: boolean } = {},
) {
  const rpc = vi.fn(async (method: string, params?: { path?: string }) => {
    if (method === "read_file") {
      const f = files[params?.path ?? ""];
      if (f instanceof Error) throw f;
      return f ?? { path: params?.path, contents: "", size: 0, error: "not found" };
    }
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const panel = <HooksPanel client={{ rpc } as never} onClose={() => {}} />;
  const trail = [{ kind: "hooks", label: "Hooks" } as never];
  render(
    asPage ? (
      <PageContext.Provider value={{ trail, onCrumb: () => {}, onBack: () => {}, onClose: () => {} }}>
        {panel}
      </PageContext.Provider>
    ) : (
      panel
    ),
  );
  return rpc;
}

const facts = () =>
  Object.fromEntries(
    [...document.querySelectorAll(".detail-fact")].map((f) => [
      f.querySelector("dt")!.textContent,
      f.querySelector("dd")!.textContent,
    ]),
  );

describe("the hooks page", () => {
  it("says how to add one when there are none", async () => {
    panelWith([]);
    expect(await screen.findByText("No hooks configured")).toBeTruthy();
    expect(screen.getByText("0 hooks")).toBeTruthy();
  });

  it("treats a null or non-list answer as no hooks", async () => {
    panelWith(null);
    expect(await screen.findByText("No hooks configured")).toBeTruthy();
    cleanup();
    panelWith({ unexpected: true });
    expect(await screen.findByText("No hooks configured")).toBeTruthy();
  });

  it("says why when the backend call fails", async () => {
    panelWith(new Error("get_hooks_details not found"));
    expect(await screen.findByText("get_hooks_details not found")).toBeTruthy();
    expect(screen.getByText("No hooks configured")).toBeTruthy();
  });

  it("shows a hook defined twice only once", async () => {
    panelWith([hook(), hook(), hook({ matcher: "Bash" })]);
    expect(await screen.findByText("2 hooks")).toBeTruthy();
    expect(screen.getAllByText(".igni/hooks/guard.sh")).toHaveLength(2);
  });

  it("orders events by lifecycle, then unknown ones alphabetically", async () => {
    panelWith([
      hook({ event: "ZetaEvent", command: "z.sh" }),
      hook({ event: "Stop", command: "stop.sh" }),
      hook({ event: "AlphaEvent", command: "a.sh" }),
      hook({ event: "SessionStart", command: "start.sh" }),
      hook({ event: "Stop", command: "stop2.sh" }),
    ]);
    await screen.findByText("5 hooks");
    const events = [...document.querySelectorAll(".hooks-group .entity-card-name")].map((e) => e.textContent);
    expect(events).toEqual(["SessionStart", "Stop", "AlphaEvent", "ZetaEvent"]);
    // Two hooks on one event share its card.
    expect(document.querySelectorAll(".hooks-group")[1].querySelectorAll(".hooks-row")).toHaveLength(2);
    // Known events explain themselves; unknown ones carry no blurb.
    expect(screen.getByText(/Runs when a session boots/)).toBeTruthy();
    expect(document.querySelectorAll(".hooks-event-blurb")).toHaveLength(2);
  });

  it("tags the matcher, background, a non-default timeout and a source other than the project", async () => {
    panelWith([
      hook({ event: "PostToolUse", matcher: "Edit|Write", background: true, timeout_ms: 30000 }),
      hook({ event: "Stop", command: "/Users/me/.igni/plugins/acme/hooks/stop.sh" }),
    ]);
    expect(await screen.findByText("2 hooks")).toBeTruthy();
    expect(screen.getByText("matches: Edit|Write")).toBeTruthy();
    expect(screen.getByText("background")).toBeTruthy();
    expect(screen.getByText("30s timeout")).toBeTruthy();
    expect(screen.getByText("plugin")).toBeTruthy();
    expect(screen.queryByText("project")).toBeNull();
  });
});

describe("a hook's page", () => {
  it("opens from its row — the row no longer opens the file", async () => {
    const openFile = vi.spyOn(host, "openFile").mockResolvedValue(true);
    panelWith([hook({ matcher: "Bash" })], { files: { ".igni/hooks/guard.sh": { contents: SCRIPT, size: 60 } } });
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    expect(openFile).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "PreToolUse" })).toBeTruthy();
    expect(document.querySelector(".hooks-group")).toBeNull();
    expect(screen.queryByText("1 hook")).toBeNull();
  });

  it("puts the event, matcher, source and type in the hero", async () => {
    panelWith([hook({ matcher: "Bash", background: true })]);
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    const hero = document.querySelector(".entity-hero") as HTMLElement;
    expect(hero.textContent).toContain("matches Bash");
    expect(hero.textContent).toContain("Runs before a tool call");
    expect([...hero.querySelectorAll(".hero-chip")].map((c) => c.textContent)).toEqual([
      "project",
      "command",
      "background",
    ]);
  });

  it("lists the hook's facts", async () => {
    panelWith([hook({ matcher: "Bash", timeout_ms: 15000, background: true })]);
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    expect(facts()).toEqual({
      Event: "PreToolUse",
      Matcher: "Bash",
      Type: "command",
      Timeout: "15s",
      Runs: "in the background",
      Source: "project",
      Script: ".igni/hooks/guard.sh",
    });
  });

  it("says a hook with no matcher applies to every target and makes the agent wait", async () => {
    panelWith([hook({ event: "Stop", timeout_ms: 0 })]);
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    expect(facts()).toMatchObject({ Matcher: "every target", Timeout: "—", Runs: "while the agent waits" });
    expect(document.querySelector(".entity-hero")!.textContent).toContain("every target");
  });

  it("names a hook's type when the backend leaves it out", async () => {
    panelWith([hook({ type: "" })]);
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    expect(facts().Type).toBe("command");
  });

  it("reads the script from the project and shows it whole, with Copy", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const rpc = panelWith([hook({ command: ".igni/hooks/guard.sh --strict" })], {
      files: { ".igni/hooks/guard.sh": { path: "/abs/.igni/hooks/guard.sh", contents: SCRIPT, size: 60 } },
    });
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    expect(rpc).toHaveBeenCalledWith("read_file", { path: ".igni/hooks/guard.sh" });
    const section = screen.getByRole("region", { name: "Script" });
    await waitFor(() => expect(section.querySelector(".mono-block")!.textContent).toBe(SCRIPT));
    fireEvent.click(screen.getByRole("button", { name: "Copy the script" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SCRIPT));
  });

  it("shows the command when the script cannot be read, and says why", async () => {
    panelWith([hook()], { files: { ".igni/hooks/guard.sh": new Error("outside the sandbox.") } });
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    expect(await screen.findByText(/Could not read the file \(outside the sandbox\)/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Script" }).querySelector(".mono-block")!.textContent).toBe(
      ".igni/hooks/guard.sh",
    );
    expect(screen.queryByRole("button", { name: "Copy the script" })).toBeNull();
  });

  it("shows the command for an empty script file", async () => {
    panelWith([hook()], { files: { ".igni/hooks/guard.sh": { contents: "", size: 0 } } });
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    expect(await screen.findByText("The command it runs:")).toBeTruthy();
  });

  it("says it is reading while the script loads", async () => {
    const rpc = vi.fn((method: string) => (method === "read_file" ? new Promise(() => {}) : Promise.resolve([hook()])));
    render(<HooksPanel client={{ rpc } as never} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    expect(screen.getByText("Reading .igni/hooks/guard.sh…")).toBeTruthy();
  });

  it("shows an inline command as the command, without reading any file", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const rpc = panelWith([hook({ command: "echo started >> log" })]);
    fireEvent.click(await screen.findByRole("button", { name: /echo started/ }));
    expect(rpc).not.toHaveBeenCalledWith("read_file", expect.anything());
    expect(facts().Command).toBe("echo started >> log");
    expect(screen.getByRole("region", { name: "Command" }).querySelector(".mono-block")!.textContent).toBe(
      "echo started >> log",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy the command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("echo started >> log"));
    // Nothing to open in an editor.
    expect(screen.queryByRole("button", { name: /Open in editor|Preview file/ })).toBeNull();
  });

  it("shows a webhook's URL and header names, never as a file", async () => {
    const rpc = panelWith([
      hook({ type: "http", command: "", url: "https://hooks.acme.test/igni", header_names: ["Authorization", "X-Team"] }),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /hooks\.acme\.test/ }));
    expect(rpc).not.toHaveBeenCalledWith("read_file", expect.anything());
    expect(facts()).toMatchObject({ URL: "https://hooks.acme.test/igni", Headers: "Authorization, X-Team" });
    expect(screen.getByRole("region", { name: "URL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the URL" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open in editor|Preview file/ })).toBeNull();
  });

  it("still opens a hook with nothing to run, named as such", async () => {
    panelWith([
      hook({ type: "webhook", command: "", url: "", event: "Stop" }),
      hook({ command: "", event: "Notification" }),
    ]);
    expect(await screen.findByText("(no url)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /\(no command\)/ }));
    expect(screen.getByRole("heading", { name: "Notification" })).toBeTruthy();
    expect(facts().Command).toBe("(no command)");
  });

  it("opens the script in the editor from its page", async () => {
    const openFile = vi.spyOn(host, "openFile").mockResolvedValue(true);
    panelWith([hook()]);
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open in editor|Preview file/ }));
    expect(openFile).toHaveBeenCalledWith(".igni/hooks/guard.sh");
  });

  it("offers no editor on the desktop's cloud side, where the script is on the VM", async () => {
    vi.spyOn(host, "onCloud", "get").mockReturnValue(true);
    panelWith([hook()]);
    fireEvent.click(await screen.findByRole("button", { name: /guard\.sh/ }));
    expect(screen.queryByRole("button", { name: /Open in editor|Preview file/ })).toBeNull();
  });

  it("goes back to the list where it was left", async () => {
    panelWith([hook(), hook({ event: "Stop", command: "stop.sh", matcher: "x" })], { asPage: true });
    await screen.findByText("2 hooks");
    const scroller = document.querySelector(".page-body") as HTMLElement;
    scroller.scrollTop = 180;
    fireEvent.click(screen.getByRole("button", { name: /stop\.sh/ }));
    expect(scroller.scrollTop).toBe(0);
    // The trail names the hook by its event and matcher.
    expect(screen.getByText("Stop · x")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hooks" }));
    expect(screen.queryByRole("heading", { name: "Stop" })).toBeNull();
    expect(screen.getByText("2 hooks")).toBeTruthy();
    expect(scroller.scrollTop).toBe(180);
  });
});

describe("where a hook comes from", () => {
  it.each([
    [".igni/hooks/guard.sh", "project"],
    ["./scripts/check.py --fast", "project"],
    ["/Users/me/.igni/hooks/a.sh", "user"],
    ["~/.igni/hooks/a.sh", "user"],
    ["/home/me/bin/hook", "user"],
    ["/Users/me/.igni/plugins/acme/hooks/stop.sh", "plugin"],
    ["/opt/venv/lib/python3.12/site-packages/igni_core/hooks/default.sh", "default"],
    ["echo hi", "project"],
  ])("%s → %s", (command, source) => {
    expect(sourceOf(hook({ command }))).toBe(source);
  });

  it("finds the script file a command runs, or none", () => {
    expect(scriptPath(hook({ command: ".igni/hooks/a.sh --x" }))).toBe(".igni/hooks/a.sh");
    expect(scriptPath(hook({ command: '"/opt/hooks/a.sh" --x' }))).toBe("/opt/hooks/a.sh");
    expect(scriptPath(hook({ command: "check.py" }))).toBe("check.py");
    expect(scriptPath(hook({ command: "echo hi" }))).toBeNull();
    expect(scriptPath(hook({ command: "" }))).toBeNull();
    expect(scriptPath(hook({ type: "http", url: "https://x.test" }))).toBeNull();
  });

  it("formats a timeout", () => {
    expect(formatTimeout(5000)).toBe("5s");
    expect(formatTimeout(1500)).toBe("1.5s");
    expect(formatTimeout(0)).toBe("—");
  });
});
