/** One toast: the shared notification card in its category's identity,
 *  a way to where it points, and a dismiss. Escape, with focus inside
 *  it, dismisses it. */

import type { KeyboardEvent } from "react";

import type { PageRoute } from "../../chat/pageStack";
import type { ModelToast } from "../../clientState";
import { NotificationCard as Card } from "../../notifications/notificationCard";
import { ToastTone } from "../../notifications/toastTone";
import { CloseIcon } from "../Icons";
import { NotificationCard } from "../NotificationCard";
import { Button } from "../page/Button";
import { useToastLifecycle } from "./useToastLifecycle";

export function ToastCard({
  toast,
  onDismiss,
  onOpen,
  sourceName,
}: {
  toast: ModelToast;
  onDismiss: () => void;
  onOpen?: (target: PageRoute) => void;
  sourceName?: (id: string) => string;
}) {
  const { closing, close, hold } = useToastLifecycle(toast.id, onDismiss);
  const tone = ToastTone.of(toast.kind);
  const card = Card.fromToast(toast, sourceName);
  const target = toast.target ?? null;

  const open = () => {
    if (target) onOpen?.(target);
    close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };

  return (
    <NotificationCard
      card={card}
      variant="toast"
      opener={{ as: "pointer", onOpen: open, title: target ? `Open ${target.label}` : undefined }}
      onAction={target ? open : undefined}
      actionTitle={target ? `Open ${target.label}` : undefined}
      corner={
        <Button variant="icon" size="sm" className="toast-close" label="Dismiss" onClick={close}>
          <CloseIcon size={12} />
        </Button>
      }
      rootProps={{
        className: `toast toast--${tone.severity}${closing ? " is-closing" : ""}`,
        role: tone.role,
        "aria-atomic": "true",
        onKeyDown,
        ...hold,
      }}
    />
  );
}
