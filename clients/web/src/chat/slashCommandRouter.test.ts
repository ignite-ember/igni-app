import { describe, expect, it, vi } from "vitest";

import type { CommandAction, ServerMessage } from "../protocol/messages";
import { IssuedCommand, PAGE_FOR_ACTION, SlashCommandRouter } from "./slashCommandRouter";
import { ArrayTranscript } from "./transcriptView.test.util";

function result(action: CommandAction, content = "", display_content = ""): ServerMessage {
  return { type: "command_result", kind: "markdown", action, content, display_content } as ServerMessage;
}

function setup(answer: ServerMessage) {
  const t = new ArrayTranscript();
  const deps = {
    client: { handleCommand: vi.fn(async () => answer) },
    view: t.view,
    run: { bumpViewGen: vi.fn() },
    streamer: { send: vi.fn(async () => {}), sendLoopIteration: vi.fn(async () => {}) },
    sessions: { followRenewed: vi.fn(async () => {}), followFork: vi.fn(async () => {}) },
    workflows: { start: vi.fn(async () => ({ name: "build", workflowRunId: "wf1" })) },
    windowModel: {
      get: vi.fn(() => ({ open: false, width: null, section: null })),
      write: vi.fn(),
      openPanel: vi.fn(),
    },
    shell: {
      goPage: vi.fn(),
      openModelMenu: vi.fn(),
      refreshStatus: vi.fn(async () => {}),
      refreshSessions: vi.fn(async () => {}),
    },
    onEvent: vi.fn(),
  };
  return { t, deps, router: new SlashCommandRouter(deps as never) };
}

describe("IssuedCommand", () => {
  it("knows the commands that clear the view", () => {
    expect(new IssuedCommand(" /clear", true, 3).clearsTheView).toBe(true);
    expect(new IssuedCommand("/fork now", true, 3).clearsTheView).toBe(true);
    expect(new IssuedCommand("/clearer", true, 3).clearsTheView).toBe(false);
  });
});

describe("SlashCommandRouter", () => {
  it("opens the page an action names, echoing its text only when typed", async () => {
    const s = setup(result("loop", "Loop started"));
    await s.router.run("/loop", false);
    expect(s.deps.shell.goPage).toHaveBeenCalledWith(PAGE_FOR_ACTION.loop!.route);
    expect(s.t.items).toEqual([]);
    await s.router.run("/loop");
    expect(s.t.kinds()).toEqual(["user", "assistant"]);
  });

  it("intercepts /workflows before the backend sees it", async () => {
    const s = setup(result("none"));
    await s.router.run("/workflows");
    expect(s.deps.shell.goPage).toHaveBeenCalledWith({ kind: "workflows", label: "Workflows" });
    await s.router.run("/workflows build");
    expect(s.deps.workflows.start).toHaveBeenCalledWith("build", {});
    await s.router.run("/workflows build {nope}");
    expect(s.t.items.at(-1)).toMatchObject({ kind: "error" });
    expect(s.deps.client.handleCommand).not.toHaveBeenCalled();
  });

  it("/clear keeps what was added in flight and follows the renewed session", async () => {
    const s = setup(result("clear"));
    s.t.view.append(s.t.chatItems.info("before"));
    await s.router.run("/clear");
    expect(s.deps.run.bumpViewGen).toHaveBeenCalledTimes(1);
    expect(s.t.items).toEqual([]);
    expect(s.deps.sessions.followRenewed).toHaveBeenCalled();
  });

  it("bumps the generation when a command that did not say clear clears", async () => {
    const s = setup(result("clear"));
    await s.router.run("/reset-skill");
    expect(s.deps.run.bumpViewGen).toHaveBeenCalledTimes(1);
  });

  it("/fork without a session id says it failed", async () => {
    const s = setup(result("fork", " "));
    await s.router.run("/fork");
    expect(s.t.items.at(-1)).toMatchObject({ kind: "error" });
    expect(s.deps.sessions.followFork).not.toHaveBeenCalled();
  });

  it("/fork follows the new session", async () => {
    const s = setup(result("fork", "s2"));
    await s.router.run("/fork");
    expect(s.deps.sessions.followFork).toHaveBeenCalledWith("s2");
    expect(s.t.items.at(-1)).toMatchObject({ kind: "info" });
  });

  it("runs a skill's prompt, and a loop's first iteration as one", async () => {
    const s = setup(result("run_prompt", "do it"));
    await s.router.run("/skill", false);
    expect(s.deps.streamer.send).toHaveBeenCalledWith("do it");
    const loop = setup(result("run_prompt", "<loop-iteration n=1>x</loop-iteration>"));
    await loop.router.run("/loop x", false);
    expect(loop.deps.streamer.sendLoopIteration).toHaveBeenCalled();
  });

  it("acts on the actions that are not pages", async () => {
    const s = setup(result("sessions"));
    await s.router.run("/sessions", false);
    expect(s.deps.windowModel.write).toHaveBeenCalledWith("sidebar", expect.objectContaining({ open: true }));
    for (const [action, check] of [
      ["model", () => expect(s.deps.shell.openModelMenu).toHaveBeenCalled()],
      ["login", () => expect(s.deps.windowModel.openPanel).toHaveBeenCalledWith("login")],
    ] as const) {
      s.deps.client.handleCommand.mockResolvedValueOnce(result(action));
      await s.router.run(`/${action}`, false);
      check();
    }
    s.deps.client.handleCommand.mockResolvedValueOnce(result("model_switched", "Now on x"));
    await s.router.run("/model x", false);
    s.deps.client.handleCommand.mockResolvedValueOnce(result("compact", "Compacted", "summary"));
    await s.router.run("/compact", false);
    s.deps.client.handleCommand.mockResolvedValueOnce(result("quit"));
    await s.router.run("/quit", false);
    expect(s.t.kinds()).toEqual(["info", "compact", "info"]);
  });

  it("hands anything else with text to the stream handler", async () => {
    const s = setup(result("none", "**hi**"));
    await s.router.run("/whatever", false);
    expect(s.deps.onEvent).toHaveBeenCalled();
    const other = setup({ type: "info", text: "x" } as ServerMessage);
    await other.router.run("/x", false);
    expect(other.deps.onEvent).toHaveBeenCalledWith({ type: "info", text: "x" });
  });

  it("shows a command that failed", async () => {
    const s = setup(result("none"));
    s.deps.client.handleCommand.mockRejectedValueOnce(new Error("down"));
    await s.router.run("/x", false);
    expect(s.t.items.at(-1)).toMatchObject({ kind: "error" });
  });
});
