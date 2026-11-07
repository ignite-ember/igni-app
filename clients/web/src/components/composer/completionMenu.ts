/**
 * The menu that opens while typing: `/` commands at the start of the
 * draft, `@` files anywhere.
 *
 * File lookups go to the backend and answer late. {@link MentionCompleter}
 * owns which answer is still wanted: every lookup *and* every close makes
 * the older ones stale, because a closed menu is newer than any lookup
 * still in flight. Without that, an answer arriving after Enter accepted
 * an entry (or Escape, or a space ending the token) reopened the picker,
 * and an open picker swallows the next Enter (T23).
 */

import type { IgniClient } from "../../protocol/client";

export interface MenuEntry {
  key: string;
  label: string;
  desc?: string;
}

export interface SlashMenu {
  kind: "slash";
  entries: MenuEntry[];
  active: number;
  /** A command is the whole first token. */
  tokenStart: 0;
}

export interface MentionMenu {
  kind: "mention";
  entries: MenuEntry[];
  active: number;
  /** Where the `@` token starts in the draft. */
  tokenStart: number;
  /** Matches before truncation: more can be loaded while this is larger
   *  than `entries`. */
  total: number;
  /** How many were asked for; grows a page per load. */
  limit: number;
  /** What was asked, so loading more asks the same. */
  query: string;
}

export type CompletionMenu = SlashMenu | MentionMenu;

/** Files asked for per page of the `@` menu. */
export const MENTION_PAGE_SIZE = 200;

/** A lookup's answer no longer applies: leave the menu as it is. */
export const STALE: unique symbol = Symbol("stale");

/** The highlight moved by `delta`, wrapping at either end. */
export function moveActive<M extends CompletionMenu>(menu: M, delta: number): M {
  const n = menu.entries.length;
  return { ...menu, active: (menu.active + delta + n) % n };
}

/** The part of the client a file lookup needs. */
type FileCompleter = Pick<IgniClient, "completeFiles">;

export class MentionCompleter {
  private seq = 0;
  /** A load is in flight: a rapid scroll asks once, not dozens of times. */
  private loadingMore = false;

  constructor(private readonly client: FileCompleter) {}

  /** The menu for the `@` token `query` starting at `tokenStart`: `null`
   *  when nothing matches or the lookup failed. */
  async query(query: string, tokenStart: number): Promise<MentionMenu | null | typeof STALE> {
    const seq = ++this.seq;
    try {
      // A small first page; the popup loads more on scroll, so a large
      // repository is not shipped on every keystroke.
      const { matches, total } = await this.client.completeFiles(query, MENTION_PAGE_SIZE);
      if (seq !== this.seq) return STALE;
      if (!matches.length) return null;
      return {
        kind: "mention",
        entries: MentionCompleter.entries(matches),
        active: 0,
        tokenStart,
        total,
        limit: MENTION_PAGE_SIZE,
        query,
      };
    } catch {
      // A failed lookup closes the menu rather than leaving a stale one.
      return seq === this.seq ? null : STALE;
    }
  }

  /** `menu` with the next page; {@link STALE} when everything is loaded,
   *  a load is already running, or this one failed or was overtaken. */
  async loadMore(menu: MentionMenu): Promise<MentionMenu | typeof STALE> {
    if (this.loadingMore || menu.entries.length >= menu.total) return STALE;
    this.loadingMore = true;
    const seq = ++this.seq;
    const limit = menu.limit + MENTION_PAGE_SIZE;
    try {
      const { matches, total } = await this.client.completeFiles(menu.query, limit);
      if (seq !== this.seq) return STALE;
      return { ...menu, entries: MentionCompleter.entries(matches), total, limit };
    } catch {
      return STALE;
    } finally {
      this.loadingMore = false;
    }
  }

  /** Every lookup in flight is stale. */
  cancel(): void {
    this.seq++;
  }

  private static entries(files: string[]): MenuEntry[] {
    return files.map((f) => ({ key: f, label: f }));
  }
}
