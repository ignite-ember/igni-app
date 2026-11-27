// @vitest-environment jsdom
/**
 * Component tests for ``PageShell`` — the breadcrumb trail.
 *
 * The trail is assembled from two sources that meet only here: the
 * page stack (which destination you are in) and the panel's own depth
 * (where you are inside it). Which one a crumb belongs to decides what
 * clicking it does, and getting that wrong is invisible until you
 * click — the first version of this silently dropped the panel's half
 * of the trail entirely, and only driving the real app showed it.
 *
 * Contracts worth pinning:
 *   • Both halves render, in order, under a Chat root.
 *   • The destination stops being the current crumb once the panel is
 *     deeper than its own root — and clicking it then asks the *panel*
 *     to go back, not the stack.
 *   • Esc pops one crumb, whichever half it came from.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PAGE_REST_SHIFT, PageShell } from "./PageShell";
import type { PageRoute } from "../chat/pageStack";

// This project does not set ``globals: true``, so testing-library's
// automatic afterEach cleanup is never installed and renders would
// otherwise accumulate across cases in one document.
afterEach(cleanup);

const trail: PageRoute[] = [{ kind: "plugins", label: "Plugins" }];

function setup(overrides: Partial<Parameters<typeof PageShell>[0]> = {}) {
  const props = {
    trail,
    onCrumb: vi.fn(),
    onBack: vi.fn(),
    onClose: vi.fn(),
    children: <div>body</div>,
    ...overrides,
  };
  render(<PageShell {...props} />);
  return props;
}

const crumbText = () =>
  Array.from(document.querySelectorAll(".page-crumb")).map((e) => e.textContent);

describe("the trail", () => {
  it("is Chat then the destination when the panel is at its root", () => {
    setup();
    expect(crumbText()).toEqual(["Chat", "Plugins"]);
  });

  it("appends the panel's own depth", () => {
    setup({ levels: { labels: ["acme-tools"], onTruncate: vi.fn() } });
    expect(crumbText()).toEqual(["Chat", "Plugins", "acme-tools"]);
  });

  it("titles the page after the deepest crumb", () => {
    setup({ levels: { labels: ["acme-tools"], onTruncate: vi.fn() } });
    expect(document.querySelector(".page-title")?.textContent).toBe("acme-tools");
  });
});

describe("clicking a crumb", () => {
  it("returns to the chat from the root crumb", () => {
    const props = setup();
    fireEvent.click(screen.getByText("Chat"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("asks the panel to go back when the destination is not the leaf", () => {
    // The destination and the panel's level are different halves of
    // one trail: only the panel can undo its own selection, so this
    // must not go to the stack.
    const onTruncate = vi.fn();
    const props = setup({ levels: { labels: ["acme-tools"], onTruncate } });
    fireEvent.click(screen.getByText("Plugins"));
    expect(onTruncate).toHaveBeenCalledWith(-1);
    expect(props.onCrumb).not.toHaveBeenCalled();
  });

  it("leaves the deepest crumb unclickable", () => {
    setup({ levels: { labels: ["acme-tools"], onTruncate: vi.fn() } });
    // Scoped to the crumb: the leaf's label is also the page title, so
    // a bare text query matches twice.
    const leaf = document.querySelector(".page-crumb.current");
    expect(leaf?.textContent).toBe("acme-tools");
    expect(leaf?.tagName).toBe("SPAN");
    expect(leaf?.getAttribute("aria-current")).toBe("page");
  });
});

describe("Esc", () => {
  it("pops the panel's level before leaving the destination", () => {
    const onTruncate = vi.fn();
    const props = setup({ levels: { labels: ["acme-tools"], onTruncate } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onTruncate).toHaveBeenCalledWith(-1);
    expect(props.onBack).not.toHaveBeenCalled();
  });

  it("leaves the destination once the panel is at its root", () => {
    const props = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onBack).toHaveBeenCalled();
  });

  it("defers to an open overflow menu that owns Esc", () => {
    // This listener is on the capture phase, so without the check it
    // would navigate away before the menu ever saw the key that was
    // meant to close it — one keypress doing two things.
    const props = setup();
    const menu = document.createElement("div");
    menu.className = "overflow-list";
    document.body.appendChild(menu);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onBack).not.toHaveBeenCalled();
    menu.remove();
  });

  it("defers to an overlay that owns Esc", () => {
    // A file preview sits on top and closes first — same rule
    // ``Drawer`` documents.
    const props = setup();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    document.body.appendChild(overlay);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onBack).not.toHaveBeenCalled();
    overlay.remove();
  });
});

describe("the head", () => {
  it("names the page by default", () => {
    setup();
    expect(document.querySelector(".page-title")?.textContent).toBe("Plugins");
  });

  it("is the window's level-one heading", () => {
    // The conversation behind a page is hidden, and with it the chat's
    // <h1>: a page titled with an <h2> left the window with no <h1>
    // for assistive technology (axe page-has-heading-one, R683).
    setup();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plugins");
  });

  it("keeps a level-one heading, out of sight, when the body carries the title", () => {
    setup({ titleInBody: true });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Plugins");
    expect(h1.classList.contains("sr-only")).toBe(true);
  });

  it("draws no title when the body carries its own", () => {
    // A document page opens with the document's name. Saying it again
    // in the bar above put it on screen twice, four lines apart.
    setup({ titleInBody: true });
    expect(document.querySelector(".page-title")).toBeNull();
  });

  it("drops the bar entirely when it would hold nothing", () => {
    // No title and no actions leaves a rule across an empty row.
    setup({ titleInBody: true });
    expect(document.querySelector(".page-head")).toBeNull();
  });

  it("keeps the bar for actions even with the title in the body", () => {
    setup({ titleInBody: true, headerExtras: <button>Sync</button> });
    expect(document.querySelector(".page-head")).toBeTruthy();
    expect(document.querySelector(".page-title")).toBeNull();
    expect(screen.getByRole("button", { name: "Sync" })).toBeTruthy();
  });

  it("leaves the trail alone — it is what still says where you are", () => {
    setup({ titleInBody: true });
    expect(crumbText()).toEqual(["Chat", "Plugins"]);
  });
});

describe("the body", () => {
  it("separates the element that scrolls from the one that holds the measure", () => {
    // Two elements, not one. They used to be a single centred box
    // that also scrolled, which put its scrollbar against the text
    // instead of at the window's edge. The CSS that widens a
    // comparison keys off this split too, so a collapse back to one
    // element takes the width with it.
    setup();
    const body = document.querySelector(".page-body");
    const measure = body?.querySelector(".page-measure");
    expect(body).toBeTruthy();
    expect(measure).toBeTruthy();
    expect(measure?.textContent).toBe("body");
  });
});

describe("scrolling under the header", () => {
  /** Renders the shell inside a ``.main``, as the app does. */
  function setupInMain(overrides: Partial<Parameters<typeof PageShell>[0]> = {}) {
    const main = document.createElement("main");
    main.className = "main main--paged";
    document.body.appendChild(main);
    const props = {
      trail,
      onCrumb: vi.fn(),
      onBack: vi.fn(),
      onClose: vi.fn(),
      children: <div>body</div>,
      ...overrides,
    };
    const view = render(<PageShell {...props} />, { container: main });
    const body = document.querySelector(".page-body") as HTMLElement;
    const scrollTo = (top: number) => {
      body.scrollTop = top;
      fireEvent.scroll(body);
    };
    return { main, body, scrollTo, view };
  }

  afterEach(() => {
    document.querySelectorAll("main").forEach((m) => m.remove());
  });

  it("scrolls the title row and the toolbar with the list", () => {
    // They go up under the app header with the content, the way the
    // chat's first message does, so both live inside the scroller.
    const { body } = setupInMain({ headerExtras: <button>Sync</button>, toolbar: <div>filters</div> });
    const kids = Array.from(body.children).map((e) => e.className);
    expect(kids).toEqual(["page-head", "page-toolbar", "page-measure"]);
    expect(document.querySelector(".page > .page-head, .page > .page-toolbar")).toBeNull();
  });

  it("lifts the fade and the blur clear of the title at rest", () => {
    const { main, body } = setupInMain();
    expect(main.style.getPropertyValue("--page-rest-shift")).toBe(`${PAGE_REST_SHIFT}px`);
    // No mask at all at rest: the page is the page it always was.
    expect(body.hasAttribute("data-scrolled")).toBe(false);
  });

  it("slides them into the chat's place over the first pixels of scroll", () => {
    const { main, body, scrollTo } = setupInMain();
    scrollTo(10);
    expect(main.style.getPropertyValue("--page-rest-shift")).toBe(`${PAGE_REST_SHIFT - 10}px`);
    expect(body.hasAttribute("data-scrolled")).toBe(true);
    scrollTo(500);
    expect(main.style.getPropertyValue("--page-rest-shift")).toBe("0px");
    scrollTo(0);
    expect(main.style.getPropertyValue("--page-rest-shift")).toBe(`${PAGE_REST_SHIFT}px`);
    expect(body.hasAttribute("data-scrolled")).toBe(false);
  });

  it("leaves nothing on .main when the page closes", () => {
    const { main, scrollTo, view } = setupInMain();
    scrollTo(500);
    view.unmount();
    expect(main.style.getPropertyValue("--page-rest-shift")).toBe("");
  });
});
