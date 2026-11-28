/** Which pages a notification can point at right now, and what each is
 *  called on a button: igni's own by their menu names, an extension's
 *  as "Extension › Page". */

import type { Contributions } from "../extensions/contributions";
import type { ExtensionSummary } from "../extensions/ExtensionPage";

type ExtensionPages = Pick<ExtensionSummary, "id" | "name" | "pages">;

export class PageDirectory {
  constructor(
    private readonly contributions: Pick<Contributions, "pages" | "sidebar" | "tools">,
    private readonly extensions: readonly ExtensionPages[],
  ) {}

  has(kind: string): boolean {
    return this.contributions.pages.has(kind);
  }

  /** The page's name; `null` for a page that is not here. */
  label(kind: string): string | null {
    if (!this.has(kind)) return null;
    const owner = this.contributions.pages.ownerOf(kind);
    const extension = this.extensions.find((e) => e.id === owner);
    const page = extension?.pages.find((p) => p.kind === kind)?.label;
    if (extension && page) return page === extension.name ? page : `${extension.name} › ${page}`;
    if (extension) return extension.name;
    const linked = this.contributions.sidebar().find((l) => l.kind === kind)?.label;
    const tool = this.contributions.tools().find((t) => t.command === `/${kind}`)?.label;
    return linked ?? tool ?? kind;
  }
}
