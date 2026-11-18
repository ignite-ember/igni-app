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

/**
 * The number a value stands for.
 *
 * The catalog declares a series point's ``y`` a number, and the
 * visualizer's prompt is generated from that catalog — but a model igni
 * does not fine-tune writes the value as text ("120"), and the chart
 * then has nothing to draw: the series is empty, the card says "no
 * data", and the agent says the chart is above (R666). A value that
 * reads as a number is the number the catalog asked for.
 *
 * Text that does not read as a number is not a number and is not
 * guessed at.
 */
function numericValue(value: unknown): number | undefined {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text === "") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A chart's ``data``: absent (still streaming) is no rows yet; anything
 *  else that is not a list is a malformed spec, said as such rather than
 *  as a TypeError from inside the chart. */
export function rows<T>(data: T[] | null | undefined): T[] {
  if (data == null) return [];
  if (!Array.isArray(data)) throw new Error("its data is not a list");
  return data;
}

/** The rows of a series that are complete. Mid-stream, partial-json
 *  hands us placeholder rows; a missing or non-finite value would put
 *  NaN into SVG attributes, which renders broken paths. A value written
 *  as text is read as the number it stands for (see
 *  {@link numericValue}).
 *
 *  A row whose value is there but is not a number is a spec the model
 *  got wrong, not a row the stream has not finished — but a chart that
 *  has other rows to draw draws them. Only a series with nothing to
 *  draw says so, in the component's own words, instead of coming out
 *  as "no data" over data that was there. */
export function completeSeries(data: SeriesPoint[]): SeriesPoint[] {
  const complete: SeriesPoint[] = [];
  let wrong = false;
  for (const row of rows(data)) {
    if (row == null || row.x == null) continue;
    const raw = (row as { y?: unknown }).y;
    const y = numericValue(raw);
    if (y === undefined) {
      if (raw !== undefined && raw !== null) wrong = true;
      continue;
    }
    complete.push({ x: row.x, y });
  }
  if (complete.length === 0 && wrong) throw new Error("its y values are not numbers");
  return complete;
}

/** The OHLC rows whose four prices have all arrived, each price read
 *  as the number it stands for. */
export function completeOHLC(data: OHLCPoint[]): OHLCPoint[] {
  const complete: OHLCPoint[] = [];
  let wrong = false;
  for (const row of rows(data)) {
    if (row == null) continue;
    const raw = row as { o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown };
    const o = numericValue(raw.o);
    const h = numericValue(raw.h);
    const l = numericValue(raw.l);
    const c = numericValue(raw.c);
    if (o === undefined || h === undefined || l === undefined || c === undefined) {
      // A price that is there but is not a number is the model's
      // mistake; one that has not arrived is the stream's.
      if (
        [raw.o, raw.h, raw.l, raw.c].some(
          (p) => p !== undefined && p !== null && numericValue(p) === undefined,
        )
      ) {
        wrong = true;
      }
      continue;
    }
    const v = numericValue(raw.v);
    complete.push({ x: row.x, o, h, l, c, ...(v === undefined ? {} : { v }) });
  }
  if (complete.length === 0 && wrong) throw new Error("its prices are not numbers");
  return complete;
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
