// @vitest-environment jsdom
/**
 * Component tests for the four status-line widgets:
 *
 *   • ModeBadge       — permission-mode chip (rows 50, 51, 7)
 *   • AutoApproveSwitch — one-click bypassPermissions toggle (row 51)
 *   • SessionContext  — session id + context ring, in one readout
 *
 * Each widget has a small, sharp contract — wrong styling or wrong
 * callback wiring is immediately visible in the UI. These tests
 * lock the contracts so a "neat refactor" can't silently regress
 * them (e.g. swapping green/red, miscounting pct thresholds).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AutoApproveSwitch,
  ModeBadge,
  SessionContext,
} from "./StatusBits";

afterEach(() => {
  cleanup();
});

// ── ModeBadge ────────────────────────────────────────────────

describe("ModeBadge", () => {
  it("renders nothing in default mode (signal-value: badge visible == mode active)", () => {
    // The whole point of the badge is "you only see it when you
    // need to" — rendering an empty / 'NORMAL' chip in default
    // mode would dilute that signal value.
    const { container } = render(<ModeBadge mode="default" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an unknown mode (forward-compat guard)", () => {
    // If the BE ever pushes a new mode the FE doesn't know about,
    // render nothing rather than crashing or rendering a malformed
    // chip. Mirrors the same forward-compat strategy used in
    // ``PlanTaskList.parseTask``.
    const { container } = render(<ModeBadge mode="brandNewMode" />);
    expect(container.firstChild).toBeNull();
  });

  it("plan mode shows 'PLAN MODE' label", () => {
    render(<ModeBadge mode="plan" />);
    expect(screen.getByText("PLAN MODE")).toBeTruthy();
  });

  it("acceptEdits mode shows 'ACCEPT EDITS' label + accept variant class", () => {
    const { container } = render(<ModeBadge mode="acceptEdits" />);
    expect(screen.getByText("ACCEPT EDITS")).toBeTruthy();
    // CSS variant class drives the green styling — refactor to
    // a different naming convention would silently break the
    // visual distinction between modes.
    expect(container.querySelector(".mode-badge--accept")).toBeTruthy();
  });

  it("dontAsk mode shows 'STRICT' label + dontask variant class", () => {
    const { container } = render(<ModeBadge mode="dontAsk" />);
    expect(screen.getByText(/STRICT/)).toBeTruthy();
    expect(container.querySelector(".mode-badge--dontask")).toBeTruthy();
  });

  it("bypassPermissions mode shows the loud 'AUTO' label", () => {
    // This mode is the sharpest one — the agent can do anything
    // without prompting. It is labelled "Auto" (igni runs every tool
    // for you), in full caps so the badge is unmistakeable.
    const { container } = render(<ModeBadge mode="bypassPermissions" />);
    expect(screen.getByText("AUTO")).toBeTruthy();
    expect(container.querySelector(".mode-badge--bypass")).toBeTruthy();
  });

  it("includes a hover title with explanation copy", () => {
    // The chip is small — the title attr is where the full
    // "what does this mode mean" copy lives. Without it the
    // user has to leave the app to look up what they enabled.
    const { container } = render(<ModeBadge mode="plan" />);
    const chip = container.querySelector(".plan-badge");
    expect(chip?.getAttribute("title")).toMatch(/plan mode/i);
    expect(chip?.getAttribute("title")).toMatch(/\/plan/);
  });
});

// ── AutoApproveSwitch ────────────────────────────────────────

describe("AutoApproveSwitch", () => {
  it("renders OFF when mode is not bypassPermissions", () => {
    // ``aria-checked=false`` for SR users + no ``is-on`` class
    // for visual. Label says "Auto-approve" with no suffix in
    // the OFF state to keep the chip compact.
    const { container } = render(
      <AutoApproveSwitch mode="default" onToggle={() => undefined} />,
    );
    const button = container.querySelector("button[role='switch']");
    expect(button?.getAttribute("aria-checked")).toBe("false");
    expect(button?.className).not.toContain("is-on");
    expect(screen.getByText("Auto-approve")).toBeTruthy();
  });

  it("renders ON when mode === bypassPermissions", () => {
    const { container } = render(
      <AutoApproveSwitch mode="bypassPermissions" onToggle={() => undefined} />,
    );
    const button = container.querySelector("button[role='switch']");
    expect(button?.getAttribute("aria-checked")).toBe("true");
    expect(button?.className).toContain("is-on");
    // Label gains an "ON" suffix so the switch reads correctly
    // even without color. Accessibility-by-text-too.
    expect(screen.getByText(/Auto-approve ON/)).toBeTruthy();
  });

  it("clicking OFF→ON calls onToggle(true)", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <AutoApproveSwitch mode="default" onToggle={onToggle} />,
    );
    fireEvent.click(container.querySelector("button[role='switch']")!);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("clicking ON→OFF calls onToggle(false)", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <AutoApproveSwitch mode="bypassPermissions" onToggle={onToggle} />,
    );
    fireEvent.click(container.querySelector("button[role='switch']")!);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("OFF title hints what turning ON does", () => {
    // The title flips with state so the affordance is always
    // forward-looking: "click to turn ON" vs "click to turn OFF".
    const { container } = render(
      <AutoApproveSwitch mode="default" onToggle={() => undefined} />,
    );
    const title = container
      .querySelector("button[role='switch']")
      ?.getAttribute("title");
    expect(title).toMatch(/click to let|without prompts/i);
  });

  it("ON title hints what turning OFF does", () => {
    const { container } = render(
      <AutoApproveSwitch mode="bypassPermissions" onToggle={() => undefined} />,
    );
    const title = container
      .querySelector("button[role='switch']")
      ?.getAttribute("title");
    expect(title).toMatch(/click to turn off/i);
  });
});

// ── SessionContext ───────────────────────────────────────────

describe("SessionContext", () => {
  /** The ring's fill arc dash, as [drawn, circumference]. */
  const dash = (container: HTMLElement): [number, number] => {
    const fill = container.querySelector(".ctx-ring-fill");
    const [drawn, circ] = (fill?.getAttribute("stroke-dasharray") ?? "0 0").split(" ").map(Number);
    return [drawn, circ];
  };

  it("shows the first 8 chars of the session id on the face", () => {
    // The 8-char prefix is the canonical short form used everywhere
    // else (Session.fork, persistence, logs).
    const { container } = render(<SessionContext sessionId="abcd1234ef56789" tokens={0} max={100} pct={0} />);
    expect(container.querySelector(".session-ctx-id")?.textContent).toBe("abcd1234");
  });

  it("shows a dash on the face when there is no session yet", () => {
    const { container } = render(<SessionContext sessionId="" tokens={0} max={100} pct={0} />);
    expect(container.querySelector(".session-ctx-id")?.textContent).toBe("—");
  });

  it("ok tone for pct < 60", () => {
    // The thresholds are not arbitrary — the user starts worrying at
    // "more than half used" (warn) and panicking at "running out"
    // (danger). Pin both transitions so a 5% drift can't shift them.
    const { container } = render(<SessionContext sessionId="s" tokens={1000} max={10000} pct={20} />);
    expect(container.querySelector(".tone-ok")).toBeTruthy();
    expect(container.querySelector(".tone-warn")).toBeNull();
    expect(container.querySelector(".tone-danger")).toBeNull();
  });

  it("warn tone at exactly 60", () => {
    const { container } = render(<SessionContext sessionId="s" tokens={6000} max={10000} pct={60} />);
    expect(container.querySelector(".tone-warn")).toBeTruthy();
  });

  it("danger tone at exactly 85", () => {
    const { container } = render(<SessionContext sessionId="s" tokens={8500} max={10000} pct={85} />);
    expect(container.querySelector(".tone-danger")).toBeTruthy();
  });

  it("survives a status message with no token count", () => {
    // No error boundary sits above this in the app, so a field that
    // arrives absent must not unmount the whole window. The types
    // promise numbers; the wire does not.
    const { container } = render(
      <SessionContext
        sessionId="s"
        tokens={undefined as unknown as number}
        max={undefined as unknown as number}
        pct={undefined as unknown as number}
      />,
    );
    expect(container.querySelector(".session-ctx")).toBeTruthy();
    expect(dash(container)[0]).toBe(0); // an empty ring, not a crash
  });

  it("clamps pct above 100 to a full ring", () => {
    const { container } = render(<SessionContext sessionId="s" tokens={120_000} max={100_000} pct={120} />);
    const [drawn, circ] = dash(container);
    expect(drawn).toBeCloseTo(circ); // full circle, not more
  });

  it("clamps negative pct to an empty ring", () => {
    const { container } = render(<SessionContext sessionId="s" tokens={0} max={10000} pct={-5} />);
    expect(dash(container)[0]).toBe(0);
  });

  it("the readout shows the session and the exact count when opened", () => {
    const { container } = render(
      <SessionContext sessionId="abcd1234ef56789" tokens={42_000} max={100_000} pct={42} />,
    );
    fireEvent.click(container.querySelector(".session-ctx")!);
    const pop = screen.getByRole("dialog", { name: "Session and context" });
    expect(pop.textContent).toContain("abcd1234");
    expect(pop.textContent).toContain("42,000");
    expect(pop.textContent).toContain("100,000");
    expect(pop.textContent).toContain("42%");
  });

  it("copies the FULL id from the readout (not the short prefix)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = render(
      <SessionContext sessionId="abcd1234ef56789" tokens={0} max={100} pct={0} />,
    );
    fireEvent.click(container.querySelector(".session-ctx")!);
    fireEvent.click(container.querySelector(".session-ctx-copy")!);
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("abcd1234ef56789");
  });

  it("title attr includes the raw token count + max for hover precision", () => {
    const { container } = render(<SessionContext sessionId="s" tokens={42_000} max={100_000} pct={42} />);
    const title = container.querySelector(".session-ctx")?.getAttribute("title");
    expect(title).toContain("42,000");
    expect(title).toContain("100,000");
  });

  it("title attr omits max when max is 0 (no model context window known)", () => {
    const { container } = render(<SessionContext sessionId="s" tokens={1234} max={0} pct={0} />);
    const title = container.querySelector(".session-ctx")?.getAttribute("title");
    expect(title).toContain("1,234");
    expect(title).not.toContain(" of 0");
  });
});
