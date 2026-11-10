import { EmptyChart } from "./ChartFrame";
import { PlotBox, YScale, completeSeries, xTickStride, type SeriesPoint } from "./chartGeometry";
import { YAxis } from "./YAxis";

export function LineChart({
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
  const scale = new YScale(Math.min(...ys), Math.max(...ys), box.top, box.innerHeight);
  const xStep = data.length > 1 ? box.innerWidth / (data.length - 1) : 0;
  const points = data.map((d, i) => ({ x: box.left + i * xStep, y: scale.px(d.y) }));
  const stride = xTickStride(data.length);
  return (
    <svg
      className="jr-linechart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="line chart"
    >
      <YAxis
        chart="jr-linechart"
        box={box}
        scale={scale}
        ticks={scale.ticks(5)}
        prefix={yPrefix}
        suffix={ySuffix}
      />
      {data.map((d, i) =>
        i % stride !== 0 ? null : (
          <text
            key={`xt-${i}`}
            x={points[i].x}
            y={box.xTickY}
            className="jr-linechart-xtick"
            textAnchor="middle"
          >
            {String(d.x)}
          </text>
        ),
      )}
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        className="jr-linechart-line"
      />
      {points.map((p, i) => (
        <circle key={`p-${i}`} cx={p.x} cy={p.y} r={2.5} className="jr-linechart-dot" />
      ))}
    </svg>
  );
}
