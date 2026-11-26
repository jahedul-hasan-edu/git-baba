import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RepoSummary } from '../../shared/types';
import { useApp } from '../state/AppState';
import { closeTab, moveTab, openTab, pruneTabs, requestRepoPicker, useRepoTabs } from '../services/repoTabs';
import { openAccountsHub } from '../services/accountsHub';
import { hueOf } from '../dialogs/RepoActionDialogs';
import { NotificationBell } from './NotificationBell';
import { ProviderMono } from './ProviderMono';
import { fitMenu, markScroll } from './menuFit';

const TAB_W = 184; // keep in sync with .rt-tab width + gap
const ADD_W = 40; // the + button
const MORE_W = 74; // the "+N ▾" button

/**
 * The top layer: every open repository as a tab (any provider), + to open another, an overflow menu for
 * the tabs that do not fit, and notifications, settings and the account on the right.
 */
export function RepoTabStrip() {
  const { repos, activeRepoId, view, selectRepo, setAccountsOpen, activeAccount } = useApp();
  const ids = useRepoTabs();
  const byId = useMemo(() => new Map(repos.map((r) => [r.id, r])), [repos]);
  const current = view === 'repo' ? activeRepoId : null;

  // Whatever opens a repository (welcome page, worktree chips, …) gets a tab, next to the one you came from.
  const lastActive = useRef<string | null>(null);
  useEffect(() => {
    if (current && byId.has(current)) openTab(current, lastActive.current);
    if (current) lastActive.current = current;
  }, [current, byId]);

  // Repositories removed from the app lose their tabs (once the list has loaded).
  useEffect(() => {
    if (repos.length) pruneTabs(new Set(repos.map((r) => r.id)));
  }, [repos]);

  const tabs = ids.map((id) => byId.get(id)).filter((r): r is RepoSummary => !!r);

  // How many tabs fit; the active one is always among the visible ones.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const fitAll = Math.max(1, Math.floor((width - ADD_W) / TAB_W));
  const fit = tabs.length > fitAll ? Math.max(1, Math.floor((width - ADD_W - MORE_W) / TAB_W)) : tabs.length;
  let shown = tabs.slice(0, fit);
  const activeIdx = tabs.findIndex((t) => t.id === current);
  if (activeIdx >= fit && fit > 0) shown = [...tabs.slice(0, fit - 1), tabs[activeIdx]];
  const shownIds = new Set(shown.map((t) => t.id));
  const hidden = tabs.filter((t) => !shownIds.has(t.id));

  const close = (id: string) => {
    const next = closeTab(id);
    if (id === current) selectRepo(next);
  };

  // Ctrl+Tab / Ctrl+Shift+Tab cycle through the tabs.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 'Tab' || tabs.length < 2) return;
      e.preventDefault();
      const i = Math.max(0, tabs.findIndex((t) => t.id === current));
      selectRepo(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [tabs, current, selectRepo]);

  // Drag a tab onto another to reorder.
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (more && moreRef.current) fitMenu(moreRef.current, more.x, more.y);
  }, [more]);
  useEffect(() => {
    if (!more) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!moreRef.current?.contains(n) && !moreBtn.current?.contains(n)) setMore(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMore(null);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [more]);
  useEffect(() => {
    if (!hidden.length) setMore(null);
  }, [hidden.length]);

  const tabEl = (r: RepoSummary) => {
    const on = r.id === current;
    return (
      <div
        key={r.id}
        role="tab"
        aria-selected={on}
        tabIndex={0}
        draggable
        className={`rt-tab ${on ? 'on' : ''} ${drag === r.id ? 'dragging' : ''} ${over === r.id && drag !== r.id ? 'over' : ''}`}
        onClick={() => selectRepo(r.id)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), selectRepo(r.id))}
        onAuxClick={(e) => e.button === 1 && (e.preventDefault(), close(r.id))}
        onDragStart={(e) => {
          setDrag(r.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          setOver(r.id);
        }}
        onDragLeave={() => setOver((o) => (o === r.id ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          if (drag) moveTab(drag, r.id);
          setDrag(null);
          setOver(null);
        }}
        onDragEnd={() => {
          setDrag(null);
          setOver(null);
        }}
        title={`${r.name}${r.branch ? ` · ${r.branch}` : ''}\n${r.path}`}
      >
        <TabBody r={r} />
        <button
          className="rt-x"
          onClick={(e) => {
            e.stopPropagation();
            close(r.id);
          }}
          title="Close tab (middle-click)"
          aria-label={`Close ${r.name}`}
        >
          ×
        </button>
      </div>
    );
  };

  const login = activeAccount?.login ?? null;
  const initials = login ? (activeAccount?.name ?? login).split(/[\s\-_.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('') : '?';
  const hue = hueOf(login ?? '?');

  return (
    <div className="rt-strip">
      <div className="rt-tabs" ref={wrapRef} role="tablist" aria-label="Open repositories">
        {shown.map(tabEl)}
        {hidden.length > 0 && (
          <button
            ref={moreBtn}
            className={`rt-more ${more ? 'on' : ''}`}
            onClick={() => {
              if (more) return setMore(null);
              const b = moreBtn.current!.getBoundingClientRect();
              setMore({ x: b.right - 300, y: b.bottom + 6 });
            }}
            title={`${hidden.length} more open repositories`}
            aria-haspopup="menu"
            aria-expanded={!!more}
          >
            +{hidden.length}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2.5 3.8 5 6.3l2.5-2.5" />
            </svg>
          </button>
        )}
        <button
          className="rt-add"
          onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            requestRepoPicker({ x: b.left - 8, y: b.bottom + 6, mode: 'new' });
          }}
          title="Open another repository in a new tab (Ctrl+P)"
          aria-label="Open repository in a new tab"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
            <path d="M7 2.5v9M2.5 7h9" />
          </svg>
        </button>
      </div>

      <div className="rt-end">
        <NotificationBell />
        <button className="rt-icon" onClick={() => openAccountsHub()} title="Accounts & connections" aria-label="Settings">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
        <button className="rt-account" onClick={() => setAccountsOpen(true)} title={login ? `Signed in as ${login} — manage accounts` : 'Sign in'} aria-label="Accounts">
          <span className="rt-avatar" style={{ background: `hsl(${hue} 55% 42%)` }}>
            {initials}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2.5 3.8 5 6.3l2.5-2.5" />
          </svg>
        </button>
      </div>

      {more && (
        <div ref={moreRef} className="ctx-menu rt-more-menu" style={{ left: more.x, top: more.y }} onScroll={(e) => markScroll(e.currentTarget)} role="menu">
          {hidden.map((r) => (
            <div
              key={r.id}
              className="rt-more-item"
              role="menuitem"
              onClick={() => {
                setMore(null);
                selectRepo(r.id);
              }}
              onAuxClick={(e) => e.button === 1 && close(r.id)}
              title={r.path}
            >
              <TabBody r={r} />
              <button
                className="rt-x"
                onClick={(e) => {
                  e.stopPropagation();
                  close(r.id);
                }}
                aria-label={`Close ${r.name}`}
                title="Close tab"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Provider icon, name over branch, and a status dot (amber: uncommitted changes, red: conflicts or missing folder). */
function TabBody({ r }: { r: RepoSummary }) {
  const prov = r.github ? 'github' : r.provider?.id;
  const dot = r.hasConflicts || !r.exists ? 'danger' : r.changeCount > 0 ? 'warn' : null;
  const dotTitle = !r.exists ? 'Folder missing' : r.hasConflicts ? 'Merge conflicts' : `${r.changeCount} uncommitted change(s)`;
  return (
    <>
      <span className="rt-prov">{prov ? <ProviderMono id={prov} size={15} /> : <span className="rt-local">{r.remoteUrl ? '🖧' : '💻'}</span>}</span>
      <span className="rt-text">
        <span className="rt-name">
          {r.name}
          {dot && <span className={`rt-dot ${dot}`} title={dotTitle} />}
        </span>
        <span className="rt-branch">{r.branch ?? (r.exists ? 'detached' : 'missing')}</span>
      </span>
    </>
  );
}
