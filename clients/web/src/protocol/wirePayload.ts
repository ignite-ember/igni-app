/**
 * Read access to one untyped wire object, field by field.
 *
 * The parse functions in this folder build their typed models through
 * it, so every lenient fallback (a missing title, a stringly number)
 * is written once, here, rather than as a cast at each consumer.
 */

export class WirePayload {
  private readonly fields: Record<string, unknown>;

  constructor(raw: unknown) {
    this.fields = WirePayload.isRecord(raw) ? raw : {};
  }

  static isRecord(raw: unknown): raw is Record<string, unknown> {
    return !!raw && typeof raw === "object" && !Array.isArray(raw);
  }

  value(key: string): unknown {
    return this.fields[key];
  }

  /** The field when it is a string, else ``fallback``. */
  string(key: string, fallback = ""): string {
    const v = this.fields[key];
    return typeof v === "string" ? v : fallback;
  }

  optionalString(key: string): string | undefined {
    const v = this.fields[key];
    return typeof v === "string" ? v : undefined;
  }

  /** ``String(x ?? fallback)``: numbers and booleans keep their text. */
  text(key: string, fallback = ""): string {
    return String(this.fields[key] ?? fallback);
  }

  /** ``Number(x ?? 0) || 0``: never NaN. */
  number(key: string): number {
    return Number(this.fields[key] ?? 0) || 0;
  }

  optionalNumber(key: string): number | undefined {
    const v = this.fields[key];
    return typeof v === "number" ? v : undefined;
  }

  flag(key: string): boolean {
    return Boolean(this.fields[key]);
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const v = this.fields[key];
    return allowed.find((a) => a === v) ?? fallback;
  }

  plainObject(key: string): Record<string, unknown> | undefined {
    const v = this.fields[key];
    return WirePayload.isRecord(v) ? v : undefined;
  }
}
