import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RepoSummary } from '../../shared/types';
import type { ProviderId } from '../../shared/providers';
import { ProviderMono } from './ProviderMono';
import { CloneDialog } from '../dialogs/CloneDialog';
import { useAddExisting } from '../dialogs/LinkAccountDialog';
import { CreateRepoWizard } from '../dialogs/CreateRepoWizard';
import { ContributorsDialog, DuplicateRepoDialog, hueOf, LastCommitDialog, RemoveRepoDialog } from '../dialogs/RepoActionDialogs';
import { call, onNotify } from '../services/api';
import { useApp } from '../state/AppState';
import { fitMenu, markScroll } from './menuFit';

/** "jahedul-hasan-kaz, inride" / "jahedul-hasan-kaz, personal" / "local repository". */
export function repoSubtitle(r: RepoSummary): string {
  if (r.github && !r.account && r.missingAccount) return `${r.missingAccount.login} (signed out), ${r.ownerLabel ?? r.github.owner}`;
  if (r.github) return `${r.account?.login ?? 'no account'}, ${r.ownerLabel ?? r.github.owner}`;
  if (r.identity) return r.identity.split('/')[0];
  return r.remoteUrl ? 'other remote' : 'local repository';
}

// ---------------------------------------------------------------------------------------------
// Where the trigger renders: the header puts a <RepoSwitcherSlot /> where the repository name goes.

type Visibility = 'private' | 'public' | null;
let slotEl: HTMLElement | null = null;
let slotVis: Visibility = null;
const slotListeners = new Set<() => void>();
const emit = () => slotListeners.forEach((l) => l());
function setSlot(el: HTMLElement | null, prev: HTMLElement | null) {
  if (el === null && slotEl !== prev) return; // another slot already took over
  slotEl = el;
  emit();
}
const subscribe = (l: () => void) => {
  slotListeners.add(l);
  return () => {
    slotListeners.delete(l);
  };
};
const useSlot = () => useSyncExternalStore(subscribe, () => slotEl);
const useSlotVisibility = () => useSyncExternalStore(subscribe, () => slotVis);

/** Marks where the repository dropdown's trigger goes (in place of the repository name); `visibility` badges its logo. */
export function RepoSwitcherSlot({ visibility = null }: { visibility?: Visibility }) {
  const mine = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    slotVis = visibility;
    emit();
    return () => {
      slotVis = null;
      emit();
    };
  }, [visibility]);
  return (
    <span
      className="rs-slot"
      ref={(el) => {
        if (el) {
          mine.current = el;
          setSlot(el, null);
        } else {
          setSlot(null, mine.current);
          mine.current = null;
        }
      }}
    />
  );
}

/** The owner shown above the repository name: GitHub owner, provider namespace, or where it lives. */
function repoOwner(r: RepoSummary): string {
  if (r.github) return r.github.owner;
  if (r.provider) return r.provider.path.includes('/') ? r.provider.path.slice(0, r.provider.path.lastIndexOf('/')) : r.provider.host;
  return r.remoteUrl ? 'other remote' : 'local';
}

// ---------------------------------------------------------------------------------------------

interface Group {
  key: string;
  label: string;
  kind: 'account' | 'signedOut' | 'provider' | 'local';
  provider?: ProviderId;
  repos: RepoSummary[];
}

/** One group per account: signed-in accounts first, then signed-out ones, other providers, and local repositories. */
function groupByAccount(list: RepoSummary[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of list) {
    let g: Omit<Group, 'repos'>;
    if (r.account) g = { key: `acct:${r.account.id}`, label: r.account.login, kind: 'account' };
    else if (r.missingAccount) g = { key: `gone:${r.missingAccount.login.toLowerCase()}`, label: `${r.missingAccount.login} (signed out)`, kind: 'signedOut' };
    else if (r.provider) {
      const owner = r.provider.path.includes('/') ? r.provider.path.slice(0, r.provider.path.lastIndexOf('/')) : r.provider.host;
      g = { key: `prov:${r.provider.id}:${owner.toLowerCase()}`, label: owner, kind: 'provider', provider: r.provider.id };
    } else g = { key: 'local', label: 'Local & other remotes', kind: 'local' };
    const cur = groups.get(g.key) ?? { ...g, repos: [] };
    cur.repos.push(r);
    groups.set(g.key, cur);
  }
  const rank = { account: 0, signedOut: 1, provider: 2, local: 3 };
  const out = [...groups.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label));
  // Favourites first inside each account, then by name.
  for (const g of out) g.repos.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  return out;
}

