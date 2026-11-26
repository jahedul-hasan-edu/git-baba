import { CLOSE_DOCK_EVENT } from '../services/dock';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeKind, FileChange, FileDiff, FriendlyError, RepoStatus } from '../../shared/types';
import { ErrorPanel } from '../components/ErrorPanel';
import { fileKey } from '../components/FileList';
import { Spinner } from '../components/Modal';
import { fitMenu } from '../components/menuFit';
import { CommitDialog } from '../dialogs/CommitDialog';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { StagePickDialog } from '../dialogs/StagePickDialog';
import { call } from '../services/api';
import { useApp } from '../state/AppState';
import { isPublished } from '../../shared/publish';
import { CommitComposer, type CommitAction } from './changes/CommitComposer';
import { CleanSlate } from './changes/CleanSlate';
import { EmptyChanges } from './changes/EmptyChanges';
import { HunkDiff, type PartialAction } from './changes/HunkDiff';

interface Props {
  status: RepoStatus | null;
  reload: () => Promise<void>;
  error: FriendlyError | null;
  /**
   * Inside the Changes workspace: only the file list and the composer render here; a picked
   * file's diff opens in `diffHost` (over the graph), and `clean` replaces the empty screen.
   */
  docked?: { diffHost: HTMLElement | null; clean: ReactNode };
  /** Start with the folder tree (the pop-up window always opens as a tree). */
  tree?: boolean;
}

type TabId = 'changes' | 'staged';
const VIEW_KEY = 'gb.changes.grouped';

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** One letter per kind of change, coloured like the rest of the app. */
const KIND: Record<ChangeKind, [string, string, string]> = {
  modified: ['M', 'mod', 'Modified'],
  added: ['A', 'add', 'Added'],
  deleted: ['D', 'del', 'Deleted'],
  renamed: ['R', 'ren', 'Renamed'],
  copied: ['C', 'ren', 'Copied'],
  typechange: ['T', 'mod', 'Type changed'],
  untracked: ['U', 'add', 'New file (untracked)'],
  conflicted: ['!', 'del', 'Conflict'],
};

