/**
 * The cloud's resync (design §4.3): after a node move the gateway
 * reconnects behind the window's socket and igni sends a new `welcome`.
 * The window must hear `connected` again — that is what re-binds its
 * session and hydrates its model — and an RPC the gateway answered with
 * "igni's connection was moved…" is a retry, not a failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    public url: string,
    public protocols?: string[],
  ) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {}
  send(data: string): void {
    this.sent.push(data);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

let IgniClient: typeof import("./client").IgniClient;
let ConnectionMovedError: typeof import("./client").ConnectionMovedError;

beforeEach(async () => {
  vi.resetModules();
  FakeWebSocket.instances = [];
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  (globalThis as { window?: unknown }).window = {
    location: { search: "" },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  (globalThis as { document?: unknown }).document = { querySelector: () => null };
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  ({ IgniClient, ConnectionMovedError } = await import("./client"));
});

afterEach(() => {
  delete (globalThis as { WebSocket?: unknown }).WebSocket;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
  vi.restoreAllMocks();
});

describe("a second welcome on the same socket", () => {
  it("is heard as connected again, with the new client id", () => {
    const client = new IgniClient("ws://127.0.0.1:1", "");
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive({ type: "welcome", client_id: "c-1" });
    expect(states).toEqual(["connecting", "connected"]);
    expect(client.clientId).toBe("c-1");
    expect(client.generation).toBe(1);

    ws.receive({ type: "welcome", client_id: "c-2" });
    expect(states).toEqual(["connecting", "connected", "connected"]);
    expect(client.clientId).toBe("c-2");
    expect(client.generation).toBe(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("is not counted twice on a new socket's first welcome", () => {
    const client = new IgniClient("ws://127.0.0.1:1", "");
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));
    client.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].receive({ type: "welcome", client_id: "a" });
    client.connect();
    FakeWebSocket.instances[1].open();
    FakeWebSocket.instances[1].receive({ type: "welcome", client_id: "b" });
    expect(states.filter((s) => s === "connected")).toHaveLength(2);
    expect(client.generation).toBe(2);
  });
});

describe("an RPC answered while the connection moved", () => {
  it("rejects with a retryable error, and other errors stay plain", async () => {
    const client = new IgniClient("ws://127.0.0.1:1", "");
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    const moved = client.rpc("list_sessions");
    const id = JSON.parse(ws.sent[0]).id;
    ws.receive({ type: "rpc_response", id, result: null, error: "igni's connection was moved to another node; try again" });
    const error = await moved.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionMovedError);
    expect((error as InstanceType<typeof ConnectionMovedError>).retryable).toBe(true);
    expect((error as Error).message).toMatch(/Try again/);

    const plain = client.rpc("list_sessions");
    const id2 = JSON.parse(ws.sent[1]).id;
    ws.receive({ type: "rpc_response", id: id2, result: null, error: "no such session" });
    const other = await plain.catch((e: unknown) => e);
    expect(other).not.toBeInstanceOf(ConnectionMovedError);
    expect((other as Error).message).toBe("no such session");
  });
});
