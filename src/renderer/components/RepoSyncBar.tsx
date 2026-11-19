import { useCallback, useEffect, useRef, useState } from 'react';
import type { BranchInfo, RepoStatus, StashEntry } from '../../shared/types';
import { SwitchBranchDialog } from '../dialogs/BranchDialogs';
import { call } from '../services/api';
import { useApp } from '../state/AppState';
import { requestQuickMerge } from '../services/quickMerge';
import { isPublished } from '../../shared/publish';
import { requestRailAction, type RailAction } from '../services/railActions';
import { BranchPickerPanel, toPickerItems } from './BranchPicker';

const REMOTE_CHECK_MS = 3 * 60 * 1000;

interface Props {
  repoId: string;
  isGitHub: boolean;
  /** False for a repository without any remote (e.g. just created locally): there is nowhere to sync with. */
  hasRemote: boolean;
  status: RepoStatus | null;
  loading: boolean;
  inOperation: boolean;
  disabled: boolean;
  onRefresh: () => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
}

/** A right-click menu is showing (it sits above popovers and handles Escape itself). */
const menuOpen = () => !!document.querySelector('.ctx-menu');

/** Closes a popover on outside click / Escape. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    // Escape with a right-click menu open closes only that menu.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !menuOpen() && close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, ref, close]);
}

/**
 * Branch picker, ahead/behind indicator and the sync controls of a repository: one Fetch/Pull button that
 * turns into "Pull ↓N" when there is something to bring in (counted locally and, for GitHub repositories,
 * checked against the remote in the background), and a Push button that shows what is waiting to go out.
 */
