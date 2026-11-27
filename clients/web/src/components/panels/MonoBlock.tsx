/** Long text on a detail page — a task's output, a hook's script — set in
 *  mono, whole (the page scrolls it, not the block); and the Copy button that goes in
 *  its section's head. */

import { useCopiedFlag } from "../CopyButton";
import { CopiedCheckIcon, CopyIcon } from "../Icons";
import { Button } from "../page/Button";

export function MonoBlock({ text, tone, label }: { text: string; tone?: "danger"; label?: string }) {
  return (
    <pre
      className={tone ? `mono-block is-${tone}` : "mono-block"}
      // Scrollable, so it is reachable by keyboard too.
      tabIndex={0}
      aria-label={label}
    >
      {text}
    </pre>
  );
}

/** "Copy" in a {@link DetailSection}'s head; "Copied" for a moment after. */
export function CopyTextButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, copy] = useCopiedFlag();
  return (
    <Button
      size="sm"
      icon={copied ? <CopiedCheckIcon /> : <CopyIcon />}
      aria-label={copied ? "Copied" : label}
      onClick={() => copy(text)}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