type RepoDialog = { kind: 'duplicate' | 'contributors' | 'lastCommit' | 'remove'; repo: RepoSummary };

/**
 * The repository picker: a dropdown on the repository name in the header, grouped by account, with the
 * same right-click menu the sidebar had. Also hosts File → Add repository (open / create / clone).
 */
export function RepoSwitcher() {
  const { repos, activeRepoId, activeRepo, selectRepo, view, showError, bump, toast } = useApp();
  const slot = useSlot();
  const vis = useSlotVisibility();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [dialog, setDialog] = useState<'create' | 'clone' | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ repo: RepoSummary; x: number; y: number } | null>(null);
  const [repoDialog, setRepoDialog] = useState<RepoDialog | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Worktrees opened in the app belong to their main repository, which is what the list shows.
  const mainRepos = useMemo(() => {
    const ids = new Set(repos.map((r) => r.id));
    return repos.filter((r) => !(r.worktreeOf && ids.has(r.worktreeOf)));
  }, [repos]);
  const current = view === 'repo' && activeRepo ? activeRepo : null;
  const currentFamily = current?.worktreeOf ?? current?.id ?? null;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (r: RepoSummary) => `${r.name} ${repoSubtitle(r)} ${r.identity ?? ''}`.toLowerCase().includes(q);
    return groupByAccount(q ? mainRepos.filter(hit) : mainRepos);
  }, [mainRepos, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.repos), [groups]);

  const close = () => {
    setOpen(false);
    setCtxMenu(null);
  };
  const show = () => {
    setQuery('');
    const i = mainRepos.length ? groupByAccount(mainRepos).flatMap((g) => g.repos).findIndex((r) => r.id === currentFamily) : -1;
    setCursor(Math.max(0, i));
    setOpen(true);
  };
  const pick = (r: RepoSummary) => {
    close();
    selectRepo(r.id);
  };

  // Position the panel under the trigger, inside the window.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !triggerRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    fitMenu(panelRef.current, t.left - 8, t.bottom + 6);
    searchRef.current?.focus();
  }, [open]);

  // Keep the keyboard cursor in view.
  useEffect(() => {
    listRef.current?.querySelector('.rs-item.cur')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  // Outside click / Esc / window blur close the panel and the context menu.
  useEffect(() => {
    if (!open && !ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (ctxRef.current?.contains(n)) return;
      setCtxMenu(null);
      if (panelRef.current?.contains(n) || triggerRef.current?.contains(n)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (ctxMenu) setCtxMenu(null);
      else setOpen(false);
    };
    const onBlur = () => close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, ctxMenu]);

  // Keep the context menu inside the window.
  useLayoutEffect(() => {
    const el = ctxRef.current;
    if (el && ctxMenu) fitMenu(el, ctxMenu.x, ctxMenu.y);
  }, [ctxMenu]);

  // Ctrl/Cmd + B opens the repository list (it used to toggle the sidebar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'b') return;
      const t = e.target as HTMLElement | null;
      if (t && t !== searchRef.current && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (open) close();
      else if (slotEl) show();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // File → Add repository (the native menu) opens these.
  const openExistingRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(
    () =>
      onNotify((e) => {
        if (e.type !== 'menu') return;
        if (e.id === 'repo-open') void openExistingRef.current();
        else if (e.id === 'repo-create') setDialog('create');
        else if (e.id === 'repo-clone') setDialog('clone');
      }),
    [],
  );
  // Adds the folder, then asks which account it is for when that is not obvious.
  const { openExisting, linkPrompt } = useAddExisting();
  openExistingRef.current = openExisting;

  const onCreated = (repo: RepoSummary) => {
    bump();
    selectRepo(repo.id);
  };

  const toggleFavorite = async (r: RepoSummary) => {
    try {
      await call('repo:setFavorite', { repoId: r.id, favorite: !r.favorite });
      toast(r.favorite ? `${r.name} removed from favorites` : `★ ${r.name} pinned to favorites`, 'info');
      bump();
    } catch (err) {
      showError(err);
    }
  };

  const openOnGitHub = async (r: RepoSummary) => {
    if (!r.github || !r.identity) return;
    try {
      await call('shell:openExternal', { url: `https://${r.identity}` });
    } catch (err) {
      showError(err);
    }
  };

  const act = (fn: () => void) => () => {
    close();
    fn();
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setCursor((c) => Math.min(flat.length - 1, c + 1));
    else if (e.key === 'ArrowUp') setCursor((c) => Math.max(0, c - 1));
    else if (e.key === 'Enter' && flat[cursor]) pick(flat[cursor]);
    else return;
    e.preventDefault();
  };

  const groupIcon = (g: Group) => {
    if (g.kind === 'local') return <span className="group-icon">⌂</span>;
    if (g.provider) return <ProviderMono id={g.provider} size={18} />;
    const hue = hueOf(g.label);
    return (
      <span className="group-icon" style={{ background: `hsl(${hue} 50% 28%)`, color: `hsl(${hue} 90% 86%)` }}>
        {g.label[0]?.toUpperCase()}
      </span>
    );
  };

  const repoIcon = (r: RepoSummary, size = 16) => {
    const id = r.github ? 'github' : r.provider?.id;
    if (id) return <ProviderMono id={id} size={size} />;
    return <span className="rs-local" title={r.remoteUrl ? 'Remote on this computer or network' : 'Local only — no remote'}>{r.remoteUrl ? '🖧' : '💻'}</span>;
  };

  let idx = -1;
  const panel = open && (
    <div ref={panelRef} className="rs-panel" role="dialog" aria-label="Repositories">
      <div className="rs-search">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onSearchKey}
          placeholder="Search repositories…"
          aria-label="Search repositories"
        />
      </div>
      <div ref={listRef} className="rs-list" role="listbox" onScroll={(e) => markScroll(e.currentTarget)}>
        {mainRepos.length === 0 && <div className="rs-empty">No repositories yet. Use File → Add repository.</div>}
        {mainRepos.length > 0 && flat.length === 0 && <div className="rs-empty">No repository matches “{query}”.</div>}
        {groups.map((g) => (
          <div key={g.key} className="rs-group">
            <div className="rs-group-head">
              {groupIcon(g)}
              <span className="ellipsis grow">{g.label}</span>
              <span className="rs-n">{g.repos.length}</span>
            </div>
            {g.repos.map((r) => {
              idx += 1;
              const i = idx;
              return (
                <div
                  key={r.id}
                  role="option"
                  aria-selected={r.id === currentFamily}
                  className={`rs-item ${r.id === currentFamily ? 'active' : ''} ${i === cursor ? 'cur' : ''} ${ctxMenu?.repo.id === r.id ? 'ctx' : ''}`}
                  onMouseMove={() => i !== cursor && setCursor(i)}
                  onClick={() => pick(r)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ repo: r, x: e.clientX, y: e.clientY });
                  }}
                  title={`${r.path}\nRight-click for more actions`}
                >
                  <span className="rs-prov">{repoIcon(r)}</span>
                  <span className="ellipsis">{r.name}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {slot &&
        createPortal(
          <button
            ref={triggerRef}
            className={`rs-trigger ${open ? 'on' : ''} ${current ? '' : 'empty'}`}
            onClick={() => (open ? close() : show())}
            aria-haspopup="listbox"
            aria-expanded={open}
            title={`${current ? `${current.name} — switch repository` : 'Choose a repository'} (Ctrl+B)`}
          >
            <span className="rs-logo">
              {current ? repoIcon(current, 22) : <span className="rs-local">🗂</span>}
              {current && vis && (
                <span className={`rs-vis ${vis}`} title={vis === 'private' ? 'Private repository: only people with access can see it' : 'Public repository: anyone can see it'} aria-label={vis === 'private' ? 'Private' : 'Public'}>
                  <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={vis === 'private' ? 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z' : 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z'} />
                  </svg>
                </span>
              )}
            </span>
            <span className="rs-text">
              <span className="rs-owner">{current ? repoOwner(current) : `${mainRepos.length} repositories`}</span>
              <span className="rs-name">{current ? current.name : 'Choose a repository'}</span>
            </span>
            <span className="rs-chev" aria-hidden>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 3.8 5 6.3l2.5-2.5" />
              </svg>
            </span>
          </button>,
          slot,
        )}
      {panel && createPortal(panel, document.body)}

      {ctxMenu &&
        createPortal(
          <div ref={ctxRef} className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y, zIndex: 210 }} onScroll={(e) => markScroll(e.currentTarget)} onContextMenu={(e) => e.preventDefault()}>
            <div className="ctx-head">
              <strong className="ellipsis">{ctxMenu.repo.name}</strong>
              <span className="small muted ellipsis">{repoSubtitle(ctxMenu.repo)}</span>
            </div>
            <div className="dropdown-item" onClick={act(() => toggleFavorite(ctxMenu.repo))}>
              <span className="ctx-ico" style={{ color: 'var(--warn)' }}>{ctxMenu.repo.favorite ? '☆' : '★'}</span>
              {ctxMenu.repo.favorite ? 'Remove from favorites' : 'Add to favorites'}
            </div>
            <div className={`dropdown-item ${ctxMenu.repo.github ? '' : 'disabled'}`} onClick={ctxMenu.repo.github ? act(() => openOnGitHub(ctxMenu.repo)) : undefined} title={ctxMenu.repo.github ? undefined : 'This repository has no GitHub remote'}>
              <span className="ctx-ico">↗</span> View on GitHub
            </div>
            <div className={`dropdown-item ${ctxMenu.repo.exists ? '' : 'disabled'}`} onClick={ctxMenu.repo.exists ? act(() => void call('graph:reveal', { repoId: ctxMenu.repo.id, path: '.' }).catch(showError)) : undefined} title={ctxMenu.repo.path}>
              <span className="ctx-ico">📂</span> Open in File Explorer
            </div>
            <div className="dropdown-item" onClick={act(() => void call('app:copyText', { text: ctxMenu.repo.path }).then(() => toast('Folder path copied'), showError))}>
              <span className="ctx-ico">⧉</span> Copy folder path
            </div>
            {(ctxMenu.repo.remoteUrl ?? ctxMenu.repo.identity) && (
              <div className="dropdown-item" onClick={act(() => void call('app:copyText', { text: (ctxMenu.repo.remoteUrl ?? ctxMenu.repo.identity)! }).then(() => toast('Remote URL copied'), showError))}>
                <span className="ctx-ico">🔗</span> Copy remote URL
              </div>
            )}
            <div className="dropdown-sep" />
            <div className={`dropdown-item ${ctxMenu.repo.exists ? '' : 'disabled'}`} onClick={ctxMenu.repo.exists ? act(() => setRepoDialog({ kind: 'lastCommit', repo: ctxMenu.repo })) : undefined}>
              <span className="ctx-ico">◉</span> Last commit &amp; tag
            </div>
            <div className={`dropdown-item ${ctxMenu.repo.exists ? '' : 'disabled'}`} onClick={ctxMenu.repo.exists ? act(() => setRepoDialog({ kind: 'contributors', repo: ctxMenu.repo })) : undefined}>
              <span className="ctx-ico">👥</span> Contributors
            </div>
            <div className={`dropdown-item ${ctxMenu.repo.exists ? '' : 'disabled'}`} onClick={ctxMenu.repo.exists ? act(() => setRepoDialog({ kind: 'duplicate', repo: ctxMenu.repo })) : undefined}>
              <span className="ctx-ico">⧉</span> Duplicate…
            </div>
            <div className="dropdown-sep" />
            <div className="dropdown-item danger" onClick={act(() => setRepoDialog({ kind: 'remove', repo: ctxMenu.repo }))}>
              <span className="ctx-ico">✕</span> Remove…
            </div>
          </div>,
          document.body,
        )}

      {linkPrompt}
      {dialog === 'create' && <CreateRepoWizard onClose={() => setDialog(null)} onCreated={onCreated} />}
      {dialog === 'clone' && <CloneDialog onClose={() => setDialog(null)} onCloned={onCreated} />}
      {repoDialog?.kind === 'duplicate' && (
        <DuplicateRepoDialog
          repo={repoDialog.repo}
          onClose={() => setRepoDialog(null)}
          onDone={(created) => {
            setRepoDialog(null);
            toast(`Duplicated as ${created.name}`);
            onCreated(created);
          }}
        />
      )}
      {repoDialog?.kind === 'contributors' && <ContributorsDialog repo={repoDialog.repo} onClose={() => setRepoDialog(null)} />}
      {repoDialog?.kind === 'lastCommit' && <LastCommitDialog repo={repoDialog.repo} onClose={() => setRepoDialog(null)} />}
      {repoDialog?.kind === 'remove' && (
        <RemoveRepoDialog
          repo={repoDialog.repo}
          onClose={() => setRepoDialog(null)}
          onRemoved={(remoteMissing) => {
            const removed = repoDialog.repo;
            setRepoDialog(null);
            if (removed.id === activeRepoId) selectRepo(null);
            toast(remoteMissing ? `${removed.name} no longer exists on the remote — removed from the app, local files untouched` : `${removed.name} removed from the app — files untouched`, 'info');
            bump();
          }}
        />
      )}
    </>
  );
}
