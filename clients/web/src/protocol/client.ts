/**
 * IgniClient — WebSocket protocol client for the igni backend.
 *
 * Responsibilities:
 *  - connect/reconnect to `python -m igni_core.backend --ws-port N`
 *  - correlate request/response pairs and streams via the `id` field
 *    ({@link ReplyCorrelator})
 *  - fan out uncorrelated events (status updates, push notifications)
 *  - the protocol messages igni's UI sends (runs, commands, HITL, …)
 *
 * Where to connect, and with which token, is {@link resolveWsUrl} and
 * {@link resolveWsToken}. The named RPCs (`search_chat`, `run_shell`, …)
 * and their typed answers are {@link BackendCalls}, reached as `calls`.
 */

import { BackendCalls } from "./backendCalls";
import { ExtensionCaller } from "./extensionCaller";
import { fe, type ClientMessage, type HITLDecision } from "./clientMessages";
import type { ServerMessage } from "./messages";
import { ReplyCorrelator, type StreamHandler } from "./replyCorrelator";
import { RPC_TIMEOUT_MS, type RpcCaller } from "./rpcCaller";
import { TypingThrottle } from "./typingThrottle";
import { resolveWsToken, resolveWsUrl, wsProtocols } from "./wsEndpoint";

export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  /** Displaced by a newer tab (close 1008); no auto-reconnect. */
  | "replaced";

export class IgniClient implements RpcCaller {
  private ws: WebSocket | null = null;
  private closed = false;
  private readonly replies = new ReplyCorrelator();
  /** Uncorrelated event listeners (status updates, pushes, HITL...). */
  private readonly eventListeners = new Set<StreamHandler>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();
  private reconnectDelay = 500;
  /** The pending reconnect, cancelled by close() so a closed client opens no socket. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Per-client counter behind {@link nextId}. */
  private idSeq = 0;
  private readonly typing = new TypingThrottle((text) => {
    try {
      this.send(fe.typing(text, this.clientId));
    } catch {
      /* disconnected — drafts are best-effort */
    }
  });

  /** The named backend calls, with typed answers. */
  readonly calls = new BackendCalls(this);

  /** This view's id from the BE's Welcome; used to skip our own echoes. */
  clientId = "";

  /** Bound session: stamped on outgoing messages, filters incoming events. Empty = BE default. */
  sessionId = "";

  constructor(
    private readonly url: string = resolveWsUrl(),
    private readonly token: string = resolveWsToken(),
  ) {}

  connect(): void {
    this.cancelReconnect(); // a queued retry would open a second socket
    this.closed = false; // StrictMode remounts after close()
    // Drop the old socket first, or it can take the BE's single-client slot.
    const old = this.ws;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try {
        old.close();
      } catch {
        /* already closed */
      }
    }

