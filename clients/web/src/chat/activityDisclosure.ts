/**
 * Which activity groups the person has opened, by group key.
 *
 * A group's row unmounts when Virtuoso scrolls it away and the whole
 * list is rebuilt on a session reload, so the choice cannot live in
 * the row. It is a per-block disclosure (``viewState.allowlist.ts``),
 * not the window model's, kept here and in this device's storage so a
 * group opened before a reload is open after it. Keys a run does not
 * anchor (``item:<id>``) are kept for this page only: item ids are
 * minted afresh on every load.
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "igni:activity-open";
/** Keys kept in storage, newest last. */
const STORED_MAX = 400;

type Listener = () => void;

/** A step's clock key: apart from the group keys in the same map. */
const stepKey = (group: string, index: number): string => `${group}#${index}`;

/** The open-group set, with its storage. */
export class ActivityDisclosure {
  private open: ReadonlySet<string>;
  private readonly listeners = new Set<Listener>();
  /** When each group was first and last seen running, for its clock. */
  private readonly clocks = new Map<string, { start: number; end: number | null }>();
  /** The steps of each group whose clocks run, by group key. */
  private readonly liveSteps = new Map<string, ReadonlySet<number>>();

  constructor(private readonly storage: Storage | null) {
    this.open = new Set(this.read());
  }

  isOpen(key: string): boolean {
    return this.open.has(key);
  }

  /** Open or close ``key``. */
  set(key: string, open: boolean): void {
    if (this.open.has(key) === open) return;
    const next = new Set(this.open);
    if (open) next.add(key);
    else next.delete(key);
    this.open = next;
    this.write();
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Mark ``key`` running or not at ``now``; returns its clock. */
  clock(key: string, running: boolean, now: number): { start: number; end: number | null } | null {
    const seen = this.clocks.get(key);
    if (running) {
      if (!seen) {
        const fresh = { start: now, end: null };
        this.clocks.set(key, fresh);
        return fresh;
      }
      seen.end = null;
      return seen;
    }
    if (seen && seen.end === null) seen.end = now;
    return seen ?? null;
  }

  /** Mark the steps at ``live`` of group ``key`` running at ``now``, and
   *  stop the clocks of its steps that were and are no longer. */
  stepClocks(key: string, live: readonly number[], now: number): void {
    const before = this.liveSteps.get(key);
    if (!before && live.length === 0) return;
    for (const index of before ?? []) {
      if (!live.includes(index)) this.clock(stepKey(key, index), false, now);
    }
    for (const index of live) this.clock(stepKey(key, index), true, now);
    if (live.length === 0) this.liveSteps.delete(key);
    else this.liveSteps.set(key, new Set(live));
  }

  /** When step ``index`` of group ``key`` was seen running; null when never. */
  stepTime(key: string, index: number): { start: number; end: number | null } | null {
    return this.clocks.get(stepKey(key, index)) ?? null;
  }

  private read(): string[] {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    const kept = [...this.open].filter((k) => !k.startsWith("item:")).slice(-STORED_MAX);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(kept));
    } catch {
      /* Storage may be off: the choice lasts this page only. */
    }
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The page's open-group set. */
export const activityDisclosure = new ActivityDisclosure(defaultStorage());

/** Whether group ``key`` is open, and the way to change it. */
export function useActivityOpen(
  key: string,
  store: ActivityDisclosure = activityDisclosure,
): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    store.subscribe,
    () => store.isOpen(key),
    () => store.isOpen(key),
  );
  const set = useCallback((next: boolean) => store.set(key, next), [store, key]);
  return [open, set];
}