export function RepoSyncBar({ repoId, isGitHub, hasRemote, status: st, loading, inOperation, disabled, onRefresh, onFetch, onPull, onPush }: Props) {
  const { revision, repoTab, setRepoTab, bump, refreshRepos } = useApp();
  const [incoming, setIncoming] = useState<number | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [syncMenu, setSyncMenu] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  /** The dropdown shows branches, or the stash list behind the Stash button. */
  const [view, setView] = useState<'branches' | 'stashes'>('branches');
  const [stashes, setStashes] = useState<StashEntry[] | null>(null);
  const loadStashes = () =>
    call('git:stashList', { repoId })
      .then(setStashes)
      .catch(() => setStashes([]));
  const [switching, setSwitching] = useState<{ target: string; kind: 'local' | 'remote' } | null>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<HTMLDivElement>(null);
  useDismiss(branchOpen, branchRef, useCallback(() => setBranchOpen(false), []));
  useDismiss(syncMenu, syncRef, useCallback(() => setSyncMenu(false), []));

  // Background, read-only check for commits on the remote that have not been fetched yet.
  const checkRemote = useCallback(async () => {
    if (!isGitHub || disabled) return;
    try {
      const r = await call('gh:remoteAhead', { repoId });
      setIncoming(r.incoming);
      setLastCheck(new Date());
    } catch {
      setIncoming(null);
    }
  }, [repoId, isGitHub, disabled]);

  useEffect(() => {
    setIncoming(null);
  }, [repoId]);

  useEffect(() => {
    void checkRemote();
    const t = window.setInterval(() => void checkRemote(), REMOTE_CHECK_MS);
    const onFocus = () => void checkRemote();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [checkRemote, revision]);

  useEffect(() => {
    if (!branchOpen) return;
    setView('branches');
    call('git:branches', { repoId })
      .then(setBranches)
      .catch(() => setBranches([]));
    void loadStashes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchOpen, repoId]);

  const branch = st?.branch ?? (st?.detached ? 'detached HEAD' : '—');
  const ahead = st?.ahead ?? 0;
  const behind = (st?.behind ?? 0) + (incoming ?? 0);
  const hasUpstream = isPublished(st);
  const canSync = !disabled && !inOperation;
  const canPush = canSync && !!st?.branch && !!st.headOid && (!hasUpstream || ahead > 0);

  const localNames = new Set((branches ?? []).filter((b) => !b.remote).map((b) => b.name));

  const dirty = st ? st.staged.length + st.unstaged.length + st.untracked.length : 0;
  /** New Branch and Stash live in the branch rail of the Changes tab: open them there. */
  const rail = (a: RailAction) => {
    setBranchOpen(false);
    if (repoTab !== 'changes') setRepoTab('changes');
    requestRailAction(a);
  };

  const pickBranch = (target: string, kind: 'local' | 'remote') => {
    setBranchOpen(false);
    setSwitching({ target, kind });
  };

  const syncTitle = st?.upstreamGone
    ? `${st.upstream} does not exist on the remote (empty repository, or deleted there). Publish to create it.`
    : !hasUpstream && st?.upstream
    ? `${st.branch} tracks ${st.upstream}. Publish creates ${st.branch} on the remote (it never updates ${st.upstream}).`
    : !hasUpstream
    ? 'This branch is not published yet'
    : `${ahead} commit(s) to push · ${st?.behind ?? 0} fetched commit(s) to pull${incoming ? ` · ${incoming} new on the remote (not fetched yet)` : ''}${lastCheck ? `\nRemote checked ${lastCheck.toLocaleTimeString()}` : ''}`;

  return (
    <>
      <div className="row sync-bar">
        {/* Branch picker */}
        <div className="pop-anchor" ref={branchRef}>
          <button className={`pill pill-btn ${branchOpen ? 'open' : ''}`} onClick={() => setBranchOpen((o) => !o)} disabled={disabled} title="Switch branch">
            <span className="sb-dot" />⎇ <strong className="ellipsis">{branch}</strong> <span className="caret">▾</span>
          </button>
          {branchOpen && view === 'stashes' && (
            <StashPanel
              repoId={repoId}
              stashes={stashes ?? []}
              dirty={dirty}
              onBack={() => setView('branches')}
              onStash={() => rail('stash')}
              onChanged={() => {
                bump();
                void loadStashes();
              }}
            />
          )}
          {branchOpen && view === 'branches' && (
            <BranchPickerPanel
              className="hb-pop pop-in"
              value={st?.branch ?? ''}
              items={branches ? toPickerItems(branches) : []}
              recentKey="header-switch"
              hideSubject
              onRowContextMenu={(it, e) => {
                // The dropdown stays open behind the menu.
                if (repoTab !== 'changes') setRepoTab('changes');
                requestRailAction({ kind: 'branch-menu', name: it.name, x: e.clientX, y: e.clientY });
              }}
              onClose={() => !menuOpen() && setBranchOpen(false)}
              onPick={(it) => {
                if (it.current) return setBranchOpen(false);
                if (!it.remote) return pickBranch(it.name, 'local');
                // A remote branch that already has a local copy: switch to the local one.
                const short = it.name.split('/').slice(1).join('/');
                if (localNames.has(short)) pickBranch(short, 'local');
                else pickBranch(it.name, 'remote');
              }}
              footer={
                <div className="hb-acts">
                  <button onClick={() => rail('new-branch')} title="New branch from here">
                    ＋ Branch
                  </button>
                  <button
                    onClick={() => {
                      setBranchOpen(false);
                      requestQuickMerge({ source: st?.branch ?? undefined });
                    }}
                    title="Merge this branch into another — or open a pull request"
                  >
                    ⤵ Merge
                  </button>
                  <button
                    disabled={dirty === 0 && !stashes?.length}
                    onClick={() => (stashes?.length ? setView('stashes') : rail('stash'))}
                    title={stashes?.length ? 'Your stashes' : dirty ? 'Shelve your uncommitted changes' : 'Nothing to stash'}
                  >
                    📦 Stash{stashes?.length ? <span className="hb-n">{stashes.length}</span> : null}
                  </button>
                </div>
              }
            />
          )}
        </div>

        {/* Ahead / behind */}
        {st?.branch && !hasRemote && (
          <button className="pill pill-btn sync-pill" onClick={() => setRepoTab('settings')} title="This repository has no remote yet. Add one (for example a new empty GitHub repository) in Settings to push and pull.">
            <span className="zero">no remote</span>
          </button>
        )}
        {st?.branch && hasRemote && (
          <button
            className={`pill pill-btn sync-pill ${ahead ? 'has-out' : ''} ${behind ? 'has-in' : ''}`}
            disabled={!canSync}
            title={`${syncTitle}\nClick to ${behind ? 'pull' : ahead || !hasUpstream ? 'push' : 'fetch'}`}
            onClick={() => (behind ? onPull() : ahead || !hasUpstream ? onPush() : onFetch())}
          >
            {hasUpstream ? (
              <>
                <span className={ahead ? 'out' : 'zero'}>↑{ahead}</span>
                <span className={behind ? 'in' : 'zero'}>↓{behind}</span>
              </>
            ) : (
              <span className="out">not published</span>
            )}
          </button>
        )}
      </div>

      <div className="row">
        {/* Fetch / Pull */}
        <div className="split-btn pop-anchor" ref={syncRef}>
          {behind > 0 ? (
            <button className="btn attention" onClick={onPull} disabled={!canSync} title={syncTitle}>
              ⬇ Pull <span className="btn-count">{behind}</span>
              {incoming ? <span className="pulse-dot" title="New commits on the remote" /> : null}
            </button>
          ) : (
            <button className="btn" onClick={onFetch} disabled={disabled || !hasRemote} title={!hasRemote ? 'No remote to fetch from yet' : `Fetch from the remote (your files are not changed)${lastCheck ? `\nRemote checked ${lastCheck.toLocaleTimeString()}: up to date` : ''}`}>
              ⬇ Fetch
            </button>
          )}
          <button className={`btn caret-btn ${behind > 0 ? 'attention' : ''}`} onClick={() => setSyncMenu((o) => !o)} disabled={disabled || !hasRemote} aria-label="More sync options">
            ▾
          </button>
          {syncMenu && (
            <div className="dropdown pop-in" onClick={() => setSyncMenu(false)}>
              <div className="dropdown-item" onClick={onFetch}>
                <span className="ctx-ico">⬇</span>
                <div>
                  <div>Fetch</div>
                  <div className="small muted">Download new commits; your files are not changed</div>
                </div>
              </div>
              <div className={`dropdown-item ${canSync ? '' : 'disabled'}`} onClick={canSync ? onPull : undefined}>
                <span className="ctx-ico">🛡</span>
                <div>
                  <div>Pull (review)</div>
                  <div className="small muted">Fetch, review incoming changes, then update your branch</div>
                </div>
              </div>
              {isGitHub && (
                <>
                  <div className="dropdown-sep" />
                  <div className="dropdown-item" onClick={() => void checkRemote()}>
                    <span className="ctx-ico">☁</span>
                    <div>
                      <div>Check remote now</div>
                      <div className="small muted">{lastCheck ? `Last checked ${lastCheck.toLocaleTimeString()}` : 'Not checked yet'}</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Push */}
        {!hasRemote ? (
          <button className="btn push-btn" onClick={() => setRepoTab('settings')} disabled={disabled} title="Add a remote in Settings, then publish this branch to it">
            ＋ Add remote
          </button>
        ) : (
        <button
          className={`btn ${canPush ? 'primary' : ''} push-btn`}
          onClick={onPush}
          disabled={!canPush}
          title={
            !st?.branch
              ? 'No branch checked out'
              : !st.headOid
              ? 'Make a first commit, then publish it'
              : !hasUpstream
              ? syncTitle
              : ahead
              ? `${ahead} commit(s) waiting to be pushed`
              : 'Nothing to push — everything is on the remote'
          }
        >
          ⬆ {hasUpstream ? 'Push' : 'Publish'}
          {ahead > 0 && <span className="btn-count">{ahead}</span>}
        </button>
        )}
      </div>

      {switching && (
        <SwitchBranchDialog
          repoId={repoId}
          target={switching.target}
          kind={switching.kind}
          onClose={() => {
            setSwitching(null);
            bump();
          }}
          onDone={() => {
            setSwitching(null);
            bump();
            void refreshRepos();
          }}
        />
      )}
    </>
  );
}

/** "On main: half-done login" → branch "main", text "half-done login". */
function splitStash(message: string): { on: string | null; text: string } {
  const m = /^(?:WIP on|On) ([^:]+):\s*(.*)$/.exec(message);
  return m ? { on: m[1], text: m[2] || '(no message)' } : { on: null, text: message };
}

/** The stash list behind the dropdown's Stash button: apply, pop or drop each one. */
function StashPanel({ repoId, stashes, dirty, onBack, onStash, onChanged }: { repoId: string; stashes: StashEntry[]; dirty: number; onBack: () => void; onStash: () => void; onChanged: () => void }) {
  const { toast, showError } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [dropping, setDropping] = useState<number | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast(ok);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      setDropping(null);
      onChanged();
    }
  };
  return (
    <div className="bp-pop hb-pop hs pop-in">
      <div className="hs-head">
        <button className="hs-back" onClick={onBack} title="Back to branches">
          ←
        </button>
        <strong>Stashes</strong>
        <span className="hb-n">{stashes.length}</span>
        <span className="grow" />
        {dirty > 0 && (
          <button className="btn sm" onClick={onStash} title="Stash your uncommitted changes">
            ＋ Stash {dirty}
          </button>
        )}
      </div>
      <div className="hs-list">
        {stashes.length === 0 && <div className="bp-none">No stashes</div>}
        {stashes.map((st) => {
          const { on, text } = splitStash(st.message);
          const k = st.ref;
          return (
            <div key={k} className={`hs-row ${dropping === st.index ? 'ask' : ''}`} title={st.message}>
              <span className="hs-ico">📦</span>
              <span className="hs-main">
                <span className="hs-text ellipsis">{text}</span>
                <span className="hs-on ellipsis">{on ? `on ${on}` : st.ref}</span>
              </span>
              {dropping === st.index ? (
                <span className="hs-acts on">
                  <button className="hs-yes" disabled={!!busy} onClick={() => void act(k, () => call('git:stashDrop', { repoId, index: st.index, confirmed: true }), 'Stash dropped')}>
                    Drop
                  </button>
                  <button onClick={() => setDropping(null)}>Keep</button>
                </span>
              ) : (
                <span className="hs-acts">
                  <button disabled={!!busy} onClick={() => void act(k, () => call('git:stashApply', { repoId, index: st.index, pop: false }), 'Stash applied — it is kept')} title="Apply and keep the stash">
                    Apply
                  </button>
                  <button disabled={!!busy} onClick={() => void act(k, () => call('git:stashApply', { repoId, index: st.index, pop: true }), 'Stash applied and removed')} title="Apply and remove the stash">
                    Pop
                  </button>
                  <button className="hs-x" disabled={!!busy} onClick={() => setDropping(st.index)} title="Drop this stash">
                    ✕
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
