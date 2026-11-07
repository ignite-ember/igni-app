import type React from "react";

/** The box a catalog chart sits in, with its axis captions under it. */
export function ChartFrame({
  xLabel,
  yLabel,
  children,
}: {
  xLabel?: string;
  yLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="jr-chart">
      {children}
      {(xLabel || yLabel) && (
        <div className="jr-chart-axes">
          {yLabel && <span className="jr-chart-y">{yLabel}</span>}
          {xLabel && <span className="jr-chart-x">{xLabel}</span>}
        </div>
      )}
    </div>
  );
}

export function EmptyChart() {
  return <div className="jr-empty">no data</div>;
}
