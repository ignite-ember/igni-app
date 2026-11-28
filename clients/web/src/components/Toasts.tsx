/**
 * Toasts: a quiet stack in the bottom-right corner, clear of the composer.
 *
 * Project-level async events (a scheduled task finishing) land here
 * rather than in whichever chat is open, persist across conversation
 * switches, and hide themselves after a few seconds unless looked at.
 *
 * The list is the window model's ``ui.toasts`` — igni's own toasts and
 * an extension's (``host.ui.toast``) alike. This renders it and reports
 * the person dismissing one or opening where it points.
 */

import { useRef } from "react";

import type { PageRoute } from "../chat/pageStack";
import type { ModelToast } from "../clientState";
import { ToastCard } from "./toasts/ToastCard";
import { useComposerClearance } from "./toasts/useComposerClearance";

export { TOAST_TTL_MS } from "./toasts/useToastLifecycle";

export function Toasts({
  items,
  onDismiss,
  onOpen,
  sourceName,
}: {
  items: readonly ModelToast[];
  onDismiss: (id: string) => void;
  /** Opening a toast that points somewhere goes there. */
  onOpen?: (target: PageRoute) => void;
  /** An extension's name, for its id. */
  sourceName?: (id: string) => string;
}) {
  const stack = useRef<HTMLDivElement>(null);
  useComposerClearance(stack, items.length > 0);
  if (items.length === 0) return null;
  return (
    <div ref={stack} className="toasts" role="region" aria-label="Notifications">
      {items.map((t) => (
        <ToastCard
          key={t.id}
          toast={t}
          onDismiss={() => onDismiss(t.id)}
          onOpen={onOpen}
          sourceName={sourceName}
        />
      ))}
    </div>
  );
}
