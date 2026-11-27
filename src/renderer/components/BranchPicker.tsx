import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { relative } from './FileDiffList';

const COLORS = ['#5b8cff', '#3ecf8e', '#f5b84a', '#ff6b6b', '#b18cff', '#6cc4ff', '#ff9f6b', '#9fd36b'];
/** Stable colour per branch name (same palette as Git History and the Merge Studio). */
export const branchColor = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};

export interface PickerItem {
  name: string;
  current?: boolean;
  remote?: boolean;
  ahead?: number;
  behind?: number;
  subject?: string;
  date?: string;
  oid?: string;
  /** Shown instead of the name (e.g. "Current branch (HEAD)"). */
  label?: string;
  /** Icon for special entries. */
  icon?: string;
  /** Why the entry cannot be picked; the row is shown but disabled. */
  disabled?: string;
}

interface Props {
  value: string;
  onChange: (name: string) => void;
  items: PickerItem[];
  /** Entries pinned above everything (e.g. "Current branch (HEAD)" with name ""). */
  special?: PickerItem[];
  placeholder?: string;
  disabled?: boolean;
  /** Key for remembering recently picked branches (per purpose). */
  recentKey?: string;
  compact?: boolean;
  title?: string;
}

type Tab = 'all' | 'local' | 'remote';

/** Subsequence fuzzy match: score (higher is better) and the matched character positions. */
function fuzzy(text: string, q: string): { score: number; hits: number[] } | null {
  if (!q) return { score: 0, hits: [] };
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct !== -1) return { score: 1000 - direct + (direct === 0 || '/-_'.includes(t[direct - 1]) ? 200 : 0), hits: [...q].map((_, i) => direct + i) };
  const hits: number[] = [];
  let score = 0;
  let last = -2;
  for (let i = 0, j = 0; i < t.length && j < q.length; i++) {
    if (t[i] !== q[j]) continue;
    score += i === last + 1 ? 8 : 1;
    if (i === 0 || '/-_.'.includes(t[i - 1])) score += 5;
    hits.push(i);
    last = i;
    j++;
  }
  return hits.length === q.length ? { score, hits } : null;
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  const out: ReactNode[] = [];
  let buf = '';
  let on = false;
  const flush = (k: number) => {
    if (buf) out.push(on ? <mark key={k}>{buf}</mark> : <span key={k}>{buf}</span>);
    buf = '';
  };
  [...text].forEach((ch, i) => {
    const h = set.has(i);
    if (h !== on) {
      flush(i);
      on = h;
    }
    buf += ch;
  });
  flush(text.length);
  return <>{out}</>;
}

/** "feature/inride/x" → folder "feature/inride/" + leaf "x", so the leaf reads first. */
function splitName(name: string) {
  const i = name.lastIndexOf('/');
  return i === -1 ? { folder: '', leaf: name } : { folder: name.slice(0, i + 1), leaf: name.slice(i + 1) };
}

const readRecent = (key?: string): string[] => {
  if (!key) return [];
  try {
    return JSON.parse(localStorage.getItem(`gb.recent.${key}`) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const pushRecent = (key: string | undefined, name: string) => {
  if (!key || !name) return;
  try {
    localStorage.setItem(`gb.recent.${key}`, JSON.stringify([name, ...readRecent(key).filter((n) => n !== name)].slice(0, 5)));
  } catch {
    /* storage unavailable: recents are a convenience */
  }
};

type PanelRow =
  | { kind: 'head'; label: string }
  | { kind: 'item'; item: PickerItem; hits: number[]; key: string; depth?: number; leaf?: string }
  | { kind: 'folder'; key: string; label: string; depth: number; open: boolean; count: number };

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  leaf: PickerItem | null;
}

const OPEN_KEY = (k?: string) => `gb.bp.open.${k ?? 'default'}`;
const readOpen = (k?: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY(k)) ?? '[]') as string[];
  } catch {
    return [];
  }
};

