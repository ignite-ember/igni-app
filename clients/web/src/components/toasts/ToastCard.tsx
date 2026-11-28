/** One toast: the shared notification card in its category's identity,
 *  a button naming what it reaches (when it reaches something), and a
 *  dismiss. Escape, with focus inside it, dismisses it. */

import type { KeyboardEvent } from "react";

import type { ModelToast } from "../../clientState";
import type { NotificationAction } from "../../notifications/notificationAction";
import { NotificationCard as Card } from "../../notifications/notificationCard";
import { ToastTone } from "../../notifications/toastTone";
import { CloseIcon } from "../Icons";
import { NotificationCard } from "../NotificationCard";
import { Button } from "../page/Button";
import { useToastLifecycle } from "./useToastLifecycle";

export function ToastCard({
  toast,
  action,
  onDismiss,
  sourceName,
}: {
  toast: ModelToast;
  /** What following it does, resolved against what is there now. */
  action: NotificationAction | null;
  onDismiss: () => void;
  sourceName?: (id: string) => string;
}) {
  const { closing, close, hold } = useToastLifecycle(toast.id, onDismiss);
  const tone = ToastTone.of(toast.kind);
  const card = Card.fromToast(toast, action, sourceName);

  const follow = () => {
    action?.run();
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
      onFollow={follow}
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
