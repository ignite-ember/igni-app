/**
 * What this client sends: TypeScript mirror of igni-core's FE→BE
 * messages (``igni_core/protocol/schemas/fe_actions.py``), and the
 * {@link fe} builders that make them.
 */

import type { BaseMessage } from "./messages";

export interface HITLDecision {
  requirement_id: string;
  action: "confirm" | "reject";
  choice: "once" | "always" | "similar" | "";
  /**
   * Atomic mode flip carried with the decision. When set, the BE
   * applies the named mode to the session BEFORE resuming the agent,
   * so the next tool permission check sees the new mode. Closes a race
   * where a separate `/accept on` slash command fired alongside this
   * batch was dispatched concurrently and lost — the agent resumed
   * under the OLD mode and re-prompted.
   */
  set_permission_mode?: "acceptEdits" | "bypassPermissions";
}

export interface UserMessage extends BaseMessage {
  type: "user_message";
  id: string;
  text: string;
  file_contents: Record<string, string>;
  client_id: string;
  force: boolean;
}

export interface QueueMessage extends BaseMessage {
  type: "queue_message";
  text: string;
  client_id: string;
}

export interface TypingMessage extends BaseMessage {
  type: "typing";
  text: string;
  client_id: string;
}

export interface CommandMessage extends BaseMessage {
  type: "command";
  id: string;
  text: string;
}

export interface HITLResponseBatch extends BaseMessage {
  type: "hitl_response_batch";
  id: string;
  decisions: HITLDecision[];
}

export interface CancelMessage extends BaseMessage {
  type: "cancel";
}

export interface ModelSwitch extends BaseMessage {
  type: "model_switch";
  id: string;
  model_name: string;
}

export interface RPCRequest extends BaseMessage {
  type: "rpc_request";
  id: string;
  method: string;
  args: Record<string, unknown>;
  /**
   * Which extension's frame this came from.
   *
   * Absent for igni's own UI, and the backend refuses the `ext.*`
   * namespace without it: an extension reaches its own service and no
   * other, and with no caller there is nothing to check that against.
   */
  caller?: string;
}

export interface CancelLogin extends BaseMessage {
  type: "cancel_login";
}

export interface MCPToggle extends BaseMessage {
  type: "mcp_toggle";
  id: string;
  server_name: string;
  connect: boolean;
}

/** Anything this client sends. */
export type ClientMessage =
  | UserMessage
  | QueueMessage
  | TypingMessage
  | CommandMessage
  | HITLResponseBatch
  | CancelMessage
  | ModelSwitch
  | RPCRequest
  | CancelLogin
  | MCPToggle;

export const fe = {
  userMessage: (
    text: string,
    id: string,
    clientId = "",
    fileContents: Record<string, string> = {},
    options: { force?: boolean } = {},
  ): UserMessage => ({
    type: "user_message",
    id,
    text,
    file_contents: fileContents,
    client_id: clientId,
    force: options.force ?? false,
  }),
  queueMessage: (text: string, clientId = ""): QueueMessage => ({
    type: "queue_message",
    text,
    client_id: clientId,
  }),
  typing: (text: string, clientId: string): TypingMessage => ({
    type: "typing",
    text,
    client_id: clientId,
  }),
  command: (text: string, id: string): CommandMessage => ({
    type: "command",
    id,
    text,
  }),
  hitlResponseBatch: (
    decisions: HITLDecision[],
    id: string,
  ): HITLResponseBatch => ({
    type: "hitl_response_batch",
    id,
    decisions,
  }),
  cancel: (): CancelMessage => ({ type: "cancel" }),
  modelSwitch: (modelName: string, id: string): ModelSwitch => ({
    type: "model_switch",
    id,
    model_name: modelName,
  }),
  rpcRequest: (
    method: string,
    args: Record<string, unknown>,
    id: string,
    caller?: string,
  ): RPCRequest => ({
    type: "rpc_request",
    id,
    method,
    args,
    ...(caller === undefined ? {} : { caller }),
  }),
  cancelLogin: (): CancelLogin => ({ type: "cancel_login" }),
  mcpToggle: (serverName: string, connect: boolean, id: string): MCPToggle => ({
    type: "mcp_toggle",
    id,
    server_name: serverName,
    connect,
  }),
};
