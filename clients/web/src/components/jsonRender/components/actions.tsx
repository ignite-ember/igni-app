/** Catalog components the user presses to fire an action: buttons,
 *  links, menus and the rating stars. Each emits a named event the
 *  spec binds to an action. */

import { useState } from "react";
import { NamedIcon } from "../../Icons";
import type { CatalogComponents } from "./catalogComponents";

export const actionComponents: Pick<
  CatalogComponents,
  "Button" | "Link" | "DropdownMenu" | "ButtonGroup" | "Rating"
> = {
  Button: ({ props, emit }) => {
    const { text, variant = "primary", disabled, iconLeft, iconRight } = props;
    return (
      <button
        type="button"
        className={`jr-btn jr-btn-${variant}`}
        disabled={disabled}
        onClick={() => emit("press")}
      >
        {iconLeft && <NamedIcon name={iconLeft} />}
        <span>{text}</span>
        {iconRight && <NamedIcon name={iconRight} />}
      </button>
    );
  },

  Link: ({ props, emit, on }) => {
    const { text, href, external } = props;
    const handle = on("press");
    return (
      <a
        className="jr-link"
        href={href ?? "#"}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer noopener" : undefined}
        onClick={(e) => {
          // Only hijack the click when a press action is bound;
          // otherwise let the browser follow the href normally.
          if (handle.bound) {
            e.preventDefault();
            emit("press");
          }
        }}
      >
        {text}
      </a>
    );
  },

  DropdownMenu: ({ props, emit }) => {
    const [open, setOpen] = useState(false);
    return (
      <div className={`jr-dropdown ${open ? "jr-dropdown-open" : ""}`}>
        <button type="button" className="jr-btn jr-btn-secondary" onClick={() => setOpen((v) => !v)}>
          <span>{props.label}</span>
          <NamedIcon name={open ? "chevronUp" : "chevron"} />
        </button>
        {open && (
          <div className="jr-dropdown-menu" role="menu">
            {props.items.map((it, i) => (
              <button
                key={i}
                type="button"
                className="jr-dropdown-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  emit(`select:${it.value}`);
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },

  ButtonGroup: ({ props, emit }) => (
    <div className="jr-btngroup">
      {props.buttons.map((b) => (
        <button
          key={b.value}
          type="button"
          className={`jr-btngroup-btn ${props.value === b.value ? "jr-on" : ""}`}
          onClick={() => emit(`press:${b.value}`)}
        >
          {b.label}
        </button>
      ))}
    </div>
  ),

  Rating: ({ props, emit }) => {
    const max = props.max ?? 5;
    const val = Math.max(0, Math.min(max, props.value ?? 0));
    return (
      <div className="jr-rating" role="radiogroup" aria-label="rating">
        {Array.from({ length: max }, (_, i) => {
          const filled = i < Math.round(val);
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={filled}
              className={`jr-rating-star ${filled ? "jr-rating-star-on" : ""}`}
              onClick={() => emit(`rate:${i + 1}`)}
            >
              <NamedIcon name="star" />
            </button>
          );
        })}
      </div>
    );
  },
};
