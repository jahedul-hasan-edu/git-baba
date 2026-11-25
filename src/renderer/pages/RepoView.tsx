import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { providerInfo, providerLinks } from '../../shared/providers';
import { ProviderMono } from '../components/ProviderMono';
import { ProviderHub } from './provider/ProviderHub';
import { createPortal } from 'react-dom';
import { HEADER_REPO_SLOT } from '../components/AppHeader';
import { NotificationBell } from '../components/NotificationBell';
import { requestCompare } from '../services/compareRequest';
import { Spinner } from '../components/Modal';
import type { PullResult } from '../../shared/types';
import type { RepoAccess } from '../../shared/github';
import { RepoSyncBar } from '../components/RepoSyncBar';
import { RepoSwitcherSlot } from '../components/RepoSwitcher';
import { AddAccountDialog } from '../dialogs/AddAccountDialog';
import { FetchDialog } from '../dialogs/FetchDialog';
import { GitHubAppSetupDialog } from '../dialogs/GitHubAppSetupDialog';
import { PullDialog } from '../dialogs/PullDialog';
import { PushDialog } from '../dialogs/PushDialog';
import { QuickMergeHost } from '../dialogs/QuickMergeDialog';
import { useAsync } from '../hooks/useAsync';
import { call } from '../services/api';
import { useApp, type RepoTab } from '../state/AppState';
import { MissingWorktree } from './MissingWorktree';
import { RepoSettingsPage } from './RepoSettingsPage';

// Screens load on demand (smaller start-up bundle).
const WorkspacePage = lazy(() => import('./workspace/WorkspacePage').then((m) => ({ default: m.WorkspacePage })));
const CodePage = lazy(() => import('./code/CodePage').then((m) => ({ default: m.CodePage })));
const ConflictsPage = lazy(() => import('./ConflictsPage').then((m) => ({ default: m.ConflictsPage })));
const ActionsTab = lazy(() => import('./github/ActionsTab').then((m) => ({ default: m.ActionsTab })));
const PullRequestsTab = lazy(() => import('./github/PullRequestsTab').then((m) => ({ default: m.PullRequestsTab })));
const PullRequestPage = lazy(() => import('./PullRequestPage').then((m) => ({ default: m.PullRequestPage })));
import { FILTER_EVENT, requestClearFilter } from '../services/jump';
const RepoSettingsShell = lazy(() => import('./repoSettings/RepoSettingsShell').then((m) => ({ default: m.RepoSettingsShell })));

