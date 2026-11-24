/** The MCP page's data: the servers, connecting them, and hiding their tools. */

import { useCallback, useEffect, useState } from "react";
import type { IgniClient } from "../../../protocol/client";
import { McpApproval } from "./mcpApproval";
import { McpServer } from "./mcpServer";

export interface McpServers {
  /** ``null`` until the first read lands. */
  servers: McpServer[] | null;
  /** First-use approvals by server name: a project's or a plugin's
   *  server never connects until approved. Empty when the backend does
   *  not list them. */
  approvals: ReadonlyMap<string, McpApproval>;
  /** The server whose connect, disconnect or approval is in flight. */
  busy: string | null;
  /** Why the list could not be read, or ``""``. */
  loadError: string;
  /** Why the last connect or tool change failed, or ``""``. */
  actionError: string;
  toggle: (server: McpServer) => void;
  setToolEnabled: (serverName: string, tool: string, enabled: boolean) => void;
  /** Approve a server and connect it, or withdraw its approval, which
   *  disconnects it. */
  setApproval: (serverName: string, approved: boolean) => void;
  /** Re-read the `.mcp.json` files and the list: a server added, edited
   *  or removed since the backend started takes effect. */
  reload: () => void;
  /** Whether a reload is in flight. */
  reloading: boolean;
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useMcpServers(client: IgniClient): McpServers {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [approvals, setApprovals] = useState<ReadonlyMap<string, McpApproval>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [reloading, setReloading] = useState(false);

  // `ensure_mcp` re-reads the config files on every call, so a refresh is
  // also the reload; this only says it is happening.
  const refresh = useCallback(async () => {
    try {
      await client.rpc("ensure_mcp");
      setServers(
        McpServer.parseList(await client.rpc("get_mcp_server_details")),
      );
      setLoadError("");
    } catch (e) {
      setServers([]);
      setLoadError(`Could not read the MCP servers: ${reason(e)}`);
    }
    try {
      setApprovals(McpApproval.parseMap(await client.rpc("list_mcp_approvals")));
    } catch {
      // A backend without approvals to list: nothing waits on one here.
      setApprovals(new Map());
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (server: McpServer) => {
    setBusy(server.name);
    setActionError("");
    const verb = server.connected ? "disconnect" : "connect";
    try {
      await client.mcpToggle(server.name, !server.connected);
    } catch (e) {
      // The re-read below shows the server's real state, and its own
      // error when it has one; this says the request itself failed.
      setActionError(`Could not ${verb} ${server.name}: ${reason(e)}`);
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const setToolEnabled = async (
    serverName: string,
    tool: string,
    enabled: boolean,
  ) => {
    // Optimistic — flip the local set so the switch reacts instantly.
    setServers((prev) =>
      prev
        ? prev.map((s) =>
            s.name === serverName ? s.withTool(tool, enabled) : s,
          )
        : prev,
    );
    setActionError("");
    try {
      await client.rpc("set_mcp_tool_enabled", {
        server: serverName,
        tool,
        enabled,
      });
    } catch (e) {
      setActionError(`Could not change ${tool}: ${reason(e)}`);
      void refresh();
    }
  };

  const setApproval = async (serverName: string, approved: boolean) => {
    setBusy(serverName);
    setActionError("");
    try {
      await client.rpc("set_mcp_approval", { server_name: serverName, approved });
    } catch (e) {
      setActionError(
        `Could not ${approved ? "approve" : "withdraw the approval of"} ${serverName}: ${reason(e)}`,
      );
      setBusy(null);
      void refresh();
      return;
    }
    if (approved) {
      // Approving only records it; the server connects on the next connect.
      try {
        await client.mcpToggle(serverName, true);
      } catch (e) {
        setActionError(`Approved ${serverName}, but it did not connect: ${reason(e)}`);
      }
    }
    setBusy(null);
    void refresh();
  };

  const reload = async () => {
    setReloading(true);
    setActionError("");
    try {
      await refresh();
    } finally {
      setReloading(false);
    }
  };

  return {
    servers,
    approvals,
    busy,
    loadError,
    actionError,
    reload: () => void reload(),
    reloading,
    toggle: (server) => void toggle(server),
    setToolEnabled: (serverName, tool, enabled) =>
      void setToolEnabled(serverName, tool, enabled),
    setApproval: (serverName, approved) => void setApproval(serverName, approved),
  };
}
