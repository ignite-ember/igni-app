/**
 * The last few lines of a streaming text — a thought, a command's
 * output — small and muted, the oldest line fading out at the top.
 */

import { memo } from "react";

import { tailLines } from "../../chat/activitySteps";

export const LiveWindow = memo(function LiveWindow({
  text,
  lines,
  mono = false,
  className = "",
}: {
  text: string;
  /** How many lines it shows at most. */
  lines: number;
  /** Set for a command's output. */
  mono?: boolean;
  className?: string;
}) {
  const shown = tailLines(text, lines);
  if (shown.length === 0) return null;
  return (
    <div
      className={`live-window${mono ? " mono" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--live-lines": lines } as React.CSSProperties}
      aria-hidden="true"
      data-lines={shown.length}
    >
      {shown.map((line, i) => (
        <div className="live-window-line" key={shown.length - i}>
          {line}
        </div>
      ))}
    </div>
  );
});