export function RepoView() {
  const { activeRepo, repoTab, setRepoTab, revision, bump, appSetupRepoId, requestAppSetup, activeAccount, accounts, setAccounts, refreshSession, refreshRepos, toast, setView, switchingAccount, ghKey } = useApp();
  // Opening a repository moves to its account on its own; for that moment nothing is shown as locked.
  const otherAccount = !switchingAccount && activeRepo?.account && activeRepo.account.id !== activeAccount?.id ? activeRepo.account : null;
  // The account this repository belongs to was signed out (or removed): ask to sign in to it again.
  const missingAccount = activeRepo?.missingAccount ?? null;
  const [signInMissing, setSignInMissing] = useState(false);
  // Opening a repository re-checks its account (it may have been signed out since the list was loaded).
  useEffect(() => {
    void refreshRepos().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepo?.id]);
  const [dialog, setDialog] = useState<'fetch' | 'pull' | 'push' | null>(null);
  const lockedRef = useRef(false);
  lockedRef.current = !!otherAccount;
  // Other screens (e.g. the clean Changes screen) can open the sync dialogs.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<'fetch' | 'pull' | 'push'>).detail;
      if (lockedRef.current) return;
      if (d === 'fetch' || d === 'pull' || d === 'push') setDialog(d);
    };
    window.addEventListener('gb:repo-dialog', on);
    return () => window.removeEventListener('gb:repo-dialog', on);
  }, []);
  const repoId = activeRepo?.id ?? '';
  const status = useAsync(() => (repoId && activeRepo?.exists ? call('git:status', { repoId }) : Promise.resolve(null)), [repoId, revision, activeRepo?.exists]);
  // Edits made outside the app (editor, build tools, another terminal) show up without a click:
  // while the window is visible, quietly re-read the status and apply it only when it changed.
  const setStatusData = status.setData;
  const lastSig = useRef('');
  useEffect(() => {
    if (!repoId || !activeRepo?.exists) return;
    let stop = false;
    let busy = false;
    lastSig.current = JSON.stringify(status.data);
    const tick = async () => {
      if (busy || stop || document.hidden || !document.hasFocus()) return;
      busy = true;
      try {
        const next = await call('git:status', { repoId });
        const sig = JSON.stringify(next);
        if (!stop && sig !== lastSig.current) {
          lastSig.current = sig;
          setStatusData(next);
        }
      } catch {
        /* transient (index busy, repo mid-operation): the next tick retries */
      } finally {
        busy = false;
      }
    };
    const t = window.setInterval(() => void tick(), 2000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, activeRepo?.exists, revision]);
  // A branch switch whose re-applied changes still need conflict resolution.
  const switchSession = useAsync(() => (repoId && activeRepo?.exists ? call('git:switchSession', { repoId }) : Promise.resolve(null)), [repoId, revision, activeRepo?.exists]);

  // The repository's name, branch, Fetch and Push live in the app header (next to the account).
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setHeaderSlot(document.getElementById(HEADER_REPO_SLOT)), []);

  // A tab this repository's provider does not have (e.g. Pull Requests on a plain Git server) falls back to Changes.
  const prov = activeRepo?.provider && activeRepo.provider.id !== 'github' ? activeRepo.provider : null;
  // GitHub: what the repository's account may do here — role, pull requests, Actions. Probed when it opens (once the
  // app is on the right account) and again after signing in; tabs it cannot use are not shown.
  const [access, setAccess] = useState<RepoAccess | null>(null);
  const accessReady = !!activeRepo?.github && !!activeRepo.exists && !otherAccount && !missingAccount && !!activeAccount;
  const loadAccess = useCallback(
    (refresh = false) => {
      if (!accessReady || !repoId) return setAccess(null);
      call('gh:access', { repoId, refresh })
        .then(setAccess)
        .catch(() => setAccess(null)); // unknown: keep every tab (each one explains its own problem)
    },
    [accessReady, repoId],
  );
  useEffect(() => {
    setAccess(null);
    loadAccess();
  }, [loadAccess, ghKey]);
  const pullsOff = !!access && !access.pulls.ok;
  const actionsOff = !!access && !access.actions.ok;
  const tabMissing =
    (!!prov && ((repoTab === 'pulls' && !(providerInfo(prov.id).tabs.pulls && providerLinks(prov).pulls)) || (repoTab === 'actions' && !(providerInfo(prov.id).tabs.pipelines && providerLinks(prov).pipelines)))) ||
    (repoTab === 'pulls' && pullsOff) ||
    (repoTab === 'actions' && actionsOff);
  useEffect(() => {
    if (tabMissing) setRepoTab('changes');
  }, [tabMissing, setRepoTab]);

  if (!activeRepo) return null;
  const st = status.data;
  const conflictCount = st?.conflicted.length ?? 0;
  const inOperation = !!st?.operation || !!switchSession.data;

  // GitHub keeps its own Pull Requests and Actions tabs. Other providers get their own names, and a tab only when
  // the provider has that feature (a plain Git server has neither).
  const other = activeRepo.provider && activeRepo.provider.id !== 'github' ? activeRepo.provider : null;
  const otherInfo = other ? providerInfo(other.id) : null;
  const otherLinks = other ? providerLinks(other) : null;
  const pullsLabel = other ? (otherInfo!.tabs.pulls && otherLinks!.pulls ? otherInfo!.tabs.pulls : null) : pullsOff ? null : 'Pull Requests';
  const pipelinesLabel = other ? (otherInfo!.tabs.pipelines && otherLinks!.pipelines ? otherInfo!.tabs.pipelines : null) : actionsOff ? null : 'Actions';
  const tabs: [RepoTab, string, number | null, string][] = [
    ['changes', 'Changes', st ? st.staged.length + st.unstaged.length + st.untracked.length : null, '✎'],
    ['code', 'Code', null, '</>'],
    ...(pullsLabel ? ([['pulls', pullsLabel, null, '⇄']] as [RepoTab, string, null, string][]) : []),
    ...(pipelinesLabel ? ([['actions', pipelinesLabel, null, '▶']] as [RepoTab, string, null, string][]) : []),
    ...(inOperation || conflictCount > 0 ? ([['conflicts', 'Conflicts', conflictCount, '⚠']] as [RepoTab, string, number, string][]) : []),
    ['settings', 'Settings', null, '⚙'],
  ];

  const switchToOwner = async () => {
    if (!otherAccount) return;
    setAccounts(await call('accounts:setActive', { accountId: otherAccount.id }));
    await refreshSession().catch(() => undefined);
    toast(`Switched to ${otherAccount.login}`);
    bump();
  };
  // Another account's repository: everything but Settings stays locked until the user switches.
  // A GitHub repository opens only with a GitHub account shown (signed in) in the header.
  const noAccount = !!activeRepo?.github && !!accounts && !activeAccount;
  const locked = !!otherAccount || noAccount || !!missingAccount;

  const onMissingSignedIn = async (a: { id: string; login: string }) => {
    if (!missingAccount || a.login.toLowerCase() !== missingAccount.login.toLowerCase()) return;
    // Make it the account in use, so the repository opens straight away.
    setAccounts(await call('accounts:setActive', { accountId: a.id }));
    await Promise.all([refreshSession().catch(() => undefined), refreshRepos().catch(() => undefined)]);
    bump();
  };

  const onPullDone = (r: PullResult | null) => {
    setDialog(null);
    bump();
    if (r?.outcome === 'conflicts') setRepoTab('conflicts');
  };

  return (
    <>
      {headerSlot &&
        createPortal(
      <div className="ah-deck">
        <RepoIdentity />
        {st?.operation && <span className="badge danger">{st.operation} in progress</span>}
        <NotificationBell />
        <RepoSyncBar
          repoId={repoId}
          isGitHub={!!activeRepo.github}
          hasRemote={!!activeRepo.remoteUrl}
          status={st ?? null}
          loading={status.loading}
          inOperation={inOperation}
          disabled={!activeRepo.exists || locked}
          onRefresh={() => bump()}
          onFetch={() => setDialog('fetch')}
          onPull={() => setDialog('pull')}
          onPush={() => setDialog('push')}
        />
      </div>,
          headerSlot,
        )}

      {!activeRepo.exists && activeRepo.worktreeOf ? (
        <MissingWorktree key={activeRepo.id} repo={activeRepo} />
      ) : !activeRepo.exists ? (
        <div className="content">
          <div className="banner danger">
            <span className="icon">⚠</span>
            <div>
              <strong>Repository folder missing</strong>
              <div>{activeRepo.path} no longer exists. Remove it from the app in Settings, or restore the folder.</div>
            </div>
          </div>
          <RepoSettingsPage />
        </div>
      ) : (
        <>
          <div className="repo-banners">
          {otherAccount && repoTab === 'settings' && (
            <div className="banner warn">
              <span className="icon">⇄</span>
              <div className="grow">
                <strong>This repository belongs to {otherAccount.login}.</strong>{' '}
                {activeAccount ? `You are using ${activeAccount.login}. ` : ''}Switch to {otherAccount.login} to commit, push, pull and use pull requests or Actions here.
              </div>
              <button
                className="btn sm primary"
                onClick={() => void switchToOwner()}
              >
                Switch to {otherAccount.login}
              </button>
            </div>
          )}
          {inOperation && repoTab !== 'conflicts' && (
            <div className="banner warn">
              <span className="icon">⚠</span>
              <div className="grow">
                {switchSession.data && !st?.operation
                  ? `Your changes from ${switchSession.data.from ?? 'detached HEAD'} are being brought to ${switchSession.data.to}`
                  : `A ${st?.operation} is in progress`}
                {conflictCount ? ` with ${conflictCount} conflicted file(s)` : ''}.
              </div>
              <button className="btn sm" onClick={() => setRepoTab('conflicts')}>
                Open conflict resolution
              </button>
            </div>
          )}
          </div>
          <TabDock tabs={tabs} active={repoTab} onPick={setRepoTab} locked={locked} extra={access && (pullsOff || actionsOff || !!access.pulls.why) ? <AccessNote access={access} onRecheck={() => loadAccess(true)} /> : null} />
<Suspense fallback={<div className="content"><Spinner label="Loading…" /></div>}>
          {missingAccount ? (
            <div className="content">
              <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 36 }}>🔐</div>
                <h2>Sign in to {missingAccount.login} to open this repository</h2>
                <p className="muted">
                  {activeRepo.name}
                  {missingAccount.viaOrg ? ` (${missingAccount.viaOrg})` : ''} belongs to {missingAccount.login}, which is signed out of Git Baba. Your files are safe on this computer — sign in to{' '}
                  {missingAccount.login} again for changes, code, pull requests, Actions and syncing.
                </p>
                <button className="btn primary" onClick={() => setSignInMissing(true)}>
                  Sign in to {missingAccount.login}
                </button>
              </div>
            </div>
          ) : noAccount ? (
            <div className="content">
              <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 36 }}>🔐</div>
                <h2>Sign in to GitHub to open this repository</h2>
                <p className="muted">
                  {activeRepo.name} is on GitHub. Add your GitHub account once — Git Baba also picks up a sign-in already on this PC — and it stays signed in.
                </p>
                <button className="btn primary" onClick={() => setView('accounts')}>
                  Sign in to GitHub
                </button>
              </div>
            </div>
          ) : locked && otherAccount ? (
            <div className="content">
              <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 36 }}>🔒</div>
                <h2>Switch to {otherAccount.login} to open this repository</h2>
                <p className="muted">
                  {activeRepo.name} belongs to {otherAccount.login}
                  {activeAccount ? `, but you are using ${activeAccount.login}` : ''}. Changes, code, pull requests, Actions, settings and syncing are available once {otherAccount.login} is the active account.
                </p>
                <button className="btn primary" onClick={() => void switchToOwner()}>
                  ⇄ Switch to {otherAccount.login}
                </button>
              </div>
            </div>
          ) : (
          <>
          {repoTab === 'changes' && <WorkspacePage status={st} reload={status.reload} error={status.error} />}
          {repoTab === 'code' && <CodePage key={repoId} />}
          {repoTab === 'pr' && <PullRequestPage />}
          {repoTab === 'pulls' && (other ? pullsLabel && <ProviderHub repo={activeRepo} status={st ?? null} kind="pulls" /> : <PullRequestsTab />)}
          {repoTab === 'actions' && (other ? pipelinesLabel && <ProviderHub repo={activeRepo} status={st ?? null} kind="pipelines" /> : <ActionsTab />)}
          {repoTab === 'conflicts' && <ConflictsPage status={st} switchSession={switchSession.data ?? null} />}
          {repoTab === 'settings' && (
            <div className="content">
              <RepoSettingsShell />
            </div>
          )}
          </>
          )}
