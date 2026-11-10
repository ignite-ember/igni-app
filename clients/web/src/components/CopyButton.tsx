/** A button that copies text and shows a tick for a moment after. */

import { useState } from "react";

import { CopiedCheckIcon, CopyIcon } from "./Icons";

const COPIED_TICK_MS = 1300;

/** ``copied`` turns true for a moment after ``copy`` lands; a blocked
 *  clipboard leaves it false and says nothing. */
export function useCopiedFlag(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), COPIED_TICK_MS);
      } catch {
        /* clipboard blocked: silent */
      }
    })();
  };
  return [copied, copy];
}

/** ``text`` is read at click time when it is a function, so a caller
 *  can copy what the DOM shows then. */
export function CopyButton({
  text,
  className,
  idleLabel,
}: {
  text: string | (() => string);
  className: string;
  idleLabel: string;
}) {
  const [copied, copy] = useCopiedFlag();
  return (
    <button
      type="button"
      className={className}
      title={copied ? "Copied!" : idleLabel}
      aria-label={copied ? "Copied" : idleLabel}
      onClick={() => copy(typeof text === "function" ? text() : text)}
    >
      {copied ? <CopiedCheckIcon /> : <CopyIcon />}
    </button>
  );
}
