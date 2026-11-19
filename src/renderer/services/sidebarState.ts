import { useSyncExternalStore } from 'react';

/** Whether the repositories sidebar is hidden; shared by the sidebar and the title bar's show button. */
const KEY = 'gitbaba.sidebar.hidden';
let hidden = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

export function setSidebarHidden(next: boolean | ((h: boolean) => boolean)): void {
  hidden = typeof next === 'function' ? next(hidden) : next;
  try {
    localStorage.setItem(KEY, hidden ? '1' : '0');
  } catch {
    /* per-viewer convenience */
  }
  listeners.forEach((l) => l());
}

export function useSidebarHidden(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hidden,
  );
}
