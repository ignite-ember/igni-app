/**
 * TypeScript mirror of igni-core's BE→FE messages
 * (``igni_core/protocol/schemas/``). What this client sends is in
 * ``clientMessages.ts``.
 *
 * Wire format: one JSON object per WebSocket text frame; the `type`
 * field discriminates. Field names match the Pydantic models exactly —
 * this file must stay in lockstep with the Python side.
 */

/** The fields every message carries, either direction. Each message
 *  declares its own literal ``type``; there is no ``type: string`` here
 *  to widen the discriminant. */
export interface BaseMessage {
  /** Correlation id for request/response and stream grouping. */
  id?: string;
  /** Session routing: which session a message targets (FE→BE) or
   *  was emitted by (BE→FE). Empty = default session / global. */
  session_id?: string;
}

// ── BE → FE streaming events ────────────────────────────────────────

export interface ContentDelta extends BaseMessage {
  type: "content_delta";
  text: string;
  is_thinking: boolean;
}

export interface ToolStarted extends BaseMessage {
  type: "tool_started";
  tool_name: string;
  friendly_name: string;
  args_summary: string;
  run_id: string;
}

/** BE diff rows are (display_text, rich_style) pairs; the text embeds
 * the +/- prefix and line number (see _format_edit_diff). */
export type DiffRow = [text: string, style: string];

export interface ToolCompleted extends BaseMessage {
  type: "tool_completed";
  summary: string;
  full_result: string;
  run_id: string;
  has_markup: boolean;
  diff_rows: DiffRow[] | null;
  is_error: boolean;
  /** Never ran: rejected in the approval dialog, or nobody could be asked. */
  is_rejected?: boolean;
}

export interface ToolError extends BaseMessage {
  type: "tool_error";
  error: string;
  run_id: string;
}

export interface ModelCompleted extends BaseMessage {
  type: "model_completed";
  input_tokens: number;
  output_tokens: number;
  run_id: string;
  parent_run_id: string | null;
}

export interface RunStarted extends BaseMessage {
  type: "run_started";
  agent_name: string;
  run_id: string;
  parent_run_id: string | null;
  model: string;
}

export interface RunCompleted extends BaseMessage {
  type: "run_completed";
  run_id: string;
  parent_run_id: string | null;
  input_tokens: number;
  output_tokens: number;
  /** Subset of ``output_tokens`` spent on the model's reasoning chain
   *  (thinking). Visible reply tokens = ``output_tokens - reasoning_tokens``. */
  reasoning_tokens?: number;
  /** Run wall-clock seconds (Agno run metrics). */
  duration: number;
}

export interface StreamingDone extends BaseMessage {
  type: "streaming_done";
  run_id: string;
}

export interface RunError extends BaseMessage {
  type: "run_error";
  error: string;
}

export interface ReasoningStarted extends BaseMessage {
  type: "reasoning_started";
  run_id: string;
}

export interface HITLRequest extends BaseMessage {
  type: "hitl_request";
  requirement_id: string;
  tool_name: string;
  friendly_name: string;
  tool_args: Record<string, unknown>;
  details: string;
  /** ``details`` is still being written (the safety check asks the
   *  model to describe the call); a ``requirement_details`` follows. */
  details_pending?: boolean;
  /** Parent → leaf, e.g. ["igni", "safety check"]; empty for igni's
   *  own agent. */
  agent_path: string[];
}

export interface RunPaused extends BaseMessage {
  type: "run_paused";
  run_id: string;
  requirements: HITLRequest[];
}

export type CommandResultKind = "markdown" | "info" | "error" | "action";

export type CommandAction =
  | ""
  | "none"
  | "quit"
  | "clear"
  | "fork"
  | "sessions"
  | "model"
  | "model_switched"
  | "login"
  | "logout"
  | "help"
  | "mcp"
  | "plugins"
  | "extensions"
  | "agents"
  | "skills"
  | "hooks"
  | "loop"
  | "schedule"
  | "watcher"
  | "compact"
  | "ctx"
  | "programs"
  | "run_prompt";

