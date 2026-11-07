/**
 * Geometry shared by the in-house SVG charts (no charting library):
 * the plot box inside the SVG, the value-to-pixel scale on the y axis,
 * and the guard that drops rows a partial stream has not finished.
 */

/** Series point as the catalog's ``LineGraph`` / ``BarGraph`` declare it. */
export type SeriesPoint = { x: string | number; y: number };

/** OHLC(V) row as the catalog's ``Candlestick`` declares it. */
export type OHLCPoint = {
  x: string | number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** The rows of a series that are complete. Mid-stream, partial-json
 *  hands us placeholder rows; a missing or non-finite value would put
 *  NaN into SVG attributes, which renders broken paths. */
export function completeSeries(data: SeriesPoint[]): SeriesPoint[] {
  return data.filter((d) => d != null && d.x != null && isFiniteNumber(d.y));
}

/** The OHLC rows whose four prices have all arrived. */
export function completeOHLC(data: OHLCPoint[]): OHLCPoint[] {
  return data.filter(
    (d) =>
      d != null &&
      isFiniteNumber(d.o) &&
      isFiniteNumber(d.h) &&
      isFiniteNumber(d.l) &&
      isFiniteNumber(d.c),
  );
}

/** The SVG canvas and the plot box inside it. */
export class PlotBox {
  static readonly RIGHT = 12;
  static readonly TOP = 12;
  static readonly BOTTOM = 26;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly left: number = 46,
  ) {}

  get right(): number {
    return this.width - PlotBox.RIGHT;
  }

  get top(): number {
    return PlotBox.TOP;
  }

  get innerWidth(): number {
    return this.right - this.left;
  }

  get innerHeight(): number {
    return this.height - PlotBox.TOP - PlotBox.BOTTOM;
  }

  /** Baseline of the x-axis tick labels. */
  get xTickY(): number {
    return this.height - 8;
  }

  /** Width of one category band when ``count`` categories share the box. */
  band(count: number): number {
    return this.innerWidth / count;
  }
}

/** Linear map from a value range onto a vertical pixel span. */
export class YScale {
  readonly range: number;

  constructor(
    readonly min: number,
    max: number,
    private readonly top: number,
    private readonly height: number,
  ) {
    this.range = max - min || 1;
  }

  px(v: number): number {
    return this.top + this.height - ((v - this.min) / this.range) * this.height;
  }

  /** ``count`` evenly spaced values from min to max inclusive. */
  ticks(count: number): number[] {
    return Array.from({ length: count }, (_, i) => this.min + (this.range * i) / (count - 1));
  }
}

/** Every n-th x label is drawn so at most ~8 fit under the chart. */
export function xTickStride(count: number): number {
  return Math.max(1, Math.ceil(count / 8));
}

export function formatTick(v: number, prefix: string, suffix: string): string {
  return `${prefix}${Number.isInteger(v) ? v : v.toFixed(2)}${suffix}`;
}
