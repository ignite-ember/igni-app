/** A bare round icon button for an {@link EntityCard}'s action slot:
 *  it does its own thing and never opens the card it sits on. */

import type { ReactNode } from "react";

import { Button } from "./Button";

export function CardAction({
  label,
  onClick,
  disabled = false,
  busy = false,
  danger = false,
  title,
  className,
  children,
}: {
  /** Its accessible name and tooltip: "Run /commit". */
  label: string;
  /** A tooltip that says more than the label. */
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** Turns red on hover: discard, remove. */
  danger?: boolean;
  className?: string;
  /** The icon; a play triangle when left out. */
  children?: ReactNode;
}) {
  return (
    <Button
      variant="icon"
      label={label}
      title={title}
      disabled={disabled}
      busy={busy}
      className={["card-action", danger && "is-danger", className].filter(Boolean).join(" ")}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children ?? <PlayGlyph />}
    </Button>
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
