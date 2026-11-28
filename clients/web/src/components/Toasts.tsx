/**
 * Toasts: a quiet stack in the bottom-right corner, clear of the composer.
 *
 * Project-level async events (a scheduled task finishing) land here
 * rather than in whichever chat is open, persist across conversation
 * switches, and hide themselves after a few seconds unless looked at.
 *
 * The list is the window model's ``ui.toasts`` — igni's own toasts and
 * an extension's (``host.ui.toast``) alike. This renders it, each with
 * what following it reaches ({@link NotificationActions}), and reports
 * the person dismissing one. A toast about a decision leaves as soon as
 * the decision is no longer waiting.
 */

import { useEffect, useRef } from "react";

import type { ModelToast } from "../clientState";
import { NotificationActions } from "../notifications/notificationActions";
import { ToastCard } from "./toasts/ToastCard";
import { useComposerClearance } from "./toasts/useComposerClearance";

export { TOAST_TTL_MS } from "./toasts/useToastLifecycle";

export function Toasts({
  items,
  onDismiss,
  actions = NotificationActions.NONE,
  sourceName,
}: {
  items: readonly ModelToast[];
  onDismiss: (id: string) => void;
  /** What each toast reaches, against what is there now. */
  actions?: NotificationActions;
  /** An extension's name, for its id. */
  sourceName?: (id: string) => string;
}) {
  const stack = useRef<HTMLDivElement>(null);
  useComposerClearance(stack, items.length > 0);
  const resolved = items.map((toast) => ({ toast, action: actions.forToast(toast) }));
  const isSettled = ({ toast, action }: (typeof resolved)[number]) =>
    toast.category === "approval" && !action?.decides;
  const shown = resolved.filter((entry) => !isSettled(entry));
  const settled = resolved
    .filter(isSettled)
    .map(({ toast }) => toast.id)
    .join(" ");

  useEffect(() => {
    for (const id of settled.split(" ").filter(Boolean)) onDismiss(id);
    // The ids are the dependency: a new handler does not dismiss again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  if (shown.length === 0) return null;
  return (
    <div ref={stack} className="toasts" role="region" aria-label="Notifications">
      {shown.map(({ toast, action }) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          action={action}
          onDismiss={() => onDismiss(toast.id)}
          sourceName={sourceName}
        />
      ))}
    </div>
  );
}
