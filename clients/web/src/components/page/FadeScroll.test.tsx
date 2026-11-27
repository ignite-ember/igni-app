// @vitest-environment jsdom
/**
 * FadeScroll, rendered: the header row is fixed chrome outside the
 * scroller, a page without one scrolls under the app header, and the rest
 * state is what the stylesheet keys the fade on. (c) of the guards whose
 * static half is `fadeScroll.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { PageContext, PageShell } from "../PageShell";
import { Drawer } from "../panels/Drawer";
import { FADE_REST_SHIFT, FadeScroll } from "./FadeScroll";

afterEach(cleanup);

const trail = [{ kind: "plugins", label: "Plugins" }];

/** Header-row elements that are not fixed chrome: inside the scroller,
 *  or outside FadeScroll's chrome slot. */
function headerOffenders(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(".page-head, .page-toolbar")).filter(
    (el) => el.closest(".fade-scroll-body") !== null || el.closest(".fade-scroll-chrome") === null,
  );
}

function shell(props: Partial<Parameters<typeof PageShell>[0]> = {}) {
  return render(
    <PageShell trail={trail} onCrumb={vi.fn()} onBack={vi.fn()} onClose={vi.fn()} {...props}>
      <div>list</div>
    </PageShell>,
  ).container;
}

describe("(c) the header row is fixed chrome", () => {
  it.each([
    ["a title", {}],
    ["a title and actions", { headerExtras: <button>Sync</button> }],
    ["a title, actions and a toolbar", { headerExtras: <button>Sync</button>, toolbar: <div>filters</div> }],
    ["actions over a body with its own title", { titleInBody: true, headerExtras: <button>Sync</button> }],
  ])("with %s, it stays outside the scroller", (_name, props) => {
    const root = shell(props);
    expect(root.querySelector(".page-head")).not.toBeNull();
    expect(root.querySelector(".fade-scroll")?.getAttribute("data-fade")).toBe("chrome");
    expect(headerOffenders(root)).toEqual([]);
  });

  it("a page whose title is in its body scrolls under the app header", () => {
    const root = shell({ titleInBody: true });
    expect(root.querySelector(".fade-scroll")?.getAttribute("data-fade")).toBe("app");
    expect(root.querySelector(".fade-scroll-chrome, .page-head")).toBeNull();
  });

  it("holds for a panel's Drawer rendered as a page", () => {
    const { container } = render(
      <PageContext.Provider value={{ trail, onCrumb: vi.fn(), onBack: vi.fn(), onClose: vi.fn() }}>
        <Drawer title="MCPs" headerExtras={<button>Add</button>} toolbar={<div>filters</div>} onClose={vi.fn()}>
          <div>list</div>
        </Drawer>
      </PageContext.Provider>,
    );
    expect(container.querySelector(".page-body.fade-scroll-body")).not.toBeNull();
    expect(headerOffenders(container)).toEqual([]);
  });

  it("catches a header moved into the scroller", () => {
    const { container } = render(
      <FadeScroll>
        <div className="page-head">Plugins</div>
      </FadeScroll>,
    );
    expect(headerOffenders(container)).toHaveLength(1);
  });
});

describe("FadeScroll", () => {
  it("draws its chrome, its blur and its scroller in that order", () => {
    const { container } = render(<FadeScroll chrome={<div>row</div>}>list</FadeScroll>);
    const root = container.querySelector(".fade-scroll")!;
    expect(Array.from(root.children).map((e) => e.className)).toEqual([
      "fade-scroll-chrome",
      "fade-scroll-blur",
      "fade-scroll-body",
    ]);
    expect(root.querySelector(".fade-scroll-blur")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("writes the chrome's height for the fade to start under", () => {
    const { container } = render(<FadeScroll chrome={<div>row</div>}>list</FadeScroll>);
    const root = container.querySelector(".fade-scroll") as HTMLElement;
    // jsdom lays nothing out, so the height is 0 — but it is written.
    expect(root.style.getPropertyValue("--fade-chrome-h")).toBe("0px");
  });

  it("is at rest until the first scrolled pixel", () => {
    const { container } = render(<FadeScroll>list</FadeScroll>);
    const root = container.querySelector(".fade-scroll") as HTMLElement;
    const body = container.querySelector(".fade-scroll-body") as HTMLElement;
    expect(root.hasAttribute("data-scrolled")).toBe(false);
    expect(root.style.getPropertyValue("--fade-rest-shift")).toBe(`${FADE_REST_SHIFT}px`);
    body.scrollTop = 1;
    fireEvent.scroll(body);
    expect(root.hasAttribute("data-scrolled")).toBe(true);
    expect(root.style.getPropertyValue("--fade-rest-shift")).toBe(`${FADE_REST_SHIFT - 1}px`);
  });

  it("adds the caller's class to the scroller", () => {
    const { container } = render(<FadeScroll className="page-body">list</FadeScroll>);
    expect(container.querySelector(".fade-scroll-body")?.className).toBe("fade-scroll-body page-body");
  });
});
