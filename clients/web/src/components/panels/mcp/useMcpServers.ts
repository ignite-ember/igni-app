/** The MCP page's data: the servers, connecting them, and hiding their tools. */

import { useCallback, useEffect, useState } from "react";
import type { IgniClient } from "../../../protocol/client";
import { McpServer } from "./mcpServer";

export interface McpServers {
  /** ``null`` until the first read lands. */
  servers: McpServer[] | null;
  /** The server whose connect or disconnect is in flight. */
  busy: string | null;
  /** Why the list could not be read, or ``""``. */
  loadError: string;
  /** Why the last connect or tool change failed, or ``""``. */
  actionError: string;
  toggle: (server: McpServer) => void;
  setToolEnabled: (serverName: string, tool: string, enabled: boolean) => void;
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useMcpServers(client: IgniClient): McpServers {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

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

  return {
    servers,
    busy,
    loadError,
    actionError,
    toggle: (server) => void toggle(server),
    setToolEnabled: (serverName, tool, enabled) =>
      void setToolEnabled(serverName, tool, enabled),
  };
}
