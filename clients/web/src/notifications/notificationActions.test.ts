/**
 * A button is a promise. Every action names what it reaches, reaches
 * exactly that, and exists only while that thing does: a decision only
 * while it waits, a chat only while it is listed, a page only while it
 * is installed, an update only while one waits.
 */
import { describe, expect, it } from "vitest";

import { UpdateInfo } from "../update/updateInfo";
import { NAME_CHARS, NotificationAction } from "./notificationAction";
import { NotificationActions } from "./notificationActions";
import { actionWorld } from "./testing";

const NPM = { requirement_id: "r1", tool_name: "bash", friendly_name: "npm install" };
const WRITE = { requirement_id: "r2", tool_name: "write_file", friendly_name: "" };
const at = (page: string, params: Record<string, string> = {}) => ({ target: { page, params } });

describe("a decision", () => {
  it("in the chat on screen names its one approval and opens the chat", () => {
    const { actions, followed } = actionWorld({ approvals: [NPM] });
    const action = actions.forFloor(at("session", { session_id: "cv" }))!;
    expect(action.decides).toBe(true);
    expect(action.label).toBe("Approve npm install in ‘CV review’");
    action.run();
    expect(followed).toEqual([{ to: "chat", sessionId: "cv" }]);
  });

  it("counts several approvals, naming the tool when the friendly name is missing", () => {
    expect(actionWorld({ approvals: [WRITE] }).actions.decision({ session_id: "cv" })?.label).toBe(
      "Approve write_file in ‘CV review’",
    );
    expect(actionWorld({ approvals: [NPM, WRITE] }).actions.decision({ session_id: "cv" })?.label).toBe(
      "Review 2 approvals in ‘CV review’",
    );
  });

  it("found by its requirement id alone, in the chat on screen", () => {
    const { actions, followed } = actionWorld({ approvals: [NPM] });
    const action = actions.forFloor(at("extension", { requirement_id: "r1" }))!;
    expect(action.decides).toBe(true);
    action.run();
    expect(followed).toEqual([{ to: "chat", sessionId: "cv" }]);
  });

  it("is gone once its requirement is answered, though others wait", () => {
    const { actions } = actionWorld({ approvals: [WRITE] });
    expect(actions.decision({ session_id: "cv", requirement_id: "r1" })).toBeNull();
    expect(actions.decision({ requirement_id: "r1" })).toBeNull();
  });

  it("is gone once the chat on screen has nothing open", () => {
    expect(actionWorld({ approvals: null }).actions.decision({ session_id: "cv" })).toBeNull();
    expect(actionWorld({ approvals: [] }).actions.decision({ session_id: "cv" })).toBeNull();
  });

  it("in another chat waits while that chat is paused, by its state or its list entry", () => {
    const byState = actionWorld({ waiting: ["infra"] });
    const action = byState.actions.decision({ session_id: "infra" })!;
    expect(action.label).toBe("Answer the approval in ‘Infra cleanup’");
    action.run();
    expect(byState.followed).toEqual([{ to: "chat", sessionId: "infra" }]);

    const byEntry = actionWorld({ chats: [{ session_id: "infra", name: "Infra cleanup", has_paused_run: true }] });
    expect(byEntry.actions.decision({ session_id: "infra" })?.decides).toBe(true);
    expect(actionWorld().actions.decision({ session_id: "infra" })).toBeNull();
  });

  it("needs a chat that is listed, and something naming it", () => {
    expect(actionWorld({ waiting: ["gone"] }).actions.decision({ session_id: "gone" })).toBeNull();
    expect(actionWorld({ approvals: [NPM] }).actions.decision({})).toBeNull();
  });

  it("names an untitled chat as such", () => {
    const { actions } = actionWorld({ chats: [{ session_id: "x", name: "" }], waiting: ["x"] });
    expect(actions.decision({ session_id: "x" })?.label).toBe("Answer the approval in ‘Untitled chat’");
  });
});

describe("a chat", () => {
  it("opens by name while it is listed", () => {
    const { actions, followed } = actionWorld();
    const action = actions.forFloor(at("session", { session_id: "infra" }))!;
    expect(action.decides).toBe(false);
    expect(action.label).toBe("Open chat ‘Infra cleanup’");
    action.run();
    expect(followed).toEqual([{ to: "chat", sessionId: "infra" }]);
    expect(actions.forFloor(at("chat", { session_id: "cv" }))?.label).toBe("Open chat ‘CV review’");
  });

  it("is nothing once deleted", () => {
    expect(actionWorld().actions.forFloor(at("session", { session_id: "deleted" }))).toBeNull();
    expect(actionWorld().actions.forFloor(at("session"))).toBeNull();
  });
});

