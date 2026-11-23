/**
 * What the Files viewer is showing — the open tabs, which is active,
 * where the navigator is pointed, and how far each file is scrolled.
 *
 * Held above the dock, in the window, so closing the dock (the folder
 * button, the ✕) keeps the tabs and their scroll offsets for when it is
 * reopened. Only a different project is a different tree, so that — and
 * nothing else — starts it clean.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { parentDir } from "./fileTree";

export interface FilesSession {
  /** Open files, in the order opened. */
  tabs: string[];
  /** The file the viewer shows (``""`` for none). */
  activePath: string;
  /** The navigator's search box. */
  query: string;
  setQuery: (next: string) => void;
  setActive: (path: string) => void;
  /** Open a file (adds a tab if new) and show its folder. */
  open: (path: string) => void;
  /** Close a tab, falling back to a neighbour. */
  close: (path: string) => void;
  /** Per-file scroll offsets, surviving the dock's open and close. */
  scrollMemory: Map<string, number>;
}

export function useFilesSession(projectDir: string): FilesSession {
  const [tabs, setTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState("");
  const [query, setQuery] = useState("");
  const scrollMemory = useRef<Map<string, number>>(new Map());

  // A different project is a different tree: drop the tabs, the scroll
  // offsets and the search. The same project reopening keeps them.
  const lastProject = useRef(projectDir);
  useEffect(() => {
    if (lastProject.current === projectDir) return;
    lastProject.current = projectDir;
    setTabs([]);
    setActivePath("");
    setQuery("");
    scrollMemory.current.clear();
  }, [projectDir]);

  const open = useCallback((path: string) => {
    setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
    setQuery(parentDir(path) ? `${parentDir(path)}/` : "");
  }, []);

  const close = useCallback((path: string) => {
    setTabs((prev) => {
      const at = prev.indexOf(path);
      const next = prev.filter((p) => p !== path);
      setActivePath((cur) => (cur === path ? (next[at] ?? next[at - 1] ?? "") : cur));
      return next;
    });
    scrollMemory.current.delete(path);
  }, []);

  return {
    tabs,
    activePath,
    query,
    setQuery,
    setActive: setActivePath,
    open,
    close,
    scrollMemory: scrollMemory.current,
  };
}
