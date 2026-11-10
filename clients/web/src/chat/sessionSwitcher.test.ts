// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionEntry } from "../components/Sidebar";
import type { HistoryLoad } from "./historyLoader";
import { SessionSwitcher } from "./sessionSwitcher";
import { ArrayTranscript } from "./transcriptView.test.util";

type Rpc = (method: string, args?: Record<string, unknown>) => Promise<unknown>;

/** A window model over a plain record, recording every write. */
function fakeWindowModel(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    session: "",
    project_dir: "",
    sidebar: { open: true, width: null, section: null },
    composer: { text: "", mode: "chat", attachments: [] },
    ...initial,
  };
  const writes: { field: string; value: unknown; options?: unknown }[] = [];
  return {
    state,
    writes,
    get: vi.fn((field: string) => state[field]),
    write: vi.fn((field: string, value: unknown, options?: unknown) => {
      writes.push({ field, value, options });
      state[field] = value;
    }),
    hydrate: vi.fn(async () => {}),
    unset: vi.fn((): string[] => []),
    closePanel: vi.fn(),
  };
}

function setup(opts: { rpc?: Rpc; model?: Record<string, unknown>; history?: HistoryLoad } = {}) {
  const t = new ArrayTranscript();
  const client = { sessionId: "", rpc: vi.fn<Rpc>(opts.rpc ?? (async () => undefined)) };
  const windowModel = fakeWindowModel(opts.model);
  const history = opts.history ?? { items: [], historyMap: [] };
  const historyLoader = { load: vi.fn(async () => history) };
  let sessions: SessionEntry[] = [{ session_id: "old", name: "Old chat" }];
  const shell = {
    setSessions: vi.fn((next: SessionEntry[] | ((prev: SessionEntry[]) => SessionEntry[])) => {
      sessions = typeof next === "function" ? next(sessions) : next;
    }),
    refreshStatus: vi.fn(async () => {}),
    refreshSessions: vi.fn(async () => {}),
  };
  const switcher = new SessionSwitcher({
    client: client as never,
    windowModel: windowModel as never,
    view: t.view,
    historyLoader,
    shell,
  });
  return { t, client, windowModel, historyLoader, shell, switcher, sessions: () => sessions };
}

afterEach(() => vi.restoreAllMocks());

describe("SessionSwitcher#bindOnConnect", () => {
  it("attaches the folder a New Window was opened onto", async () => {
    const s = setup({
      rpc: async (method) =>
        method === "attach_session" ? { session_id: "s-dir", project_dir: "/work/repo" } : undefined,
    });
    await s.switcher.bindOnConnect({ wantedDir: "/work/repo", arrival: null });
    expect(s.client.rpc).toHaveBeenCalledWith("attach_session", { project_dir: "/work/repo" });
    expect(s.client.sessionId).toBe("s-dir");
    expect(s.windowModel.state.session).toBe("s-dir");
    expect(s.windowModel.state.project_dir).toBe("/work/repo");
  });

  it("resumes the session the window had stored", async () => {
    const s = setup({
      model: { session: "s-old" },
      rpc: async (method) => (method === "attach_session" ? { session_id: "s-old", project_dir: "/p" } : undefined),
    });
    await s.switcher.bindOnConnect({ wantedDir: "", arrival: null });
    expect(s.client.rpc).toHaveBeenCalledWith("attach_session", { session_id: "s-old" });
    expect(s.client.sessionId).toBe("s-old");
  });

  it("falls back to the backend's default session when the stored one cannot be attached", async () => {
    const s = setup({
      model: { session: "s-gone" },
      rpc: async (method) => {
        if (method === "attach_session") throw new Error("unknown session");
        return method === "get_session_id" ? "s-default" : undefined;
      },
    });
    await s.switcher.bindOnConnect({ wantedDir: "", arrival: null });
    expect(s.client.sessionId).toBe("s-default");
    expect(s.windowModel.state.session).toBe("s-default");
  });

  it("keeps a session it is already bound to across a reconnect", async () => {
    const s = setup();
    s.client.sessionId = "s-live";
    await s.switcher.bindOnConnect({ wantedDir: "/elsewhere", arrival: null });
    expect(s.client.rpc).not.toHaveBeenCalled();
    expect(s.windowModel.state.session).toBe("s-live");
  });

  it("opens the page a link asked for, and shows the session's history", async () => {
    const history = { items: [new ArrayTranscript().chatItems.info("from before")], historyMap: [0] };
    const s = setup({ history, rpc: async () => "s-default" });
    await s.switcher.bindOnConnect({
      wantedDir: "",
      arrival: { page: "ext:acme", params: { id: "7" } } as never,
    });
    expect(s.windowModel.state.route).toEqual([{ kind: "ext:acme", label: "ext:acme", params: { id: "7" } }]);
    expect(s.t.items).toEqual(history.items);
    expect(s.t.historyMap).toEqual([0]);
  });
});

