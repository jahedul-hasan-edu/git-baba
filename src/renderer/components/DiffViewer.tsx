import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BlameInfo, DiffHunk, DiffLine, FileDiff } from '../../shared/types';
import { initials } from '../pages/history/graphStyle';
import { call } from '../services/api';
import { relative } from './FileDiffList';

const RENDER_LIMIT = 3000;

function statusLabel(d: FileDiff): string {
  switch (d.status) {
    case 'renamed':
      return `Renamed from ${d.oldPath}${d.similarity !== undefined ? ` (${d.similarity}% similar)` : ''}`;
    case 'copied':
      return `Copied from ${d.oldPath}`;
    case 'added':
      return 'New file';
    case 'deleted':
      return 'Deleted file';
    default:
      return 'Modified';
  }
}

interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}

/** Pairs deletions with additions so both sides line up in split view. */
function toSplitRows(h: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) rows.push({ left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };
  for (const l of h.lines) {
    if (l.type === 'del') dels.push(l);
    else if (l.type === 'add') adds.push(l);
    else {
      flush();
      rows.push({ left: l, right: l });
    }
  }
  flush();
  return rows;
}

/** Wraps case-insensitive matches of `term` in <mark>. */
function highlightText(text: string, term?: string): ReactNode {
  if (!term) return text || ' ';
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (let at = lower.indexOf(t); at !== -1; at = lower.indexOf(t, i)) {
    if (at > i) out.push(text.slice(i, at));
    out.push(<mark key={k++}>{text.slice(at, at + t.length)}</mark>);
    i = at + t.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out.length ? out : text || ' ';
}

/** Where each side of the diff comes from, so lines can show who last changed them. */
export interface DiffBlameSource {
  repoId: string;
  /** Revision of the left/old side (null: no history to show, e.g. working tree). */
  oldRev?: string | null;
  newRev?: string | null;
}

const blameCache = new Map<string, Promise<BlameInfo | null>>();
export function loadBlame(repoId: string, rev: string, path: string): Promise<BlameInfo | null> {
  const key = `${repoId}\u0000${rev}\u0000${path}`;
  let p = blameCache.get(key);
  if (!p) {
    p = call('graph:blame', { repoId, rev, path }).catch(() => null);
    blameCache.set(key, p);
    if (blameCache.size > 60) blameCache.delete(blameCache.keys().next().value as string);
  }
  return p;
}

/** "3 days ago · Nov 16, 2026" for recent changes; just the date once relative time would repeat it. */
export function whenText(iso: string): string {
  const abs = new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const rel = relative(iso);
  return /ago|now|today|yesterday/i.test(rel) ? `${rel} · ${abs}` : abs;
}

type Hover = { x: number; y: number; side: 'old' | 'new'; hash: string };

export function DiffViewer({ diff, emptyText = 'Select a file to see its changes.', highlight, hideHeader, forceMode, blame }: { diff: FileDiff | null; emptyText?: string; highlight?: string; hideHeader?: boolean; /** Controlled layout (the caller shows its own toggle). */ forceMode?: 'unified' | 'split'; /** Show who changed each line (hover a line). */ blame?: DiffBlameSource }) {
  const [ownMode, setMode] = useState<'unified' | 'split'>('unified');
  const mode = forceMode ?? ownMode;
  const [showAll, setShowAll] = useState(false);
  const totalLines = useMemo(() => diff?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0, [diff]);
  const [oldB, setOldB] = useState<BlameInfo | null>(null);
  const [newB, setNewB] = useState<BlameInfo | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOldB(null);
    setNewB(null);
    setHover(null);
    if (!blame || !diff || diff.binary) return;
    let live = true;
    if (blame.oldRev && diff.status !== 'added') void loadBlame(blame.repoId, blame.oldRev, diff.oldPath).then((b) => live && setOldB(b));
    if (blame.newRev && diff.status !== 'deleted') void loadBlame(blame.repoId, blame.newRev, diff.newPath).then((b) => live && setNewB(b));
    return () => {
      live = false;
    };
  }, [diff, blame?.repoId, blame?.oldRev, blame?.newRev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the card inside the window.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !hover) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(hover.x + 14, window.innerWidth - w - 8))}px`;
    el.style.top = `${hover.y + 18 + h > window.innerHeight - 8 ? Math.max(8, hover.y - h - 12) : hover.y + 18}px`;
  }, [hover]);

  /** Line-number cell props: a strip in the side's colour (before red, after green) and the commit id for the hover card. */
  const who = (side: 'old' | 'new', n: number | undefined) => {
    const b = side === 'old' ? oldB : newB;
    const hash = n && b ? b.lines[n - 1] : undefined;
    const c = hash ? b!.commits[hash] : undefined;
    return c ? { 'data-h': hash, 'data-s': side, style: { ['--bl' as string]: side === 'old' ? 'var(--danger)' : 'var(--ok)' } } : {};
  };
  const onMove = (e: React.MouseEvent) => {
    const td = (e.target as HTMLElement).closest('td');
    const tr = td?.closest('tr');
    // Side-by-side: the half under the pointer (its own line-number cell); unified: the row's line.
    const prev = td?.previousElementSibling as HTMLElement | null | undefined;
    const own = td?.dataset.h ? td : prev?.dataset.h && td?.classList.contains('half') ? prev : !td?.classList.contains('half') ? (tr?.querySelector('[data-h]') as HTMLElement | null) : null;
    const hash = own?.dataset.h;
    const side = own?.dataset.s as 'old' | 'new' | undefined;
    window.clearTimeout(hoverTimer.current);
    if (!hash || !side) {
      hoverTimer.current = window.setTimeout(() => setHover(null), 80);
      return;
    }
    const { clientX: x, clientY: y } = e;
    if (hover && hover.hash === hash && hover.side === side) {
      setHover({ ...hover, x, y });
      return;
    }
    hoverTimer.current = window.setTimeout(() => setHover({ x, y, side, hash }), hover ? 0 : 220);
  };
  const leave = () => {
    window.clearTimeout(hoverTimer.current);
    setHover(null);
  };
  const hb = hover ? (hover.side === 'old' ? oldB : newB) : null;
  const hc = hover && hb ? hb.commits[hover.hash] : null;
  const hCount = hover && hb ? hb.lines.filter((x) => x === hover.hash).length : 0;

  if (!diff) return <div className="empty">{emptyText}</div>;
  const path = diff.status === 'deleted' ? diff.oldPath : diff.newPath;
  const modeChange = diff.oldMode && diff.newMode && diff.oldMode !== diff.newMode ? `Mode ${diff.oldMode} → ${diff.newMode}` : null;
  let budget = showAll ? Infinity : RENDER_LIMIT;

  return (
    <div>
      <div className="diff-header" style={hideHeader ? { display: 'none' } : undefined}>
        <strong className="ellipsis grow mono">{path}</strong>
        <span className="muted small">{statusLabel(diff)}</span>
        {modeChange && <span className="badge warn">{modeChange}</span>}
        <span className="badge ok">+{diff.additions}</span>
        <span className="badge danger">−{diff.deletions}</span>
        <div className="row">
          <button className={`btn sm ${mode === 'unified' ? 'primary' : ''}`} onClick={() => setMode('unified')}>
            Unified
          </button>
          <button className={`btn sm ${mode === 'split' ? 'primary' : ''}`} onClick={() => setMode('split')}>
            Side-by-side
          </button>
        </div>
      </div>
      {diff.binary && <div className="empty">Binary file — contents cannot be shown as text.</div>}
      {!diff.binary && diff.hunks.length === 0 && <div className="empty">{diff.truncated ? 'File is too large to display.' : modeChange ? 'Only the file mode changed.' : 'No content changes.'}</div>}
      {diff.truncated && diff.hunks.length > 0 && <div className="banner warn" style={{ margin: 10 }}>This diff is very large and was truncated.</div>}
      <table className={`diff ${oldB || newB ? 'blamed' : ''}`} onMouseMove={oldB || newB ? onMove : undefined} onMouseLeave={leave}>
        {mode === 'split' ? (
          <colgroup>
            <col style={{ width: 52 }} />
            <col />
            <col style={{ width: 52 }} />
            <col />
          </colgroup>
        ) : (
          <colgroup>
            <col style={{ width: 52 }} />
            <col style={{ width: 52 }} />
            <col style={{ width: 18 }} />
            <col />
          </colgroup>
        )}
        <tbody>
          {diff.hunks.map((h, hi) => {
            if (budget <= 0) return null;
            const header = (
              <tr className="hunk" key={`h${hi}`}>
                <td colSpan={mode === 'split' ? 4 : 4}>{h.header}</td>
              </tr>
            );
            if (mode === 'unified') {
              const lines = h.lines.slice(0, Math.max(0, budget));
              budget -= lines.length;
              return [
                header,
                ...lines.map((l, li) => (
                  <tr key={`${hi}-${li}`} className={l.type}>
                    <td className="ln" {...(l.type === 'del' ? who('old', l.oldLine) : {})}>{l.oldLine ?? ''}</td>
                    <td className="ln" {...(l.type !== 'del' ? who('new', l.newLine) : {})}>{l.newLine ?? ''}</td>
                    <td className="sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</td>
                    <td>{highlightText(l.content, highlight)}</td>
                  </tr>
                )),
              ];
            }
            const rows = toSplitRows(h).slice(0, Math.max(0, budget));
            budget -= rows.length;
            return [
              header,
              ...rows.map((r, ri) => {
                const lt = r.left?.type === 'del' ? 'del' : r.left ? '' : 'empty';
                const rt = r.right?.type === 'add' ? 'add' : r.right ? '' : 'empty';
                return (
                  <tr key={`${hi}-s${ri}`} className={r.left?.type === 'meta' ? 'meta' : ''}>
                    <td className={`ln ${lt}`} {...(r.left ? who('old', r.left.oldLine) : {})}>{r.left?.oldLine ?? ''}</td>
                    <td className={`half ${lt}`}>{r.left ? highlightText(r.left.content, highlight) : ''}</td>
                    <td className={`ln ${rt}`} {...(r.right ? who('new', r.right.newLine) : {})}>{r.right?.newLine ?? ''}</td>
                    <td className={`half ${rt}`}>{r.right ? highlightText(r.right.content, highlight) : ''}</td>
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
      {hover &&
        hc &&
        createPortal(
          <div ref={card} className={`bl-card ${hover.side === 'old' ? 'before' : 'after'}`} role="tooltip">
            <div className="bl-card-head">
              <span className="bl-avatar">{initials(hc.author)}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bl-author">
                  <span className="ellipsis">{hc.author}</span>
                  <span className="bl-side">{hover.side === 'old' ? 'Before' : 'After'}</span>
                </div>
                <div className="bl-when" title={hc.date ? new Date(hc.date).toLocaleString() : ''}>
                  {hc.date ? whenText(hc.date) : 'date unknown'}
                </div>
              </div>
            </div>
            <div className="bl-summary">{hc.summary || '(no message)'}</div>
            <div className="bl-foot">
              <span className="mono">{hover.hash.slice(0, 7)}</span>
              <span>
                {hCount} line{hCount === 1 ? '' : 's'} in this file
              </span>
            </div>
          </div>,
          document.body,
        )}
      {!showAll && totalLines > RENDER_LIMIT && (
        <div className="empty">
          Showing the first {RENDER_LIMIT} of {totalLines} lines.{' '}
          <button className="btn sm" onClick={() => setShowAll(true)}>
            Show all
          </button>
        </div>
      )}
    </div>
  );
}
