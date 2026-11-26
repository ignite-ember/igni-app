/** The one button every page uses, in Claude's style: no gradient, no
 *  border. `primary` is a filled rounded rectangle in the inverse of the
 *  page (light on the dark theme, dark on the light one); `secondary` a
 *  soft quiet fill; `danger` quiet red text; `icon` a bare round icon. */

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { NamedIcon } from "../Icons";

export type ButtonVariant = "primary" | "secondary" | "danger" | "icon";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Defaults to `secondary`. */
  variant?: ButtonVariant;
  /** `md` is 32px tall, `sm` 28px. Defaults to `md`. */
  size?: ButtonSize;
  /** Drawn before the label; the whole content of an `icon` button
   *  (which also takes its icon as children). */
  icon?: ReactNode;
  /** A trailing down chevron: the button opens a menu. */
  chevron?: boolean;
  /** Disables the button and swaps its icon for a spinner. */
  busy?: boolean;
  /** Accessible name and tooltip; required in practice for `icon`. */
  label?: string;
  /** Lit, for an icon that toggles or a menu that narrows something. */
  active?: boolean;
  children?: ReactNode;
}

/** The class list a button of this variant and size carries. */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return ["button", `button--${variant}`, `button--${size}`, extra].filter(Boolean).join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  chevron = false,
  busy = false,
  label,
  active = false,
  className,
  disabled,
  type = "button",
  title,
  children,
  ...rest
}: ButtonProps) {
  const lead = busy ? <span className="icon-spinner" aria-hidden="true" /> : icon;
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass(variant, size, [active && "is-active", className].filter(Boolean).join(" "))}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={label ?? rest["aria-label"]}
      title={title ?? (variant === "icon" ? label : undefined)}
    >
      {variant === "icon" ? (
        (lead ?? children)
      ) : (
        <>
          {lead && <span className="button-icon">{lead}</span>}
          {children}
        </>
      )}
      {chevron && (
        <span className="button-chevron">
          <NamedIcon name="chevron" size={12} />
        </span>
      )}
    </button>
  );
}
