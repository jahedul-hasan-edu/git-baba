import { useSyncExternalStore } from 'react';

/** Repositories open as tabs, in order (repository ids). Remembered between sessions. */
const KEY = 'gitbaba.repoTabs';

let tabs: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

function set(next: string[]) {
  if (next.length === tabs.length && next.every((id, i) => id === tabs[i])) return;
  tabs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    /* per-viewer convenience */
  }
  listeners.forEach((l) => l());
}

export function useRepoTabs(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => tabs,
  );
}

/** Adds a tab (at the end, or right after `after`); no-op if it is already open. */
export function openTab(id: string, after?: string | null) {
  if (tabs.includes(id)) return;
  const i = after ? tabs.indexOf(after) : -1;
  set(i >= 0 ? [...tabs.slice(0, i + 1), id, ...tabs.slice(i + 1)] : [...tabs, id]);
}

/** Puts `id` in place of the tab `current` (switching the repository of a tab). */
export function replaceTab(current: string, id: string) {
  const i = tabs.indexOf(current);
  if (i < 0) return openTab(id);
  set(tabs.filter((t) => t !== id).map((t) => (t === current ? id : t)));
}

/** Closes a tab; returns the tab to show next (its right neighbour, else the left one), or null. */
export function closeTab(id: string): string | null {
  const i = tabs.indexOf(id);
  if (i < 0) return null;
  const next = tabs.filter((t) => t !== id);
  set(next);
  return next[i] ?? next[i - 1] ?? null;
}

/** Moves tab `id` to the position of tab `before` (drag to reorder). */
export function moveTab(id: string, before: string) {
  if (id === before || !tabs.includes(id) || !tabs.includes(before)) return;
  const rest = tabs.filter((t) => t !== id);
  const i = rest.indexOf(before);
  const from = tabs.indexOf(id);
  const to = tabs.indexOf(before);
  // Dragging rightwards drops after the target; leftwards, before it.
  rest.splice(from < to ? i + 1 : i, 0, id);
  set(rest);
}

/** Drops tabs whose repositories are no longer in the app. */
export function pruneTabs(known: Set<string>) {
  const next = tabs.filter((t) => known.has(t));
  if (next.length !== tabs.length) set(next);
}

/** Opens the repository picker anchored at a point; `mode` says whether the pick opens a new tab or replaces the current one. */
export const REPO_PICKER_EVENT = 'gb:repo-picker';
export type RepoPickerRequest = { x: number; y: number; mode: 'new' | 'replace' };
export const requestRepoPicker = (r: RepoPickerRequest) => window.dispatchEvent(new CustomEvent<RepoPickerRequest>(REPO_PICKER_EVENT, { detail: r }));
