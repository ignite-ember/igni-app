/**
 * Whether the sidebar shows the cat: a preference of this device, kept
 * in localStorage, shared by the account menu's switch and the sidebar.
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "igni:sidebar-cat";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage?.getItem(STORAGE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

/** Show or hide the cat on this device. */
export function setCatShown(shown: boolean): void {
  try {
    if (shown) window.localStorage?.removeItem(STORAGE_KEY);
    else window.localStorage?.setItem(STORAGE_KEY, "hidden");
  } catch {
    // Storage blocked: the choice lasts until the window closes.
  }
  shownNow = shown;
  for (const listener of listeners) listener();
}

let shownNow = typeof window === "undefined" ? true : read();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the cat shows, and the way to change it. */
export function useCatShown(): [boolean, (shown: boolean) => void] {
  const shown = useSyncExternalStore(subscribe, () => shownNow, () => true);
  return [shown, useCallback(setCatShown, [])];
}
