import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { providerInfo, providerLinks } from '../../shared/providers';
import { ProviderHub } from './provider/ProviderHub';
import { createPortal } from 'react-dom';
import { HEADER_REPO_SLOT } from '../components/AppHeader';
import { Spinner } from '../components/Modal';
import type { PullResult } from '../../shared/types';
import type { RepoAccess } from '../../shared/github';
import { RepoSyncBar } from '../components/RepoSyncBar';
import { RepoSwitcherSlot } from '../components/RepoSwitcher';
import { RepoNav } from './RepoNav';
import { ChangesPage } from './ChangesPage';
import { requestOpenFile } from '../services/openFile';
import { AddAccountDialog } from '../dialogs/AddAccountDialog';
import { FetchDialog } from '../dialogs/FetchDialog';
import { GitHubAppSetupDialog } from '../dialogs/GitHubAppSetupDialog';
import { PullDialog } from '../dialogs/PullDialog';
import { PushDialog } from '../dialogs/PushDialog';
import { QuickMergeHost } from '../dialogs/QuickMergeDialog';
import { useAsync } from '../hooks/useAsync';
import { call } from '../services/api';
import { useApp } from '../state/AppState';
import { MissingWorktree } from './MissingWorktree';
import { RepoSettingsPage } from './RepoSettingsPage';

// Screens load on demand (smaller start-up bundle).
const WorkspacePage = lazy(() => import('./workspace/WorkspacePage').then((m) => ({ default: m.WorkspacePage })));
const CodePage = lazy(() => import('./code/CodePage').then((m) => ({ default: m.CodePage })));
const ConflictsPage = lazy(() => import('./ConflictsPage').then((m) => ({ default: m.ConflictsPage })));
const ActionsTab = lazy(() => import('./github/ActionsTab').then((m) => ({ default: m.ActionsTab })));
const PullRequestsTab = lazy(() => import('./github/PullRequestsTab').then((m) => ({ default: m.PullRequestsTab })));
const PullRequestPage = lazy(() => import('./PullRequestPage').then((m) => ({ default: m.PullRequestPage })));
const RepoSettingsShell = lazy(() => import('./repoSettings/RepoSettingsShell').then((m) => ({ default: m.RepoSettingsShell })));

/** Width (% of the page) of the Changes panel beside non-History pages: the same size as in History. */
function changesPaneWidth(): number {
  try {
    const v = Number(localStorage.getItem('gb.ws.paneW')) || 36;
    return Math.max(30, Math.min(42, v));
  } catch {
    return 36;
  }
}

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
  const [dialog, setDialog] = useState<'fetch' | 'pull' | 'pull-review' | 'push' | null>(null);
  const lockedRef = useRef(false);
  lockedRef.current = !!otherAccount;
  // Other screens (e.g. the clean Changes screen) can open the sync dialogs.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<'fetch' | 'pull' | 'pull-review' | 'push'>).detail;
      if (lockedRef.current) return;
      if (d === 'fetch' || d === 'pull' || d === 'pull-review' || d === 'push') setDialog(d);
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
  // The Changes panel rises through the repository bar to the top: publish the bar's height for it.
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>('.app-header');
    if (!bar) return;
    const set = () => document.documentElement.style.setProperty('--repo-bar-h', `${bar.offsetHeight}px`);
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    set();
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--repo-bar-h');
    };
  }, [headerSlot]);
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
          onPullReview={() => setDialog('pull-review')}
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
          {/* The left sidebar replaces the Changes / Code / Pull Requests / Actions / Settings tab bar. */}
          <div className="rn-layout">
          <RepoNav
            tab={repoTab}
            onPick={setRepoTab}
            pullsLabel={pullsLabel}
            pipelinesLabel={pipelinesLabel}
            conflictCount={conflictCount}
            showConflicts={inOperation || conflictCount > 0}
            locked={locked}
            branch={st?.branch ?? null}
            extra={access && (pullsOff || actionsOff || !!access.pulls.why) ? <AccessNote access={access} onRecheck={() => loadAccess(true)} /> : null}
          />
          <div className="rn-main">
<Suspense fallback={<div className="content"><Spinner label="Loading…" /></div>}>
          {missingAccount ? (
            <div className="content">
              <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 'var(--fs-3xl)' }}>🔐</div>
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
                <div style={{ fontSize: 'var(--fs-3xl)' }}>🔐</div>
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
                <div style={{ fontSize: 'var(--fs-3xl)' }}>🔒</div>
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
          {repoTab !== 'changes' && (
            // Every other page keeps the Changes panel (stage, commit) on the right; a file picked there opens in History.
            <div className="rn-split">
              <div className="rn-page">
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
              </div>
              <aside className="rn-changes" style={{ width: `${changesPaneWidth()}%` }}>
                <ChangesPage
                  status={st ?? null}
                  reload={status.reload}
                  error={status.error}
                  docked={{ diffHost: null, clean: null }}
                  onOpenFile={(f) => {
                    requestOpenFile({ path: f.path, area: f.area });
                    setRepoTab('changes');
                  }}
                />
              </aside>
            </div>
          )}
          </>
          )}
</Suspense>
          </div>
          </div>
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
      {dialog === 'pull' && <PullDialog direct repoId={repoId} onClose={() => setDialog(null)} onDone={onPullDone} />}
      {dialog === 'pull-review' && <PullDialog repoId={repoId} onClose={() => setDialog(null)} onDone={onPullDone} />}
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


/** Repository identity: monogram tile, name and interactive chips (remote, account, owner, folder). */
/** Visibility of GitHub repositories, by repo id: fetched once per session. */
const visibilityCache = new Map<string, 'private' | 'public'>();

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
  const remote = activeRepo.remoteUrl ?? activeRepo.identity;
  // The provider's logo stands in for the repository tile; a repository with no remote gets a folder.
  const provId = activeRepo.github ? 'github' : (activeRepo.provider?.id ?? null);
  return (
    <div className="deck-id">
      <div className="deck-main">
        <div className="deck-title">
          {/* The repository capsule (provider logo, owner, name) is the repository dropdown. */}
          <h1 className="deck-name" title={provId ? `${providerInfo(provId).name}${remote ? ` · ${remote}` : ''}` : 'Local repository — no remote'}>
            {/* Private / public shows as a lock or globe badge on the capsule's logo. */}
            <RepoSwitcherSlot visibility={vis} />
          </h1>
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
