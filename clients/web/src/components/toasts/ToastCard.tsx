/** One toast: a quiet card with its severity mark, a title and a line,
 *  an optional way to where it points, and a dismiss. Escape, with focus
 *  inside it, dismisses it. */

import type { KeyboardEvent } from "react";

import type { PageRoute } from "../../chat/pageStack";
import type { ModelToast } from "../../clientState";
import { ToastTone } from "../../notifications/toastTone";
import { CloseIcon, SeverityIcon } from "../Icons";
import { Button } from "../page/Button";
import { useToastLifecycle } from "./useToastLifecycle";

export function ToastCard({
  toast,
  onDismiss,
  onOpen,
}: {
  toast: ModelToast;
  onDismiss: () => void;
  onOpen?: (target: PageRoute) => void;
}) {
  const { closing, close, hold } = useToastLifecycle(toast.id, onDismiss);
  const tone = ToastTone.of(toast.kind);
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
    <div
      className={`toast toast--${tone.severity}${closing ? " is-closing" : ""}`}
      role={tone.role}
      aria-atomic="true"
      onKeyDown={onKeyDown}
      {...hold}
    >
      <span className="toast-mark" aria-hidden="true">
        <SeverityIcon severity={tone.severity} size={16} />
      </span>
      {/* The text is a click target for the pointer; the keyboard has
          the buttons beside it. */}
      <div className="toast-text" onClick={open}>
        <div className="toast-title">{toast.text}</div>
        {toast.body && (
          <div className="toast-body" title={toast.body}>
            {toast.body}
          </div>
        )}
      </div>
      <div className="toast-actions">
        {target && (
          <Button size="sm" className="toast-action" title={`Open ${target.label}`} onClick={open}>
            Open
          </Button>
        )}
        <Button variant="icon" size="sm" className="toast-close" label="Dismiss" onClick={close}>
          <CloseIcon size={12} />
        </Button>
      </div>
    </div>
  );
}
