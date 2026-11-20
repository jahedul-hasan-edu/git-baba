import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GraphCommit } from '../../../shared/types';
import { branchColor } from '../../components/BranchPicker';
import { relative } from '../../components/FileDiffList';
import { requestRailAction } from '../../services/railActions';
import { PaneIcon } from '../../components/PaneIcon';

/** Width of one commit column at 100% zoom, height of one branch lane. */
const COL = 34;
const LANE = 46;
const LABEL_W = 240;
/** Room above the first lane for tag flags. */
const TOP_PAD = 26;
const RULER_H = 30;
const MAP_H = 38;
const PAD_X = 40;
const OTHER = '(other)';

interface Lane {
  name: string;
  color: string;
  commits: GraphCommit[];
  /** Column of the oldest and newest commit in this lane. */
  from: number;
  to: number;
}

interface Props {
  commits: GraphCommit[];
  headOid: string | null;
  headBranch: string | null;
  mainRef: string | null;
  selected: string | null;
  pair: string[];
  hasMore: boolean;
  loading: boolean;
  onSelect: (hash: string) => void;
  onMenu: (c: GraphCommit, x: number, y: number) => void;
  onLoadMore: () => void;
  onSwitch: (branch: string) => void;
}

const readSet = (key: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};
const writeSet = (key: string, s: Set<string>) => {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* per-viewer convenience */
  }
};

/**
 * Branch Explorer: history laid out in time, left (oldest) to right (newest), one horizontal lane per branch.
 * Branch starts and merges are drawn between lanes, tags fly as flags, a date ruler runs on top and an
 * overview map sits at the bottom. Zoom, pan, find, solo / hide lanes and keyboard navigation included.
 */