/**
 * Branches as a folder tree ("feature/x" under "feature"): newest work first, a folder ranked by its newest
 * branch, the current branch on top, and single-child folder chains merged ("inride/features").
 */
function treeRows(scope: string, list: PickerItem[], open: Set<string>): PanelRow[] {
  const root: TreeNode = { name: '', path: '', children: new Map(), leaf: null };
  for (const it of list) {
    const parts = it.name.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const k = last ? `${part}\u0000` : part;
      let next = node.children.get(k);
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join('/'), children: new Map(), leaf: null };
        node.children.set(k, next);
      }
      if (last) next.leaf = it;
      node = next;
    });
  }
  const newest = (n: TreeNode): number => Math.max(n.leaf ? Date.parse(n.leaf.date ?? '') || 0 : 0, ...[...n.children.values()].map(newest));
  const hasCurrent = (n: TreeNode): boolean => !!n.leaf?.current || [...n.children.values()].some(hasCurrent);
  const count = (n: TreeNode): number => (n.leaf ? 1 : 0) + [...n.children.values()].reduce((a, c) => a + count(c), 0);
  const out: PanelRow[] = [];
  const walk = (node: TreeNode, depth: number) => {
    const kids = [...node.children.values()].sort((a, b) => Number(hasCurrent(b)) - Number(hasCurrent(a)) || newest(b) - newest(a) || a.name.localeCompare(b.name));
    for (const child of kids) {
      if (child.children.size === 0 && child.leaf) {
        out.push({ kind: 'item', item: child.leaf, hits: [], key: `${scope}:${child.leaf.name}`, depth, leaf: child.name });
        continue;
      }
      // Merge "a" → "b" when "a" holds nothing but the folder "b".
      let f = child;
      let label = f.name;
      while (!f.leaf && f.children.size === 1) {
        const only = [...f.children.values()][0];
        if (only.children.size === 0) break;
        f = only;
        label += `/${f.name}`;
      }
      const key = `${scope}:${f.path}`;
      const isOpen = open.has(key);
      out.push({ kind: 'folder', key, label, depth, open: isOpen, count: count(f) });
      if (!isOpen) continue;
      if (f.leaf) out.push({ kind: 'item', item: f.leaf, hits: [], key: `${scope}:${f.leaf.name}`, depth: depth + 1, leaf: f.name });
      walk(f, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * The picker's popup: fuzzy search, Local/Remote tabs, recents, rich rows and full keyboard control.
 * Used by BranchPicker and by the header branch menu (which puts its own actions in the footer).
 */
export function BranchPickerPanel({
  value,
  items,
  special = [],
  recentKey,
  onPick,
  onClose,
  footer,
  className = '',
  style,
  panelRef,
  hideSubject,
  onRowContextMenu,
  tree,
}: {
  value: string;
  items: PickerItem[];
  special?: PickerItem[];
  recentKey?: string;
  onPick: (it: PickerItem) => void;
  onClose: () => void;
  /** Replaces the keyboard hints at the bottom. */
  footer?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  panelRef?: React.Ref<HTMLDivElement>;
  /** One line per branch: no last-commit message. */
  hideSubject?: boolean;
  onRowContextMenu?: (it: PickerItem, e: React.MouseEvent) => void;
  /** Without a search, show branches as a folder tree (searching always lists flat matches). */
  tree?: boolean;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasRemote = items.some((i) => i.remote);
  const hasLocal = items.some((i) => !i.remote);
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set(readOpen(recentKey));
    const parts = value.split('/');
    for (let i = 1; i < parts.length; i++) s.add(`Local:${parts.slice(0, i).join('/')}`);
    return s;
  });
  const toggleFolder = (key: string, to?: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (to ?? !next.has(key)) next.add(key);
      else next.delete(key);
      try {
        localStorage.setItem(OPEN_KEY(recentKey), JSON.stringify([...next].slice(-200)));
      } catch {
        /* per-viewer convenience */
      }
      return next;
    });

  // Rows: specials, recents (no query), then local / remote groups, filtered and ranked.
  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const out: PanelRow[] = [];
    const match = (it: PickerItem) => fuzzy(it.label ?? it.name, query);
    const inTab = (it: PickerItem) => tab === 'all' || (tab === 'remote' ? !!it.remote : !it.remote);
    const sp = special.filter((s) => !query || match(s));
    if (sp.length && tab === 'all') sp.forEach((it) => out.push({ kind: 'item', item: it, hits: match(it)?.hits ?? [], key: `s:${it.name}` }));
    if (!query && tab === 'all') {
      const rec = readRecent(recentKey)
        .map((n) => items.find((i) => i.name === n))
        .filter((i): i is PickerItem => !!i);
      if (rec.length) {
        out.push({ kind: 'head', label: 'Recent' });
        rec.forEach((it) => out.push({ kind: 'item', item: it, hits: [], key: `r:${it.name}` }));
      }
    }
    const group = (label: string, list: PickerItem[]) => {
      const scored = list
        .filter(inTab)
        .map((it) => ({ it, m: match(it) }))
        .filter((x): x is { it: PickerItem; m: { score: number; hits: number[] } } => !!x.m);
      if (query) scored.sort((a, b) => b.m.score - a.m.score);
      else scored.sort((a, b) => Number(!!b.it.current) - Number(!!a.it.current) || (Date.parse(b.it.date ?? '') || 0) - (Date.parse(a.it.date ?? '') || 0));
      if (!scored.length) return;
      out.push({ kind: 'head', label: `${label} · ${scored.length}` });
      if (tree && !query) out.push(...treeRows(label, scored.map((x) => x.it), open));
      else scored.forEach(({ it, m }) => out.push({ kind: 'item', item: it, hits: m.hits, key: `${label}:${it.name}` }));
    };
    group('Local', items.filter((i) => !i.remote));
    group('Remote', items.filter((i) => i.remote));
    return out;
  }, [q, tab, items, special, recentKey, tree, open]);
  const pickable = rows.map((r, i) => ((r.kind === 'item' && !r.item.disabled) || r.kind === 'folder' ? i : -1)).filter((i) => i !== -1);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  // Keep the highlighted row on the selected branch (or the first pickable one).
  useEffect(() => {
    const sel = rows.findIndex((r) => r.kind === 'item' && r.item.name === value && !r.item.disabled);
    setActive(q || sel === -1 ? pickable[0] ?? 0 : sel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab, items.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (it: PickerItem) => {
    if (it.disabled) return;
    pushRecent(recentKey, it.name);
    onPick(it);
  };
  const step = (d: number) => {
    if (!pickable.length) return;
    const i = pickable.indexOf(active);
    setActive(pickable[(i + d + pickable.length) % pickable.length]);
  };
  const tabs: Tab[] = hasLocal && hasRemote ? ['all', 'local', 'remote'] : [];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), step(1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), step(-1));
    else if (e.key === 'PageDown') (e.preventDefault(), step(8));
    else if (e.key === 'PageUp') (e.preventDefault(), step(-8));
    else if (e.key === 'Enter') {
      e.preventDefault();
      const r = rows[active];
      if (r?.kind === 'item') choose(r.item);
      else if (r?.kind === 'folder') toggleFolder(r.key);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && rows[active]?.kind === 'folder' && !q) {
      e.preventDefault();
      toggleFolder((rows[active] as { key: string }).key, e.key === 'ArrowRight');
    } else if (e.key === 'Escape') {
      // A right-click menu over the panel closes first (it listens on the window).
      if (document.querySelector('.ctx-menu')) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab' && tabs.length) {
      e.preventDefault();
      setTab((t) => tabs[(tabs.indexOf(t) + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]);
    }
  };
  const activeItem = rows[active]?.kind === 'item' ? (rows[active] as { item: PickerItem }).item : null;

  return (
    <div ref={panelRef} className={`bp-pop ${className}`} style={style} onKeyDown={onKey} role="listbox">
      <div className="bp-search">
        <span className="bp-search-ico">⌕</span>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search branches…" spellCheck={false} />
        {q && (
          <button className="bp-clear" onClick={() => setQ('')} title="Clear search">
            ✕
          </button>
        )}
      </div>
      {tabs.length > 0 && (
        <div className="bp-tabs">
          {tabs.map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'all' ? 'All' : t === 'local' ? `⎇ Local ${items.filter((i) => !i.remote).length}` : `☁ Remote ${items.filter((i) => i.remote).length}`}
            </button>
          ))}
        </div>
      )}
      <div className="bp-list" ref={listRef}>
        {rows.length === 0 && <div className="bp-none">{q ? `No branch matches “${q}”` : 'No branches'}</div>}
        {rows.map((r, i) =>
          r.kind === 'head' ? (
            <div key={`h${i}`} className="bp-head">
              {r.label}
            </div>
          ) : r.kind === 'folder' ? (
            <div
              key={r.key}
              data-row={i}
              role="treeitem"
              aria-expanded={r.open}
              className={`bp-row bp-folder ${r.depth ? 'tn' : ''} ${i === active ? 'active' : ''}`}
              style={{ paddingLeft: 8 + r.depth * 14 }}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setActive(i);
                toggleFolder(r.key);
              }}
              title={r.label}
            >
              <span className="bp-caret">{r.open ? '▾' : '▸'}</span>
              <span className="bp-fico" aria-hidden>
                {r.open ? '📂' : '📁'}
              </span>
              <span className="bp-fname ellipsis">{r.label}</span>
              <span className="bp-fcount">{r.count}</span>
            </div>
          ) : (
            (() => {
              const it = r.item;
              const { folder, leaf } = r.leaf !== undefined ? { folder: '', leaf: r.leaf } : splitName(it.label ?? it.name);
              const off = folder.length;
              return (
                <div
                  key={r.key}
                  data-row={i}
                  role="option"
                  aria-selected={it.name === value}
                  className={`bp-row ${r.depth ? 'tn' : ''} ${i === active ? 'active' : ''} ${it.name === value ? 'sel' : ''} ${it.disabled ? 'disabled' : ''}`}
                  style={{ ['--bc' as string]: it.icon ? 'var(--accent)' : branchColor(it.name), ...(r.depth !== undefined ? { paddingLeft: 8 + r.depth * 14 + (r.depth ? 4 : 0) } : {}) }}
                  onMouseEnter={() => !it.disabled && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(it)}
                  onContextMenu={
                    onRowContextMenu && !it.icon
                      ? (e) => {
                          e.preventDefault();
                          onRowContextMenu(it, e);
                        }
                      : undefined
                  }
                  title={it.disabled ?? it.name}
                >
                  {it.icon ? <span className="bp-ico">{it.icon}</span> : <span className="bp-dot" />}
                  <div className="bp-main">
                    <div className="bp-name ellipsis">
                      {folder && (
                        <span className="bp-folder">
                          <Highlight text={folder} hits={r.hits.filter((h) => h < off)} />
                        </span>
                      )}
                      <span className={it.label ? '' : 'mono'}>
                        <Highlight text={leaf} hits={r.hits.filter((h) => h >= off).map((h) => h - off)} />
                      </span>
                    </div>
                    {(it.disabled || (it.subject && !hideSubject)) && <div className="bp-sub ellipsis">{it.disabled ?? it.subject}</div>}
                  </div>
                  <div className="bp-meta">
                    {it.current && <span className="bp-badge cur">HEAD</span>}
                    {!!it.ahead && <span className="bp-ab up">↑{it.ahead}</span>}
                    {!!it.behind && <span className="bp-ab down">↓{it.behind}</span>}
                    {it.date && <span className="bp-when">{relative(it.date)}</span>}
                    {it.name === value && <span className="bp-check">✓</span>}
                  </div>
                </div>
              );
            })()
          ),
        )}
      </div>
      {footer ?? (
        <div className="bp-foot">
          {activeItem?.oid ? (
            <span className="mono ellipsis">
              {activeItem.oid.slice(0, 8)} <span className="muted">{activeItem.subject}</span>
            </span>
          ) : (
            <span className="muted">
              <kbd>↑</kbd>
              <kbd>↓</kbd> move · <kbd>Enter</kbd> pick {tabs.length ? <>· <kbd>Tab</kbd> local/remote</> : null} · <kbd>Esc</kbd> close
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Searchable branch picker: a trigger button that opens BranchPickerPanel next to it. */
export function BranchPicker({ value, onChange, items, special = [], placeholder = 'Choose a branch…', disabled, recentKey, compact, title }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; maxH: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => [...special, ...items], [special, items]);
  const selected = all.find((i) => i.name === value) ?? null;

  const place = () => {
    const t = triggerRef.current?.getBoundingClientRect();
    if (!t) return;
    const below = window.innerHeight - t.bottom - 12;
    const above = t.top - 12;
    const up = below < 280 && above > below;
    const width = Math.max(t.width, 360);
    setPos({ left: Math.max(8, Math.min(t.left, window.innerWidth - width - 8)), top: up ? t.top - 6 : t.bottom + 6, width, up, maxH: Math.min(440, (up ? above : below) - 6) });
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onWin = () => place();
    window.addEventListener('resize', onWin);
    document.addEventListener('scroll', onWin, true);
    return () => {
      window.removeEventListener('resize', onWin);
      document.removeEventListener('scroll', onWin, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!popRef.current?.contains(n) && !triggerRef.current?.contains(n)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const shown = selected ?? null;
  const c = shown && shown.name ? branchColor(shown.name) : 'var(--text-3)';

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`bp-trigger ${open ? 'open' : ''} ${compact ? 'compact' : ''} ${shown ? '' : 'empty'}`}
        style={{ ['--bc' as string]: c }}
        disabled={disabled}
        title={title ?? shown?.name}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          } else if (!open && e.key.length === 1 && /\S/.test(e.key)) {
            setOpen(true); // start typing to search
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {shown ? (
          <>
            {shown.icon ? <span className="bp-ico">{shown.icon}</span> : <span className="bp-dot" />}
            <span className={`bp-val ellipsis ${shown.label ? '' : 'mono'}`}>{shown.label ?? shown.name}</span>
            {shown.current && <span className="bp-badge cur">HEAD</span>}
            {shown.remote && <span className="bp-badge">remote</span>}
            {!compact && !!shown.ahead && <span className="bp-ab up">↑{shown.ahead}</span>}
            {!compact && !!shown.behind && <span className="bp-ab down">↓{shown.behind}</span>}
          </>
        ) : (
          <span className="bp-val muted">{placeholder}</span>
        )}
        <span className="bp-chev">▾</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <BranchPickerPanel
            panelRef={popRef}
            className={pos.up ? 'up' : ''}
            style={{ left: pos.left, width: pos.width, maxHeight: pos.maxH, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
            value={value}
            items={items}
            special={special}
            recentKey={recentKey}
            onPick={(it) => {
              onChange(it.name);
              close();
            }}
            onClose={close}
          />,
          document.body,
        )}
    </>
  );
}

/** Converts branch info from the API into picker rows. */
export function toPickerItems(list: { name: string; current?: boolean; remote?: boolean; ahead?: number; behind?: number; subject?: string; date?: string; oid?: string }[]): PickerItem[] {
  return list.filter((b) => !b.name.endsWith('/HEAD')).map((b) => ({ name: b.name, current: b.current, remote: b.remote, ahead: b.ahead, behind: b.behind, subject: b.subject, date: b.date, oid: b.oid }));
}
