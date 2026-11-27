/** Small pieces the MCP card and page share: the status chip and the plug. */

import { HeroChip } from "../../page/HeroChip";
import type { McpServerState } from "./mcpServerState";

/** The status as a chip with its coloured dot. */
export function McpStatusChip({ state }: { state: McpServerState }) {
  return (
    <HeroChip>
      <span className={`tool-status mcp-dot ${state.dot}`} aria-hidden="true" />
      {state.label}
    </HeroChip>
  );
}

/** A plug: "connect"; struck through: "disconnect". */
export function PlugGlyph({ off = false }: { off?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0V5zM8 11v3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {off && <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}
