/** The menu a right-click on the open chat's row opens: what can be done
 *  to the chat on screen. Portaled to the body and placed at the pointer. */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** The room kept between the menu and the window's right and bottom edges. */
const EDGE = 8;
/** The menu's width as drawn, for keeping it inside the window. */
const MENU_WIDTH = 200;
/** The menu's height as drawn, for keeping it inside the window. */
const MENU_HEIGHT = 48;

export function SessionMenu({
  x,
  y,
  busy,
  onCompact,
  onClose,
}: {
  /** Where the pointer was, in window coordinates. */
  x: number;
  y: number;
  /** A reply is running in this chat: compacting waits until it ends. */
  busy: boolean;
  onCompact: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const left = Math.max(EDGE, Math.min(x, window.innerWidth - MENU_WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(y, window.innerHeight - MENU_HEIGHT - EDGE));

  return createPortal(
    <div
      ref={menuRef}
      className="control-menu session-menu"
      role="menu"
      aria-label="Chat"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="control-menu-item"
        disabled={busy}
        title={busy ? "Wait for the reply to finish" : undefined}
        onClick={() => {
          onClose();
          onCompact();
        }}
      >
        <span className="control-menu-item-label">Compact conversation</span>
      </button>
    </div>,
    document.body,
  );
}
