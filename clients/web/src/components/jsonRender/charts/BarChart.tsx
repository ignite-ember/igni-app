import { EmptyChart } from "./ChartFrame";
import { PlotBox, YScale, completeSeries, type SeriesPoint } from "./chartGeometry";
import { YAxis } from "./YAxis";

export function BarChart({
  data: rawData,
  yPrefix = "",
  ySuffix = "",
  width = 640,
  height = 220,
}: {
  data: SeriesPoint[];
  yPrefix?: string;
  ySuffix?: string;
  width?: number;
  height?: number;
}) {
  const data = completeSeries(rawData);
  if (!data.length) return <EmptyChart />;
  const box = new PlotBox(width, height);
  const ys = data.map((d) => d.y);
  // Bars grow from zero, so zero is always inside the scale.
  const scale = new YScale(Math.min(...ys, 0), Math.max(...ys, 0), box.top, box.innerHeight);
  const bandW = box.band(data.length);
  const barW = Math.max(2, bandW * 0.6);
  const zero = scale.px(0);
  return (
    <svg
      className="jr-barchart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="bar chart"
    >
      <YAxis
        chart="jr-barchart"
        box={box}
        scale={scale}
        ticks={scale.ticks(3)}
        prefix={yPrefix}
        suffix={ySuffix}
      />
      {data.map((d, i) => {
        const x = box.left + i * bandW + (bandW - barW) / 2;
        const top = scale.px(d.y);
        return (
          <g key={`b-${i}`}>
            <rect
              x={x}
              y={Math.min(zero, top)}
              width={barW}
              height={Math.abs(zero - top)}
              className="jr-barchart-bar"
            />
            <text x={x + barW / 2} y={box.xTickY} className="jr-barchart-xtick" textAnchor="middle">
              {String(d.x)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
