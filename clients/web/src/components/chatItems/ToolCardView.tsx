/**
 * A tool call: chevron, status dot, name, truncated args, and the result
 * or diff behind the chevron. Top-level tools and a sub-agent's tools
 * inside a team card look the same.
 */

import { memo, useState } from "react";

import type { ToolItem, ToolStatus } from "../../chat/chatItem";
import type { DiffRow } from "../../protocol/messages";
import { ChevronIcon } from "../Icons";

function DiffTable({ rows }: { rows: DiffRow[] }) {
  return (
    <table className="diff-table">
      <tbody>
        {rows.map(([text], i) => (
          <tr key={i} className={text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : ""}>
            <td className="code">{text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ToolCardView({
  name,
  args,
  status,
  result,
  diffRows,
  agentName,
}: {
  name: string;
  args: string;
  status: ToolStatus;
  result: string;
  diffRows?: DiffRow[] | null;
  agentName?: string;
}) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(result || diffRows?.length);
  return (
    <div className="tool-card">
      <div className="tool-card-header" onClick={() => expandable && setOpen(!open)}>
        <span className={`tool-chevron ${open ? "open" : ""}`}>
          {expandable ? <ChevronIcon /> : null}
        </span>
        <span className={`tool-status ${status}`} />
        <span className="tool-name">{name}</span>
        <span className="tool-args">{args}</span>
        {status === "rejected" && <span className="tool-rejected-tag">Not run</span>}
        {agentName && (
          <span className="tool-agent-badge" title={`Called by sub-agent ${agentName}`}>
            {agentName}
          </span>
        )}
      </div>
      {open && diffRows?.length ? (
        <div className="tool-card-body">
          <DiffTable rows={diffRows} />
        </div>
      ) : open && result ? (
        <div className="tool-card-body">{result}</div>
      ) : null}
    </div>
  );
}

/** The ``tool`` item's renderer. */
export const ToolCard = memo(function ToolCard({ item }: { item: ToolItem }) {
  return (
    <ToolCardView
      name={item.name}
      args={item.args}
      status={item.status}
      result={item.result}
      diffRows={item.diffRows}
      agentName={item.agentName}
    />
  );
});
