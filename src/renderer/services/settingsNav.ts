import { useSyncExternalStore } from 'react';

/** The repository Settings pages, listed under Settings in the repository sidebar. */
export type SettingsSection = 'general' | 'access' | 'secrets';

let section: SettingsSection = 'general';
const listeners = new Set<() => void>();

export function setSettingsSection(next: SettingsSection): void {
  if (next === section) return;
  section = next;
  listeners.forEach((l) => l());
}

export function useSettingsSection(): SettingsSection {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => section,
  );
}
