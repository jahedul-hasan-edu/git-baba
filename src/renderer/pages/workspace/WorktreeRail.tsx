import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BranchInfo, WorktreeInfo } from '../../../shared/types';
import { relative } from '../../components/FileDiffList';
import { fitMenu } from '../../components/menuFit';
import { Modal } from '../../components/Modal';
import { PaneIcon } from '../../components/PaneIcon';
import { DeleteBranchDialog } from '../../dialogs/BranchDialogs';
import { call, toFriendly } from '../../services/api';
import { useApp } from '../../state/AppState';
import { AddWorktreeDialog, branchColor, type AddRequest } from './WorktreePanel';

const folderOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
const SEARCH_FROM = 7;

interface Props {
  repoId: string;
  repoPath: string;
  repoName: string;
  worktrees: WorktreeInfo[] | null;
  loading: boolean;
  branches: BranchInfo[];
  reload: () => void;
  addRequest: AddRequest | null;
  clearAddRequest: () => void;
  onHide: () => void;
}

/** Where a worktree's branch lives: on the remote, only here, or its remote branch was deleted. */
type Reach = 'remote' | 'local' | 'gone' | 'none';
function reachOf(w: WorktreeInfo, branches: BranchInfo[]): { reach: Reach; remoteName: string | null } {
  if (!w.branch) return { reach: 'none', remoteName: null };
  const b = branches.find((x) => !x.remote && x.name === w.branch);
  if (b?.upstreamGone) return { reach: 'gone', remoteName: null };
  const remoteName = (b?.upstream && branches.some((x) => x.remote && x.name === b.upstream) ? b.upstream : null) ?? branches.find((x) => x.remote && x.name.slice(x.name.indexOf('/') + 1) === w.branch)?.name ?? null;
  return { reach: remoteName ? 'remote' : 'local', remoteName };
}

/**
 * The Changes sidebar: this repository's worktrees and nothing else. One click switches to a worktree,
 * hovering offers delete, right-click has the rest. The whole sidebar hides with the panel icon.
 */
export function WorktreeRail({ repoId, repoPath, repoName, worktrees, loading, branches, reload, addRequest, clearAddRequest, onHide }: Props) {
  const { showError, toast, selectRepo, refreshRepos, bump } = useApp();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<AddRequest | null>(null);
  const [removing, setRemoving] = useState<WorktreeInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ w: WorktreeInfo; x: number; y: number } | null>(null);

  useEffect(() => {
    if (addRequest) {
      setAdding(addRequest);
      clearAddRequest();
    }
  }, [addRequest, clearAddRequest]);

  const all = worktrees ?? [];
  const query = q.trim().toLowerCase();
  // You are here first, then the main folder, then the most recently worked on.
  const list = useMemo(
    () =>
      [...all]
        .filter((w) => !query || `${w.branch ?? ''} ${w.path}`.toLowerCase().includes(query))
        .sort((a, b) => Number(b.current) - Number(a.current) || Number(b.main) - Number(a.main) || (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0)),
    [all, query],
  );
  const missing = all.filter((w) => w.prunable).length;

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
      reload();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };
  const open = (w: WorktreeInfo) => {
    if (w.current || w.prunable) return;
    void run(`open:${w.path}`, async () => {
      const s = await call('git:worktreeOpen', { repoId, path: w.path });
      await refreshRepos();
      selectRepo(s.id);
      bump();
    });
  };

  return (
    <div className="wtr">
      <div className="wtr-head">
        <span className="wtr-title">Worktrees</span>
        <span className="wtr-n">{all.length}</span>
        <span className="grow" />
        <button className="wtr-icon" onClick={() => setAdding({})} title="New worktree">
          ＋
        </button>
        <button className="wtr-icon" onClick={onHide} title="Hide sidebar (Ctrl+Shift+B)">
          <PaneIcon />
        </button>
      </div>
      {all.length >= SEARCH_FROM && (
        <div className="wtr-search">
          <span aria-hidden>⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder="Filter" spellCheck={false} />
        </div>
      )}

      <div className="wtr-list" role="listbox" aria-label="Worktrees">
        {loading && !worktrees && <div className="wtr-empty mm-shimmer">Reading…</div>}
        {list.map((w, i) => (
          <WorktreeItem
            key={w.path}
            w={w}
            i={i}
            q={query}
            busy={busy === `open:${w.path}`}
            menuOn={menu?.w.path === w.path}
            onOpen={() => open(w)}
            onRemove={() => setRemoving(w)}
            onMenu={(x, y) => setMenu({ w, x, y })}
          />
        ))}
        {worktrees && list.length === 0 && query && <div className="wtr-empty">No match</div>}
        {worktrees && all.length <= 1 && !query && (
          <button className="wtr-new" onClick={() => setAdding({})}>
            <span className="wtr-new-ico">＋</span>
            <span>
              <strong>New worktree</strong>
              <span className="small muted">Another branch, side by side</span>
            </span>
          </button>
        )}
      </div>

      {missing > 0 && (
        <button className="wtr-clean" disabled={busy === 'prune'} onClick={() => void run('prune', () => call('git:worktreePrune', { repoId }), 'Missing worktrees cleaned up')} title="Forget worktrees whose folders were deleted">
          ⚠ {missing} missing · <u>Clean up</u>
        </button>
      )}

      {menu && (
        <WorktreeMenu
          menu={menu}
          onClose={() => setMenu(null)}
          items={[
            !menu.w.current && !menu.w.prunable && { icon: '⇄', label: 'Switch here', run: () => open(menu.w) },
            !menu.w.prunable && { icon: '📂', label: 'Open folder', run: () => void run(`rev:${menu.w.path}`, () => call('git:worktreeReveal', { repoId, path: menu.w.path })) },
            { icon: '⧉', label: 'Copy path', run: () => void call('app:copyText', { text: menu.w.path }).then(() => toast('Path copied')) },
            !menu.w.main && !menu.w.prunable && {
              icon: menu.w.locked ? '🔓' : '🔒',
              label: menu.w.locked ? 'Unlock' : 'Lock',
              run: () => void run(`lock:${menu.w.path}`, () => call('git:worktreeLock', { repoId, path: menu.w.path, lock: !menu.w.locked }), menu.w.locked ? 'Unlocked' : 'Locked'),
            },
            !menu.w.main && !menu.w.current && { icon: '✕', label: menu.w.prunable ? 'Forget…' : 'Delete…', danger: true, run: () => setRemoving(menu.w) },
          ]}
        />
      )}
      {adding && (
        <AddWorktreeDialog
          repoId={repoId}
          repoPath={repoPath}
          repoName={repoName}
          branches={branches}
          taken={new Set(all.map((w) => w.branch).filter((b): b is string => !!b))}
          initial={adding}
          onClose={() => setAdding(null)}
          onDone={(w, openIt) => {
            setAdding(null);
            reload();
            toast(`Worktree ${folderOf(w.path)} ready`);
            if (openIt) open({ ...w, current: false });
          }}
        />
      )}
      {removing && (
        <RemoveWorktreeDialog
          repoId={repoId}
          w={removing}
          branches={branches}
          otherHolders={all.filter((x) => x.path !== removing.path && x.branch === removing.branch).length}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            reload();
            bump();
            void refreshRepos();
          }}
        />
      )}
    </div>
  );
}

