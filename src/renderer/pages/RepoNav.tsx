import { useEffect, useState, type ReactNode } from 'react';
import type { WorktreeInfo } from '../../shared/types';
import { useAsync } from '../hooks/useAsync';
import { call } from '../services/api';
import { requestCompare } from '../services/compareRequest';
import { CLOSE_DOCK_EVENT, FILE_DIFF_EVENT } from '../services/dock';
import { requestQuickMerge } from '../services/quickMerge';
import { FILTER_EVENT, requestClearFilter } from '../services/jump';
import { useApp, type RepoTab } from '../state/AppState';
import { requestNewBranch } from './changes/CleanSlate';
import { AddWorktreeDialog } from './workspace/WorktreePanel';

const COLLAPSE_KEY = 'gb.repoNav.collapsed';
const OPEN_KEY = 'gb.repoNav.open';

type Section = 'history' | 'worktrees';

interface Props {
  tab: RepoTab;
  onPick: (t: RepoTab) => void;
  /** Labels of the provider-dependent pages (null when this repository has no such page). */
  pullsLabel: string | null;
  pipelinesLabel: string | null;
  conflictCount: number;
  showConflicts: boolean;
  /** Everything but the sidebar itself is off until the right account is in use. */
  locked: boolean;
  branch: string | null;
  /** "Limited access" note, shown at the bottom. */
  extra?: ReactNode;
}

const I = {
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  worktree: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />,
  pr: <path d="M6 3v12M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 17V9a3 3 0 0 0-3-3h-4m0 0 2-2m-2 2 2 2" />,
  actions: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5v7l5.5-3.5z" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
  warn: <path d="M12 3 2 20h20zM12 10v4M12 17.5v.01" />,
  pane: <path d="M4 5h16v14H4zM9 5v14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
};

function Ico({ d, size = 15 }: { d: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* per-viewer convenience */
  }
};
const folderOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;

/**
 * The repository's left sidebar (replaces the Changes / Code / … tab bar): Branches & History with its
 * actions, the worktrees, Code explorer, Pull requests, Actions and Settings. Collapses to an icon rail.
 */