describe("SessionSwitcher#pick", () => {
  it("binds the view and replaces the transcript with that session's history", async () => {
    const other = new ArrayTranscript().chatItems.user("earlier question");
    const s = setup({ history: { items: [other], historyMap: [0] } });
    s.t.items = [s.t.chatItems.user("current chat")];
    await s.switcher.pick("abcdef0123456789");
    expect(s.client.sessionId).toBe("abcdef0123456789");
    expect(s.windowModel.state.session).toBe("abcdef0123456789");
    expect(s.t.items).toMatchObject([
      { kind: "user", text: "earlier question" },
      { kind: "info", text: "Resumed session abcdef01." },
    ]);
    expect(s.shell.refreshStatus).toHaveBeenCalled();
  });

  it("closes the sidebar on a narrow window, and leaves it on a wide one", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(500);
    const narrow = setup();
    await narrow.switcher.pick("s2");
    expect((narrow.windowModel.state.sidebar as { open: boolean }).open).toBe(false);

    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1400);
    const wide = setup();
    await wide.switcher.pick("s2");
    expect((wide.windowModel.state.sidebar as { open: boolean }).open).toBe(true);
  });
});

describe("SessionSwitcher#attachFolder", () => {
  it("starts a fresh session locked to the folder", async () => {
    const s = setup({ rpc: async () => ({ session_id: "s-new", project_dir: "/work/new" }) });
    s.t.items = [s.t.chatItems.user("old chat")];
    await s.switcher.attachFolder("/work/new");
    expect(s.windowModel.closePanel).toHaveBeenCalled();
    expect(s.windowModel.state.session).toBe("s-new");
    expect(s.t.items).toMatchObject([{ kind: "info", text: "Session locked to /work/new" }]);
    expect(s.shell.refreshSessions).toHaveBeenCalled();
  });

  it("says why when the folder cannot be attached, keeping the chat", async () => {
    const s = setup({ rpc: async () => Promise.reject(new Error("not a directory")) });
    s.t.items = [s.t.chatItems.user("old chat")];
    await s.switcher.attachFolder("/nope");
    expect(s.t.kinds()).toEqual(["user", "error"]);
    expect(s.windowModel.state.session).toBe("");
  });
});

describe("SessionSwitcher rotations", () => {
  it("/clear follows the renewed id, carries the draft and lists the new chat first", async () => {
    const draft = { text: "half-typed @src", mode: "chat", attachments: [] };
    const s = setup({ model: { composer: draft }, rpc: async () => "s-renewed" });
    s.client.sessionId = "s-old";
    await s.switcher.followRenewed();
    expect(s.client.sessionId).toBe("s-renewed");
    const composerWrite = s.windowModel.writes.find((w) => w.field === "composer");
    expect(composerWrite).toMatchObject({ value: draft, options: { force: true } });
    expect(s.sessions()[0]).toEqual({ session_id: "s-renewed", name: "New chat" });
  });

  it("/clear stays put when the backend names no session", async () => {
    const s = setup({ rpc: async () => null });
    s.client.sessionId = "s-old";
    await s.switcher.followRenewed();
    expect(s.client.sessionId).toBe("s-old");
    expect(s.shell.setSessions).not.toHaveBeenCalled();
  });

  it("an empty draft is not written onto the new session", async () => {
    const s = setup({ rpc: async () => "s-renewed" });
    s.client.sessionId = "s-old";
    await s.switcher.followRenewed();
    expect(s.windowModel.writes.some((w) => w.field === "composer")).toBe(false);
  });

  it("/fork continues in the new id with the cloned history before what was added meanwhile", async () => {
    const cloned = new ArrayTranscript().chatItems.user("cloned question");
    const s = setup({ history: { items: [cloned], historyMap: [0] } });
    s.client.sessionId = "s-old";
    const typedMeanwhile = s.t.chatItems.user("typed while forking");
    s.t.items = [typedMeanwhile];
    await s.switcher.followFork("s-fork");
    expect(s.client.sessionId).toBe("s-fork");
    expect(s.t.items).toEqual([cloned, typedMeanwhile]);
  });
});
