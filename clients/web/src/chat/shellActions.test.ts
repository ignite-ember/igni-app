import { describe, expect, it, vi } from "vitest";

import type { FolderPick } from "./projectFolderPicker";
import { ShellActions } from "./shellActions";

function setup(pick: FolderPick = { kind: "cancelled" }) {
  const deps = {
    client: {} as never,
    windowModel: { get: vi.fn(() => "/current"), openPanel: vi.fn() },
    view: { info: vi.fn(), error: vi.fn() },
    controller: {
      commands: { run: vi.fn(async () => {}) },
      sessions: { attachFolder: vi.fn(async () => {}), pick: vi.fn(async () => {}) },
      submitter: { submit: vi.fn(async () => {}) },
      streamer: { sendLoopIteration: vi.fn(async () => {}) },
    },
    folderPicker: { pick: vi.fn(async () => pick) },
    navigator: { closePages: vi.fn() },
    seeder: { seed: vi.fn() },
    refreshStatus: vi.fn(async () => {}),
  };
  return { deps, actions: new ShellActions(deps as never) };
}

describe("ShellActions.pickProject", () => {
  it("attaches the folder the dialog picked, starting from the current one", async () => {
    const { deps, actions } = setup({ kind: "picked", path: "/new" });
    await actions.pickProject();
    expect(deps.folderPicker.pick).toHaveBeenCalledWith("/current");
    expect(deps.controller.sessions.attachFolder).toHaveBeenCalledWith("/new");
  });

  it("opens the in-app picker when no dialog could", async () => {
    const { deps, actions } = setup({ kind: "in-app" });
    await actions.pickProject();
    expect(deps.windowModel.openPanel).toHaveBeenCalledWith("dir-picker");
    expect(deps.controller.sessions.attachFolder).not.toHaveBeenCalled();
  });

  it("does nothing when the person cancelled", async () => {
    const { deps, actions } = setup({ kind: "cancelled" });
    await actions.pickProject();
    expect(deps.windowModel.openPanel).not.toHaveBeenCalled();
    expect(deps.controller.sessions.attachFolder).not.toHaveBeenCalled();
  });
});

describe("ShellActions", () => {
  it("runs commands without a chat line of their own", () => {
    const { deps, actions } = setup();
    actions.newChat();
    actions.logOut();
    actions.runCommand("/tools");
    expect(deps.controller.commands.run.mock.calls).toEqual([
      ["/clear", false],
      ["/logout", false],
      ["/tools", false],
    ]);
  });

  it("says who signed in, and refreshes the status after either answer", () => {
    const { deps, actions } = setup();
    actions.signedIn("a@b");
    actions.loginFailed("denied");
    expect(deps.view.info).toHaveBeenCalledWith("Logged in as a@b");
    expect(deps.view.error).toHaveBeenCalledWith("Login failed: denied");
    expect(deps.refreshStatus).toHaveBeenCalledTimes(2);
  });

  it("only reports a failed login behind the wall", () => {
    const { deps, actions } = setup();
    actions.wallLoginFailed("denied");
    expect(deps.view.error).toHaveBeenCalledWith("Login failed: denied");
    expect(deps.refreshStatus).not.toHaveBeenCalled();
  });

  it("gives pages services that go back to the chat first", () => {
    const { deps, actions } = setup();
    const services = actions.pageServices({
      extensions: [],
      setExtensions: vi.fn(),
      skills: [],
      maxContext: 1000,
    });
    services.seed("/skill");
    expect(deps.navigator.closePages).toHaveBeenCalledTimes(1);
    expect(deps.seeder.seed).toHaveBeenCalledWith("/skill");
    services.compact();
    expect(deps.controller.commands.run).toHaveBeenCalledWith("/compact", false);
    services.resumeLoop("again");
    expect(deps.controller.streamer.sendLoopIteration).toHaveBeenCalledWith("again");
    expect(deps.navigator.closePages).toHaveBeenCalledTimes(3);
    expect(services.close).toBe(deps.navigator.closePages);
    expect(services.maxContext).toBe(1000);
  });
});
