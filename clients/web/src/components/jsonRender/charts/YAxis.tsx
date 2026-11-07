import { formatTick, type PlotBox, type YScale } from "./chartGeometry";

/** Horizontal grid lines with their y-axis value labels. ``chart``
 *  is the CSS block (``jr-linechart`` …) the grid and labels style under. */
export function YAxis({
  chart,
  box,
  scale,
  ticks,
  prefix,
  suffix,
}: {
  chart: string;
  box: PlotBox;
  scale: YScale;
  ticks: number[];
  prefix: string;
  suffix: string;
}) {
  return (
    <>
      {ticks.map((v, i) => {
        const y = scale.px(v);
        return (
          <g key={`yt-${i}`}>
            <line x1={box.left} x2={box.right} y1={y} y2={y} className={`${chart}-grid`} />
            <text x={box.left - 6} y={y + 3} className={`${chart}-ytick`}>
              {formatTick(v, prefix, suffix)}
            </text>
          </g>
        );
      })}
    </>
  );
}
