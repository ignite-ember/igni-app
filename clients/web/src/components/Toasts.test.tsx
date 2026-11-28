// @vitest-environment jsdom
/**
 * Tests for ``Toasts`` — the top-right notification stack used for
 * project-level async events (scheduled tasks finishing, etc.).
 *
 * Critical contracts:
 *   • Auto-dismiss fires after ``ttlMs`` (default 8000) + a short
 *     animation tail. Without this, toasts accumulate forever.
 *   • Click body → opens its target AND dismisses (it's a "primary
 *     action" affordance, e.g. "open the scheduled tasks").
 *   • Close X → dismisses ONLY (does NOT open the target, otherwise
 *     the user can't dismiss without taking the action).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Toasts } from "./Toasts";
import type { PageRoute } from "../chat/pageStack";
import type { ModelToast } from "../clientState";
import { NotificationActions } from "../notifications/notificationActions";
import { actionWorld } from "../notifications/testing";
import { UpdateInfo } from "../update/updateInfo";

/** Every page installed; following a toast to one calls `onOpen`. */
function opens(onOpen: (route: PageRoute) => void): NotificationActions {
  return new NotificationActions(
    { ...NOWHERE, pages: { has: () => true, label: (kind) => kind, routeLabel: (kind) => kind } },
    { openChat: () => {}, openPage: onOpen, showUpdate: () => {} },
  );
}
const NOWHERE = {
  chats: [],
  states: { of: () => ({ activity: "idle" as const, unread: false }) },
  currentChat: "",
  approvals: null,
  update: null,
};

/** A toast as the window model holds it. */
function toast(id: number, text: string, extra: Partial<ModelToast> = {}): ModelToast {
  return { id: `t${id}`, text, kind: "info", ...extra };
}
const SCHEDULE = { kind: "schedule", label: "Scheduled tasks" };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toasts — list rendering", () => {
  it("renders nothing when items is empty", () => {
    // The empty wrapper would still take a row in flex / grid
    // layouts even if invisible; collapse cleanly.
    const { container } = render(<Toasts items={[]} onDismiss={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one card per toast with title + body", () => {
    const items = [
      toast(1, "First", { body: "body one" }),
      toast(2, "Second", { body: "body two" }),
    ];
    render(<Toasts items={items} onDismiss={() => undefined} />);
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("body one")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByText("body two")).toBeTruthy();
  });

  it("body is optional — only the title row renders when body is absent", () => {
    const { container } = render(
      <Toasts items={[toast(1, "Just a title")]} onDismiss={() => undefined} />,
    );
    expect(screen.getByText("Just a title")).toBeTruthy();
    // No body element when ``body`` isn't passed.
    expect(container.querySelector(".ncard-body")).toBeNull();
  });

  it("wrapper has the right ARIA landmark", () => {
    // Screen readers announce toasts; the region landmark
    // tells them where notifications live. Aria attrs are
    // small but easy to silently drop.
    const { container } = render(
      <Toasts items={[toast(1, "x")]} onDismiss={() => undefined} />,
    );
    const region = container.querySelector(".toasts");
    expect(region?.getAttribute("role")).toBe("region");
    expect(region?.getAttribute("aria-label")).toBe("Notifications");
  });
});

