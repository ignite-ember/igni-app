import { EmptyChart } from "./ChartFrame";
import { PlotBox, YScale, completeOHLC, xTickStride, type OHLCPoint } from "./chartGeometry";
import { YAxis } from "./YAxis";

/** Gap between the price panel and the volume panel under it. */
const VOLUME_GAP = 6;

export function CandlestickChart({
  data,
  yPrefix = "",
  ySuffix = "",
  upColor = "#22c55e",
  downColor = "#dc2626",
  width = 640,
  height = 260,
}: {
  data: OHLCPoint[];
  yPrefix?: string;
  ySuffix?: string;
  upColor?: string;
  downColor?: string;
  width?: number;
  height?: number;
}) {
  const clean = completeOHLC(data);
  if (!clean.length) return <EmptyChart />;
  const hasVolume = clean.some((d) => typeof d.v === "number");
  const box = new PlotBox(width, height, 52);
  const priceH = hasVolume ? Math.round(box.innerHeight * 0.72) : box.innerHeight;
  const volH = hasVolume ? box.innerHeight - priceH - VOLUME_GAP : 0;
  const bandW = box.band(clean.length);
  const candleW = Math.max(2, bandW * 0.62);

  // Price scale spans every low and high, padded 5% so the extremes
  // don't touch the border.
  const yMin = Math.min(...clean.map((d) => d.l));
  const yMax = Math.max(...clean.map((d) => d.h));
  const yPad = (yMax - yMin || 1) * 0.05;
  const scale = new YScale(yMin - yPad, yMax + yPad, box.top, priceH);

  // Volume has its own non-negative scale under the price panel.
  const vMax = hasVolume ? Math.max(...clean.map((d) => d.v ?? 0), 1) : 1;
  const volBottom = box.top + priceH + VOLUME_GAP + volH;
  const volumeH = (v: number) => (v / vMax) * volH;

  const stride = xTickStride(clean.length);

  return (
    <svg
      className="jr-candlestick"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="candlestick chart"
    >
      <YAxis
        chart="jr-candlestick"
        box={box}
        scale={scale}
        ticks={scale.ticks(5)}
        prefix={yPrefix}
        suffix={ySuffix}
      />
      {clean.map((d, i) => {
        const color = d.c >= d.o ? upColor : downColor;
        const cx = box.left + i * bandW + bandW / 2;
        const bodyTopY = scale.px(Math.max(d.o, d.c));
        const bodyBottomY = scale.px(Math.min(d.o, d.c));
        const volume = volumeH(d.v ?? 0);
        return (
          <g key={`c-${i}`}>
            <line
              x1={cx}
              x2={cx}
              y1={scale.px(d.h)}
              y2={scale.px(d.l)}
              stroke={color}
              strokeWidth={1}
            />
            <rect
              x={cx - candleW / 2}
              y={bodyTopY}
              width={candleW}
              height={Math.max(1, bodyBottomY - bodyTopY)}
              fill={color}
              stroke={color}
              strokeWidth={1}
            />
            {hasVolume && (
              <rect
                x={cx - candleW / 2}
                y={volBottom - volume}
                width={candleW}
                height={volume}
                fill={color}
                opacity={0.4}
              />
            )}
            {i % stride === 0 && (
              <text x={cx} y={box.xTickY} className="jr-candlestick-xtick" textAnchor="middle">
                {String(d.x)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
