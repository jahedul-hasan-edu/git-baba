import type { Theme } from '../services/theme';
import { useApp } from '../state/AppState';
import { AppMenus } from './AppMenus';
import { NotificationBell } from './NotificationBell';
import { RepoSwitcherSlot } from './RepoSwitcher';

/** The slot RepoView fills with the open repository's name, branch, Fetch and Push. */
export const HEADER_REPO_SLOT = 'app-header-repo';

/** Global header: with no repository open, the repository dropdown and notifications on the left; otherwise the open repository's controls (its name is the dropdown). The account follows the repository; accounts are managed from File → Accounts. */
export function AppHeader() {
  const { view, activeRepo } = useApp();
  // With a repository open, the dropdown and the bell sit with its controls; otherwise here.
  const repoOpen = view === 'repo' && !!activeRepo;
  return (
    <header className="app-header">
      {!repoOpen && (
        <div className="ah-left">
          <RepoSwitcherSlot />
        </div>
      )}
      <AppMenus />
      <div id={HEADER_REPO_SLOT} className="ah-repo" />
      {/* Notifications sit at the far right; with a repository open, RepoView puts the bell after Push. */}
      {!repoOpen && (
        <div className="ah-end">
          <NotificationBell />
        </div>
      )}
    </header>
  );
}

/** Small line icons (currentColor) for each theme. */
export function ThemeIcon({ theme, size = 16 }: { theme: Theme; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (theme === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
      </svg>
    );
  }
  if (theme === 'system') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      {theme === 'dark' && <path d="M17 3.5v3M15.5 5h3M20.5 8.5v2M19.5 9.5h2" strokeWidth={1.6} />}
    </svg>
  );
}
