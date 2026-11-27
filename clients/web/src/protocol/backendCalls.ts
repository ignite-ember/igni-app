/**
 * The backend calls igni's own UI makes by name, each answer parsed into
 * a typed model.
 *
 * Built over {@link RpcTransport}, not inside the transport: correlating
 * frames on a socket and knowing what ``search_chat`` returns are two
 * jobs. Reached as ``IgniClient.calls``.
 */

import { bytesToBase64 } from "../lib/base64";
import {
  ChatSearchMatch,
  FileCompletions,
  GlobalChatSearchMatch,
  LoginStarted,
  PlanDecision,
  ShellOutput,
  TerminalOpened,
} from "./backendCallResults";
import {
  MAX_ATTACHMENT_BYTES,
  ModelRegistryResponse,
  SearchCodeResponse,
  UploadAttachmentResponse,
  failureReason,
  type CodeSearchResult,
  type ModelRegistryResult,
  type UploadResult,
} from "./composerWire";

/** What these calls need of the transport: send one RPC, get back an
 *  answer this class parses. */
export interface RpcTransport {
  rpc(method: string, args?: Record<string, unknown>): Promise<unknown>;
}

export class BackendCalls {
  constructor(private readonly transport: RpcTransport) {}

  /** @-mention file completions (BE-side FileIndex). */
  async completeFiles(query: string, limit = 50): Promise<FileCompletions> {
    return FileCompletions.parse(await this.transport.rpc("complete_files", { query, limit }));
  }

  /** Ship a file from the OS to the backend, which writes it under the
   *  session's attachments folder and answers with its path. */
  async uploadAttachment(file: File): Promise<UploadResult> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, reason: `${file.name} is too large (${file.size} bytes)` };
    }
    try {
      const content_base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const res = UploadAttachmentResponse.parse(
        await this.transport.rpc("upload_attachment", { filename: file.name, content_base64 }),
      );
      if (res.error) return { ok: false, reason: res.error };
      if (!res.path) return { ok: false, reason: `no path came back for ${file.name}` };
      return { ok: true, path: res.path };
    } catch (e) {
      return { ok: false, reason: failureReason(e) };
    }
  }

  /**
   * Where in the repository a pasted snippet appears. igni-core's
   * `SearchCodeArgs` names the snippet `query` and refuses any other key,
   * so a call that sent `{ snippet }` failed every time and no code pill
   * was ever made.
   */
  async searchCode(snippet: string): Promise<CodeSearchResult> {
    try {
      const res = SearchCodeResponse.parse(await this.transport.rpc("search_code", { query: snippet }));
      return { ok: true, matches: res.matches };
    } catch (e) {
      return { ok: false, reason: failureReason(e) };
    }
  }

  /** The models the picker offers, by name, with the default marked. */
  async modelRegistry(): Promise<ModelRegistryResult> {
    try {
      const reg = ModelRegistryResponse.parse(await this.transport.rpc("get_model_registry"));
      if (!reg) return { ok: false, reason: "no model registry came back" };
      return { ok: true, models: reg.choices() };
    } catch (e) {
      return { ok: false, reason: failureReason(e) };
    }
  }

  /**
   * Case-insensitive substring search over the persisted history of
   * ``sessionId`` (Agno SQLite session). Cheap for any reasonable
   * conversation length — the BE walks pre-deserialized turn dicts.
   *
   * ``historyIndex`` aligns with ``get_chat_history``'s emission
   * order; the caller maps it to its in-memory items list through
   * the parallel ``historyIndex → itemIndex`` map it builds at
   * session-load time.
   */
  async searchChat(sessionId: string, query: string, limit = 50): Promise<ChatSearchMatch[]> {
    return ChatSearchMatch.parseList(
      await this.transport.rpc("search_chat", { session_id: sessionId, query, limit }),
    );
  }

  /** Search across every session in the project; each hit says which
   *  session it was found in so the caller can open it. */
  async searchAllChats(query: string, limit = 50): Promise<GlobalChatSearchMatch[]> {
    return GlobalChatSearchMatch.parseList(
      await this.transport.rpc("search_all_chats", { query, limit }),
    );
  }

  /** $-prefix shell mode — captured output from the BE. */
  async runShell(command: string): Promise<ShellOutput> {
    return ShellOutput.parse(await this.transport.rpc("run_shell", { command }));
  }

  /**
   * Start the browser login flow. Progress arrives as push
   * notifications on channels `login_status` / `login_result`.
   */
  async login(): Promise<LoginStarted> {
    return LoginStarted.parse(await this.transport.rpc("login", {}));
  }

  /**
   * Record the user's approval of the plan submitted in ``runId``.
   * BE persists the decision (survives reload), flips
   * ``permission_mode`` → default, then broadcasts ``plan_decided``
   * so the PlanCard's footer text catches up. The wake-up
   * message that tells the agent to execute the plan is sent
   * separately by the caller — keeping it FE-driven so it lands
   * in the chat transcript like a user-typed continuation.
   */
  async approvePlan(runId: string): Promise<PlanDecision> {
    return PlanDecision.parse(await this.transport.rpc("approve_plan", { run_id: runId }));
  }

  /**
   * Record the user's dismissal (Refine click). BE persists the
   * decision and emits ``plan_decided``; permission mode stays
   * in ``plan`` so the user can iterate.
   */
  async dismissPlan(runId: string): Promise<PlanDecision> {
    return PlanDecision.parse(await this.transport.rpc("dismiss_plan", { run_id: runId }));
  }

  /**
   * Start an interactive shell for this window, sized ``cols`` × ``rows``.
   * Its output arrives on the ``terminal_output`` push channel and its
   * end on ``terminal_exited``, both addressed to this window only.
   */
  async terminalOpen(cols: number, rows: number): Promise<TerminalOpened> {
    return TerminalOpened.parse(await this.transport.rpc("terminal_open", { cols, rows }));
  }

  /** Keystrokes (or a paste) for the terminal, as the text xterm made of them. */
  async terminalInput(terminalId: string, data: string): Promise<void> {
    await this.transport.rpc("terminal_input", { terminal_id: terminalId, data });
  }

  /** The terminal's new size, after the pane was resized. */
  async terminalResize(terminalId: string, cols: number, rows: number): Promise<void> {
    await this.transport.rpc("terminal_resize", { terminal_id: terminalId, cols, rows });
  }

  /** End the terminal's shell. */
  async terminalClose(terminalId: string): Promise<void> {
    await this.transport.rpc("terminal_close", { terminal_id: terminalId });
  }
}