function WorktreeItem({ w, i, q, busy, menuOn, onOpen, onRemove, onMenu }: { w: WorktreeInfo; i: number; q: string; busy: boolean; menuOn: boolean; onOpen: () => void; onRemove: () => void; onMenu: (x: number, y: number) => void }) {
  const name = w.branch ?? `detached ${w.head.slice(0, 7)}`;
  const cut = name.lastIndexOf('/') + 1;
  const mark = (t: string) => {
    const k = q ? t.toLowerCase().indexOf(q) : -1;
    return k < 0 ? t : (
      <>
        {t.slice(0, k)}
        <mark>{t.slice(k, k + q.length)}</mark>
        {t.slice(k + q.length)}
      </>
    );
  };
  const canDelete = !w.main && !w.current;
  return (
    <div
      className={`wtr-row ${w.current ? 'here' : ''} ${w.prunable ? 'gone' : ''} ${busy ? 'busy' : ''} ${menuOn ? 'menu' : ''}`}
      style={{ ['--c' as string]: branchColor(w.branch ?? 'HEAD'), animationDelay: `${Math.min(i, 12) * 16}ms` }}
      role="option"
      aria-selected={w.current}
      tabIndex={0}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
        else if (e.key === 'Delete' && canDelete) onRemove();
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const rows = [...document.querySelectorAll<HTMLElement>('.wtr-row')];
          rows[rows.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
        }
      }}
      title={`${name}\n${w.path}${w.date ? `\n${relative(w.date)}` : ''}${w.current ? '\nYou are here' : w.prunable ? '\nFolder is missing' : '\nClick to switch'}`}
    >
      <span className="wtr-dot" aria-hidden>
        {w.main ? '⌂' : ''}
      </span>
      <span className="wtr-name">
        {cut > 0 && <span className="wtr-pre">{mark(name.slice(0, cut))}</span>}
        <span className="wtr-leaf">{mark(name.slice(cut))}</span>
      </span>
      {w.locked && <span className="wtr-tag" title={w.lockReason ? `Locked: ${w.lockReason}` : 'Locked'}>🔒</span>}
      {w.prunable ? (
        <span className="wtr-tag warn" title="Folder is missing">⚠</span>
      ) : (w.changes ?? 0) > 0 ? (
        <span className="wtr-tag dirty" title={`${w.changes} uncommitted`}>✎{w.changes}</span>
      ) : null}
      {w.current && <span className="wtr-here" title="You are here" />}
      {canDelete && (
        <button
          className="wtr-del"
          title={w.prunable ? 'Forget' : 'Delete'}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

type MenuItem = { icon: string; label: string; run: () => void; danger?: boolean } | false;

function WorktreeMenu({ menu, items, onClose }: { menu: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  useLayoutEffect(() => {
    if (ref.current) fitMenu(ref.current, menu.x, menu.y);
  }, [menu]);
  return (
    <div ref={ref} className="ctx-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map(
        (it) =>
          it && (
            <div
              key={it.label}
              className={`dropdown-item ${it.danger ? 'danger' : ''}`}
              onClick={() => {
                onClose();
                it.run();
              }}
            >
              <span className="ctx-ico">{it.icon}</span> {it.label}
            </div>
          ),
      )}
    </div>
  );
}

/**
 * Delete a worktree: its folder always; optionally its branch here and on the remote. Covers changed,
 * locked, missing (orphan), detached and local-only worktrees with one short line each.
 */
function RemoveWorktreeDialog({ repoId, w, branches, otherHolders, onClose, onDone }: { repoId: string; w: WorktreeInfo; branches: BranchInfo[]; otherHolders: number; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const { reach, remoteName } = reachOf(w, branches);
  const [delLocal, setDelLocal] = useState(false);
  const [delRemote, setDelRemote] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteStep, setRemoteStep] = useState(false);
  const canBranch = !!w.branch && otherHolders === 0;
  const changes = w.changes ?? 0;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (w.locked) await call('git:worktreeLock', { repoId, path: w.path, lock: false });
      await call('git:worktreeRemove', { repoId, path: w.path, force: changes > 0 || w.locked, confirmed: true });
      if (delLocal && w.branch) {
        try {
          await call('git:deleteBranch', { repoId, name: w.branch, force, confirmed: true });
        } catch (err) {
          const f = toFriendly(err);
          // The folder is gone already; keep the branch and say why.
          toast(`Worktree deleted. ${w.branch} kept: ${f.code === 'branch-not-merged' ? 'it has unmerged commits' : f.message}`, 'warning');
          setBusy(false);
          if (delRemote && remoteName) return setRemoteStep(true);
          return onDone();
        }
      }
      toast(`Deleted ${folderOf(w.path)}${delLocal ? ` and ${w.branch}` : ''}`);
      if (delRemote && remoteName) {
        setBusy(false);
        setRemoteStep(true);
        return;
      }
      onDone();
    } catch (err) {
      setError(toFriendly(err).message);
      setBusy(false);
    }
  };

  // The remote branch is deleted on the server with the authentication the user picks.
  if (remoteStep && remoteName) return <DeleteBranchDialog repoId={repoId} branch={remoteName} kind="remote" onClose={onDone} onDone={onDone} />;

  const reachLabel: Record<Reach, string> = { remote: `on ${remoteName?.split('/')[0] ?? 'remote'}`, local: 'local only', gone: 'remote deleted', none: 'detached' };
  return (
    <Modal
      title={w.prunable ? 'Forget worktree' : 'Delete worktree'}
      size="narrow"
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button className="btn cancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn danger solid" onClick={() => void go()} disabled={busy}>
            {busy ? 'Deleting…' : w.prunable ? 'Forget' : 'Delete'}
          </button>
        </>
      }
    >
      <div className="wtd-card" style={{ ['--c' as string]: branchColor(w.branch ?? 'HEAD') }}>
        <span className="wtd-name ellipsis">{w.branch ?? `detached ${w.head.slice(0, 7)}`}</span>
        <span className="wtd-path ellipsis" title={w.path}>
          {w.path}
        </span>
        <span className="wtd-tags">
          <span className={`wtd-chip ${reach}`}>{reachLabel[reach]}</span>
          {w.prunable && <span className="wtd-chip warn">folder missing</span>}
          {w.locked && <span className="wtd-chip">locked</span>}
          {changes > 0 && <span className="wtd-chip danger">✎ {changes} uncommitted</span>}
        </span>
      </div>

      {changes > 0 && <p className="small text-danger wtd-note">Uncommitted changes are lost.</p>}

      {canBranch && (
        <div className="wtd-opts">
          <label className="check">
            <input type="checkbox" checked={delLocal} onChange={(e) => setDelLocal(e.target.checked)} /> Also delete branch <span className="mono">{w.branch}</span>
          </label>
          {delLocal && (
            <label className="check small wtd-sub">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Even if not merged{reach !== 'remote' ? ' (its commits are only here)' : ''}
            </label>
          )}
          {remoteName && (
            <label className="check">
              <input type="checkbox" checked={delRemote} onChange={(e) => setDelRemote(e.target.checked)} /> Also delete <span className="mono">{remoteName}</span>
            </label>
          )}
        </div>
      )}
      {!!w.branch && otherHolders > 0 && <p className="small muted wtd-note">The branch is open in another worktree, so it stays.</p>}
      {error && <p className="small text-danger wtd-note">{error}</p>}
    </Modal>
  );
}