describe("a page", () => {
  it("opens by its name with the notification's params", () => {
    const { actions, followed } = actionWorld({ pages: { "acme.review": "Code review › Findings" } });
    const action = actions.forFloor(at("acme.review", { id: "7" }))!;
    expect(action.label).toBe("Open Code review › Findings");
    action.run();
    expect(followed).toEqual([
      { to: "page", route: { kind: "acme.review", label: "Code review › Findings", params: { id: "7" } } },
    ]);
  });

  it("names the thing on it when the notification says which", () => {
    const { actions } = actionWorld({ pages: { schedule: "Scheduled tasks" } });
    expect(actions.forFloor(at("schedule", { name: "nightly sync" }))?.label).toBe(
      "Show ‘nightly sync’ in Scheduled tasks",
    );
  });

  it("is nothing once uninstalled, and nothing without a target", () => {
    expect(actionWorld({ pages: {} }).actions.forFloor(at("acme.review"))).toBeNull();
    expect(actionWorld().actions.forFloor({ target: null })).toBeNull();
  });

  it("from a toast keeps the toast's own route and label", () => {
    const { actions, followed } = actionWorld({ pages: { schedule: "x" } });
    const target = { kind: "schedule", label: "Scheduled tasks" };
    const action = actions.forToast({ target, category: "background" })!;
    expect(action.label).toBe("Open Scheduled tasks");
    action.run();
    expect(followed).toEqual([{ to: "page", route: target }]);
  });
});

describe("an update", () => {
  const info = UpdateInfo.parse({ available: true, current_version: "1.0.7", latest_version: "1.0.8" })!;

  it("installs the one waiting, by version, from an update notice", () => {
    const { actions, followed } = actionWorld({ update: info });
    const action = actions.forToast({ target: null, category: "update" })!;
    expect(action.label).toBe("Restart to update to 1.0.8");
    action.run();
    expect(followed).toEqual([{ to: "update", version: "1.0.8" }]);
  });

  it("is nothing when none waits, or for a notice about something else", () => {
    const none = UpdateInfo.parse({ available: false, current_version: "1.0.8", latest_version: "1.0.8" });
    expect(actionWorld({ update: none }).actions.forToast({ category: "update" })).toBeNull();
    expect(actionWorld().actions.forToast({ category: "update" })).toBeNull();
    expect(actionWorld({ update: info }).actions.forToast({ category: "background" })).toBeNull();
  });
});

describe("every label", () => {
  it("is cut on the button at a word, whole in its label", () => {
    const { actions } = actionWorld();
    const action = actions.forFloor(at("session", { session_id: "billing" }))!;
    expect(action.label).toBe("Open chat ‘Trace the billing flow through the gateway and the ledger’");
    expect(action.text).toBe("Open chat ‘Trace the billing flow…’");
  });

  it("cuts a name with no word break at the limit", () => {
    const long = "x".repeat(NAME_CHARS + 5);
    expect(NotificationAction.cut(long)).toBe("x".repeat(NAME_CHARS - 1) + "…");
    expect(NotificationAction.cut("x".repeat(NAME_CHARS))).toBe("x".repeat(NAME_CHARS));
  });

  it("names its target for every kind of target", () => {
    const { actions } = actionWorld({
      approvals: [NPM],
      waiting: ["infra"],
      update: UpdateInfo.parse({ available: true, current_version: "1", latest_version: "2" }),
      pages: { schedule: "Scheduled tasks", "acme.review": "Code review" },
    });
    const cases: [NotificationAction | null, string][] = [
      [actions.forFloor(at("session", { session_id: "cv" })), "CV review"],
      [actions.forFloor(at("session", { session_id: "infra" })), "Infra cleanup"],
      [actions.forFloor(at("chat", { session_id: "billing" })), "Trace the billing flow"],
      [actions.forFloor(at("acme.review")), "Code review"],
      [actions.forFloor(at("schedule", { name: "nightly" })), "nightly"],
      [actions.forToast({ category: "update" }), "2"],
    ];
    for (const [action, name] of cases) {
      expect(action).not.toBeNull();
      expect(action!.label).toContain(name);
      expect(action!.label).not.toMatch(/^(Open|Review|View|Show)$/);
    }
  });
});

describe("the empty resolver", () => {
  it("reaches nothing", () => {
    expect(NotificationActions.NONE.forFloor(at("session", { session_id: "cv" }))).toBeNull();
    expect(NotificationActions.NONE.forToast({ category: "update", target: { kind: "schedule", label: "S" } })).toBeNull();
  });
});