export function BranchExplorer({ commits, headOid, headBranch, mainRef, selected, pair, hasMore, loading, onSelect, onMenu, onLoadMore, onSwitch }: Props) {
  const [zoom, setZoom] = useState(() => {
    try {
      return Math.min(2, Math.max(0.25, Number(localStorage.getItem('gb.bx.zoom')) || 1));
    } catch {
      return 1;
    }
  });
  const [hidden, setHidden] = useState<Set<string>>(() => readSet('gb.bx.hidden'));
  const [solo, setSolo] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [findAt, setFindAt] = useState(0);
  const tip = useRef<(t: TipState | null) => void>(() => undefined);
  const [labelW, setLabelW] = useState(() => {
    try {
      return Math.min(420, Math.max(150, Number(localStorage.getItem('gb.bx.labelW')) || LABEL_W));
    } catch {
      return LABEL_W;
    }
  });
  const [namesOpen, setNamesOpen] = useState(() => {
    try {
      return localStorage.getItem('gb.bx.names') !== '0';
    } catch {
      return true;
    }
  });
  const toggleNames = () =>
    setNamesOpen((o) => {
      try {
        localStorage.setItem('gb.bx.names', o ? '0' : '1');
      } catch {
        /* per-viewer convenience */
      }
      return !o;
    });
  const live = useRef({ left: 0, top: 0 });
  const labelListRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const mapViewRef = useRef<SVGRectElement>(null);
  const raf = useRef(0);
  const [scroll, setScroll] = useState({ left: 0, top: 0, width: 800, height: 400 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('gb.bx.zoom', String(zoom));
    } catch {
      /* per-viewer convenience */
    }
  }, [zoom]);

  // ---- layout: columns in time order, lanes per branch ----
  const n = commits.length;
  const colOf = useMemo(() => {
    const m = new Map<string, number>();
    commits.forEach((c, i) => m.set(c.hash, n - 1 - i));
    return m;
  }, [commits, n]);

  const mainShort = mainRef?.replace(/^[^/]+\//, '') ?? null;
  /**
   * Which lane each commit sits in: walk every branch's first-parent chain from its tip, main first, then the
   * branch you are on, then the others (newest tip first). A commit belongs to the first branch that reaches it,
   * so merged work stays on its own branch and the main line stays straight.
   */
  const laneName = useMemo(() => {
    const byHashLocal = new Map(commits.map((c) => [c.hash, c]));
    const tips: { name: string; hash: string; date: number; remote: boolean }[] = [];
    const locals = new Set<string>();
    for (const c of commits)
      for (const raw of c.refs) {
        const r = raw.replace(/^HEAD -> /, '');
        if (r === 'HEAD' || r.startsWith('tag: ') || r.endsWith('/HEAD')) continue;
        const remote = /^[^/]+\//.test(r) && !c.refs.some((x) => x.replace(/^HEAD -> /, '') === r.slice(r.indexOf('/') + 1));
        tips.push({ name: r, hash: c.hash, date: Date.parse(c.date) || 0, remote });
        if (!remote) locals.add(r);
      }
    // A remote branch with a local copy is the same lane as the local one.
    const usable = tips.filter((t) => !(t.remote && locals.has(t.name.slice(t.name.indexOf('/') + 1))));
    const rank = (t: (typeof tips)[number]) => (t.name === mainRef || t.name === mainShort ? 0 : t.name === headBranch ? 1 : t.remote ? 3 : 2);
    usable.sort((a, b) => rank(a) - rank(b) || b.date - a.date);
    const out = new Map<string, string>();
    for (const t of usable) {
      let h: string | undefined = t.hash;
      while (h && !out.has(h)) {
        out.set(h, t.name);
        h = byHashLocal.get(h)?.parents[0];
      }
    }
    for (const c of commits) if (!out.has(c.hash)) out.set(c.hash, c.branch ?? OTHER);
    return out;
  }, [commits, mainRef, mainShort, headBranch]);
  const branchOf = (c: GraphCommit) => laneName.get(c.hash) ?? OTHER;
  const allLanes = useMemo<Lane[]>(() => {
    const map = new Map<string, GraphCommit[]>();
    for (const c of commits) {
      const b = branchOf(c);
      map.set(b, [...(map.get(b) ?? []), c]);
    }
    const lanes = [...map.entries()].map(([name, list]) => {
      const cols = list.map((c) => colOf.get(c.hash)!);
      return { name, color: name === OTHER ? 'var(--text-3)' : branchColor(name), commits: list, from: Math.min(...cols), to: Math.max(...cols) };
    });
    // Main on top, then the branch you are on, then branches in the order they started.
    const rank = (l: Lane) => (l.name === mainRef || l.name === mainShort ? 0 : l.name === headBranch ? 1 : l.name === OTHER ? 3 : 2);
    return lanes.sort((a, b) => rank(a) - rank(b) || a.from - b.from || a.name.localeCompare(b.name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commits, colOf, mainRef, mainShort, headBranch, laneName]);

  const lanes = useMemo(
    () => allLanes.filter((l) => (solo ? l.name === solo || l.name === mainRef || l.name === mainShort : !hidden.has(l.name))),
    [allLanes, solo, hidden, mainRef, mainShort],
  );
  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l.name, i])), [lanes]);
  const laneOf = (c: GraphCommit) => laneIndex.get(branchOf(c));
  const colW = COL * zoom;
  const xOf = (col: number) => PAD_X + col * colW;
  const yOf = (lane: number) => TOP_PAD + lane * LANE + LANE / 2;
  const width = PAD_X * 2 + Math.max(0, n - 1) * colW;
  const height = TOP_PAD + Math.max(lanes.length * LANE, LANE);
  const byHash = useMemo(() => new Map(commits.map((c) => [c.hash, c])), [commits]);

  // ---- find ----
  const q = find.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? commits.filter((c) => laneIndex.has(branchOf(c)) && `${c.subject} ${c.hash} ${c.author} ${c.refs.join(' ')}`.toLowerCase().includes(q)) : []),
    [q, commits, laneIndex],
  );
  const matchSet = useMemo(() => new Set(matches.map((c) => c.hash)), [matches]);

  // ---- scrolling ----
  const scrollTo = useCallback(
    (hash: string, smooth = true) => {
      const el = scrollRef.current;
      const c = byHash.get(hash);
      const lane = c ? laneOf(c) : undefined;
      if (!el || !c || lane === undefined) return;
      const x = xOf(colOf.get(hash)!);
      const y = yOf(lane);
      const pad = 80;
      const left = x < el.scrollLeft + pad || x > el.scrollLeft + el.clientWidth - pad ? x - el.clientWidth / 2 : el.scrollLeft;
      const top = y < el.scrollTop + LANE || y > el.scrollTop + el.clientHeight - LANE ? y - el.clientHeight / 2 : el.scrollTop;
      el.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'auto' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byHash, colOf, laneIndex, colW],
  );
  const mapW = () => Math.max(1, (wrapRef.current?.clientWidth ?? 800) - 2);
  const mx = (x: number) => (x / Math.max(1, width)) * mapW();
  const sync = () => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft;
    const top = el.scrollTop;
    live.current = { left, top };
    // Names, ruler and the map frame follow the scroll directly: no re-render while scrolling.
    if (labelListRef.current) labelListRef.current.style.transform = `translateY(${-top}px)`;
    if (rulerRef.current) rulerRef.current.style.transform = `translateX(${-left}px)`;
    if (mapViewRef.current) mapViewRef.current.setAttribute('x', String(mx(left)));
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const w = el.clientWidth;
      const h = el.clientHeight;
      setScroll((s) => (Math.abs(s.left - left) < 240 && Math.abs(s.top - top) < 160 && s.width === w && s.height === h ? s : { left, top, width: w, height: h }));
    });
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Open on the newest work (or the selected commit).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || didInitialScroll.current || !n) return;
    didInitialScroll.current = true;
    if (selected && byHash.has(selected)) scrollTo(selected, false);
    else el.scrollLeft = el.scrollWidth;
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  useEffect(() => {
    if (selected) scrollTo(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  // Zoom around the middle of the view.
  const zoomTo = (z: number) => {
    const el = scrollRef.current;
    const next = Math.min(2, Math.max(0.25, Math.round(z * 100) / 100));
    if (!el) return setZoom(next);
    const mid = (el.scrollLeft + el.clientWidth / 2 - PAD_X) / colW;
    setZoom(next);
    requestAnimationFrame(() => {
      el.scrollLeft = PAD_X + mid * COL * next - el.clientWidth / 2;
      sync();
    });
  };
  const fit = () => {
    const el = scrollRef.current;
    if (!el || n < 2) return;
    zoomTo((el.clientWidth - PAD_X * 2) / ((n - 1) * COL));
  };

  // ---- lanes: hide / solo ----
  const hide = (name: string) => {
    const s = new Set(hidden);
    s.add(name);
    setHidden(s);
    writeSet('gb.bx.hidden', s);
    if (solo === name) setSolo(null);
  };
  const showAll = () => {
    setHidden(new Set());
    writeSet('gb.bx.hidden', new Set());
    setSolo(null);
  };

  // ---- keyboard: ← → along the lane, ↑ ↓ to the nearest commit in the lane above / below ----
  const onKey = (e: React.KeyboardEvent) => {
    const c = selected ? byHash.get(selected) : null;
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
      e.preventDefault();
      return e.key === '0' ? zoomTo(1) : zoomTo(zoom * (e.key === '-' ? 0.8 : 1.25));
    }
    if (!c) return;
    const lane = laneOf(c);
    if (lane === undefined) return;
    const list = lanes[lane].commits; // newest first
    const at = list.findIndex((x) => x.hash === c.hash);
    let next: GraphCommit | undefined;
    if (e.key === 'ArrowLeft') next = list[at + 1];
    else if (e.key === 'ArrowRight') next = list[at - 1];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const target = lanes[lane + (e.key === 'ArrowUp' ? -1 : 1)];
      const col = colOf.get(c.hash)!;
      next = target?.commits.reduce<GraphCommit | undefined>((best, x) => (!best || Math.abs(colOf.get(x.hash)! - col) < Math.abs(colOf.get(best.hash)! - col) ? x : best), undefined);
    } else if (e.key === 'Home') next = lanes[lane].commits[lanes[lane].commits.length - 1];
    else if (e.key === 'End') next = lanes[lane].commits[0];
    else return;
    e.preventDefault();
    if (next) onSelect(next.hash);
  };

  // ---- what is on screen (only that is drawn) ----
  const margin = 700;
  const visCol = (col: number) => {
    const x = xOf(col);
    return x >= scroll.left - margin && x <= scroll.left + scroll.width + margin;
  };
  const edges = useMemo(() => {
    const out: { key: string; d: string; kind: 'lane' | 'branch' | 'merge'; color: string; cols: [number, number] }[] = [];
    for (const c of commits) {
      const lc = laneIndex.get(branchOf(c));
      if (lc === undefined) continue;
      const xc = xOf(colOf.get(c.hash)!);
      const yc = yOf(lc);
      c.parents.forEach((p, k) => {
        const pc = byHash.get(p);
        if (!pc) return;
        const lp = laneIndex.get(branchOf(pc));
        if (lp === undefined) return;
        const xp = xOf(colOf.get(p)!);
        const yp = yOf(lp);
        if (lp === lc) {
          out.push({ key: `${p}>${c.hash}`, d: `M${xp} ${yp}L${xc} ${yc}`, kind: 'lane', color: lanes[lc].color, cols: [colOf.get(p)!, colOf.get(c.hash)!] });
          return;
        }
        // A merge arrives at the merge commit; a new branch leaves its base commit.
        const bend = Math.min(60, Math.max(18, (xc - xp) / 2));
        const d = k > 0 ? `M${xp} ${yp}C${xc - bend} ${yp} ${xc - bend} ${yc} ${xc - 9} ${yc}` : `M${xp} ${yp}C${xp + bend} ${yp} ${xp + bend} ${yc} ${xp + bend * 2} ${yc}L${xc} ${yc}`;
        out.push({ key: `${p}>${c.hash}`, d, kind: k > 0 ? 'merge' : 'branch', color: k > 0 ? 'var(--ok, #3fb950)' : lanes[lc].color, cols: [colOf.get(p)!, colOf.get(c.hash)!] });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commits, laneIndex, colOf, byHash, colW, lanes, laneName]);

  // ---- date ruler: a tick where the day changes, bolder on a new month ----
  const ticks = useMemo(() => {
    const out: { col: number; label: string; month: boolean }[] = [];
    let prev = '';
    let prevMonth = '';
    let lastX = -Infinity;
    const usedDays = new Set<string>();
    for (let col = 0; col < n; col++) {
      const c = commits[n - 1 - col];
      const d = new Date(c.date);
      if (Number.isNaN(d.getTime())) continue;
      const day = d.toDateString();
      // Commit order is not always calendar order: label each day once, where it first appears.
      if (day === prev || usedDays.has(day)) continue;
      prev = day;
      const month = `${d.getFullYear()}-${d.getMonth()}`;
      const isMonth = month !== prevMonth;
      prevMonth = month;
      const x = PAD_X + col * colW;
      if (x - lastX < 64) continue; // keep labels readable when zoomed out
      lastX = x;
      usedDays.add(day);
      out.push({ col, label: d.toLocaleDateString(undefined, isMonth ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' }), month: isMonth });
    }
    return out;
  }, [commits, n, colW]);

  const tagsOf = (c: GraphCommit) => c.refs.filter((r) => r.startsWith('tag: ')).map((r) => r.slice(5));
  const flagW = (t: string[]) => Math.min(96, 10 + Math.min(13, t[0].length) * 6.2 + (t.length > 1 ? 18 : 0));
  const fullFlags = useMemo(() => {
    const out = new Set<string>();
    const lastEnd = new Map<number, number>();
    for (let col = 0; col < n; col++) {
      const c = commits[n - 1 - col];
      const tags = tagsOf(c);
      const lane = laneOf(c);
      if (!tags.length || lane === undefined) continue;
      const x = xOf(col);
      if (x >= (lastEnd.get(lane) ?? -Infinity) + 6) {
        out.add(c.hash);
        lastEnd.set(lane, x + flagW(tags));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commits, n, laneIndex, colW, laneName]);
  const hiddenCount = solo ? allLanes.length - lanes.length : hidden.size;

  // ---- overview map ----
  const onMap = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const go = (cx: number) => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = ((cx - r.left) / r.width) * width - el.clientWidth / 2;
    };
    go(e.clientX);
    const move = (ev: MouseEvent) => go(ev.clientX);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="bx" ref={wrapRef} tabIndex={0} onKeyDown={onKey} aria-label="Branch Explorer">
      <div className="bx-tools">
        <button className={`bx-btn bx-names-btn ${namesOpen ? 'on' : ''}`} onClick={toggleNames} title={namesOpen ? 'Hide branch names' : 'Show branch names'} aria-pressed={namesOpen}>
          <PaneIcon />
        </button>
        <div className="bx-find">
          <span aria-hidden>⌕</span>
          <input
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              setFindAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches.length) {
                e.preventDefault();
                // Enter: next match, Shift+Enter: previous; wraps around.
                const i = ((e.shiftKey ? findAt - 2 : findAt) % matches.length + matches.length) % matches.length;
                onSelect(matches[i].hash);
                setFindAt(i + 1);
              } else if (e.key === 'Escape') setFind('');
            }}
            placeholder="Find commit, author, sha, tag"
            spellCheck={false}
          />
          {q && <span className="bx-find-n">{matches.length}</span>}
        </div>
        {hiddenCount > 0 && (
          <button className="bx-chip" onClick={showAll} title="Show every branch lane again">
            {solo ? `Only ${solo.split('/').pop()}` : `${hiddenCount} hidden`} · show all
          </button>
        )}
        <span className="grow" />
        <button className="bx-btn" onClick={() => headOid && onSelect(headOid)} disabled={!headOid || !byHash.has(headOid)} title="Go to HEAD">
          ⌖ HEAD
        </button>
        <button className="bx-btn" onClick={fit} title="Fit all commits">
          ⤢ Fit
        </button>
        <div className="bx-zoom" role="group" aria-label="Zoom">
          <button onClick={() => zoomTo(zoom * 0.8)} title="Zoom out (Ctrl −)">
            −
          </button>
          <button className="bx-zoom-n" onClick={() => zoomTo(1)} title="Reset zoom (Ctrl 0)">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => zoomTo(zoom * 1.25)} title="Zoom in (Ctrl +)">
            +
          </button>
        </div>
      </div>

      <div className="bx-body">
        {/* Branch names: a header above a clipped list that follows the vertical scroll; resizable, collapsible */}
        {namesOpen && (
        <div className="bx-labels" style={{ width: labelW }}>
          <div className="bx-corner" style={{ height: RULER_H }}>
            <span className="bx-corner-t">
              Branches <span>{lanes.length}</span>
            </span>
            <button className="bx-corner-btn" onClick={toggleNames} title="Hide branch names" aria-label="Hide branch names">
              ‹
            </button>
          </div>
          <div className="bx-label-view">
            <div className="bx-label-list" ref={labelListRef} style={{ transform: `translateY(${-live.current.top}px)`, paddingTop: TOP_PAD }}>
              {lanes.map((l) => {
                const cut = l.name.lastIndexOf('/');
                const isHead = l.name === headBranch;
                return (
                  <div
                    key={l.name}
                    className={`bx-label ${isHead ? 'head' : ''}`}
                    style={{ height: LANE, ['--c' as string]: l.color }}
                    title={`${l.name} · ${l.commits.length} commit${l.commits.length === 1 ? '' : 's'}\nDouble-click to switch · right-click for more`}
                    onDoubleClick={() => l.name !== OTHER && !isHead && onSwitch(l.name)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (l.name !== OTHER) requestRailAction({ kind: 'branch-menu', name: l.name, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <span className="bx-lane-dot" />
                    {namesOpen && (
                      <>
                        <span className="bx-lane-text">
                          <span className="bx-lane-leaf">{l.name.slice(cut + 1)}</span>
                          {cut > 0 && <span className="bx-lane-pre">{l.name.slice(0, cut)}</span>}
                        </span>
                        {isHead && <span className="bx-here">HEAD</span>}
                        <span className="bx-lane-acts">
                          <button onClick={() => setSolo(solo === l.name ? null : l.name)} title={solo === l.name ? 'Show all lanes' : 'Show only this branch (and main)'}>
                            {solo === l.name ? '◉' : '◎'}
                          </button>
                          <button onClick={() => hide(l.name)} title="Hide this lane">
                            ✕
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {namesOpen && (
            <div
              className="bx-label-resize"
              title="Drag to resize · double-click to reset"
              onDoubleClick={() => setLabelW(LABEL_W)}
              onMouseDown={(e) => {
                e.preventDefault();
                const x0 = e.clientX;
                const w0 = labelW;
                let w = w0;
                const move = (ev: MouseEvent) => {
                  w = Math.min(420, Math.max(150, w0 + ev.clientX - x0));
                  setLabelW(w);
                };
                const up = () => {
                  window.removeEventListener('mousemove', move);
                  window.removeEventListener('mouseup', up);
                  document.body.classList.remove('resizing');
                  try {
                    localStorage.setItem('gb.bx.labelW', String(Math.round(w)));
                  } catch {
                    /* per-viewer convenience */
                  }
                };
                document.body.classList.add('resizing');
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
              }}
            />
          )}
        </div>
        )}

        <div className="bx-main" style={{ position: 'relative' }}>
          {/* Date ruler (follows the horizontal scroll) */}
          <div className="bx-ruler" style={{ height: RULER_H }}>
            <div ref={rulerRef} style={{ transform: `translateX(${-live.current.left}px)`, width }}>
              {ticks.map((t) => (
                <span key={t.col} className={`bx-tick ${t.month ? 'month' : ''}`} style={{ left: xOf(t.col) }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          <div
            className="bx-scroll"
            ref={scrollRef}
            onScroll={sync}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                zoomTo(zoom * (e.deltaY > 0 ? 0.9 : 1.1));
              } else if (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY) && lanes.length * LANE <= scroll.height) {
                // Nothing to scroll vertically: the wheel moves through time.
                scrollRef.current!.scrollLeft += e.deltaY;
              }
            }}
            onMouseDown={(e) => {
              if (e.button !== 0 || (e.target as Element).closest('.bx-node')) return;
              const el = scrollRef.current!;
              drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
              const move = (ev: MouseEvent) => {
                const d = drag.current;
                if (!d) return;
                if (Math.abs(ev.clientX - d.x) + Math.abs(ev.clientY - d.y) > 3) d.moved = true;
                el.scrollLeft = d.left - (ev.clientX - d.x);
                el.scrollTop = d.top - (ev.clientY - d.y);
              };
              const up = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
                el.classList.remove('panning');
              };
              el.classList.add('panning');
              window.addEventListener('mousemove', move);
              window.addEventListener('mouseup', up);
            }}
          >
            <svg width={width} height={height} className="bx-svg">
              <defs>
                <marker id="bx-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L8 4L0 8z" fill="var(--ok, #3fb950)" />
                </marker>
              </defs>
              {lanes.map((l, i) => (
                <g key={l.name}>
                  <rect x={0} y={TOP_PAD + i * LANE} width={width} height={LANE} className={i % 2 ? 'bx-band odd' : 'bx-band'} />
                  <line x1={xOf(l.from)} y1={yOf(i)} x2={xOf(l.to)} y2={yOf(i)} stroke={l.color} className="bx-lane-line" />
                </g>
              ))}
              {ticks.map((t) => (
                <line key={t.col} x1={xOf(t.col)} y1={0} x2={xOf(t.col)} y2={height} className={`bx-grid ${t.month ? 'month' : ''}`} />
              ))}
              {edges
                .filter((e) => visCol(e.cols[0]) || visCol(e.cols[1]) || (xOf(e.cols[0]) < scroll.left && xOf(e.cols[1]) > scroll.left + scroll.width))
                .map((e) =>
                  e.kind === 'lane' ? null : (
                    <path key={e.key} d={e.d} className={`bx-edge ${e.kind} ${selected && e.key.includes(selected) ? 'hot' : ''}`} stroke={e.color} markerEnd={e.kind === 'merge' ? 'url(#bx-arrow)' : undefined} />
                  ),
                )}
              {commits.map((c) => {
                const lane = laneOf(c);
                const col = colOf.get(c.hash)!;
                if (lane === undefined || !visCol(col)) return null;
                const x = xOf(col);
                const y = yOf(lane);
                const color = lanes[lane].color;
                const isHead = c.hash === headOid;
                const tags = tagsOf(c);
                const letter = pair[0] === c.hash ? 'A' : pair[1] === c.hash ? 'B' : null;
                return (
                  <g
                    key={c.hash}
                    data-hash={c.hash}
                    className={`bx-node ${selected === c.hash ? 'sel' : ''} ${isHead ? 'head' : ''} ${q && !matchSet.has(c.hash) ? 'dim' : ''} ${matchSet.has(c.hash) ? 'hit' : ''}`}
                    transform={`translate(${x} ${y})`}
                    onClick={() => !drag.current?.moved && onSelect(c.hash)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onMenu(c, e.clientX, e.clientY);
                    }}
                    onMouseEnter={(e) => !drag.current && tip.current({ c, x: e.clientX, y: e.clientY, branch: branchOf(c) })}
                    onMouseLeave={() => tip.current(null)}
                  >
                    {isHead && <circle r={13} className="bx-head-ring" stroke={color} />}
                    {c.parents.length > 1 ? (
                      <rect x={-7} y={-7} width={14} height={14} rx={3} transform="rotate(45)" fill={color} className="bx-dot" />
                    ) : (
                      <circle r={zoom < 0.5 ? 5 : 7} fill={color} className="bx-dot" />
                    )}
                    {letter && (
                      <text className="bx-letter" y={-14}>
                        {letter}
                      </text>
                    )}
                    {tags.length > 0 &&
                      (fullFlags.has(c.hash) && zoom >= 0.5 ? (
                        <g className="bx-flag" transform="translate(0 -11)">
                          <line y1={0} y2={-10} />
                          <rect x={0} y={-19} width={flagW(tags)} height={13} rx={3} />
                          <text x={4} y={-9.5}>
                            {tags[0].length > 13 ? `${tags[0].slice(0, 12)}…` : tags[0]}
                            {tags.length > 1 ? ` +${tags.length - 1}` : ''}
                          </text>
                        </g>
                      ) : (
                        <g className="bx-flag mini" transform="translate(0 -11)">
                          <line y1={0} y2={-7} />
                          <rect x={-3} y={-12} width={6} height={6} rx={1.5} />
                        </g>
                      ))}
                  </g>
                );
              })}
            </svg>
          </div>
          {hasMore && scroll.left < 160 && (
            <button className="bx-more" onClick={onLoadMore} disabled={loading} style={{ top: RULER_H + 8 }} title="Load older commits">
              {loading ? 'Loading…' : '‹ Older commits'}
            </button>
          )}
        </div>
      </div>

      {/* Overview map: every lane, the visible window as a frame; click or drag to move */}
      <div className="bx-map" style={{ height: MAP_H }} onMouseDown={onMap} title="Overview · click or drag to move through history">
        <svg width="100%" height={MAP_H} preserveAspectRatio="none">
          {lanes.map((l, i) => {
            const y = 4 + ((i + 0.5) / Math.max(1, lanes.length)) * (MAP_H - 8);
            return <line key={l.name} x1={mx(xOf(l.from))} x2={Math.max(mx(xOf(l.from)) + 1, mx(xOf(l.to)))} y1={y} y2={y} stroke={l.color} strokeWidth={2} strokeLinecap="round" />;
          })}
          {headOid && byHash.has(headOid) && <circle cx={mx(xOf(colOf.get(headOid)!))} cy={MAP_H / 2} r={3} className="bx-map-head" />}
          <rect ref={mapViewRef} x={mx(live.current.left)} y={1} width={Math.max(6, mx(scroll.width))} height={MAP_H - 2} className="bx-map-view" />
        </svg>
      </div>

      <TipLayer bind={(f) => (tip.current = f)} />
    </div>
  );
}

type TipState = { c: GraphCommit; x: number; y: number; branch: string };

/** The hover card, in its own component so hovering a commit never re-renders the graph. */
function TipLayer({ bind }: { bind: (show: (t: TipState | null) => void) => void }) {
  const [t, setT] = useState<TipState | null>(null);
  useEffect(() => bind(setT), [bind]);
  if (!t) return null;
  return (
    <div className="bx-tip" style={{ left: Math.min(t.x + 14, window.innerWidth - 330), top: Math.min(t.y + 14, window.innerHeight - 90) }}>
      <strong className="ellipsis">{t.c.subject}</strong>
      <span>
        {t.c.author} · {relative(t.c.date)}
      </span>
      <span className="mono">
        {t.c.shortHash} · {t.branch}
      </span>
    </div>
  );
}