</Suspense>
        </>
      )}

      {dialog === 'fetch' && (
        <FetchDialog
          repoId={repoId}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            bump();
          }}
        />
      )}
      {appSetupRepoId === activeRepo.id && <GitHubAppSetupDialog repo={activeRepo} onClose={() => requestAppSetup(null)} />}
      <QuickMergeHost repoId={repoId} />
      {dialog === 'pull' && <PullDialog repoId={repoId} onClose={() => setDialog(null)} onDone={onPullDone} />}
      {dialog === 'push' && (
        <PushDialog
          repoId={repoId}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            bump();
          }}
          onRequestPull={() => setDialog('pull')}
        />
      )}
      {signInMissing && missingAccount && (
        <AddAccountDialog
          expectLogin={missingAccount.login}
          expectApiBaseUrl={missingAccount.apiBaseUrl}
          onAdded={(a) => void onMissingSignedIn(a)}
          onClose={() => setSignInMissing(false)}
        />
      )}
    </>
  );
}

const DECK_COLORS = ['#5b8cff', '#3ecf8e', '#f5b84a', '#ff6b6b', '#b18cff', '#6cc4ff', '#ff9f6b', '#9fd36b'];
const deckColor = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DECK_COLORS[h % DECK_COLORS.length];
};

/** Repository identity: monogram tile, name and interactive chips (remote, account, owner, folder). */
/** Visibility of GitHub repositories, by repo id: fetched once per session. */
const visibilityCache = new Map<string, 'private' | 'public'>();