export function ChangesPage({ status, reload, error, docked, tree }: Props) {
  const { activeRepo, showError, bump, toast, setRepoTab } = useApp();
  const repoId = activeRepo!.id;
  const [tab, setTab] = useState<TabId>('changes');
  const [selected, setSelected] = useState<FileChange | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [commitOpen, setCommitOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [discard, setDiscard] = useState<string[] | null>(null);
  const [discardLines, setDiscardLines] = useState<{ path: string; selection: { hunk: number; lines?: number[] }[]; count: number } | null>(null);
  const [stageThenCommit, setStageThenCommit] = useState(false);
  const [filter, setFilter] = useState('');
  const [treeView, setTreeView] = useState(() => {
    if (tree) return true;
    try {
      return localStorage.getItem(VIEW_KEY) === 'grouped';
    } catch {
      return false;
    }
  });
  const [foldedDirs, setFoldedDirs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ staged: Record<string, [number, number]>; unstaged: Record<string, [number, number]> }>({ staged: {}, unstaged: {} });
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ f: FileChange; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, treeView ? 'grouped' : 'flat');
    } catch {
      /* convenience only */
    }
  }, [treeView]);

  useEffect(() => {
    if (!status) return;
    call('git:changeStats', { repoId }).then(setStats).catch(() => undefined);
  }, [status, repoId]);

  // Keep the selection valid when status changes (a staged file keeps focus as it moves tabs).
  useEffect(() => {
    if (!status || !selected) return;
    const all = [...status.conflicted, ...status.staged, ...status.unstaged, ...status.untracked];
    const still = all.find((f) => fileKey(f) === fileKey(selected)) ?? all.find((f) => f.path === selected.path) ?? null;
    if (!still) {
      setSelected(null);
      setDiff(null);
    } else if (still !== selected) setSelected(still);
    setPicked((p) => new Set([...p].filter((k) => all.some((f) => fileKey(f) === k))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const loadDiff = useCallback(
    (f: FileChange | null) => {
      if (!f) return;
      let cancelled = false;
      setDiffLoading(true);
      call('git:diffFile', { repoId, path: f.path, area: f.area })
        .then((d) => !cancelled && setDiff(d))
        .catch((err) => !cancelled && showError(err))
        .finally(() => !cancelled && setDiffLoading(false));
      return () => {
        cancelled = true;
      };
    },
    [repoId, showError],
  );
  useEffect(() => loadDiff(selected), [selected, loadDiff, status]);

  const act = async (fn: () => Promise<unknown>, moved?: string[]) => {
    setBusy(true);
    try {
      await fn();
      if (moved?.length) {
        setFlash(new Set(moved));
        setTimeout(() => setFlash(new Set()), 900);
      }
    } catch (err) {
      showError(err);
    }
    setBusy(false);
    await reload();
    bump();
  };

  const q = filter.trim().toLowerCase();
  const changesAll = useMemo(() => (status ? [...status.conflicted, ...status.unstaged, ...status.untracked] : []), [status]);
  const stagedAll = useMemo(() => status?.staged ?? [], [status]);
  const list = useMemo(() => {
    const src = tab === 'changes' ? changesAll : stagedAll;
    return q ? src.filter((x) => x.path.toLowerCase().includes(q)) : src;
  }, [tab, changesAll, stagedAll, q]);

  // An empty tab gives way to the other one (staging everything lands you on Staged, unstaging on Changes).
  // Only when a tab *becomes* empty — clicking an empty tab yourself stays there.
  const prevCounts = useRef<{ changes: number; staged: number } | null>(null);
  useEffect(() => {
    if (!status) return;
    const prev = prevCounts.current;
    prevCounts.current = { changes: changesAll.length, staged: stagedAll.length };
    if (!prev) return;
    if (tab === 'changes' && prev.changes > 0 && changesAll.length === 0 && stagedAll.length > 0) setTab('staged');
    else if (tab === 'staged' && prev.staged > 0 && stagedAll.length === 0 && changesAll.length > 0) setTab('changes');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, changesAll.length, stagedAll.length]);
  // Switching tabs clears the ticked files.
  useEffect(() => setPicked(new Set()), [tab]);

  // Docked: picking Lanes / Explorer closes the file diff.
  useEffect(() => {
    if (!docked) return;
    const close = () => {
      setSelected(null);
      setDiff(null);
    };
    window.addEventListener(CLOSE_DOCK_EVENT, close);
    return () => window.removeEventListener(CLOSE_DOCK_EVENT, close);
  }, [docked]);
  // Docked: Esc closes the file diff and brings the graph back.
  const isDocked = !!docked;
  useEffect(() => {
    if (!isDocked || !selected) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop, .dt, .cm, .ctx-menu')) return;
      setSelected(null);
      setDiff(null);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [isDocked, selected]);

  // Right-click menu on a file.
  useLayoutEffect(() => {
    if (menu && menuRef.current) fitMenu(menuRef.current, menu.x, menu.y);
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  }, [menu]);

  if (error) return <div className="content"><ErrorPanel error={error} /></div>;
  if (!status) return <div className="content"><Spinner label="Reading repository status…" /></div>;

  const unstagedAll = [...status.unstaged.map((f) => f.path), ...status.untracked.map((f) => f.path)];
  const total = status.staged.length + unstagedAll.length + status.conflicted.length;
  const nothing = total === 0;
  // Nothing to commit: a full-width overview instead of an empty two-pane layout.
  if (nothing) return docked ? <EmptyChanges repoId={repoId} status={status} /> :<div className="content flush"><CleanSlate repoId={repoId} status={status} /></div>;
  const statOf = (f: FileChange) => (f.area === 'staged' ? stats.staged[f.path] : stats.unstaged[f.path]);

  const pickedFiles = list.filter((f) => picked.has(fileKey(f)));
  const allPicked = list.length > 0 && pickedFiles.length === list.length;
  const stageable = (fs: FileChange[]) => fs.filter((f) => f.area === 'unstaged' || f.area === 'untracked').map((f) => f.path);

  const stage = (paths: string[]) => paths.length && act(() => call('git:stage', { repoId, paths }), paths);
  const unstage = (paths: string[]) => paths.length && act(() => call('git:unstage', { repoId, paths }), paths);
  const toggleStage = (f: FileChange) => (f.area === 'staged' ? unstage([f.path]) : f.area === 'conflicted' ? setRepoTab('conflicts') : stage([f.path]));
  const togglePick = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const clickRow = (f: FileChange, e: React.MouseEvent) => {
    const k = fileKey(f);
    if (e.ctrlKey || e.metaKey) {
      togglePick(k);
      setAnchor(k);
      return;
    }
    if (e.shiftKey && anchor) {
      const a = list.findIndex((x) => fileKey(x) === anchor);
      const b = list.findIndex((x) => fileKey(x) === k);
      if (a !== -1 && b !== -1) setPicked(new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1).map(fileKey)));
      return;
    }
    setAnchor(k);
    setSelected(f);
  };

  const onBoardKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    const i = selected ? list.findIndex((f) => fileKey(f) === fileKey(selected)) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        setSelected(next);
        setAnchor(fileKey(next));
        boardRef.current?.querySelector(`[data-key="${CSS.escape(fileKey(next))}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === ' ' && (selected || pickedFiles.length)) {
      e.preventDefault();
      if (pickedFiles.length > 1) {
        if (tab === 'changes') void stage(stageable(pickedFiles));
        else void unstage(pickedFiles.map((f) => f.path));
      } else if (selected) void toggleStage(selected);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && tab === 'changes' && (pickedFiles.length || (selected && selected.area !== 'staged' && selected.area !== 'conflicted'))) {
      e.preventDefault();
      setDiscard(pickedFiles.length ? stageable(pickedFiles) : [selected!.path]);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      setPicked(new Set(list.map(fileKey)));
    } else if (e.key === 'Escape') setPicked(new Set());
  };

  const applyPartial = (action: PartialAction, selection: { hunk: number; lines?: number[] }[]) => {
    if (!selected) return;
    if (action === 'discard') {
      const count = selection.reduce((n, s) => n + (s.lines ? s.lines.length : (diff?.hunks[s.hunk]?.lines.filter((l) => l.type !== 'context' && l.type !== 'meta').length ?? 0)), 0);
      return setDiscardLines({ path: selected.path, selection, count });
    }
    void act(async () => {
      const r = await call('git:applySelection', { repoId, path: selected.path, action, selection });
      toast(`${action === 'stage' ? 'Staged' : 'Unstaged'} ${r.lines} line(s) of ${baseOf(selected.path)}`);
    });
  };
  const applyWhole = (action: PartialAction) => {
    if (!selected) return;
    if (action === 'discard') return setDiscard([selected.path]);
    void (action === 'stage' ? stage([selected.path]) : unstage([selected.path]));
  };

  // ------------------------------------------------------------------ commit

  const hasUpstream = isPublished(status);
  const amendAllowed = !!status.headOid && !(hasUpstream && status.ahead === 0);
  const amendHint = !status.headOid ? 'No commit yet' : amendAllowed ? 'Add to the last commit (not pushed yet)' : 'The last commit is already pushed';

  /** Commit straight away (the review dialog only when asked for, or when the author still has to be set). */
  const commit = async (action: CommitAction) => {
    if (action === 'review') {
      if (status.staged.length === 0) setStageThenCommit(true);
      else setCommitOpen(true);
      return;
    }
    setCommitting(true);
    try {
      if (status.staged.length === 0) await call('git:stage', { repoId, paths: unstagedAll });
      const p = await call('commit:prepare', { repoId });
      const a = p.accountAuthor;
      const mine = !!a && [p.identity.name, p.identity.email].some((v) => (v ?? '').toLowerCase().includes(a.login.toLowerCase()));
      const asAccount = !!a && !mine;
      if ((!p.identity.name || !p.identity.email) && !asAccount) {
        // No author yet: the review dialog asks for a name and email.
        setCommitOpen(true);
        return;
      }
      const c = await call('commit:execute', { repoId, confirmationId: p.confirmationId, message, signing: p.defaultSigning, authorAccount: asAccount, amend: action === 'amend' });
      try {
        localStorage.removeItem(`gb.draft.${repoId}`);
      } catch {
        /* drafts are a convenience */
      }
      setMessage('');
      toast(`${action === 'amend' ? 'Amended' : 'Committed'} ${c.shortHash}: ${c.subject}`);
      if (action === 'commit-push') window.dispatchEvent(new CustomEvent('gb:repo-dialog', { detail: 'push' }));
    } catch (err) {
      showError(err);
    } finally {
      setCommitting(false);
      await reload();
      bump();
    }
  };

  const blockedReason = status.conflicted.length
    ? 'Resolve the conflicts before committing.'
    : !message.trim()
      ? 'Write a summary to commit.'
      : status.staged.length === 0 && unstagedAll.length === 0
        ? 'Nothing to commit.'
        : null;
  const primaryLabel = status.staged.length === 0 ? `Stage all & commit (${unstagedAll.length})` : `Commit staged (${status.staged.length})`;
  const stagedForComposer = status.staged.map((f) => ({ path: f.path, kind: f.kind, add: stats.staged[f.path]?.[0] ?? 0, del: stats.staged[f.path]?.[1] ?? 0 }));

  // ------------------------------------------------------------------ rows

  const row = (f: FileChange, depth = 0) => {
    const k = fileKey(f);
    const st = statOf(f);
    const isSel = selected && fileKey(selected) === k;
    const [letter, tone, kindTitle] = KIND[f.area === 'conflicted' ? 'conflicted' : f.kind] ?? KIND.modified;
    const dir = dirOf(f.path);
    return (
      <div
        key={k}
        data-key={k}
        className={`chg-row ${isSel ? 'focus' : ''} ${picked.has(k) ? 'picked' : ''} ${flash.has(f.path) ? 'flash' : ''}`}
        style={depth ? { paddingLeft: 10 + depth * 16 } : undefined}
        onClick={(e) => clickRow(f, e)}
        onDoubleClick={() => void toggleStage(f)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ f, x: e.clientX, y: e.clientY });
        }}
        title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
      >
        <input
          type="checkbox"
          className="chg-check"
          checked={picked.has(k)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => togglePick(k)}
          aria-label={`Select ${f.path}`}
        />
        <span className={`chg-kind ${tone}`} title={kindTitle}>
          {letter}
        </span>
        <span className="chg-path">
          {!treeView && dir && <span className="chg-dir">{dir}/</span>}
          <span className="chg-file">{baseOf(f.path)}</span>
        </span>
        {st && (st[0] > 0 || st[1] > 0) && (
          <span className="chg-stat">
            <span className="text-ok">+{st[0]}</span> <span className="text-danger">−{st[1]}</span>
          </span>
        )}
        <span className="chg-acts" onClick={(e) => e.stopPropagation()}>
          {f.area === 'conflicted' ? (
            <button onClick={() => setRepoTab('conflicts')} title="Resolve in Conflicts">
              ⚠
            </button>
          ) : f.area === 'staged' ? (
            <button onClick={() => void unstage([f.path])} disabled={busy} title="Unstage (Space)">
              −
            </button>
          ) : (
            <>
              <button className="danger" onClick={() => setDiscard([f.path])} title={f.area === 'untracked' ? 'Delete this new file' : 'Discard changes'}>
                ↺
              </button>
              <button onClick={() => void stage([f.path])} disabled={busy} title="Stage (Space)">
                +
              </button>
            </>
          )}
        </span>
      </div>
    );
  };

  /** Folder tree: folders fold, single-child chains are joined ("src/renderer"), counts per folder. */
  const treeBody = (files: FileChange[]) => {
    type Node = { name: string; path: string; dirs: Map<string, Node>; files: FileChange[] };
    const root: Node = { name: '', path: '', dirs: new Map(), files: [] };
    for (const f of [...files].sort((x, y) => x.path.localeCompare(y.path))) {
      let n = root;
      f.path
        .split('/')
        .slice(0, -1)
        .forEach((part) => {
          const path = n.path ? `${n.path}/${part}` : part;
          if (!n.dirs.has(part)) n.dirs.set(part, { name: part, path, dirs: new Map(), files: [] });
          n = n.dirs.get(part)!;
        });
      n.files.push(f);
    }
    const count = (n: Node): number => n.files.length + [...n.dirs.values()].reduce((a, d) => a + count(d), 0);
    const render = (n: Node, depth: number): ReactNode[] => {
      const out: ReactNode[] = [];
      for (const d0 of [...n.dirs.values()].sort((x, y) => x.name.localeCompare(y.name))) {
        let d = d0;
        let label = d.name;
        while (d.files.length === 0 && d.dirs.size === 1) {
          d = [...d.dirs.values()][0];
          label += `/${d.name}`;
        }
        const key = `${tab}:${d.path}`;
        const shut = foldedDirs.has(key);
        out.push(
          <div key={`d:${key}`} className="chg-dir-row" style={{ paddingLeft: 10 + depth * 16 }} onClick={() => toggleDir(key)} title={d.path}>
            <span className={`chg-caret ${shut ? 'shut' : ''}`}>▾</span>
            <span className="chg-folder" aria-hidden>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
              </svg>
            </span>
            <span className="chg-dir-name">{label}</span>
            <span className="chg-n">{count(d)}</span>
          </div>,
        );
        if (!shut) out.push(...render(d, depth + 1));
      }
      for (const f of n.files) out.push(row(f, depth));
      return out;
    };
    return render(root, 0);
  };
  const toggleDir = (key: string) =>
    setFoldedDirs((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const changesCount = changesAll.length;
  const stagedCount = stagedAll.length;

  return (
    <div className={`content flush ${docked ? 'ws-dock-wrap' : ''}`}>
      <div className={`split cb-split ${docked ? 'ws-dock' : ''}`}>
        <div className="left cb-left chg" ref={boardRef} tabIndex={0} onKeyDown={onBoardKey}>
          <div className="chg-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'on' : ''} onClick={() => setTab('changes')}>
              Changes <span className="chg-tab-n">{changesCount}</span>
            </button>
            <button role="tab" aria-selected={tab === 'staged'} className={tab === 'staged' ? 'on' : ''} onClick={() => setTab('staged')}>
              Staged <span className="chg-tab-n">{stagedCount}</span>
            </button>
          </div>

          <div className="chg-filter">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4.2-4.2" />
            </svg>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter changed files" spellCheck={false} aria-label="Filter changed files" />
          </div>

          <div className="chg-bar">
            <label className="chg-all">
              <input
                type="checkbox"
                checked={allPicked}
                ref={(el) => {
                  if (el) el.indeterminate = pickedFiles.length > 0 && !allPicked;
                }}
                onChange={() => setPicked(allPicked ? new Set() : new Set(list.map(fileKey)))}
                disabled={!list.length}
              />
              {pickedFiles.length ? `${pickedFiles.length} selected` : 'Select all'}
            </label>
            <span className="grow" />
            <div className="chg-seg" role="group" aria-label="View">
              <button className={!treeView ? 'on' : ''} onClick={() => setTreeView(false)} title="Paths">
                ☰ Path
              </button>
              <button className={treeView ? 'on' : ''} onClick={() => setTreeView(true)} title="Folder tree">
                ⊞ Tree
              </button>
            </div>
            {tab === 'changes' ? (
              <>
                <button
                  className="chg-btn"
                  disabled={busy || (pickedFiles.length ? !stageable(pickedFiles).length : !unstagedAll.length)}
                  onClick={() => (pickedFiles.length ? void stage(stageable(pickedFiles)) : act(() => call('git:stageAll', { repoId }), unstagedAll))}
                >
                  {pickedFiles.length ? 'Stage selected' : 'Stage all'}
                </button>
                <button
                  className="chg-icon danger"
                  disabled={pickedFiles.length ? !stageable(pickedFiles).length : !unstagedAll.length}
                  onClick={() => setDiscard(pickedFiles.length ? stageable(pickedFiles) : unstagedAll)}
                  title={pickedFiles.length ? 'Discard the selected changes' : 'Discard all unstaged changes'}
                >
                  ↺
                </button>
              </>
            ) : (
              <button
                className="chg-btn"
                disabled={busy || !stagedCount}
                onClick={() => (pickedFiles.length ? void unstage(pickedFiles.map((f) => f.path)) : act(() => call('git:unstageAll', { repoId }), status.staged.map((f) => f.path)))}
              >
                {pickedFiles.length ? 'Unstage selected' : 'Unstage all'}
              </button>
            )}
          </div>

          {tab === 'staged' && stagedCount > 0 && (
            <div className="chg-note">
              {stagedCount} file{stagedCount === 1 ? '' : 's'} ready to commit
            </div>
          )}
          {tab === 'changes' && status.conflicted.length > 0 && (
            <button className="chg-conflicts" onClick={() => setRepoTab('conflicts')}>
              ⚠ {status.conflicted.length} conflict{status.conflicted.length === 1 ? '' : 's'} to resolve <span className="grow" /> Resolve →
            </button>
          )}

          <div className="chg-list">
            {list.length === 0 && (
              <div className="chg-empty">
                {q ? `No file matches “${filter}”.` : tab === 'staged' ? 'Tip: press Space on a file in Changes to stage it.' : 'No unstaged changes.'}
              </div>
            )}
            {treeView ? treeBody(list) : list.map((f) => row(f))}
          </div>

          <CommitComposer
            repoId={repoId}
            message={message}
            setMessage={setMessage}
            staged={stagedForComposer}
            canCommit={!blockedReason}
            primaryLabel={primaryLabel}
            blockedReason={blockedReason}
            amendAllowed={amendAllowed}
            amendHint={amendHint}
            busy={committing}
            onCommit={(a) => void commit(a)}
          />
        </div>
        {docked ? (
          selected &&
          docked.diffHost &&
          createPortal(
            <div className="ws-diff">
              <div className="ws-diff-body">
                {diffLoading && !diff && <Spinner />}
                {diff && <HunkDiff file={selected} diff={diff} busy={busy} onApply={applyPartial} onWhole={applyWhole} />}
                {!diffLoading && !diff && <div className="empty">No textual changes for this file.</div>}
              </div>
            </div>,
            docked.diffHost,
          )
        ) : (
        <div className="right cb-right">
          {!selected && (
            <div className="cb-placeholder">
              <div className="cb-placeholder-ico">✋</div>
              <h3>Pick a file to review</h3>
              <p className="small muted">
                Stage whole files, single hunks or just the lines you choose. Drag files between <strong>Changes</strong> and <strong>Staged</strong>.
              </p>
              <div className="cb-keys small">
                <span>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> move
                </span>
                <span>
                  <kbd>Space</kbd> stage / unstage
                </span>
                <span>
                  <kbd>Ctrl</kbd>/<kbd>Shift</kbd>+click multi-select
                </span>
                <span>
                  <kbd>Del</kbd> discard
                </span>
                <span>
                  <kbd>Ctrl</kbd>+<kbd>Enter</kbd> commit
                </span>
              </div>
            </div>
          )}
          {selected && diffLoading && !diff && (
            <div className="content">
              <Spinner />
            </div>
          )}
          {selected && diff && <HunkDiff file={selected} diff={diff} busy={busy} onApply={applyPartial} onWhole={applyWhole} />}
          {selected && !diffLoading && !diff && <div className="empty">No textual changes for this file.</div>}
        </div>
        )}
      </div>

      {menu && (
        <div ref={menuRef} className="ctx-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
          {menu.f.area === 'conflicted' ? (
            <div className="dropdown-item" onClick={() => (setMenu(null), setRepoTab('conflicts'))}>
              <span className="ctx-ico">⚠</span> Resolve in Conflicts
            </div>
          ) : menu.f.area === 'staged' ? (
            <div className="dropdown-item" onClick={() => (setMenu(null), void unstage([menu.f.path]))}>
              <span className="ctx-ico">−</span> Unstage
            </div>
          ) : (
            <>
              <div className="dropdown-item" onClick={() => (setMenu(null), void stage([menu.f.path]))}>
                <span className="ctx-ico">+</span> Stage
              </div>
              <div className="dropdown-item danger" onClick={() => (setMenu(null), setDiscard([menu.f.path]))}>
                <span className="ctx-ico">↺</span> {menu.f.area === 'untracked' ? 'Delete new file…' : 'Discard changes…'}
              </div>
            </>
          )}
          <div className="dropdown-sep" />
          <div className="dropdown-item" onClick={() => (setMenu(null), void call('app:copyText', { text: menu.f.path }).then(() => toast('Path copied')).catch(showError))}>
            <span className="ctx-ico">⧉</span> Copy path
          </div>
          <div className="dropdown-item" onClick={() => (setMenu(null), void call('graph:reveal', { repoId, path: menu.f.path }).catch(showError))}>
            <span className="ctx-ico">📂</span> Show in folder
          </div>
        </div>
      )}
      {commitOpen && (
        <CommitDialog
          repoId={repoId}
          mode="commit"
          initialMessage={message}
          onClose={() => setCommitOpen(false)}
          onDone={(c) => {
            setCommitOpen(false);
            if (c) {
              setMessage('');
              toast(`Committed ${c.shortHash}: ${c.subject}`);
            }
            void reload();
            bump();
          }}
        />
      )}
      {stageThenCommit && (
        <StagePickDialog
          files={[...status.unstaged, ...status.untracked]}
          onCancel={() => setStageThenCommit(false)}
          onStage={async (paths) => {
            try {
              await call('git:stage', { repoId, paths });
              await reload();
              bump();
              setStageThenCommit(false);
              setCommitOpen(true);
            } catch (err) {
              setStageThenCommit(false);
              showError(err);
            }
          }}
        />
      )}
      {discardLines && (
        <ConfirmDialog
          title="Discard Selected Changes"
          danger
          explanation={
            <>
              Removes {discardLines.count} changed line(s) from <strong className="mono">{discardLines.path}</strong> in your working folder. The exact patch is saved in the app’s data folder first, so it can be
              re-applied.
            </>
          }
          impact="Your file is edited; the rest of its changes stay."
          affected={[discardLines.path]}
          confirmLabel={`Discard ${discardLines.count} line(s)`}
          onCancel={() => setDiscardLines(null)}
          onConfirm={async () => {
            const d = discardLines;
            setDiscardLines(null);
            await act(async () => {
              const r = await call('git:applySelection', { repoId, path: d.path, action: 'discard', selection: d.selection, confirmed: true });
              toast(`Discarded ${r.lines} line(s). Patch saved: ${r.backupFile}`, 'info');
            });
          }}
        />
      )}
      {discard && (
        <ConfirmDialog
          title="Discard Changes"
          danger
          explanation={
            <>
              Restores the selected tracked files to their last committed version and deletes the selected untracked files. A backup copy of each file is saved in the app's data folder before anything is
              removed.
            </>
          }
          impact="This operation will overwrite local changes. Git cannot undo it."
          affected={discard}
          confirmLabel={`Discard ${discard.length} file(s)`}
          onCancel={() => setDiscard(null)}
          onReview={() => {
            const f = [...status.unstaged, ...status.untracked].find((x) => x.path === discard[0]);
            if (f) setSelected(f);
            setDiscard(null);
          }}
          onConfirm={async () => {
            try {
              const res = await call('git:discard', { repoId, paths: discard, confirmed: true });
              toast(`Discarded ${discard.length} file(s). Backup: ${res.backupDir}`, 'info');
            } catch (err) {
              showError(err);
            }
            setDiscard(null);
            await reload();
            bump();
          }}
        />
      )}
    </div>
  );
}
