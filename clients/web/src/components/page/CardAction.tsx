/** A quiet round icon button for an {@link EntityCard}'s action slot:
 *  it does its own thing and never opens the card it sits on. */

import type { ReactNode } from "react";

export function CardAction({
  label,
  onClick,
  disabled = false,
  children,
}: {
  /** Its accessible name and tooltip: "Run /commit". */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** The icon; a play triangle when left out. */
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="card-action"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children ?? <PlayGlyph />}
    </button>
  );
}

/** A small play triangle: "run this". */
export function PlayGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.5 2.2v7.6a.5.5 0 0 0 .76.43l6.1-3.8a.5.5 0 0 0 0-.86l-6.1-3.8a.5.5 0 0 0-.76.43z" fill="currentColor" />
    </svg>
  );
}
