import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileChange, FileDiff } from '../../../shared/types';
import { DiffViewer } from '../../components/DiffViewer';

type Sel = Map<number, Set<number>>;
export type PartialAction = 'stage' | 'unstage' | 'discard';

interface Props {
  file: FileChange;
  diff: FileDiff;
  busy: boolean;
  onApply: (action: PartialAction, selection: { hunk: number; lines?: number[] }[]) => void;
  /** Whole-file actions for files that cannot be split (untracked, renamed, binary). */
  onWhole: (action: PartialAction) => void;
}

const VIEW_KEY = 'gb.changes.diffLayout';

/**
 * Working-tree diff you can act on: stage / unstage / discard a whole hunk, or click and drag over
 * individual lines to act on just those. A "minimap" on the side shows where the changes are.
 */
export function HunkDiff({ file, diff, busy, onApply, onWhole }: Props) {
  const [sel, setSel] = useState<Sel>(new Map());
  // Unified (default) and Side by side are read-only; Interactive picks lines and hunks to stage.
  const [view, setView] = useState<'unified' | 'split' | 'interactive'>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === 'split' || v === 'interactive' ? v : 'unified';
    } catch {
      return 'unified';
    }
  });
  const drag = useRef<{ hunk: number; add: boolean } | null>(null);
  const anchor = useRef<{ hunk: number; line: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setMenu(false));
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [menu]);
  const staged = file.area === 'staged';
  const splittable = (file.area === 'staged' || file.area === 'unstaged') && !diff.binary && !diff.truncated && diff.status !== 'renamed' && diff.status !== 'copied';

  useEffect(() => setSel(new Map()), [diff]);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* convenience only */
    }
  }, [view]);
  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const count = useMemo(() => [...sel.values()].reduce((n, s) => n + s.size, 0), [sel]);
  const isChange = (h: number, k: number) => {
    const t = diff.hunks[h]?.lines[k]?.type;
    return t === 'add' || t === 'del';
  };
  const setLine = (h: number, k: number, on: boolean) =>
    setSel((m) => {
      if (!isChange(h, k)) return m;
      const n = new Map(m);
      const s = new Set(n.get(h) ?? []);
      if (on) s.add(k);
      else s.delete(k);
      if (s.size) n.set(h, s);
      else n.delete(h);
      return n;
    });
  const range = (h: number, a: number, b: number, on: boolean) =>
    setSel((m) => {
      const n = new Map(m);
      const s = new Set(n.get(h) ?? []);
      for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (isChange(h, k)) (on ? s.add(k) : s.delete(k));
      if (s.size) n.set(h, s);
      else n.delete(h);
      return n;
    });

  const selection = () => [...sel.entries()].map(([hunk, s]) => ({ hunk, lines: [...s].sort((a, b) => a - b) }));
  const primary: PartialAction = staged ? 'unstage' : 'stage';
  const totalLines = diff.hunks.reduce((n, h) => n + h.lines.length, 0) || 1;

  const jump = (h: number) => bodyRef.current?.querySelector(`[data-hunk="${h}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="hd">
      <div className="hd-bar">
        <span className="mono ellipsis grow" title={file.path}>
          {file.origPath ? `${file.origPath} → ` : ''}
          {file.path}
        </span>
        <span className="hd-stat add">+{diff.additions}</span>
        <span className="hd-stat del">−{diff.deletions}</span>
        <span className="small muted">
          {diff.hunks.length} hunk{diff.hunks.length === 1 ? '' : 's'}
        </span>
        <div className="hd-seg" role="radiogroup" aria-label="Diff layout">
          {(
            [
              ['unified', 'Unified', 'Read-only, one column'],
              ['split', 'Side by side', 'Read-only, old and new next to each other'],
              ['interactive', 'Interactive', 'Click or drag over lines to stage, unstage or discard just those'],
            ] as const
          ).map(([v, label, hint]) => (
            <button key={v} role="radio" aria-checked={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)} title={hint}>
              {label}
            </button>
          ))}
        </div>
        <div className="hd-more" ref={menuRef}>
          <button className={`hd-more-btn ${menu ? 'on' : ''}`} onClick={() => setMenu((m) => !m)} title="View and file actions" aria-haspopup="menu" aria-expanded={menu}>
            ⋮
          </button>
          {menu && (
            <div className="hd-menu" role="menu">
              <button role="menuitem" className="hd-mi" disabled={busy} onClick={() => (onWhole(primary), setMenu(false))}>
                <span className="hd-mi-ico">{staged ? '−' : '+'}</span>
                <span className="grow">{staged ? 'Unstage file' : 'Stage file'}</span>
              </button>
              {!staged && file.area !== 'conflicted' && (
                <button role="menuitem" className="hd-mi danger" disabled={busy} onClick={() => (onWhole('discard'), setMenu(false))}>
                  <span className="hd-mi-ico">↺</span>
                  <span className="grow">Discard all changes</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {view !== 'interactive' ? (
        <div className="hd-split">
          {/* One bar only: this view's header — the viewer's own is hidden. */}
          <DiffViewer diff={diff} hideHeader forceMode={view} />
        </div>
      ) : (
        <div className="hd-wrap">
          <div className="hd-body" ref={bodyRef}>
            {!splittable && (
              <div className="banner info small" style={{ margin: 10 }}>
                <span className="icon">ℹ</span>
                <div>
                  {file.area === 'untracked'
                    ? 'This is a new file: stage it as a whole (it can be edited afterwards and re-staged).'
                    : diff.binary
                      ? 'Binary file — it can only be staged as a whole.'
                      : diff.truncated
                        ? 'This diff is too large to select lines from; stage the whole file.'
                        : file.area === 'conflicted'
                          ? 'Resolve this conflict in the Conflicts tab.'
                          : 'Renamed files are staged as a whole.'}
                </div>
              </div>
            )}
            {diff.binary && <div className="empty">Binary file — contents cannot be shown as text.</div>}
            {diff.hunks.map((h, hi) => {
              const hs = sel.get(hi);
              return (
                <div key={hi} className={`hd-hunk ${hs ? 'has-sel' : ''}`} data-hunk={hi}>
                  <div className="hd-hunk-head">
                    <span className="mono small grow ellipsis">{h.header}</span>
                    {splittable && (
                      <>
                        <button className="hd-act" disabled={busy} onClick={() => onApply(primary, [{ hunk: hi }])}>
                          {staged ? '− Unstage hunk' : '+ Stage hunk'}
                        </button>
                        {!staged && (
                          <button className="hd-act danger" disabled={busy} onClick={() => onApply('discard', [{ hunk: hi }])}>
                            ↺ Discard hunk
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <table className="diff hd-table">
                    <colgroup>
                      <col style={{ width: 22 }} />
                      <col style={{ width: 48 }} />
                      <col style={{ width: 48 }} />
                      <col style={{ width: 16 }} />
                      <col />
                    </colgroup>
                    <tbody>
                      {h.lines.map((l, k) => {
                        const change = l.type === 'add' || l.type === 'del';
                        const on = !!hs?.has(k);
                        return (
                          <tr
                            key={k}
                            className={`${l.type === 'add' ? 'add' : l.type === 'del' ? 'del' : l.type === 'meta' ? 'meta' : ''} ${on ? 'picked' : ''} ${change && splittable ? 'pickable' : ''}`}
                            onMouseDown={(e) => {
                              if (!change || !splittable || e.button !== 0) return;
                              e.preventDefault();
                              if (e.shiftKey && anchor.current?.hunk === hi) return range(hi, anchor.current.line, k, true);
                              drag.current = { hunk: hi, add: !on };
                              anchor.current = { hunk: hi, line: k };
                              setLine(hi, k, !on);
                            }}
                            onMouseEnter={() => drag.current && drag.current.hunk === hi && change && setLine(hi, k, drag.current.add)}
                          >
                            <td className="hd-pick">{change && splittable ? <span className={`hd-box ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span> : null}</td>
                            <td className="ln">{l.oldLine ?? ''}</td>
                            <td className="ln">{l.newLine ?? ''}</td>
                            <td className="sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</td>
                            <td>{l.content}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          {diff.hunks.length > 1 && (
            <div className="hd-map" title="Changes in this file — click to jump">
              {diff.hunks.map((h, hi) => {
                const before = diff.hunks.slice(0, hi).reduce((n, x) => n + x.lines.length, 0);
                const adds = h.lines.filter((l) => l.type === 'add').length;
                const dels = h.lines.filter((l) => l.type === 'del').length;
                return (
                  <button
                    key={hi}
                    className={`hd-map-mark ${adds && dels ? 'mod' : adds ? 'add' : 'del'} ${sel.has(hi) ? 'sel' : ''}`}
                    style={{ top: `${(before / totalLines) * 100}%`, height: `${Math.max(3, (h.lines.length / totalLines) * 100)}%` }}
                    onClick={() => jump(hi)}
                    title={`${h.header} · +${adds} −${dels}`}
                  />
                );
              })}
            </div>
          )}
          {count > 0 && (
            <div className="hd-float">
              <span className="small">
                <strong>{count}</strong> line{count === 1 ? '' : 's'} selected
              </span>
              <button className="btn sm primary" disabled={busy} onClick={() => onApply(primary, selection())}>
                {staged ? `− Unstage ${count}` : `+ Stage ${count}`}
              </button>
              {!staged && (
                <button className="btn sm danger" disabled={busy} onClick={() => onApply('discard', selection())}>
                  ↺ Discard {count}
                </button>
              )}
              <button className="btn sm ghost" onClick={() => setSel(new Map())} title="Clear selection (Esc)">
                ✕
              </button>
            </div>
          )}
        </div>
      )}
      {view === 'interactive' && splittable && count === 0 && diff.hunks.length > 0 && <div className="hd-hint small muted">Tip: click or drag over lines to pick them · Shift+click for a range · stage hunks from their header</div>}
    </div>
  );
}