const ICONS = {
  github: 'M12 2C6.48 2 2 6.58 2 12.22c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.36-3.37-1.36-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.56 2.350 1.11 2.92.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.030 1.64 1.03 2.76 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9v2.81c0 .27.18.6.69.49A10.1 10.1 0 0 0 22 12.22C22 6.58 17.52 2 12 2z',
  cloud: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.1 4.5 4.5 0 0 0 7 18z',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
} as const;

function Ic({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function RepoIdentity() {
  const { activeRepo, repos, selectRepo, ghKey } = useApp();
  const [vis, setVis] = useState<'private' | 'public' | null>(null);
  const repoId = activeRepo?.id;
  const isGh = !!activeRepo?.github;
  useEffect(() => {
    if (!repoId || !isGh) {
      setVis(null);
      return;
    }
    const known = visibilityCache.get(repoId);
    if (known) {
      setVis(known);
      return;
    }
    setVis(null);
    let live = true;
    call('gh:context', { repoId })
      .then((c) => {
        const v = c.isPrivate ? 'private' : 'public';
        visibilityCache.set(repoId, v);
        if (live) setVis(v);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repoId, isGh, ghKey]);
  if (!activeRepo) return null;
  const mainRepo = activeRepo.worktreeOf ? repos.find((r) => r.id === activeRepo.worktreeOf) : undefined;
  const c = deckColor(activeRepo.identity ?? activeRepo.name);
  const remote = activeRepo.remoteUrl ?? activeRepo.identity;
  // The provider's logo stands in for the repository tile; a repository with no remote gets a folder.
  const provId = activeRepo.github ? 'github' : (activeRepo.provider?.id ?? null);
  return (
    <div className="deck-id">
      {provId ? (
        <span className="deck-logo" title={`${providerInfo(provId).name}${remote ? ` · ${remote}` : ''}`}>
          <ProviderMono id={provId} size={30} />
        </span>
      ) : (
        <div className="deck-tile local" style={{ ['--rc' as string]: c }} title="Local repository — no remote">
          📁
        </div>
      )}
      <div className="deck-main">
        <div className="deck-title">
          <h1 className="deck-name">
            <RepoSwitcherSlot />
          </h1>
          {vis && (
            <span className={`deck-vis ${vis}`} title={vis === 'private' ? 'Private repository: only people with access can see it' : 'Public repository: anyone can see it'}>
              <Ic d={vis === 'private' ? ICONS.lock : ICONS.globe} />
              {vis === 'private' ? 'Private' : 'Public'}
            </span>
          )}
          {!remote && (
            <span className="deck-vis local" title="This repository has no remote">
              Local only
            </span>
          )}
        </div>
        <div className="deck-acts">
          {mainRepo && (
            <button className="deck-chip wt-of" onClick={() => selectRepo(mainRepo.id)} title={`This folder is a worktree of ${mainRepo.name}\nClick to go back to the main folder`}>
              <span>🗂</span>
              <span className="ellipsis">worktree of {mainRepo.name}</span>
              <span className="deck-chip-go">↩</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tab bar with icons, a sliding active indicator, counts and Ctrl+1…9 shortcuts. */
function TabDock({ tabs, active, onPick: pick, locked, extra }: { tabs: [RepoTab, string, number | null, string][]; active: RepoTab; onPick: (t: RepoTab) => void; locked?: boolean; extra?: ReactNode }) {
  const isOff = (_t: RepoTab) => !!locked;
  const onPick = (t: RepoTab) => {
    if (!isOff(t)) pick(t);
  };
  const ref = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!el) return setInk(null);
    setInk({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active, tabs.length]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && tabs[n - 1]) {
        e.preventDefault();
        onPick(tabs[n - 1][0]);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [tabs, onPick]);
  useEffect(() => {
    const on = () => {
      const el = ref.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
      if (el) setInk({ left: el.offsetLeft, width: el.offsetWidth });
    };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [active]);
  const [filtered, setFiltered] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setFiltered(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(FILTER_EVENT, on);
    return () => window.removeEventListener(FILTER_EVENT, on);
  }, []);
  return (
    <div className="tabs dock" ref={ref} role="tablist">
      {tabs.map(([id, label, count, icon], i) => (
        <div
          key={id}
          data-tab={id}
          role="tab"
          aria-selected={active === id}
          aria-disabled={isOff(id)}
          className={`tab ${active === id ? 'active' : ''} ${id === 'conflicts' ? 'alert' : ''}`}
          style={isOff(id) ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          onClick={() => onPick(id)}
          title={isOff(id) ? `Switch account to use ${label}` : i < 9 ? `${label} (Ctrl+${i + 1})` : label}
        >
          <span className="tab-ico">{icon}</span>
          {label}
          {count !== null && count > 0 && <span className={`tab-count ${id === 'conflicts' ? 'danger' : ''}`}>{count}</span>}
        </div>
      ))}
      {ink && <span className="tab-ink" style={{ transform: `translateX(${ink.left}px)`, width: ink.width }} />}
      {extra}
      <button
        className="tab-compare"
        disabled={!!locked}
        onClick={() => {
          if (active !== 'changes') pick('changes');
          requestCompare();
        }}
        title={locked ? 'Switch to the account this repository belongs to first' : 'Compare branches, tags or commits'}
      >
        ⇄ Compare
      </button>
      {filtered && (
        <button className="tab-clear" onClick={requestClearFilter} title="Show all commits again">
          ✕ Clear search
        </button>
      )}
    </div>
  );
}

/**
 * "Limited access": the features hidden for this repository's account, why, and how to grant them. Rechecking
 * after changing the token (or signing in to the GitHub CLI) brings the tabs back.
 */
function AccessNote({ access, onRecheck }: { access: RepoAccess; onRecheck: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', down);
    return () => window.removeEventListener('mousedown', down);
  }, [open]);
  // Hidden features, and ones that work with less (e.g. pull requests over REST only).
  const rows = ([
    ['⇄', 'Pull requests', access.pulls],
    ['▶', 'Actions', access.actions],
  ] as const).filter(([, , f]) => !f.ok || !!f.why);
  const hidden = rows.filter(([, , f]) => !f.ok).length;
  const tokenPage = access.fineGrained ? 'https://github.com/settings/personal-access-tokens' : 'https://github.com/settings/tokens';
  return (
    <div className="acn" ref={ref}>
      <button className={`acn-btn ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} title="Some features are hidden: this account may not use them here">
        {hidden ? `🔒 ${hidden} hidden` : '◐ Limited'}
      </button>
      {open && (
        <div className="acn-pop pop-in" role="dialog" aria-label="Access">
          <div className="acn-head">
            <strong>{access.login}</strong>
            <span className="acn-role">{access.role ?? 'no role'}</span>
            {access.via === 'gh' && <span className="acn-role">via GitHub CLI</span>}
          </div>
          {rows.map(([ico, name, f]) => (
            <div key={name} className={`acn-row ${f.ok ? 'part' : ''}`}>
              <span className="acn-ico">{ico}</span>
              <span className="grow">
                <strong>
                  {name} <span className={`acn-state ${f.ok ? 'part' : 'off'}`}>{f.ok ? 'limited' : 'hidden'}</span>
                </strong>
                <span className="small muted">{f.why}</span>
              </span>
            </div>
          ))}
          <div className="acn-foot">
            <a className="small" onClick={() => void call('shell:openExternal', { url: tokenPage }).catch(() => undefined)}>
              {access.fineGrained ? 'Edit token permissions ↗' : 'Token settings ↗'}
            </a>
            <span className="grow" />
            <button
              className="btn sm"
              onClick={() => {
                setOpen(false);
                onRecheck();
              }}
            >
              ↻ Check again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