    this.emitState("connecting");
    const protocols = wsProtocols(this.token);
    const ws = protocols
      ? new WebSocket(this.url, protocols)
      : new WebSocket(this.url);
    this.ws = ws;
    // Handlers ignore events from a replaced socket.
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectDelay = 500;
      this.emitState("connected");
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.dispatch(JSON.parse(ev.data as string) as ServerMessage);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.replies.failAll(new Error("connection closed"));
      // 1008: another tab took the slot; reconnecting would start a war.
      if (ev.code === 1008) {
        this.closed = true;
        this.emitState("replaced");
        return;
      }
      this.emitState("disconnected");
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5_000);
      }
    };
    ws.onerror = () => {
      // onclose follows; reconnect handled there.
    };
  }

  close(): void {
    this.closed = true;
    this.cancelReconnect();
    this.ws?.close();
  }

  onEvent(fn: StreamHandler): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onStateChange(fn: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  // ── Core flows ────────────────────────────────────────────────────

  /** Send a user message, streaming its run to `onMessage` until `stream_end`.
   *  `force` supersedes interrupted rows (the Retry action). */
  runMessage(
    text: string,
    onMessage: StreamHandler,
    fileContents?: Record<string, string>,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const id = this.nextId("run");
    return this.stream(
      fe.userMessage(text, id, this.clientId, fileContents, options),
      id,
      onMessage,
    );
  }

  /** Queue a message while a run is in flight. Fire-and-forget. */
  queueMessage(text: string): void {
    this.send(fe.queueMessage(text, this.clientId));
  }

  /** Broadcast the composer draft, throttled by {@link TypingThrottle}. */
  sendTyping(text: string): void {
    this.typing.push(text);
  }

  /** Execute a slash command; request/reply, resolves with the CommandResult. */
  handleCommand(text: string): Promise<ServerMessage> {
    const id = this.nextId("cmd");
    return this.request(fe.command(text, id), id);
  }

  /** Resolve a batch of HITL requirements; streams the resumed run. */
  resolveHitlBatch(
    decisions: HITLDecision[],
    onMessage: StreamHandler,
  ): Promise<void> {
    const id = this.nextId("hitl");
    return this.stream(fe.hitlResponseBatch(decisions, id), id, onMessage);
  }

  cancel(): void {
    this.send(fe.cancel());
  }

  /** Switch model — request/reply, resolves with the BE's Info ack. */
  switchModel(modelName: string): Promise<ServerMessage> {
    const id = this.nextId("model");
    return this.request(fe.modelSwitch(modelName, id), id);
  }

  cancelLogin(): void {
    this.send(fe.cancelLogin());
  }

  mcpToggle(serverName: string, connect: boolean): Promise<ServerMessage> {
    const id = this.nextId("mcp");
    return this.request(fe.mcpToggle(serverName, connect, id), id);
  }

  /** Generic RPC correlated by id: an `rpc_response` resolves to its result, a typed
   *  reply as itself. `T` is unchecked; parse answers via {@link BackendCalls}. */
  async rpc<T = unknown>(
    method: string,
    args: Record<string, unknown> = {},
    timeoutMs: number = RPC_TIMEOUT_MS,
    /** Asking extension, omitted for igni's own UI; set via {@link asExtension}. */
    caller?: string,
  ): Promise<T> {
    const id = this.nextId("rpc");
    const reply = await this.replies.request(
      id,
      () => this.send(fe.rpcRequest(method, args, id, caller)),
      timeoutMs,
      `RPC ${method} timed out`,
    );
    if (reply.type !== "rpc_response") return reply as T;
    if (reply.error) throw new Error(reply.error);
    return reply.result as T;
  }

  /** This client speaking for one extension, so the BE can enforce its `permissions.rpc`. */
  asExtension(extensionId: string): ExtensionCaller {
    return new ExtensionCaller(this, extensionId);
  }

  // ── Internals ─────────────────────────────────────────────────────

  private nextId(prefix: string): string {
    this.idSeq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.idSeq}`;
  }

  /** One-shot request/reply correlated by id. */
  private request(payload: ClientMessage, id: string): Promise<ServerMessage> {
    return this.replies.request(
      id,
      () => this.send(payload),
      RPC_TIMEOUT_MS,
      "request timed out",
    );
  }

  private stream(
    payload: ClientMessage,
    id: string,
    onMessage: StreamHandler,
  ): Promise<void> {
    return this.replies.stream(id, () => this.send(payload), onMessage);
  }

  private send(payload: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("not connected to backend");
    }
    this.ws.send(JSON.stringify(this.routed(payload)));
  }

  /** A copy of ``payload`` stamped with the bound session unless it names one. */
  private routed(payload: ClientMessage): ClientMessage {
    if (payload.session_id || !this.sessionId) return payload;
    return { ...payload, session_id: this.sessionId };
  }

  private dispatch(msg: ServerMessage): void {
    if (msg.type === "welcome") {
      this.clientId = msg.client_id;
    }

    // Replies to our requests win over the session filter.
    if (this.replies.deliver(msg)) return;

    // Broadcasts from other sessions are dropped; unstamped ones pass.
    if (msg.session_id && this.sessionId && msg.session_id !== this.sessionId) {
      return;
    }

    for (const fn of this.eventListeners) fn(msg);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitState(s: ConnectionState): void {
    for (const fn of this.stateListeners) fn(s);
  }
}
