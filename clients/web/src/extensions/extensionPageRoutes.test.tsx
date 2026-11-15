// @vitest-environment jsdom
/**
 * An extension page's `navigate` reaches the window.
 *
 * The frame delivered the message and the app mounted the page without
 * the callback that answers it, so `bridge.navigate('plugins')` did
 * nothing (R405).
 * Driven through `AppPages`, the one place the page is mounted, the way
 * a frame would: a `message` event carrying the nonce from `hello`.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_VERSION } from "@ignite-ember/extension-bridge/protocol";

import { PageRegistry, type PageRoute } from "../chat/pageStack";
import { AppPages, type PageServices } from "../components/AppPages";
import type { ExtensionSummary } from "./ExtensionPage";
import { pageLabel, routeForNavigate } from "./extensionPageRoutes";

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

describe("the route rules", () => {
  it("labels igni's pages by their own names, an extension's by its label", () => {
    expect(pageLabel("mcp", [])).toBe("MCP servers");
    expect(pageLabel("acme.notes", [NOTES])).toBe("Release notes");
    expect(pageLabel("unknown", [])).toBe("unknown");
  });

  it("declines an empty target", () => {
    expect(routeForNavigate("", new PageRegistry(), [])).toBeNull();
  });
});
