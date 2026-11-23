/** One header icon that drops a small radio menu — filter or sort.
 *  Shared by Plugins, MCPs and Extensions so their controls match. */

import type { ReactNode } from "react";

import { CheckIcon } from "../Icons";

export function ControlMenu<K extends string>({
  label,
  icon,
  active,
  open,
  onToggle,
  onClose,
  options,
  current,
  onPick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  options: readonly { key: K; label: string }[];
  current: K;
  onPick: (key: K) => void;
}) {
  return (
    <div className="plugins-menu-wrap">
      <button
        className={`kb-icon-btn${active ? " is-active" : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        {icon}
      </button>
      {open && (
        <>
          <div className="plugins-menu-backdrop" onClick={onClose} />
          <div className="plugins-menu" role="menu">
            <div className="plugins-menu-head">{label}</div>
            {options.map((o) => (
              <button
                key={o.key}
                role="menuitemradio"
                aria-checked={current === o.key}
                className={`plugins-menu-item${current === o.key ? " active" : ""}`}
                onClick={() => {
                  onPick(o.key);
                  onClose();
                }}
              >
                <span>{o.label}</span>
                {current === o.key && <CheckIcon size={12} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
