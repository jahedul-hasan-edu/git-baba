import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BranchInfo, NewBranchChanges, RepoStatus, StashEntry, TagInfo } from '../../../shared/types';
import { BranchPicker, toPickerItems } from '../../components/BranchPicker';
import { fitMenu, markScroll } from '../../components/menuFit';
import { Modal } from '../../components/Modal';
import { MultiMergeCard } from '../../components/MultiMergeCard';
import { BranchChangesDialog } from '../../dialogs/BranchChangesDialog';
import { DeleteBranchDialog, MergeBranchesDialog, PublishBranchDialog, SwitchBranchDialog } from '../../dialogs/BranchDialogs';
import { ChangesChoice } from '../../dialogs/ChangesChoice';
import { ConfirmDialog } from '../../dialogs/ConfirmDialog';
import { useAsync } from '../../hooks/useAsync';
import { call } from '../../services/api';
import { requestMergeStudio } from '../../services/mergeStudio';
import { requestQuickMerge } from '../../services/quickMerge';
import { onRailAction } from '../../services/railActions';
import { useApp } from '../../state/AppState';
import type { GraphFocus } from '../GitHistoryPage';
import { type AddRequest } from './WorktreePanel';
import { WorktreeRail } from './WorktreeRail';
import { clearPendingNewBranch, takePendingNewBranch } from '../changes/CleanSlate';


function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* per-viewer convenience */
  }
}


type Menu =
  | { kind: 'branch'; x: number; y: number; branch: BranchInfo }
  | { kind: 'stash'; x: number; y: number; stash: StashEntry }
  | { kind: 'tag'; x: number; y: number; tag: TagInfo };

