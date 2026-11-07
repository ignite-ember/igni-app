/**
 * The completion menu's state, driven by typing: which menu is open, and
 * the file lookups behind the `@` one.
 */

import { useCallback, useMemo, useState } from "react";

import { SlashCommandCatalog, type SlashCommand } from "../../chat/slashCommands";
import type { IgniClient } from "../../protocol/client";
import { MentionCompleter, STALE, moveActive, type CompletionMenu } from "./completionMenu";

export interface CompletionMenuApi {
  menu: CompletionMenu | null;
  /** Open, update or close the menu for the text and caret just typed. */
  refresh: (value: string, caret: number) => Promise<void>;
  move: (delta: number) => void;
  /** Close it; a lookup still in flight will not reopen it. */
  close: () => void;
  /** The next page of the `@` menu. */
  loadMore: () => Promise<void>;
}

export function useCompletionMenu({
  client,
  backendCommands,
  skills,
}: {
  client: Pick<IgniClient, "completeFiles">;
  backendCommands: SlashCommand[] | null;
  skills: SlashCommand[];
}): CompletionMenuApi {
  const [menu, setMenu] = useState<CompletionMenu | null>(null);
  const completer = useMemo(() => new MentionCompleter(client), [client]);
  // Keyed on both lists, so the `/` filter never reads a stale pool.
  const catalog = useMemo(
    () => SlashCommandCatalog.merge(backendCommands, skills),
    [backendCommands, skills],
  );

  const close = useCallback(() => {
    completer.cancel();
    setMenu(null);
  }, [completer]);

  const refresh = async (value: string, caret: number) => {
    // `/` menu: the draft starts with `/` and the caret is in its first token.
    if (value.startsWith("/") && !value.slice(0, caret).includes(" ")) {
      completer.cancel(); // a pending @ lookup is no longer about this text
      const entries = catalog
        .filter(value.slice(1, caret))
        .map((c) => ({ key: c.name, label: c.name, desc: c.description }));
      setMenu(entries.length ? { kind: "slash", entries, active: 0, tokenStart: 0 } : null);
      return;
    }
    // `@` menu: an `@` token under the caret, at the start of a word.
    const upToCaret = value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    const query = upToCaret.slice(at + 1);
    if (at >= 0 && (at === 0 || /\s/.test(upToCaret[at - 1])) && !/\s/.test(query)) {
      const next = await completer.query(query, at);
      if (next !== STALE) setMenu(next);
      return;
    }
    close();
  };

  const loadMore = async () => {
    if (menu?.kind !== "mention") return;
    const next = await completer.loadMore(menu);
    if (next === STALE) return;
    setMenu((cur) =>
      cur?.kind === "mention" && cur.query === next.query
        ? { ...cur, entries: next.entries, total: next.total, limit: next.limit }
        : cur,
    );
  };

  return {
    menu,
    refresh,
    move: (delta) => setMenu((cur) => cur && moveActive(cur, delta)),
    close,
    loadMore,
  };
}
