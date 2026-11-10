/** A catalog source string. The catalog encodes a subdirectory install
 *  as ``<url> [<subdir>]``; this splits it back out. */
export class SourceRef {
  constructor(
    readonly url: string,
    readonly subdir: string,
  ) {}

  static parse(raw: string): SourceRef {
    const m = raw.match(/^(.+?)\s+\[(.+?)\]\s*$/);
    return m ? new SourceRef(m[1].trim(), m[2].trim()) : new SourceRef(raw.trim(), "");
  }

  /** The URL as a reader would paste it into a browser: no ``.git``. */
  get displayUrl(): string {
    return this.url.replace(/\.git$/, "");
  }

  /** Whether it can be opened as a link. */
  get isHttp(): boolean {
    return /^https?:\/\//.test(this.url);
  }
}
