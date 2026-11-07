/**
 * igni's own navigation, before any extension adds to it.
 *
 * Constants: {@link Contributions} copies them and folds extensions in
 * beside them, so nothing ever writes to these.
 */

import type { SidebarLink, ToolsEntry } from "./contributions";

/** The destinations with a permanent seat in the sidebar, above the
 *  sessions: the places you go back to while working rather than
 *  configure once. The rest are in {@link BASE_TOOLS_MENU}. */
export const BASE_SIDEBAR_LINKS: readonly SidebarLink[] = [
  { kind: "plugins", label: "Plugins" },
  { kind: "mcp", label: "MCPs" },
  { kind: "extensions", label: "Extensions" },
];

/** The header tools menu: each entry opens its feature's UI directly,
 *  with no slash command shown. */
export const BASE_TOOLS_MENU: readonly ToolsEntry[] = [
  { label: "MCP servers", command: "/mcp", desc: "connect external tools" },
  { label: "Agents", command: "/agents", desc: "agent pool" },
  { label: "Skills", command: "/skills", desc: "slash-command workflows" },
  { label: "Plugins", command: "/plugins", desc: "marketplaces & installs" },
  { label: "Extensions", command: "/extensions", desc: "installed extensions & their settings" },
  { label: "Hooks", command: "/hooks", desc: "pre/post tool hooks" },
  { label: "Loop", command: "/loop", desc: "recurring prompt status" },
  { label: "Scheduled tasks", command: "/schedule", desc: "background routines" },
  { label: "Workflows", command: "/workflows", desc: "multi-phase agent scripts" },
  { label: "Watcher", command: "/watcher", desc: "background processes & live logs" },
  { label: "Compact context", command: "/compact", desc: "summarize old turns" },
  { label: "Context breakdown", command: "/ctx", desc: "system vs runs token split" },
  { label: "Help", command: "/help", desc: "all commands" },
];
