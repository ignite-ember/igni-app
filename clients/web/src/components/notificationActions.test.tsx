// @vitest-environment jsdom
/**
 * The promise every button makes: it names the thing it opens, and it
 * opens that thing. Checked over what is actually drawn, for a toast
 * and for a row of the sheet, with the world moved under them.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { ModelToast } from "../clientState";
import { NotificationActions } from "../notifications/notificationActions";
import { actionWorld } from "../notifications/testing";
import { NotificationList } from "./NotificationList";
import { Toasts } from "./Toasts";
import type { FloorNotification } from "../notifications/model";

afterEach(cleanup);

const NPM = { requirement_id: "r1", tool_name: "bash", friendly_name: "npm install" };

function row(over: Partial<FloorNotification> = {}): FloorNotification {
  return {
    id: "n1",
    origin: "server",
    source: "acme.review",
    kind: "comment",
    title: "Ada commented",
    body: "On step 3",
    actor: "Ada",
    target: { page: "session", params: { session_id: "cv" } },
    created_at: new Date().toISOString(),
    read: false,
    ...over,
  };
}

function toast(id: number, text: string, over: Partial<ModelToast> = {}): ModelToast {
  return { id: `t${id}`, text, kind: "info", ...over };
}

/** Every button drawn, with its accessible name and its tooltip. */
function drawnButtons(container: HTMLElement): { name: string; title: string }[] {
  return [...container.querySelectorAll<HTMLElement>("button.ncard-action")].map((b) => ({
    name: b.getAttribute("aria-label") ?? b.textContent ?? "",
    title: b.getAttribute("title") ?? "",
  }));
}

describe("every button drawn", () => {
  it("names the thing it opens, and its tooltip holds the whole name", () => {
    const { actions } = actionWorld({
      approvals: [NPM],
      waiting: ["infra"],
      pages: { schedule: "Scheduled tasks", "acme.review": "Code review" },
    });
    const { container } = render(
      <NotificationList
        actions={actions}
        rows={[
          row({ id: "a", kind: "approval", target: { page: "session", params: { session_id: "cv" } } }),
          row({ id: "b", kind: "process_failed", target: { page: "session", params: { session_id: "infra" } } }),
          row({ id: "c", kind: "release", target: { page: "acme.review", params: {} } }),
          row({ id: "d", kind: "scheduler_completed", target: { page: "schedule", params: { name: "nightly" } } }),
        ]}
      />,
    );
    const buttons = drawnButtons(container);
    expect(buttons.length).toBe(4);
    for (const button of buttons) {
      expect(button.name.length).toBeGreaterThan(4);
      // Never a bare verb: the label says what it reaches.
      expect(button.name).not.toMatch(/^(Open|Review|View|Show|Approve|Answer)$/);
      expect(button.title).toBe(button.name);
    }
    expect(buttons.map((b) => b.name)).toEqual([
      "Approve npm install in ‘CV review’",
      "Answer the approval in ‘Infra cleanup’",
      "Open Code review",
      "Show ‘nightly’ in Scheduled tasks",
    ]);
  });

  it("names its target in a toast the same way", () => {
    const { actions } = actionWorld({ approvals: [NPM], pages: { schedule: "Scheduled tasks" } });
    const { container } = render(
      <Toasts
        actions={actions}
        onDismiss={() => {}}
        items={[
          toast(1, "a", { category: "approval", target: { kind: "session", label: "CV review", params: { session_id: "cv" } } }),
          toast(2, "b", { category: "background", target: { kind: "schedule", label: "Scheduled tasks", params: { name: "nightly" } } }),
        ]}
      />,
    );
    expect(drawnButtons(container).map((b) => b.name)).toEqual([
      "Approve npm install in ‘CV review’",
      "Show ‘nightly’ in Scheduled tasks",
    ]);
  });

  it("follows what it says when pressed", () => {
    const { actions, followed } = actionWorld({ approvals: [NPM] });
    render(
      <NotificationList
        actions={actions}
        rows={[row({ kind: "approval", target: { page: "session", params: { session_id: "cv" } } })]}
        onFollow={(_row, action) => action.run()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve npm install in ‘CV review’" }));
    expect(followed).toEqual([{ to: "chat", sessionId: "cv" }]);
  });

  it("is gone the moment its target is", () => {
    const live = actionWorld({ approvals: [NPM] });
    const gone = actionWorld({ approvals: null, chats: [] });
    const rows = [row({ kind: "approval", target: { page: "session", params: { session_id: "cv" } } })];
    const { container, rerender } = render(<NotificationList actions={live.actions} rows={rows} />);
    expect(drawnButtons(container)).toHaveLength(1);

    rerender(<NotificationList actions={gone.actions} rows={rows} />);
    expect(drawnButtons(container)).toHaveLength(0);
    expect(container.querySelector(".ncard.is-prominent")).toBeNull();
  });
});

describe("a resolver with nothing behind it", () => {
  it("draws no button at all", () => {
    const { container } = render(
      <NotificationList rows={[row()]} actions={NotificationActions.NONE} onFollow={() => {}} />,
    );
    expect(drawnButtons(container)).toHaveLength(0);
  });
});
