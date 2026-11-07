/** Catalog status components: alerts, progress, spinners, skeletons. */

import type React from "react";
import type { CatalogComponents } from "./catalogComponents";

export const feedbackComponents: Pick<
  CatalogComponents,
  "Alert" | "Progress" | "Spinner" | "Skeleton"
> = {
  Alert: ({ props }) => (
    <div className={`jr-alert jr-alert-${props.tone}`}>
      {props.title && <div className="jr-alert-title">{props.title}</div>}
      <div className="jr-alert-body">{props.text}</div>
    </div>
  ),

  Progress: ({ props }) => {
    const { value = 0, max = 100, label, indeterminate } = props;
    const pct = (Math.max(0, Math.min(max, value)) / max) * 100;
    return (
      <div className="jr-progress">
        {label && <div className="jr-progress-label">{label}</div>}
        <div className="jr-progress-track">
          <div
            className={`jr-progress-bar ${indeterminate ? "jr-progress-indet" : ""}`}
            style={{ width: indeterminate ? "40%" : `${pct}%` }}
          />
        </div>
      </div>
    );
  },

  Spinner: ({ props }) => {
    const size = props.size ?? 16;
    return (
      <span className="jr-spinner" aria-live="polite">
        <span className="jr-spinner-ring" style={{ width: size, height: size }} aria-hidden="true" />
        {props.label && <span className="jr-spinner-label">{props.label}</span>}
      </span>
    );
  },

  Skeleton: ({ props }) => {
    const { width, height, variant } = props;
    const style: React.CSSProperties = {
      width: width ?? "100%",
      height: height ?? (variant === "circle" ? 32 : variant === "block" ? 60 : 12),
      borderRadius: variant === "circle" ? "50%" : variant === "block" ? 8 : 6,
    };
    return <span className="jr-skeleton" style={style} aria-hidden="true" />;
  },
};