describe("Toasts — body button (primary action)", () => {
  it("clicking the body opens where it points", () => {
    // The body click is the toast's "do the thing" action —
    // e.g. open the conversation a scheduled task landed in.
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toasts
        items={[toast(7, "click me", { target: SCHEDULE })]}
        onDismiss={onDismiss}
        actions={opens(onOpen)}
      />,
    );
    fireEvent.click(screen.getByText("click me"));
    expect(onOpen).toHaveBeenCalledWith(SCHEDULE);
  });

  it("clicking the body then dismisses (animation tail then onDismiss)", () => {
    // Click → start exit animation → 150ms later, drop from
    // the list. The 150ms tail keeps the animation visible.
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toasts
        items={[toast(7, "click me", { target: SCHEDULE })]}
        onDismiss={onDismiss}
        actions={opens(onOpen)}
      />,
    );
    fireEvent.click(screen.getByText("click me"));
    // Synchronously, onClick fired but onDismiss hasn't yet —
    // the animation hasn't completed.
    expect(onOpen).toHaveBeenCalledWith(SCHEDULE);
    expect(onDismiss).not.toHaveBeenCalled();
    // Advance past the 150ms exit-animation tail.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onDismiss).toHaveBeenCalledWith("t7");
  });

  it("clicking the body of a toast that points nowhere still dismisses", () => {
    // The handler is optional — informational toasts without an
    // action still close on click. The ``?.()`` chain in the
    // source guards this.
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toasts items={[toast(7, "info only")]} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByText("info only"));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onDismiss).toHaveBeenCalledWith("t7");
  });

  it("applies the is-closing class while the exit animation plays", () => {
    // Without the class, the CSS animation can't fire — the
    // toast would just blink out. Lock the class transition
    // on body-click so a styling refactor doesn't silently
    // skip the animation.
    vi.useFakeTimers();
    const { container } = render(
      <Toasts items={[toast(7, "click me")]} onDismiss={() => undefined} />,
    );
    expect(container.querySelector(".toast")?.className).not.toContain(
      "is-closing",
    );
    fireEvent.click(screen.getByText("click me"));
    // Class flipped synchronously, before the animation tail.
    expect(container.querySelector(".toast")?.className).toContain("is-closing");
  });
});

describe("Toasts — dismiss (X) button", () => {
  it("dismisses without opening its target", () => {
    // The most subtle bug here: an event bubbling from the X
    // button up to the body button would fire onClick when
    // the user only meant to close. The source uses
    // ``stopPropagation`` to guard against this; locked here.
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toasts
        items={[toast(7, "x", { target: SCHEDULE })]}
        onDismiss={onDismiss}
        actions={opens(onOpen)}
      />,
    );
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onOpen).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onDismiss).toHaveBeenCalledWith("t7");
  });
});