export interface CommandResult extends BaseMessage {
  type: "command_result";
  kind: CommandResultKind;
  content: string;
  action: CommandAction;
  display_content: string;
}

/** The backend's permission modes (``PermissionModeName``). */
export const PERMISSION_MODE_NAMES = [
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
  "dontAsk",
] as const;

export type PermissionModeName = (typeof PERMISSION_MODE_NAMES)[number];

export interface StatusUpdate extends BaseMessage {
  type: "status_update";
  input_tokens: number;
  output_tokens: number;
  context_tokens: number;
  max_context: number;
  model: string;
  /** Whether a run would reach a real model rather than the BE's
   *  ``NoModelConfigured`` placeholder. Read it instead of comparing
   *  ``model`` against the placeholder's id string — that made a
   *  sentinel into a contract between two files that did not know they
   *  shared one. */
  model_configured: boolean;
  cloud_connected: boolean;
  cloud_org: string;
  /** The signed-in account's address. On disk, so it is present
   *  on the first status push rather than after a round trip. */
  cloud_email?: string;
  /** Display name, once `/portal/me` has been asked. */
  cloud_name?: string;
  /** Active permission mode. ``plan`` triggers the PlanBadge in the
   *  header. */
  permission_mode: PermissionModeName;
  /** Brand overrides from the signed-in user's group; null means
   *  igni's own palette. Values are untrusted here: `lib/theme.ts`
   *  validates each one against its allowlist before applying it. */
  theme: GroupTheme | null;
}

/** Brand overrides a group can set. Every field optional; anything
 *  unset falls back to what igni ships. */
export interface GroupTheme {
  accent?: string | null;
  danger?: string | null;
  success?: string | null;
  brand_name?: string | null;
  brand_mark?: string | null;
}

export interface Info extends BaseMessage {
  type: "info";
  text: string;
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  text: string;
}

export interface StreamEnd extends BaseMessage {
  type: "stream_end";
}

export interface RPCResponse extends BaseMessage {
  type: "rpc_response";
  result: unknown;
  error: string | null;
}

/** A broadcast on one channel, as it arrives: the producer set is open
 *  on the backend, so ``payload`` is unread here. Nothing reads it
 *  directly — ``parsePushChannel`` (``pushChannels.ts``) and the
 *  feature parsers turn a known channel into its typed event. */
export interface PushNotification extends BaseMessage {
  type: "push_notification";
  channel: string;
  payload: unknown;
}

// ── Multi-client session mirroring ──────────────────────────────────

export interface Welcome extends BaseMessage {
  type: "welcome";
  client_id: string;
}

export interface Typing extends BaseMessage {
  type: "typing";
  text: string;
  client_id: string;
}

export interface UserMessageReceived extends BaseMessage {
  type: "user_message_received";
  text: string;
  client_id: string;
  queued: boolean;
  /** Set when an extension posted it (`host.chat.post`). */
  extension_id?: string;
  /** Set, with `extension_id`, when the extension's service sent it: the service's client id. */
  service_client_id?: string;
}

export interface RequirementResolved extends BaseMessage {
  type: "requirement_resolved";
  requirement_id: string;
}

/** The reason for an open approval, arriving after its dialog — the
 *  safety check's description of the call. Replaces the spinner. */
export interface RequirementDetails extends BaseMessage {
  type: "requirement_details";
  requirement_id: string;
  details: string;
}

export type ServerMessage =
  | ContentDelta
  | ToolStarted
  | ToolCompleted
  | ToolError
  | ModelCompleted
  | RunStarted
  | RunCompleted
  | StreamingDone
  | RunError
  | ReasoningStarted
  | HITLRequest
  | RunPaused
  | CommandResult
  | StatusUpdate
  | Info
  | ErrorMessage
  | StreamEnd
  | RPCResponse
  | PushNotification
  | Welcome
  | Typing
  | UserMessageReceived
  | RequirementResolved
  | RequirementDetails;
