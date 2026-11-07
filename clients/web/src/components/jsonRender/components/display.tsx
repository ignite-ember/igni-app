/** Catalog components that show data: text, tables, metrics, media
 *  and the three charts. None of them fires an action. */

import { NamedIcon } from "../../Icons";
import { BarChart } from "../charts/BarChart";
import { CandlestickChart } from "../charts/CandlestickChart";
import { ChartFrame } from "../charts/ChartFrame";
import { LineChart } from "../charts/LineChart";
import type { CatalogComponents } from "./catalogComponents";

/** A table row's cells as display strings; null and undefined read as "". */
function cellText(row: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!row || typeof row !== "object") return out;
  for (const [k, v] of Object.entries(row)) {
    out[k] = v == null ? "" : String(v);
  }
  return out;
}

/** A Metric's delta as its CSS tone, its direction glyph and its label. */
function deltaBadge(delta: number): { tone: string; icon: string; text: string } {
  const text = `${Math.abs(delta)}%`;
  if (delta > 0) return { tone: "up", icon: "triangleUp", text };
  if (delta < 0) return { tone: "down", icon: "triangleDown", text };
  return { tone: "flat", icon: "dot", text };
}

export const displayComponents: Pick<
  CatalogComponents,
  | "Heading"
  | "Text"
  | "Table"
  | "LineGraph"
  | "BarGraph"
  | "Candlestick"
  | "Metric"
  | "Badge"
  | "Avatar"
  | "Icon"
  | "Image"
> = {
  Heading: ({ props }) => {
    const level = Math.min(4, Math.max(1, props.level ?? 2));
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
    return <Tag className={`jr-heading jr-h${level}`}>{props.text}</Tag>;
  },

  Text: ({ props }) => {
    const cls = ["jr-text", props.muted ? "jr-text-muted" : "", props.mono ? "jr-text-mono" : ""]
      .filter(Boolean)
      .join(" ");
    return <div className={cls}>{props.text}</div>;
  },

  Table: ({ props }) => {
    const cols = props.columns;
    return (
      <table className="jr-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? "left" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => {
            const cells = cellText(row);
            return (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                    {cells[c.key] ?? ""}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  },

  LineGraph: ({ props }) => (
    <ChartFrame xLabel={props.xLabel} yLabel={props.yLabel}>
      <LineChart data={props.data} yPrefix={props.yPrefix} ySuffix={props.ySuffix} />
    </ChartFrame>
  ),

  BarGraph: ({ props }) => (
    <ChartFrame xLabel={props.xLabel} yLabel={props.yLabel}>
      <BarChart data={props.data} yPrefix={props.yPrefix} ySuffix={props.ySuffix} />
    </ChartFrame>
  ),

  Candlestick: ({ props }) => (
    <ChartFrame xLabel={props.xLabel} yLabel={props.yLabel}>
      <CandlestickChart
        data={props.data}
        yPrefix={props.yPrefix}
        ySuffix={props.ySuffix}
        upColor={props.upColor}
        downColor={props.downColor}
      />
    </ChartFrame>
  ),

  Metric: ({ props }) => {
    const { label, value, prefix, suffix, delta } = props;
    const badge = typeof delta === "number" ? deltaBadge(delta) : null;
    return (
      <div className="jr-metric">
        <div className="jr-metric-label">{label}</div>
        <div className="jr-metric-value">
          {prefix ?? ""}
          {value}
          {suffix ?? ""}
        </div>
        {badge && (
          <div className={`jr-metric-delta jr-metric-${badge.tone}`}>
            <NamedIcon name={badge.icon} size={10} />
            {badge.text}
          </div>
        )}
      </div>
    );
  },

  Badge: ({ props }) => (
    <span className={`jr-badge jr-badge-${props.tone ?? "neutral"}`}>{props.text}</span>
  ),

  Avatar: ({ props }) => {
    const { src, alt, initials, size = 32 } = props;
    if (src) {
      return <img className="jr-avatar" src={src} alt={alt ?? ""} width={size} height={size} />;
    }
    return (
      <span
        className="jr-avatar jr-avatar-initials"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
        aria-label={alt ?? initials ?? ""}
      >
        {(initials ?? "?").slice(0, 2).toUpperCase()}
      </span>
    );
  },

  Icon: ({ props }) => <NamedIcon name={props.name ?? "info"} size={props.size ?? 14} />,

  Image: ({ props }) => {
    const { src, alt, width, height, caption } = props;
    if (!src) return null;
    return (
      <figure className="jr-image">
        <img src={src} alt={alt ?? ""} width={width} height={height} />
        {caption && <figcaption className="jr-image-caption">{caption}</figcaption>}
      </figure>
    );
  },
};
