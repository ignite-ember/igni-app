// @vitest-environment jsdom
/**
 * An extension page's `navigate` and `setLocation` reach the window.
 *
 * The frame delivered both messages and the app mounted the page without
 * the callbacks that answer them, so `bridge.navigate('plugins')` did
 * nothing and a `setLocation` was never kept or replayed (R405, R410).
 * Driven through `AppPages`, the one place the page is mounted, the way
 * a frame would: a `message` event carrying the nonce from `hello`.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_VERSION } from "@ignite-ember/extension-bridge/protocol";

import { PageRegistry, type PageRoute } from "../chat/pageStack";
import { AppPages, type PageServices } from "../components/AppPages";
import type { ExtensionSummary } from "./ExtensionPage";
import {
  LOCATION_LIMITS,
  keptLocation,
  pageLabel,
  routeForNavigate,
  routeWithLocation,
} from "./extensionPageRoutes";

afterEach(cleanup);

const ORIGIN = "http://127.0.0.1:41234";

const NOTES: ExtensionSummary = {
  id: "acme.notes",
  name: "Release notes",
  version: "1.0.0",
  state: "READY",
  reason: "",
  origin: ORIGIN,
  allow: [],
  pages: [{ kind: "acme.notes", label: "Release notes", sidebar: true, entry: "index.html" }],
  menu: [],
  indicators: [],
  settings: [],
  values: {},
};

function mountPage(page: PageRoute, trail: PageRoute[] = [page]) {
  const registry = new PageRegistry();
  registry.add("acme.notes", "acme.notes");
  const onRoute = vi.fn();
  const services = {
    client: { asExtension: () => ({ rpc: vi.fn(async () => null) }) },
    close: vi.fn(),
    seed: vi.fn(),
    compact: vi.fn(),
    resumeLoop: vi.fn(),
    extensions: [NOTES],
    setExtensions: vi.fn(),
    skills: [],
    maxContext: 0,
  } as unknown as PageServices;
  const { container } = render(
    <AppPages
      page={page}
      trail={trail}
      onCrumb={vi.fn()}
      onBack={vi.fn()}
      registry={registry}
      services={services}
      homeWindow="w-1"
      theme="dark"
      signals={{}}
      onRoute={onRoute}
    />,
  );
  const frame = container.querySelector("iframe") as HTMLIFrameElement;
  const posted = vi.fn();
  Object.defineProperty(frame.contentWindow!, "postMessage", { value: posted, writable: true });
  frame.dispatchEvent(new Event("load"));
  const hello = posted.mock.calls.map((c) => c[0]).find((m) => m.kind === "hello");
  const send = (body: Record<string, unknown>) => {
    const event = new MessageEvent("message", {
      data: { igni: BRIDGE_VERSION, nonce: hello.nonce, ...body },
      origin: ORIGIN,
    });
    Object.defineProperty(event, "source", { value: frame.contentWindow });
    window.dispatchEvent(event);
  };
  return { onRoute, send, posted, hello };
}

const NOTES_PAGE: PageRoute = { kind: "acme.notes", label: "Release notes" };

describe("bridge.navigate from an extension page", () => {
  it("opens the page it names", () => {
    const { onRoute, send } = mountPage(NOTES_PAGE);
    send({ kind: "navigate", to: "plugins" });
    expect(onRoute).toHaveBeenCalledWith([{ kind: "plugins", label: "Plugins" }]);
  });

  it("goes nowhere when the page does not exist", () => {
    const { onRoute, send } = mountPage(NOTES_PAGE);
    send({ kind: "navigate", to: "no-such-page" });
    expect(onRoute).not.toHaveBeenCalled();
  });
});

describe("bridge.setLocation from an extension page", () => {
  it("folds the location into the top page's params, keeping the trail", () => {
    const below: PageRoute = { kind: "extensions", label: "Extensions" };
    const { onRoute, send } = mountPage(NOTES_PAGE, [below, NOTES_PAGE]);
    send({ kind: "location", state: { version: "2.3.1" } });
    expect(onRoute).toHaveBeenCalledWith([below, { ...NOTES_PAGE, params: { version: "2.3.1" } }]);
  });

  it("is replayed in the next hello once the route carries it", () => {
    const { hello } = mountPage({ ...NOTES_PAGE, params: { version: "2.3.1" } });
    expect(hello.params).toEqual({ version: "2.3.1" });
  });
});

describe("the route rules", () => {
  it("labels igni's pages by their own names, an extension's by its label", () => {
    expect(pageLabel("mcp", [])).toBe("MCP servers");
    expect(pageLabel("acme.notes", [NOTES])).toBe("Release notes");
    expect(pageLabel("unknown", [])).toBe("unknown");
  });

  it("declines an empty target", () => {
    expect(routeForNavigate("", new PageRegistry(), [])).toBeNull();
  });

  it("has nowhere to fold a location with no page on top", () => {
    expect(routeWithLocation([], { a: "b" })).toBeNull();
  });

  it("keeps string values only, and caps what it keeps", () => {
    const big: Record<string, unknown> = { n: 3, long: "x".repeat(LOCATION_LIMITS.valueLength + 1) };
    big["k".repeat(LOCATION_LIMITS.keyLength + 1)] = "v";
    for (let i = 0; i < LOCATION_LIMITS.keys + 5; i++) big[`k${i}`] = String(i);
    const kept = keptLocation(big);
    expect(Object.keys(kept)).toHaveLength(LOCATION_LIMITS.keys);
    expect(kept.n).toBeUndefined();
    expect(kept.long).toBeUndefined();
    expect(kept.k0).toBe("0");
  });
});