interface Props {
  repoId: string;
  status: RepoStatus | null;
  onFocus: (f: Omit<GraphFocus, 'n'>) => void;
  /** The whole sidebar is hidden (shown again from the graph toolbar). */
  hidden: boolean;
  setHidden: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * The workspace's left rail: every local and remote branch, stash and tag in one compact, filterable
 * tree. Click to find it in the graph, double-click to switch, drag one branch onto another to merge,
 * right-click for everything else. Collapses to an icon strip (Ctrl+Shift+B) and can be resized.
 */
export function RepoRail({ repoId, status, onFocus, hidden, setHidden }: Props) {
  const { revision, bump, showError, toast, refreshRepos } = useApp();
  const branches = useAsync(() => call('git:branches', { repoId }), [repoId, revision]);
  const worktrees = useAsync(() => call('git:worktrees', { repoId }), [repoId, revision]);
  const { activeRepo } = useApp();
  const [mode, setMode] = useState<'branches' | 'worktrees'>(() => readPref('gb.ws.railMode', 'branches'));
  useEffect(() => writePref('gb.ws.railMode', mode), [mode]);
  const [addWorktree, setAddWorktree] = useState<AddRequest | null>(null);
  /** Branch → folder name of the other worktree it is checked out in. */
  const inWorktree = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of worktrees.data ?? []) if (w.branch && !w.current) m.set(w.branch, w.path.replace(/[\/]+$/, '').split(/[\/]/).pop() ?? w.path);
    return m;
  }, [worktrees.data]);

  const [width, setWidth] = useState(() => readPref('gb.ws.railW', 256));
  useEffect(() => writePref('gb.ws.railW', Math.round(width)), [width]);

  const [menu, setMenu] = useState<Menu | null>(null);
  /** Opens the branch menu for a branch named elsewhere (the header menu); reads the latest branch lists. */
  const menuFor = useRef<(name: string, x: number, y: number) => void>(() => undefined);
  const waitingMenu = useRef<{ name: string; x: number; y: number } | null>(null);
  const [newBranch, setNewBranch] = useState<{ name: string; from: string; switchTo: boolean; changes?: NewBranchChanges } | null>(null);
  const [publish, setPublish] = useState<{ name: string; base: string; changes?: NewBranchChanges } | null>(null);
  const [stashing, setStashing] = useState<{ message: string; untracked: boolean } | null>(null);
  const [toDrop, setToDrop] = useState<StashEntry | null>(null);
  const [renaming, setRenaming] = useState<{ branch: BranchInfo; name: string } | null>(null);
  const [toDelete, setToDelete] = useState<{ branch: string; kind: 'local' | 'remote' } | null>(null);
  const [merging, setMerging] = useState<{ source: string; target: string } | null>(null);
  const [switching, setSwitching] = useState<{ target: string; kind: 'local' | 'remote' } | null>(null);
  const [viewing, setViewing] = useState<{ branch: string; kind: 'local' | 'remote' } | null>(null);
  const [mergeSources, setMergeSources] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');

  const local = useMemo(() => branches.data?.filter((b) => !b.remote) ?? [], [branches.data]);
  const remote = useMemo(() => branches.data?.filter((b) => b.remote && !b.name.endsWith('/HEAD')) ?? [], [branches.data]);
  const localNames = useMemo(() => new Set(local.map((b) => b.name)), [local]);
  const current = local.find((b) => b.current) ?? null;
  const currentName = current?.name ?? null;
  const dirty = status ? status.staged.length + status.unstaged.length + status.untracked.length + status.conflicted.length : 0;
  menuFor.current = (name, x, y) => {
    const b = [...local, ...remote].find((x2) => x2.name === name);
    if (b) setMenu({ kind: 'branch', x, y, branch: b });
    else if (!branches.data) waitingMenu.current = { name, x, y }; // the rail is still loading its branches
  };
  useEffect(() => {
    const w = waitingMenu.current;
    if (!w || !branches.data) return;
    waitingMenu.current = null;
    menuFor.current(w.name, w.x, w.y);
  }, [branches.data]);
  /** A local branch is published when it tracks a remote branch or a remote has a branch of the same name. */
  const publishedOn = (b: BranchInfo): string | null => (b.upstreamGone ? null : b.upstream) ?? remote.find((r) => r.name.slice(r.name.indexOf('/') + 1) === b.name)?.name ?? null;

  // The header branch menu opens New Branch / Stash here (kept waiting if the rail was not mounted yet).
  useEffect(
    () =>
      onRailAction((a) => {
        if (a === 'new-branch') setNewBranch({ name: '', from: '', switchTo: true });
        else if (a === 'stash') setStashing({ message: '', untracked: true });
        else menuFor.current(a.name, a.x, a.y);
      }),
    [],
  );
  // Other screens (the clean Changes screen, keyboard) open the New Branch window.
  useEffect(() => {
    const on = (e: Event) => {
      clearPendingNewBranch();
      setNewBranch({ name: '', from: (e as CustomEvent<string>).detail || '', switchTo: true });
    };
    // Asked for from another page, before this one was mounted:
    const waiting = takePendingNewBranch();
    if (waiting !== null) setNewBranch({ name: '', from: waiting, switchTo: true });
    window.addEventListener('gb:new-branch', on);
    return () => window.removeEventListener('gb:new-branch', on);
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-backdrop, .dt')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && k === 'b') {
        e.preventDefault();
        setHidden((c) => !c);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'n') {
        e.preventDefault();
        setNewBranch({ name: '', from: '', switchTo: true });
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const act = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast(success);
    } catch (err) {
      showError(err);
    }
    bump();
  };
  const copy = (text: string, what: string) => void call('app:copyText', { text }).then(() => toast(`${what} copied`), showError);
  const openStudio = (sources?: string[], target?: string) => {
    if (sources) setMergeSources(sources);
    if (target !== undefined) setMergeTarget(target);
    requestMergeStudio();
  };

  // Hidden: nothing on screen, but the dialogs and menus the header branch menu opens still work.
  if (hidden) return <>{dialogs()}</>;

  return (
    <aside className="ws-rail" style={{ width }}>
      <WorktreeRail
        repoId={repoId}
        repoPath={activeRepo?.path ?? ''}
        repoName={activeRepo?.name ?? 'repo'}
        worktrees={worktrees.data ?? null}
        loading={worktrees.loading}
        branches={branches.data ?? []}
        reload={() => void worktrees.reload()}
        addRequest={addWorktree}
        clearAddRequest={() => setAddWorktree(null)}
        onHide={() => setHidden(true)}
      />
      <div
        className="wr-resizer"
        title="Drag to resize · double-click to reset"
        onDoubleClick={() => setWidth(256)}
        onMouseDown={(e) => {
          e.preventDefault();
          const start = e.clientX;
          const w0 = width;
          const move = (ev: MouseEvent) => setWidth(Math.max(200, Math.min(440, w0 + ev.clientX - start)));
          const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            document.body.classList.remove('resizing');
          };
          document.body.classList.add('resizing');
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      />
      {dialogs()}
    </aside>
  );

  // ---------- menus & dialogs (shared by both rail sizes) ----------
  function dialogs() {
    return (
      <>
        {menu && <RailMenu menu={menu} onClose={() => setMenu(null)}>{menuItems(menu)}</RailMenu>}
        <MultiMergeCard
          repoId={repoId}
          local={local}
          remote={remote}
          currentName={currentName}
          sources={mergeSources}
          setSources={setMergeSources}
          target={mergeTarget}
          setTarget={setMergeTarget}
          onChanged={bump}
          headless
        />
        {newBranch && newBranchDialog()}
        {stashing && (
          <Modal
            title="Stash Changes"
            icon="📦"
            size="narrow"
            onClose={() => setStashing(null)}
            footer={
              <>
                <button className="btn cancel" onClick={() => setStashing(null)}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    const s = stashing;
                    setStashing(null);
                    void act(() => call('git:stashPush', { repoId, message: s.message.trim(), includeUntracked: s.untracked }), 'Changes stashed');
                  }}
                >
                  Stash {dirty} change{dirty === 1 ? '' : 's'}
                </button>
              </>
            }
          >
            <p className="small muted">Shelves your uncommitted changes so the working folder is clean — handy before switching branches or pulling. Bring them back any time from the Stashes list.</p>
            <div className="field">
              <label>Message (optional)</label>
              <input autoFocus value={stashing.message} onChange={(e) => setStashing({ ...stashing, message: e.target.value })} placeholder="e.g. half-done login form" />
            </div>
            <label className="check">
              <input type="checkbox" checked={stashing.untracked} onChange={(e) => setStashing({ ...stashing, untracked: e.target.checked })} /> Include new (untracked) files
            </label>
          </Modal>
        )}
        {toDrop && (
          <ConfirmDialog
            title="Drop Stash"
            danger
            explanation={
              <>
                Permanently deletes <code>{toDrop.ref}</code> ({toDrop.message}).
              </>
            }
            impact="The stashed changes will be lost."
            confirmLabel="Drop stash"
            onCancel={() => setToDrop(null)}
            onConfirm={async () => {
              const s = toDrop;
              setToDrop(null);
              await act(() => call('git:stashDrop', { repoId, index: s.index, confirmed: true }), 'Stash dropped');
            }}
          />
        )}
        {renaming && renameDialog()}
        {toDelete && (
          <DeleteBranchDialog
            repoId={repoId}
            branch={toDelete.branch}
            kind={toDelete.kind}
            onClose={() => {
              setToDelete(null);
              bump();
            }}
            onDone={() => {
              setToDelete(null);
              bump();
            }}
          />
        )}
        {publish && (
          <PublishBranchDialog
            repoId={repoId}
            name={publish.name}
            base={publish.base}
            changes={publish.changes}
            onClose={() => {
              setPublish(null);
              bump();
            }}
            onDone={() => {
              setPublish(null);
              bump();
            }}
          />
        )}
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
        {merging && (
          <MergeBranchesDialog
            repoId={repoId}
            source={merging.source}
            target={merging.target}
            onClose={() => {
              setMerging(null);
              bump();
            }}
            onDone={() => {
              setMerging(null);
              bump();
            }}
          />
        )}
        {viewing && (
          <BranchChangesDialog
            repoId={repoId}
            branch={viewing.branch}
            candidates={[...local, ...remote].map((b) => b.name)}
            branchInfo={[...local, ...remote]}
            onClose={() => setViewing(null)}
          />
        )}
      </>
    );
  }

  function menuItems(m: Menu): ReactNode {
    const item = (ico: string, label: ReactNode, run: () => void, opts?: { danger?: boolean; disabled?: boolean; title?: string }) => (
      <div
        className={`dropdown-item ${opts?.danger ? 'danger' : ''} ${opts?.disabled ? 'disabled' : ''}`}
        title={opts?.title}
        onClick={
          opts?.disabled
            ? undefined
            : () => {
                setMenu(null);
                run();
              }
        }
      >
        <span className="ctx-ico">{ico}</span> {label}
      </div>
    );
    if (m.kind === 'stash') {
      const s = m.stash;
      return (
        <>
          <div className="ctx-head">
            <strong className="ellipsis">{s.message}</strong>
            <span className="small muted mono">{s.ref}</span>
          </div>
          {item('⤓', 'Apply (keep the stash)', () => act(() => call('git:stashApply', { repoId, index: s.index, pop: false }), 'Stash applied'))}
          {item('⇣', 'Pop (apply and remove)', () => act(() => call('git:stashApply', { repoId, index: s.index, pop: true }), 'Stash popped'))}
          {item('⧉', 'Copy message', () => copy(s.message, 'Stash message'))}
          <div className="dropdown-sep" />
          {item('✕', 'Drop…', () => setToDrop(s), { danger: true })}
        </>
      );
    }
    if (m.kind === 'tag') {
      const t = m.tag;
      return (
        <>
          <div className="ctx-head">
            <strong className="ellipsis mono">{t.name}</strong>
            <span className="small muted">{t.annotated ? 'annotated tag' : 'tag'}</span>
          </div>
          {item('◉', 'Show in graph', () => onFocus({ oid: t.commit, ref: t.name }))}
          {item('＋', 'New branch from this tag…', () => setNewBranch({ name: '', from: t.name, switchTo: true }))}
          {item('⧉', 'Copy tag name', () => copy(t.name, 'Tag name'))}
          {item('#', 'Copy commit SHA', () => copy(t.commit, 'Commit SHA'))}
        </>
      );
    }
    const b = m.branch;
    const isLocal = !b.remote;
    const short = isLocal ? b.name : b.name.slice(b.name.indexOf('/') + 1);
    const hasLocal = !isLocal && localNames.has(short);
    const isCurrent = isLocal && b.current;
    const pub = isLocal ? publishedOn(b) : null;
    return (
      <>
        <div className="ctx-head">
          <strong className="ellipsis mono">{b.name}</strong>
          <span className="small muted ellipsis">{isCurrent ? 'current branch' : isLocal ? (pub ? `local · tracks ${pub}` : 'local · not published') : 'remote branch'}</span>
        </div>
        {item('◉', 'Show in graph', () => onFocus({ oid: b.oid, ref: b.name }))}
        {isLocal && !isCurrent && item('⇄', `Switch to ${b.name}`, () => setSwitching({ target: b.name, kind: 'local' }))}
        {!isLocal && !hasLocal && item('⤓', `Check out locally as ${short}`, () => setSwitching({ target: b.name, kind: 'remote' }))}
        {hasLocal && short !== currentName && item('⇄', `Switch to local ${short}`, () => setSwitching({ target: short, kind: 'local' }))}
        {item('≋', 'View changes vs. main…', () => setViewing({ branch: b.name, kind: isLocal ? 'local' : 'remote' }))}
        <div className="dropdown-sep" />
        <div className="dropdown-title">Merge</div>
        {currentName && !isCurrent && item('⤵', <>Merge into <strong className="mono">{currentName}</strong>…</>, () => requestQuickMerge({ source: b.name, target: currentName }))}
        {isLocal && currentName && !isCurrent && item('⤴', <>Merge <span className="mono">{currentName}</span> into this…</>, () => requestQuickMerge({ source: currentName, target: b.name }))}
        {isCurrent && item('⤵', 'Merge this branch…', () => requestQuickMerge({ source: b.name }))}
        {item('✨', 'Merge Studio with this as source…', () => openStudio([...mergeSources.filter((x) => x !== b.name), b.name], mergeTarget === b.name ? '' : undefined))}
        {isLocal && item('◎', 'Merge Studio with this as target…', () => openStudio(mergeSources.filter((x) => x !== b.name), b.name))}
        <div className="dropdown-sep" />
        {item('＋', 'New branch from here…', () => setNewBranch({ name: '', from: b.name, switchTo: true }))}
        {isLocal && !isCurrent && !inWorktree.has(b.name) &&
          item('🗂', 'Open in a new worktree…', () => {
            setMode('worktrees');
            setAddWorktree({ branch: b.name });
          })}
        {!isLocal && !hasLocal &&
          item('🗂', `Check out ${short} in a new worktree…`, () => {
            setMode('worktrees');
            setAddWorktree({ branch: b.name });
          })}
        {isLocal && inWorktree.has(b.name) && item('🗂', `In worktree ${inWorktree.get(b.name)} — show`, () => setMode('worktrees'))}
        {isLocal &&
          item('✎', `Rename…${pub ? ' (published)' : ''}`, () => setRenaming({ branch: b, name: b.name }), {
            disabled: !!pub,
            title: pub ? `Published as ${pub} — only unpublished branches can be renamed` : 'Rename this branch',
          })}
        {isLocal && !pub && item('⬆', 'Publish…', () => setPublish({ name: b.name, base: b.name }))}
        {item('⧉', 'Copy branch name', () => copy(b.name, 'Branch name'))}
        {!isCurrent && (
          <>
            <div className="dropdown-sep" />
            {item('✕', `Delete${isLocal ? '' : ' from remote'}…`, () => setToDelete({ branch: b.name, kind: isLocal ? 'local' : 'remote' }), { danger: true })}
          </>
        )}
      </>
    );
  }

  function newBranchDialog() {
    const nb = newBranch!;
    const name = nb.name.trim();
    const valid = /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('/') && !name.endsWith('/') && !name.includes('..') && !name.endsWith('.lock') && !name.startsWith('-');
    const taken = localNames.has(name);
    // Branch names are paths: "feature/tools" blocks "feature/tools/inventory" (and the other way round).
    const clash = taken || !name ? undefined : [...localNames].find((n) => name.startsWith(`${n}/`) || n.startsWith(`${name}/`));
    const fix = clash && name.startsWith(`${clash}/`) ? `${clash}-${name.slice(clash.length + 1).replace(/\//g, '-')}` : null;
    const ok = !!name && valid && !taken && !clash;
    // With work in progress the choice of where it goes replaces the plain "switch" checkbox.
    const changes: NewBranchChanges | undefined = dirty > 0 ? (nb.changes ?? 'carry') : undefined;
    const create = () =>
      act(
        async () => {
          await call('git:createBranch', { repoId, name, startPoint: nb.from || undefined, switchTo: changes ? changes !== 'leave' : nb.switchTo, changes });
          setNewBranch(null);
        },
        changes === 'stash' ? `Created ${name}. Your changes are stashed on ${currentName ?? 'the previous branch'}.` : changes === 'leave' ? `Created ${name}. You stay on ${currentName ?? 'the current branch'} with your changes.` : `Created ${name}`,
      );
    return (
      <Modal
        title="New Branch"
        icon="⎇"
        size="narrow"
        onClose={() => setNewBranch(null)}
        footer={
          <>
            <button className="btn cancel" onClick={() => setNewBranch(null)}>
              Cancel
            </button>
            <button className="btn" disabled={!ok} onClick={create} title="Create the branch on this computer only (nothing is pushed)">
              Create locally
            </button>
            <button
              className="btn primary"
              disabled={!ok}
              onClick={() => {
                setPublish({ name, base: nb.from, changes });
                setNewBranch(null);
              }}
              title="Create the branch, push it with the authentication you choose, and verify it on the remote"
            >
              Create & Publish…
            </button>
          </>
        }
      >
        <div className="field">
          <label>Branch name</label>
          <input
            className="mono"
            autoFocus
            value={nb.name}
            onChange={(e) => setNewBranch({ ...nb, name: e.target.value.replace(/\s+/g, '-') })}
            onKeyDown={(e) => e.key === 'Enter' && ok && create()}
            placeholder="feature/my-change"
            spellCheck={false}
          />
          {taken && <div className="small text-danger">A branch with this name already exists.</div>}
          {clash && (
            <div className="small text-danger nb-clash">
              {fix ? (
                <>
                  <span>
                    <span className="mono">{clash}</span> is a branch; names can't nest under it.
                  </span>
                  <button type="button" className="mm-chip static" onClick={() => setNewBranch({ ...nb, name: fix })}>
                    Use {fix}
                  </button>
                </>
              ) : (
                <span>
                  Taken as a folder by <span className="mono">{clash}</span>.
                </span>
              )}
            </div>
          )}
          {!valid && name && <div className="small text-danger">Use letters, digits, “.”, “_”, “-” and “/” (no “..” or trailing “/”).</div>}
          <div className="wr-presets">
            {['feature/', 'fix/', 'chore/', 'release/'].map((p) => (
              <button key={p} type="button" className="mm-chip static" onClick={() => setNewBranch({ ...nb, name: p + nb.name.replace(/^(feature|fix|chore|release)\//, '') })}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Start from</label>
          <BranchPicker
            value={nb.from}
            onChange={(from) => setNewBranch({ ...nb, from })}
            items={toPickerItems([...local, ...remote])}
            special={[{ name: '', label: `Current branch (HEAD)${currentName ? ` · ${currentName}` : ''}`, icon: '◉', subject: 'Start from where you are now' }]}
            recentKey="branch-start"
          />
        </div>
        {changes ? (
          <div className="field">
            <label>
              {dirty} uncommitted change{dirty === 1 ? '' : 's'}
            </label>
            <ChangesChoice value={changes} onChange={(v) => setNewBranch({ ...nb, changes: v })} count={dirty} from={currentName ?? 'HEAD'} to={name || 'the new branch'} compact />
          </div>
        ) : (
          <label className="check">
            <input type="checkbox" checked={nb.switchTo} onChange={(e) => setNewBranch({ ...nb, switchTo: e.target.checked })} /> Switch to the new branch
          </label>
        )}
      </Modal>
    );
  }

  function renameDialog() {
    const r = renaming!;
    const name = r.name.trim();
    const taken = local.some((x) => x.name === name && x.name !== r.branch.name);
    const valid = /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('/') && !name.endsWith('/') && !name.includes('..') && !name.endsWith('.lock') && !name.startsWith('-');
    const same = name === r.branch.name;
    const ok = !!name && valid && !taken && !same;
    const go = () =>
      act(async () => {
        await call('git:renameBranch', { repoId, name: r.branch.name, newName: name });
        setRenaming(null);
      }, `Renamed ${r.branch.name} → ${name}`);
    return (
      <Modal
        title="Rename Branch"
        icon="✎"
        size="narrow"
        onClose={() => setRenaming(null)}
        footer={
          <>
            <button className="btn cancel" onClick={() => setRenaming(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!ok} onClick={go}>
              Rename
            </button>
          </>
        }
      >
        <div className="field">
          <label>
            New name for <span className="mono">{r.branch.name}</span>
          </label>
          <input className="mono" value={r.name} autoFocus spellCheck={false} onChange={(e) => setRenaming({ ...r, name: e.target.value })} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => e.key === 'Enter' && ok && go()} />
          {taken && <div className="small text-danger">A branch with this name already exists.</div>}
          {!valid && name && <div className="small text-danger">Use letters, digits, “.”, “_”, “-” and “/” (no “..” or trailing “/”).</div>}
        </div>
        <p className="small muted">
          Only this computer is affected{r.branch.current ? ' — you are on this branch, and stay on it under the new name' : ''}. The branch has not been published, so nothing on a remote changes.
        </p>
      </Modal>
    );
  }
}

/** A context menu that stays inside the window and closes on outside click, Esc, scroll or resize. */
function RailMenu({ menu, onClose, children }: { menu: Menu; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    const onScroll = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitMenu(el, menu.x, menu.y);
  }, [menu]);
  return (
    <div ref={ref} className="ctx-menu" style={{ left: menu.x, top: menu.y }} onScroll={(e) => markScroll(e.currentTarget)} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}