export function RepoNav({ tab, onPick, pullsLabel, pipelinesLabel, conflictCount, showConflicts, locked, branch, extra }: Props) {
  const { activeRepo, revision, selectRepo, refreshRepos, bump, toast, showError } = useApp();
  const repoId = activeRepo!.id;
  const [collapsed, setCollapsed] = useState<boolean>(() => read(COLLAPSE_KEY, false));
  const [open, setOpen] = useState<Record<Section, boolean>>(() => read(OPEN_KEY, { history: true, worktrees: false }));
  useEffect(() => write(COLLAPSE_KEY, collapsed), [collapsed]);
  useEffect(() => write(OPEN_KEY, open), [open]);
  const toggle = (s: Section) => setOpen((o) => ({ ...o, [s]: !o[s] }));

  const worktrees = useAsync(() => call('git:worktrees', { repoId }), [repoId, revision]);
  const [adding, setAdding] = useState(false);
  const branches = useAsync(() => (adding ? call('git:branches', { repoId }) : Promise.resolve(null)), [repoId, adding]);
  const wts = [...(worktrees.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || Number(b.main) - Number(a.main));

  // A changed file open over the history: History is not the selected item then; clicking it closes the file.
  const [fileOpen, setFileOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setFileOpen(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(FILE_DIFF_EVENT, on);
    return () => window.removeEventListener(FILE_DIFF_EVENT, on);
  }, []);
  const [filtered, setFiltered] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setFiltered(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(FILTER_EVENT, on);
    return () => window.removeEventListener(FILTER_EVENT, on);
  }, []);

  // Ctrl+1…9 still jump to the pages, in sidebar order.
  const pages: RepoTab[] = ['changes', ...(showConflicts ? (['conflicts'] as RepoTab[]) : []), 'code', ...(pullsLabel ? (['pulls'] as RepoTab[]) : []), ...(pipelinesLabel ? (['actions'] as RepoTab[]) : []), 'settings'];
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && pages[n - 1]) {
        e.preventDefault();
        if (!locked) onPick(pages[n - 1]);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const go = (t: RepoTab) => !locked && onPick(t);
  const onHistory = (fn: () => void) => () => {
    if (locked) return;
    if (tab !== 'changes') onPick('changes');
    fn();
  };

  const openWorktree = async (w: WorktreeInfo) => {
    if (w.current || w.prunable) return;
    try {
      const s = await call('git:worktreeOpen', { repoId, path: w.path });
      await refreshRepos();
      selectRepo(s.id);
      bump();
    } catch (err) {
      showError(err);
    }
  };

  const navItem = (id: RepoTab, label: string, icon: ReactNode, opts: { count?: number; chevron?: boolean; tone?: 'danger' } = {}) => (
    <button key={id} className={`rn-item ${tab === id ? 'on' : ''} ${opts.tone ?? ''}`} disabled={locked} onClick={() => go(id)} title={locked ? `Switch account to use ${label}` : label}>
      <span className="rn-ico">
        <Ico d={icon} />
      </span>
      <span className="rn-label">{label}</span>
      {!!opts.count && <span className={`rn-n ${opts.tone ?? ''}`}>{opts.count}</span>}
      {opts.chevron && <span className="rn-chev">›</span>}
    </button>
  );

  if (collapsed) {
    const rail = (id: RepoTab | 'worktrees', label: string, icon: ReactNode, onClick: () => void, on: boolean) => (
      <button key={id} className={`rn-rail-btn ${on ? 'on' : ''}`} disabled={locked && id !== 'worktrees'} onClick={onClick} title={label} aria-label={label}>
        <Ico d={icon} size={16} />
      </button>
    );
    return (
      <nav className="rn rn-rail" aria-label="Repository">
        <button className="rn-rail-btn" onClick={() => setCollapsed(false)} title="Expand sidebar" aria-label="Expand sidebar">
          <Ico d={I.pane} size={16} />
        </button>
        <span className="rn-rail-sep" />
        {rail('changes', 'Branches & History', I.history, () => go('changes'), tab === 'changes')}
        {showConflicts && rail('conflicts', 'Conflicts', I.warn, () => go('conflicts'), tab === 'conflicts')}
        {rail('worktrees', 'Worktrees', I.worktree, () => (setCollapsed(false), setOpen((o) => ({ ...o, worktrees: true }))), false)}
        {rail('code', 'Code explorer', I.code, () => go('code'), tab === 'code')}
        {pullsLabel && rail('pulls', pullsLabel, I.pr, () => go('pulls'), tab === 'pulls')}
        {pipelinesLabel && rail('actions', pipelinesLabel, I.actions, () => go('actions'), tab === 'actions')}
        <span className="grow" />
        {rail('settings', 'Settings', I.settings, () => go('settings'), tab === 'settings')}
      </nav>
    );
  }

  return (
    <nav className="rn" aria-label="Repository">
      <div className="rn-head">
        <span className="rn-title" title={activeRepo!.name}>
          {activeRepo!.name}
        </span>
        <button className="rn-icon" onClick={() => setCollapsed(true)} title="Collapse sidebar" aria-label="Collapse sidebar">
          <Ico d={I.pane} />
        </button>
      </div>

      <div className="rn-body">
        {/* Branches & History */}
        <button className={`rn-item rn-group ${tab === 'changes' ? 'here' : ''}`} onClick={() => toggle('history')} aria-expanded={open.history}>
          <span className="rn-ico">
            <Ico d={I.history} />
          </span>
          <span className="rn-label">Branches &amp; History</span>
          <span className={`rn-caret ${open.history ? 'open' : ''}`}>›</span>
        </button>
        {open.history && (
          <div className="rn-sub">
            <button
              className={`rn-subitem ${tab === 'changes' && !fileOpen ? 'on' : ''}`}
              disabled={locked}
              onClick={() => {
                go('changes');
                window.dispatchEvent(new Event(CLOSE_DOCK_EVENT));
              }}
            >
              History
              {filtered && tab === 'changes' && (
                <span
                  className="rn-clear"
                  role="button"
                  title="Show all commits again"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestClearFilter();
                  }}
                >
                  ✕ filter
                </span>
              )}
            </button>
            <button className="rn-subitem" disabled={locked} onClick={onHistory(() => requestNewBranch(branch ?? undefined))}>
              Create branch
            </button>
            <button className="rn-subitem" disabled={locked} onClick={onHistory(() => requestQuickMerge({ source: branch ?? undefined }))}>
              Merge branch
            </button>
            <button className="rn-subitem" disabled={locked} onClick={onHistory(() => requestCompare())}>
              Compare
            </button>
          </div>
        )}

        {showConflicts && navItem('conflicts', 'Conflicts', I.warn, { count: conflictCount, tone: 'danger' })}

        {/* Worktrees */}
        <button className="rn-item rn-group" onClick={() => toggle('worktrees')} aria-expanded={open.worktrees}>
          <span className="rn-ico">
            <Ico d={I.worktree} />
          </span>
          <span className="rn-label">Worktrees</span>
          {wts.length > 0 && <span className="rn-n">{wts.length}</span>}
          <span className={`rn-caret ${open.worktrees ? 'open' : ''}`}>›</span>
        </button>
        {open.worktrees && (
          <div className="rn-sub">
            {wts.map((w) => {
              const leaf = w.branch ? w.branch.slice(w.branch.lastIndexOf('/') + 1) : folderOf(w.path);
              return (
                <button
                  key={w.path}
                  className={`rn-wt ${w.current ? 'on' : ''} ${w.prunable ? 'gone' : ''}`}
                  onClick={() => void openWorktree(w)}
                  title={`${w.branch ?? 'detached'}\n${w.path}${w.current ? '\n(open here)' : w.prunable ? '\n(folder missing)' : '\nClick to open'}`}
                >
                  <span className={`rn-wt-dot ${w.current ? 'here' : w.changes ? 'dirty' : ''}`} />
                  <span className="rn-wt-text">
                    <span className="rn-wt-name">{leaf}</span>
                    <span className="rn-wt-sub">{w.branch ?? folderOf(w.path)}</span>
                  </span>
                  {!!w.changes && <span className="rn-wt-n">{w.changes}</span>}
                </button>
              );
            })}
            {worktrees.data && (
              <button className="rn-subitem rn-add" onClick={() => setAdding(true)}>
                <Ico d={I.plus} size={13} /> Add worktree
              </button>
            )}
          </div>
        )}

        {navItem('code', 'Code explorer', I.code)}
        {pullsLabel && navItem('pulls', pullsLabel, I.pr, { chevron: true })}
        {pipelinesLabel && navItem('actions', pipelinesLabel, I.actions)}
        {navItem('settings', 'Settings', I.settings, { chevron: true })}
      </div>

      {extra && <div className="rn-extra">{extra}</div>}

      {adding && branches.data && (
        <AddWorktreeDialog
          repoId={repoId}
          repoPath={activeRepo!.path}
          repoName={activeRepo!.name}
          branches={branches.data}
          taken={new Set(wts.map((w) => w.branch).filter((b): b is string => !!b))}
          initial={{}}
          onClose={() => setAdding(false)}
          onDone={(w, openIt) => {
            setAdding(false);
            void worktrees.reload();
            toast(`Worktree ${folderOf(w.path)} ready`);
            if (openIt) void openWorktree({ ...w, current: false });
          }}
        />
      )}
    </nav>
  );
}
