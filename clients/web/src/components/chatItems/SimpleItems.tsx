/** The transcript rows that are one line of text. */

import { CopyButton } from "../CopyButton";
import { formatStats } from "../statsLine";
import type { ItemRendererProps } from "./handlers";

export function AgentLine({ item }: ItemRendererProps<"agent">) {
  return <div className="agent-dispatch">{item.text}</div>;
}

export function InfoLine({ item }: ItemRendererProps<"info">) {
  return <div className="msg-info">{item.text}</div>;
}

export function ErrorLine({ item }: ItemRendererProps<"error">) {
  return <div className="msg-error">{item.text}</div>;
}

/** A legacy item: attached files render as pills inside the user bubble. */
export function AttachmentsLine(_props: ItemRendererProps<"attachments">) {
  return null;
}

/** A run's token and time totals, with a button that copies the reply
 *  the run produced when the caller found one. */
export function StatsLine({ item, copyResponseText }: ItemRendererProps<"stats">) {
  return (
    <div className={`agent-dispatch${copyResponseText ? " agent-dispatch--with-copy" : ""}`}>
      <span>{formatStats(item)}</span>
      {copyResponseText ? (
        <CopyButton className="msg-stats-copy" idleLabel="Copy response" text={copyResponseText} />
      ) : null}
    </div>
  );
}
