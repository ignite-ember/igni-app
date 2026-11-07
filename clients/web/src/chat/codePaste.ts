/**
 * A pasted code snippet as it travels inside a user message. The
 * composer turns ``@code:c1`` into
 *
 *     [code-paste hello.py:9 lines=9-16]
 *     …the snippet…
 *     [/code-paste]
 *
 * at submit, so the bubble can find each snippet by its tag.
 */

export class CodePasteBlock {
  /** Shared and global: read only through ``matchAll`` and ``replace``,
   *  which never leave state on it. Never ``exec`` or ``test`` it. */
  static readonly PATTERN = /\[code-paste (\S+):(\d+) lines=([^\]]+)\]\n([\s\S]*?)\n\[\/code-paste\]/g;

  constructor(
    readonly path: string,
    /** The line the snippet starts at. */
    readonly line: number,
    /** What the pill shows: ``71``, ``71-75``, or ``9,11-13``. */
    readonly lineSpec: string,
    readonly snippet: string,
    /** The whole tagged block, as it appears in the message. */
    readonly raw: string,
  ) {}

  /** ``match`` is one match of {@link PATTERN}. */
  static fromMatch(match: RegExpMatchArray): CodePasteBlock {
    return new CodePasteBlock(match[1], Number(match[2]), match[3], match[4], match[0]);
  }

  get fileName(): string {
    return this.path.split("/").pop() || this.path;
  }

  /** The first contiguous range of ``lineSpec``: the segment the person
   *  attached, which the editor selects. */
  get firstRange(): string {
    return this.lineSpec.split(",")[0].trim();
  }
}

/**
 * One edit session's stand-ins for the snippets in a message. ``swap``
 * shows each block as a compact ``«code:hello.py 9-16#1»`` the person can
 * move or delete but not corrupt; ``restore`` puts the surviving ones
 * back. A deleted placeholder deletes its snippet.
 */
export class CodePastePlaceholders {
  private static readonly PLACEHOLDER = /«code:[^«»]*?#\d+»/g;
  private readonly blocks = new Map<string, string>();

  get size(): number {
    return this.blocks.size;
  }

  swap(text: string): string {
    this.blocks.clear();
    let n = 0;
    return text.replace(
      CodePasteBlock.PATTERN,
      (raw: string, path: string, line: string, lineSpec: string, snippet: string) => {
        n += 1;
        const block = new CodePasteBlock(path, Number(line), lineSpec, snippet, raw);
        const placeholder = `«code:${block.fileName} ${block.lineSpec}#${n}»`;
        this.blocks.set(placeholder, block.raw);
        return placeholder;
      },
    );
  }

  /** A placeholder this session did not make restores as nothing. */
  restore(text: string): string {
    return text.replace(
      CodePastePlaceholders.PLACEHOLDER,
      (placeholder) => this.blocks.get(placeholder) ?? "",
    );
  }
}
