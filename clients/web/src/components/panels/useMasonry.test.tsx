// @vitest-environment jsdom
/**
 * The masonry flow: each card spans its own height plus the gap, it
 * re-measures when a card resizes or the cards change, it tears down when
 * the grid goes, and without a ResizeObserver it leaves the grid alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { useMasonry } from "./useMasonry";

const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];

class FakeResizeObserver {
  disconnect = vi.fn();
  constructor(public callback: () => void) {
    observers.push(this);
  }
  observe() {}
}

/** Heights by card id, read through getBoundingClientRect. */
const heights: Record<string, number> = {};

function Grid({ ids, show = true }: { ids: string[]; show?: boolean }) {
  const flow = useMasonry();
  if (!show) return null;
  return (
    <div ref={flow} style={{ columnGap: "10px" }} data-testid="grid">
      {ids.map((id) => (
        <div key={id} data-id={id} />
      ))}
    </div>
  );
}

function stubLayout() {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return { height: heights[this.dataset.id ?? ""] ?? 0 } as DOMRect;
  });
}

const span = (id: string) =>
  (document.querySelector(`[data-id="${id}"]`) as HTMLElement).style.gridRowEnd;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  observers.length = 0;
});

describe("useMasonry", () => {
  it("spans each card its height plus the gap, rounded up to whole rows", () => {
    stubLayout();
    Object.assign(heights, { a: 86, b: 104.4 });
    render(<Grid ids={["a", "b"]} />);
    expect(span("a")).toBe("span 96");
    expect(span("b")).toBe("span 115");
  });

  it("re-measures when a card resizes", () => {
    stubLayout();
    Object.assign(heights, { a: 86 });
    render(<Grid ids={["a"]} />);
    heights.a = 334;
    act(() => observers[0].callback());
    expect(span("a")).toBe("span 344");
  });

  it("measures a card that arrives later", async () => {
    stubLayout();
    Object.assign(heights, { a: 50, c: 70 });
    const { rerender } = render(<Grid ids={["a"]} />);
    rerender(<Grid ids={["a", "c"]} />);
    // The MutationObserver reports on a microtask.
    await act(async () => {});
    expect(span("c")).toBe("span 80");
  });

  it("stops observing when the grid goes away", () => {
    stubLayout();
    const { rerender } = render(<Grid ids={["a"]} />);
    rerender(<Grid ids={["a"]} show={false} />);
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it("leaves the grid alone without a ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Grid ids={["a"]} />);
    expect(span("a")).toBe("");
  });
});