describe("Toasts — auto-dismiss TTL", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("auto-dismisses after default 8000ms + 200ms animation tail", () => {
    // The default-TTL contract — silent acartifactsment that
    // most toasts shouldn't need a manual close. 8s gives a
    // user enough time to read but doesn't pile up notifications.
    const onDismiss = vi.fn();
    render(<Toasts items={[toast(7, "x")]} onDismiss={onDismiss} />);
    // Just before TTL — still mounted, not closing.
    act(() => {
      vi.advanceTimersByTime(7999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    // TTL hits → ``is-closing`` flips → 200ms tail fires onDismiss.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledWith("t7");
  });

});

describe("Toasts — holding the countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not hide while the pointer is on it, and resumes from what was left", () => {
    const onDismiss = vi.fn();
    const { container } = render(<Toasts items={[toast(7, "x")]} onDismiss={onDismiss} />);
    const card = container.querySelector(".toast")!;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(card.className).not.toContain("is-closing");
    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(card.className).not.toContain("is-closing");
    act(() => {
      vi.advanceTimersByTime(1 + 200);
    });
    expect(onDismiss).toHaveBeenCalledWith("t7");
  });

  it("does not hide while keyboard focus is inside it", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[toast(7, "x")]} onDismiss={onDismiss} />);
    const close = screen.getByRole("button", { name: "Dismiss" });
    act(() => close.focus());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => close.blur());
    act(() => {
      vi.advanceTimersByTime(8200);
    });
    expect(onDismiss).toHaveBeenCalledWith("t7");
  });

  it("keeps holding when focus moves between its own buttons", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[toast(7, "x", { target: SCHEDULE })]} onDismiss={onDismiss} actions={opens(() => {})} />);
    const open = screen.getByRole("button", { name: "Open Scheduled tasks" });
    const close = screen.getByRole("button", { name: "Dismiss" });
    act(() => open.focus());
    act(() => close.focus());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("holds once for hover and focus together, released by both", () => {
    const onDismiss = vi.fn();
    const { container } = render(<Toasts items={[toast(7, "x")]} onDismiss={onDismiss} />);
    const card = container.querySelector(".toast")!;
    fireEvent.mouseEnter(card);
    fireEvent.mouseEnter(card);
    act(() => screen.getByRole("button", { name: "Dismiss" }).focus());
    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "Dismiss" }).blur());
    act(() => {
      vi.advanceTimersByTime(8200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("Toasts — Escape and the action", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("Escape with focus inside dismisses it, and goes no further", () => {
    const onDismiss = vi.fn();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    render(<Toasts items={[toast(7, "x")]} onDismiss={onDismiss} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Dismiss" }), { key: "Escape" });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onDismiss).toHaveBeenCalledWith("t7");
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener("keydown", outer);
  });

  it("other keys do nothing", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[toast(7, "x")]} onDismiss={onDismiss} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Dismiss" }), { key: "Enter" });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("offers Open only when it points somewhere, which opens and dismisses", () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toasts items={[toast(1, "a", { target: SCHEDULE }), toast(2, "b")]} onDismiss={onDismiss} actions={opens(onOpen)} />,
    );
    const buttons = screen.getAllByRole("button", { name: "Open Scheduled tasks" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Open Scheduled tasks");
    fireEvent.click(buttons[0]);
    expect(onOpen).toHaveBeenCalledWith(SCHEDULE);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("closes once however many times it is asked", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[toast(7, "x")]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("Toasts — how loudly each is announced", () => {
  it.each([
    ["info", "status"],
    ["success", "status"],
    ["warning", "alert"],
    ["error", "alert"],
  ])("a %s toast is a %s with its category's badge", (kind, role) => {
    const { container } = render(<Toasts items={[toast(1, "x", { kind })]} onDismiss={() => {}} />);
    const card = screen.getByRole(role as "status" | "alert");
    expect(card.className).toContain(`toast--${kind}`);
    expect(card.getAttribute("aria-atomic")).toBe("true");
    expect(container.querySelector(".ncard-badge svg")).toBeTruthy();
  });
});

describe("Toasts — clear of the composer", () => {
  it("lifts the stack above a composer it would cover", () => {
    const composer = document.createElement("div");
    composer.className = "composer";
    composer.getBoundingClientRect = () =>
      ({ left: 0, right: window.innerWidth, top: window.innerHeight - 120, bottom: window.innerHeight - 16 }) as DOMRect;
    document.body.appendChild(composer);
    try {
      const { container } = render(<Toasts items={[toast(1, "x")]} onDismiss={() => {}} />);
      const stack = container.querySelector<HTMLElement>(".toasts")!;
      expect(stack.style.getPropertyValue("--toasts-bottom")).toBe("136px");
    } finally {
      composer.remove();
    }
  });

  it("sits in the corner with no composer", () => {
    const { container } = render(<Toasts items={[toast(1, "x")]} onDismiss={() => {}} />);
    expect(container.querySelector<HTMLElement>(".toasts")!.style.getPropertyValue("--toasts-bottom")).toBe("16px");
  });
});

describe("Toasts — each in its category's identity", () => {
  const CV = { kind: "session", label: "CV review", params: { session_id: "cv" } };
  const NPM = { requirement_id: "r1", tool_name: "bash", friendly_name: "npm install" };

  it("draws each category's badge, name and hue", () => {
    const { actions } = actionWorld({ approvals: [NPM] });
    const items = [
      toast(1, "a", { category: "approval", target: CV }),
      toast(2, "b", { category: "failed", kind: "error" }),
      toast(3, "c", { category: "background" }),
      toast(4, "d", { category: "update" }),
      toast(5, "e", { source: "acme.idx" }),
      toast(6, "f", { kind: "success", source: "acme.idx" }),
      toast(7, "g"),
    ];
    const { container } = render(<Toasts items={items} onDismiss={() => {}} actions={actions} />);
    const cards = [...container.querySelectorAll<HTMLElement>(".toast.ncard")];
    expect(cards.map((c) => c.dataset.category)).toEqual([
      "approval",
      "failed",
      "background",
      "update",
      "extension",
      "done",
      "notice",
    ]);
    const paths = cards.map((c) => c.querySelector(".ncard-badge svg path")?.getAttribute("d"));
    expect(new Set(paths).size).toBe(7);
    expect(cards[0].style.getPropertyValue("--ncard-hue")).toBe("var(--notify-hue-approval)");
  });

  it("names the extension that showed it, by its name, and igni for its own", () => {
    render(
      <Toasts
        items={[toast(1, "a", { source: "acme.idx" }), toast(2, "b")]}
        onDismiss={() => {}}
        sourceName={(id) => (id === "acme.idx" ? "Code index" : id)}
      />,
    );
    expect(screen.getByText("Code index")).toBeTruthy();
    expect(screen.getByText("igni")).toBeTruthy();
  });

  it("makes a waiting approval prominent, its primary button naming it and opening its chat", () => {
    const { actions, followed } = actionWorld({ approvals: [NPM] });
    const { container } = render(
      <Toasts items={[toast(1, "Approve?", { category: "approval", target: CV })]} onDismiss={() => {}} actions={actions} />,
    );
    expect(container.querySelector(".toast.is-prominent")).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve npm install in ‘CV review’" });
    expect(approve.className).toContain("button--primary");
    fireEvent.click(approve);
    expect(followed).toEqual([{ to: "chat", sessionId: "cv" }]);
  });

  it("leaves the moment its approval is answered", () => {
    const onDismiss = vi.fn();
    const items = [toast(1, "Approve?", { category: "approval", target: CV }), toast(2, "News")];
    const { container, rerender } = render(
      <Toasts items={items} onDismiss={onDismiss} actions={actionWorld({ approvals: [NPM] }).actions} />,
    );
    expect(container.querySelectorAll(".toast")).toHaveLength(2);

    rerender(<Toasts items={items} onDismiss={onDismiss} actions={actionWorld({ approvals: null }).actions} />);
    expect(screen.queryByText("Approve?")).toBeNull();
    expect(screen.getByText("News")).toBeTruthy();
    expect(onDismiss).toHaveBeenCalledWith("t1");
    expect(onDismiss).not.toHaveBeenCalledWith("t2");
  });

  it("never shows an approval igni claimed without a decision behind it", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[toast(1, "Approve?", { category: "approval" })]} onDismiss={onDismiss} />);
    expect(screen.queryByText("Approve?")).toBeNull();
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("opens a failed run's chat by name, and keeps news quiet", () => {
    const { actions, followed } = actionWorld();
    const { container } = render(
      <Toasts
        items={[toast(1, "Failed", { category: "failed", kind: "error", target: CV }), toast(2, "News")]}
        onDismiss={() => {}}
        actions={actions}
      />,
    );
    expect(container.querySelectorAll(".is-prominent")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Open chat ‘CV review’" }));
    expect(followed).toEqual([{ to: "chat", sessionId: "cv" }]);
  });

  it("offers the waiting update by its version, and nothing when none waits", () => {
    const info = UpdateInfo.parse({ available: true, current_version: "1.0.7", latest_version: "1.0.8" })!;
    const waiting = actionWorld({ update: info });
    const { rerender } = render(
      <Toasts items={[toast(1, "Update ready", { category: "update" })]} onDismiss={() => {}} actions={waiting.actions} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restart to update to 1.0.8" }));
    expect(waiting.followed).toEqual([{ to: "update", version: "1.0.8" }]);

    rerender(<Toasts items={[toast(2, "Up to date", { category: "update" })]} onDismiss={() => {}} actions={actionWorld().actions} />);
    expect(screen.queryByRole("button", { name: /Restart/ })).toBeNull();
  });

  it("names the scheduled task it shows", () => {
    const { actions, followed } = actionWorld({ pages: { schedule: "Scheduled tasks" } });
    const target = { kind: "schedule", label: "Scheduled tasks", params: { name: "nightly sync" } };
    render(<Toasts items={[toast(1, "Done", { category: "background", target })]} onDismiss={() => {}} actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Show ‘nightly sync’ in Scheduled tasks" }));
    expect(followed).toEqual([{ to: "page", route: target }]);
  });

  it("offers nothing for a page that is not installed", () => {
    const { actions } = actionWorld({ pages: {} });
    render(<Toasts items={[toast(1, "x", { target: SCHEDULE })]} onDismiss={() => {}} actions={actions} />);
    expect(document.querySelector(".ncard-action")).toBeNull();
  });
});

