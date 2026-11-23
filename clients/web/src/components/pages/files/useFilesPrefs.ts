/**
 * The viewer's display preferences — word wrap, tab width, whether the
 * file tree shows and which side it sits on. A preference of this
 * device, not of the window, so it lives in ``localStorage`` and is read
 * back defensively: a private window or blocked storage just means the
 * defaults, never a crash.
 */

import { useCallback, useState } from "react";

export type TreeSide = "left" | "right";

export interface FilesPrefs {
  wordWrap: boolean;
  tabSize: number;
  treeOpen: boolean;
  treeSide: TreeSide;
  /** The right-docked panel's width in pixels. */
  dockWidth: number;
  /** Show markdown rendered rather than as source. */
  renderMarkdown: boolean;
}

/** Tab widths the menu offers. */
export const TAB_SIZES = [2, 4, 8] as const;
/** How narrow and how wide the dock may be dragged. */
export const DOCK_MIN = 360;
export const DOCK_MAX = 1100;

const KEY = "igni.files.prefs";

const DEFAULTS: FilesPrefs = {
  wordWrap: true,
  tabSize: 4,
  treeOpen: true,
  treeSide: "right",
  dockWidth: 680,
  renderMarkdown: true,
};

function clampWidth(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(DOCK_MAX, Math.max(DOCK_MIN, n)) : DEFAULTS.dockWidth;
}

function load(): FilesPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<FilesPrefs>;
    return {
      wordWrap: typeof saved.wordWrap === "boolean" ? saved.wordWrap : DEFAULTS.wordWrap,
      tabSize: TAB_SIZES.includes(saved.tabSize as (typeof TAB_SIZES)[number])
        ? (saved.tabSize as number)
        : DEFAULTS.tabSize,
      treeOpen: typeof saved.treeOpen === "boolean" ? saved.treeOpen : DEFAULTS.treeOpen,
      treeSide: saved.treeSide === "left" || saved.treeSide === "right" ? saved.treeSide : DEFAULTS.treeSide,
      dockWidth: clampWidth(saved.dockWidth),
      renderMarkdown: typeof saved.renderMarkdown === "boolean" ? saved.renderMarkdown : DEFAULTS.renderMarkdown,
    };
  } catch {
    return DEFAULTS;
  }
}

export interface PrefsControl extends FilesPrefs {
  set: <K extends keyof FilesPrefs>(key: K, value: FilesPrefs[K]) => void;
}

export function useFilesPrefs(): PrefsControl {
  const [prefs, setPrefs] = useState<FilesPrefs>(load);

  const set = useCallback<PrefsControl["set"]>((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // A per-device convenience; losing it is not worth a failure.
      }
      return next;
    });
  }, []);

  return { ...prefs, set };
}
