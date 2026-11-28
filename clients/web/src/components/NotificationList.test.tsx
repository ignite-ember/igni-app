// @vitest-environment jsdom
/**
 * Reading a notification, whichever extension it is from.
 *
 * The list used to know Artifacts' verbs. Notifications are the
 * floor's now (igni server's `docs/service-identity.md` §10) and every
 * extension has its own kinds, so a row says what the notification
 * says — which extension, its title, its body, who, and when — and the
 * two ways to get that wrong are tested here: a row that loses one of
 * those, and a row that can be opened when there is nowhere to go.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { NotificationDays } from "../notifications/dayGroups";
import { actionWorld } from "../notifications/testing";
import { NotificationList, when, type FloorNotification } from "./NotificationList";

afterEach(cleanup);

function row(over: Partial<FloorNotification> = {}): FloorNotification {
  return {
    id: "n1",
    origin: "server",
    source: "igni.artifacts",
    kind: "comment",
    title: "Runbook",
    body: "Ada: can we drop step 3?",
    actor: "ada@acme.com",
    target: { page: "igni.artifacts", params: { slug: "runbook", comment: "c1" } },
    created_at: new Date().toISOString(),
    read: false,
    ...over,
  };
}

const NAMES: Record<string, string> = { "igni.artifacts": "Artifacts" };
const nameOf = (id: string) => NAMES[id] ?? id;

describe("what a row says", () => {
  it("names its extension, its title, its body, who and when", () => {
    render(<NotificationList rows={[row()]} sourceName={nameOf} />);

    expect(screen.getByText("Artifacts")).toBeTruthy();
    expect(screen.getByText("Runbook")).toBeTruthy();
    expect(screen.getByText("Ada: can we drop step 3?")).toBeTruthy();
    expect(screen.getByText("ada@acme.com")).toBeTruthy();
    expect(screen.getByText(/just now/)).toBeTruthy();
  });

  it("names the organisation it came from, when the backend sends one", () => {
    // The backend sends `org_name` only for somebody in more than one
    // organisation; with one, every row is from it.
    render(
      <NotificationList
        rows={[row({ org_id: "org-globex", org_name: "Globex" })]}
        sourceName={nameOf}
      />,
    );

    expect(screen.getByText(/Globex/).textContent).toBe(" · Globex");
    expect(screen.getByText(/Artifacts/).textContent).toBe("Artifacts · Globex");
  });

  it("says nothing about the organisation when there is only one", () => {
    const { container } = render(
      <NotificationList rows={[row({ org_id: "org-acme", org_name: "" })]} sourceName={nameOf} />,
    );

    expect(container.querySelector(".ncard-org")).toBeNull();
  });

  it("names an extension it has no name for by its id", () => {
    render(<NotificationList rows={[row({ source: "acme.scanner" })]} sourceName={nameOf} />);

    expect(screen.getByText("acme.scanner")).toBeTruthy();
  });

  it("draws a notice about your own work without an actor", () => {
    // An extension's local notice — "your export is ready" — has
    // nobody who did it.
    render(
      <NotificationList
        rows={[row({ origin: "local", actor: "", title: "Runbook.pdf", body: "Your export is ready" })]}
        sourceName={nameOf}
      />,
    );

    expect(screen.getByText("Runbook.pdf")).toBeTruthy();
    expect(screen.queryByText("ada@acme.com")).toBeNull();
  });

  it("puts a server row and a local row with the same id side by side", () => {
    const { container } = render(
      <NotificationList rows={[row(), row({ origin: "local" })]} sourceName={nameOf} />,
    );

    expect(container.querySelectorAll(".notify-row").length).toBe(2);
  });
});

describe("opening one", () => {
  it("follows what it reaches and hands back the row and the action", () => {
    const { actions } = actionWorld({ pages: { "igni.artifacts": "Artifacts" } });
    const followed = vi.fn();
    render(<NotificationList rows={[row()]} actions={actions} onFollow={followed} />);

    const open = screen.getByRole("button", { name: "Open Artifacts" });
    fireEvent.click(open);

    expect(followed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n1", target: row().target }),
      expect.objectContaining({ label: "Open Artifacts" }),
    );
  });

  it("cannot be opened when its page is not here", () => {
    // The extension it is from is not installed on this machine.
    const { actions } = actionWorld({ pages: {} });
    const followed = vi.fn();
    render(<NotificationList rows={[row()]} actions={actions} onFollow={followed} />);

    expect(screen.queryByRole("button", { name: /Open/ })).toBeNull();
    expect(followed).not.toHaveBeenCalled();
  });

  it("cannot be opened when it names no page", () => {
    const { actions } = actionWorld();
    render(<NotificationList rows={[row({ target: null })]} actions={actions} onFollow={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Open/ })).toBeNull();
  });

  it("opens nothing without a resolver", () => {
    render(<NotificationList rows={[row()]} onFollow={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Open/ })).toBeNull();
  });
});

describe("what it looks like when there is nothing", () => {
  it("says so rather than showing an empty box", () => {
    render(<NotificationList rows={[]} />);

    expect(screen.getByText("Nothing is waiting on you.")).toBeTruthy();
  });

  it("marks what has been read without hiding it", () => {
    const { container } = render(<NotificationList rows={[row({ read: true })]} />);

    expect(container.querySelector(".notify-row.is-read")).toBeTruthy();
    expect(screen.getByText("Runbook")).toBeTruthy();
  });
});

describe("when it happened", () => {
  it("reads as just now for something that just did", () => {
    expect(when(new Date().toISOString())).toBe("just now");
  });

  it("counts in minutes, then hours, then days", () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(when(ago(10 * 60_000))).toBe("10m ago");
    expect(when(ago(3 * 3_600_000))).toBe("3h ago");
    expect(when(ago(2 * 86_400_000))).toBe("2d ago");
  });

  it("says nothing rather than NaN for a timestamp it cannot read", () => {
    expect(when("not a date")).toBe("");
    expect(when("")).toBe("");
    expect(when(null)).toBe("");
  });
});

describe("grouped by day", () => {
  it("heads each day and lists its rows under it", () => {
    const now = new Date(2026, 10, 28, 15);
    const days = new NotificationDays(now, "en-GB");
    const at = (d: number) => new Date(2026, 10, d, 10).toISOString();
    render(
      <NotificationList
        days={days}
        rows={[
          row({ id: "a", title: "Fresh", created_at: at(28) }),
          row({ id: "b", title: "Older", created_at: at(27) }),
        ]}
      />,
    );

    const today = screen.getByRole("region", { name: "Today" });
    const yesterday = screen.getByRole("region", { name: "Yesterday" });
    expect(within(today).getByText("Fresh")).toBeTruthy();
    expect(within(today).queryByText("Older")).toBeNull();
    expect(within(yesterday).getByText("Older")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Today", "Yesterday"]);
  });
});

describe("unread, quietly", () => {
  it("marks an unread row with a dot and says so to a screen reader", () => {
    const { container } = render(<NotificationList rows={[row()]} />);

    expect(container.querySelector(".notify-row.is-unread .ncard-dot")).toBeTruthy();
    expect(screen.getByText(/Runbook/).textContent).toContain("(unread)");
  });

  it("draws no dot on a read row", () => {
    const { container } = render(<NotificationList rows={[row({ read: true })]} />);

    expect(container.querySelector(".ncard-dot")).toBeNull();
    expect(screen.queryByText(/\(unread\)/)).toBeNull();
  });

  it("offers marking an unread row read, without opening it", () => {
    const marked = vi.fn();
    const opened = vi.fn();
    const { actions } = actionWorld();
    render(<NotificationList rows={[row()]} actions={actions} onMarkRead={marked} onFollow={opened} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));

    expect(marked).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }));
    expect(opened).not.toHaveBeenCalled();
  });

  it("offers no mark-as-read on a read row, or without a handler", () => {
    const { rerender } = render(<NotificationList rows={[row({ read: true })]} onMarkRead={() => {}} />);
    expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
    rerender(<NotificationList rows={[row()]} />);
    expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
  });
});

describe("who it is about", () => {
  it("puts a person's monogram on the badge's corner, and none on an extension's own notice", () => {
    const { container, rerender } = render(<NotificationList rows={[row()]} sourceName={nameOf} />);
    expect(container.querySelector(".ncard-badge .ncard-face")).toBeTruthy();

    rerender(<NotificationList rows={[row({ actor: "" })]} sourceName={nameOf} />);
    expect(container.querySelector(".ncard-face")).toBeNull();
    expect(container.querySelector(".ncard-badge svg")).toBeTruthy();
  });

  it("does not repeat an actor that is the extension itself", () => {
    const { container } = render(<NotificationList rows={[row({ actor: "Artifacts" })]} sourceName={nameOf} />);

    expect(container.querySelector(".ncard-actor")).toBeNull();
  });

  it("leaves out when for a row with no date", () => {
    const { container } = render(<NotificationList rows={[row({ created_at: null })]} />);

    expect(container.querySelector(".ncard-when")).toBeNull();
  });
});

describe("an empty list", () => {
  it("shows what it is given instead of the default", () => {
    render(<NotificationList rows={[]} empty={<p>Custom</p>} />);

    expect(screen.getByText("Custom")).toBeTruthy();
    expect(screen.queryByText("Nothing is waiting on you.")).toBeNull();
  });

  it("says you are caught up by default", () => {
    render(<NotificationList rows={[]} />);

    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });
});

describe("its category and its button", () => {
  /** A row that names a chat, as an approval notice does. */
  const inChat = (over: Partial<FloorNotification> = {}) =>
    row({ kind: "approval", actor: "", target: { page: "session", params: { session_id: "cv" } }, ...over });

  it("draws the category's badge, name and hue on every row", () => {
    const { actions } = actionWorld({ approvals: [{ requirement_id: "r1", tool_name: "bash", friendly_name: "npm install" }] });
    const { container } = render(
      <NotificationList
        actions={actions}
        rows={[inChat({ id: "a" }), row({ id: "b", kind: "process_failed" }), row({ id: "c", kind: "x" })]}
      />,
    );
    const cards = [...container.querySelectorAll<HTMLElement>(".ncard")];
    expect(cards.map((c) => c.dataset.category)).toEqual(["approval", "failed", "extension"]);
    expect(cards.map((c) => c.style.getPropertyValue("--ncard-hue"))).toEqual([
      "var(--notify-hue-approval)",
      "var(--notify-hue-failed)",
      "var(--notify-hue-extension)",
    ]);
    expect(cards.map((c) => c.querySelector(".ncard-category")?.textContent)).toEqual([
      "Needs you",
      "Failed",
      "Extensions",
    ]);
    for (const card of cards) expect(card.querySelector(".ncard-badge svg path")?.getAttribute("d")).toBeTruthy();
  });

  it("makes a waiting approval louder than news, with a button naming it that opens its chat", () => {
    const { actions, followed } = actionWorld({
      approvals: [{ requirement_id: "r1", tool_name: "bash", friendly_name: "npm install" }],
    });
    const onFollow = vi.fn((_row, action) => action.run());
    const { container } = render(
      <NotificationList rows={[inChat({ id: "a" }), row({ id: "b", kind: "comment" })]} actions={actions} onFollow={onFollow} />,
    );
    const [approval, comment] = [...container.querySelectorAll(".ncard")];
    expect(approval.classList.contains("is-prominent")).toBe(true);
    expect(comment.classList.contains("is-prominent")).toBe(false);

    const approve = screen.getByRole("button", { name: "Approve npm install in ‘CV review’" });
    expect(approve.className).toContain("button--primary");
    expect(approve.textContent).toBe("Approve npm install in ‘CV review’");
    expect(within(comment as HTMLElement).queryByRole("button", { name: /Approve|Answer|Review \d/ })).toBeNull();
    fireEvent.click(approve);
    expect(followed).toEqual([{ to: "chat", sessionId: "cv" }]);
  });

  it("counts several approvals waiting in the chat", () => {
    const { actions } = actionWorld({
      approvals: [
        { requirement_id: "r1", tool_name: "bash", friendly_name: "" },
        { requirement_id: "r2", tool_name: "write", friendly_name: "" },
        { requirement_id: "r3", tool_name: "edit", friendly_name: "" },
      ],
    });
    render(<NotificationList rows={[inChat()]} actions={actions} />);
    expect(screen.getByRole("button", { name: "Review 3 approvals in ‘CV review’" })).toBeTruthy();
  });

  it("demotes the card the moment its approval is answered: no longer Needs you, its button the chat", () => {
    const pending = actionWorld({ approvals: [{ requirement_id: "r1", tool_name: "bash", friendly_name: "npm install" }] });
    const answered = actionWorld({ approvals: null });
    const { container, rerender } = render(<NotificationList rows={[inChat()]} actions={pending.actions} />);
    expect(container.querySelector(".ncard")?.getAttribute("data-category")).toBe("approval");

    rerender(<NotificationList rows={[inChat()]} actions={answered.actions} />);
    expect(container.querySelector(".ncard.is-prominent")).toBeNull();
    expect(container.querySelector(".ncard")?.getAttribute("data-category")).not.toBe("approval");
    expect(screen.queryByRole("button", { name: /Approve|Review \d|Answer/ })).toBeNull();
    // The card still opens the chat, which is still there; it just says so.
    expect(screen.getByRole("button", { name: "Open chat ‘CV review’" })).toBeTruthy();
  });

  it("gives a row whose kind only says review no decision and no decision button", () => {
    const { actions } = actionWorld({ pages: { "igni.artifacts": "Artifacts" } });
    const { container } = render(
      <NotificationList rows={[row({ kind: "review_requested" }), row({ id: "b", kind: "approval" })]} actions={actions} />,
    );
    expect(container.querySelector('[data-category="approval"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve|Review \d|Answer/ })).toBeNull();
  });

  it("names the chat a failure opens, cut short on the button and whole in its label", () => {
    const { actions, followed } = actionWorld();
    render(
      <NotificationList
        rows={[row({ kind: "process_failed", target: { page: "session", params: { session_id: "billing" } } })]}
        actions={actions}
        onFollow={(_row, action) => action.run()}
      />,
    );
    const full = "Open chat ‘Trace the billing flow through the gateway and the ledger’";
    const open = screen.getByRole("button", { name: full });
    expect(open.textContent).toBe("Open chat ‘Trace the billing flow…’");
    fireEvent.click(open);
    expect(followed).toEqual([{ to: "chat", sessionId: "billing" }]);
  });

  it("offers no button for a chat that is gone", () => {
    const { actions } = actionWorld();
    render(
      <NotificationList
        rows={[row({ kind: "process_failed", target: { page: "session", params: { session_id: "deleted" } } })]}
        actions={actions}
      />,
    );
    expect(document.querySelector(".ncard-action")).toBeNull();
  });
});
