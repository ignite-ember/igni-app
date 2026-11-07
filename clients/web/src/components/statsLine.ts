/**
 * The text of a run's stats line. ``think`` and ``out`` are estimated
 * from the rendered text; the billed totals go in the tooltip.
 */

import type { StatsItem } from "../chat/chatItem";

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function duration(seconds: number): string {
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return seconds > 0 ? `${seconds.toFixed(1)}s` : "";
}

export function formatStats(stats: StatsItem): string {
  const parts = [`${compact(stats.inputTokens)} in`];
  if (stats.visibleThinkTokens > 0) parts.push(`${compact(stats.visibleThinkTokens)} think`);
  parts.push(`${compact(stats.visibleOutTokens)} out`);
  const took = duration(stats.duration);
  if (took) parts.push(took);
  return parts.join(" · ");
}
