import { useEffect, useMemo, useRef, useState } from 'react';
import { branchColor } from '../../components/BranchPicker';

export interface QueryRefs {
  current: string | null;
  branches: string[];
  remotes: string[];
  tags: string[];
}

interface Props {
  /** 'current' | 'all' | 'remotes' | 'tags' | 'ref:<name>' */
  scope: string;
  onScope: (s: string) => void;
  refs: QueryRefs | null;
  author: string;
  onAuthor: (email: string) => void;
  authors: { name: string; email: string; commits: number }[];
  sinceDays: number | null;
  onSince: (d: number | null) => void;
  text: string;
  onText: (t: string) => void;
  /** Enter in the box (Shift = backwards). */
  onStep?: (back: boolean) => void;
  /** Matches for the text, when the view highlights rather than filters. */
  matches?: number | null;
  /** Branch lanes the view can hide or isolate; omitted when the view has no lanes. */
  lanes?: { all: string[]; hidden: Set<string>; solo: string | null; onChange: (hidden: Set<string>, solo: string | null) => void } | null;
  /** What the free text does in this view: highlight matches or filter the list. */
  textMode: 'find' | 'filter';
}

const SCOPES: [string, string, string][] = [
  ['all', '◎', 'All branches, remotes & tags'],
  ['current', '⎇', 'Current branch'],
  ['remotes', '☁', 'Remote branches'],
  ['tags', '⚑', 'Tags'],
];
const DATES: [number, string][] = [
  [1, '24 hours'],
  [7, '7 days'],
  [30, '30 days'],
  [90, '90 days'],
  [365, 'year'],
];

type Sug = { key: string; group: string; label: string; hint?: string; dot?: string; apply: () => void };

/**
 * One box for the whole history query. What you are looking at sits in it as chips (where, who, when, which lanes
 * are out); everything else is a sentence you type. Prefixes steer the suggestions: `on:` or `in:` for a branch or
 * tag, `@` for an author, `#` for a tag, `-` to drop a lane, `+` to show only one, `since:` for a date range.
 * Plain text finds commits by message, sha, author or ref. Backspace on an empty box peels the last chip off.
 */
export function HistoryQueryBar(p: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', down);
    return () => window.removeEventListener('mousedown', down);
  }, [open]);
  // "/" focuses the bar from anywhere that is not a text field.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // Ctrl+K also lands here now that the bar is the only search.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        return setOpen(true);
      }
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      input.current?.focus();
      setOpen(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const raw = p.text;
  const m = /^(on:|in:|@|#|-|\+|since:)(.*)$/i.exec(raw.trimStart());
  const prefix = m?.[1].toLowerCase() ?? '';
  const needle = (m ? m[2] : raw).trim().toLowerCase();
  const has = (s: string) => !needle || s.toLowerCase().includes(needle);
  const done = (f: () => void) => () => {
    f();
    p.onText('');
    setActive(0);
    input.current?.focus();
  };

  const sugs = useMemo<Sug[]>(() => {
    const out: Sug[] = [];
    const refs = p.refs;
    const lanes = p.lanes;
    const wantRefs = !prefix || prefix === 'on:' || prefix === 'in:' || prefix === '#';
    if (!prefix || prefix === 'on:' || prefix === 'in:')
      for (const [v, ico, label] of SCOPES)
        if (has(label) && p.scope !== v) out.push({ key: `s:${v}`, group: 'Show', label, dot: ico, hint: v === 'current' && refs?.current ? refs.current : undefined, apply: done(() => p.onScope(v)) });
    if (wantRefs && refs) {
      const add = (list: string[], group: string, kind: string) => {
        let n = 0;
        for (const r of list) {
          if (!has(r) || p.scope === `ref:${r}`) continue;
          if (++n > (needle ? 8 : 4)) break;
          out.push({ key: `r:${r}`, group, label: r, hint: r === refs.current ? 'current' : kind, dot: kind === 'tag' ? '⚑' : undefined, apply: done(() => p.onScope(`ref:${r}`)) });
        }
      };
      if (prefix !== '#') add(refs.branches, 'Only this branch', 'branch');
      if (prefix !== '#') add(refs.remotes, 'Only this remote branch', 'remote');
      add(refs.tags, 'Up to this tag', 'tag');
    }
    if (!prefix || prefix === '@') {
      let n = 0;
      for (const a of p.authors) {
        if (!(has(a.name) || has(a.email)) || p.author === a.email) continue;
        if (++n > (needle ? 8 : 4)) break;
        out.push({ key: `a:${a.email}`, group: 'By', label: a.name, hint: `${a.commits} commit${a.commits === 1 ? '' : 's'}`, dot: '@', apply: done(() => p.onAuthor(a.email)) });
      }
    }
    if (!prefix || prefix === 'since:')
      for (const [d, label] of DATES)
        if ((has(label) || has(String(d))) && p.sinceDays !== d) out.push({ key: `d:${d}`, group: 'When', label: `Last ${label}`, dot: '◷', apply: done(() => p.onSince(d)) });
    if (lanes && (!prefix || prefix === '-' || prefix === '+')) {
      for (const l of lanes.all) {
        if (!has(l)) continue;
        if (prefix !== '+' && !lanes.hidden.has(l) && (prefix === '-' || needle))
          out.push({ key: `h:${l}`, group: 'Hide lane', label: l, dot: '●', hint: 'hide', apply: done(() => lanes.onChange(new Set(lanes.hidden).add(l), lanes.solo === l ? null : lanes.solo)) });
        if (prefix !== '-' && lanes.solo !== l && (prefix === '+' || needle))
          out.push({ key: `o:${l}`, group: 'Focus lane', label: l, dot: '●', hint: 'only this + main', apply: done(() => lanes.onChange(lanes.hidden, l)) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, p.refs, p.authors, p.scope, p.author, p.sinceDays, p.lanes]);

  useEffect(() => setActive(0), [raw]);

  // ---- chips: one per thing that narrows the view ----
  const chips: { key: string; kind: string; label: string; title: string; color?: string; remove?: () => void }[] = [];
  const scopeRef = p.scope.startsWith('ref:') ? p.scope.slice(4) : null;
  const scopeInfo = SCOPES.find(([v]) => v === p.scope);
  // Everything is the default, so it needs no chip; only a narrower scope shows one.
  if (p.scope !== 'all')
    chips.push({
      key: 'scope',
      kind: 'scope',
      label: scopeRef ?? (p.scope === 'current' && p.refs?.current ? p.refs.current : scopeInfo?.[2] ?? p.scope),
      title: `${scopeRef ? `Only ${scopeRef}` : scopeInfo?.[2]} — × to show everything`,
      color: scopeRef ? branchColor(scopeRef) : undefined,
      remove: () => p.onScope('all'),
    });
  if (p.author) {
    const a = p.authors.find((x) => x.email === p.author);
    chips.push({ key: 'author', kind: 'author', label: `@${a?.name ?? p.author}`, title: `Only commits by ${a?.name ?? p.author} <${p.author}>`, remove: () => p.onAuthor('') });
  }
  if (p.sinceDays) {
    const d = DATES.find(([x]) => x === p.sinceDays);
    chips.push({ key: 'since', kind: 'since', label: `last ${d?.[1] ?? `${p.sinceDays} days`}`, title: 'Only recent commits', remove: () => p.onSince(null) });
  }
  if (p.lanes?.solo) {
    const l = p.lanes;
    chips.push({ key: 'solo', kind: 'solo', label: `only ${l.solo!.split('/').pop()}`, title: `Showing only the ${l.solo} lane (and main)`, color: branchColor(l.solo!), remove: () => l.onChange(l.hidden, null) });
  }
  if (p.lanes && !p.lanes.solo)
    for (const h of p.lanes.hidden) {
      if (!p.lanes.all.includes(h)) continue;
      const l = p.lanes;
      chips.push({
        key: `h:${h}`,
        kind: 'hidden',
        label: h.split('/').pop()!,
        title: `${h} lane is hidden — × to show it again`,
        color: branchColor(h),
        remove: () => {
          const s = new Set(l.hidden);
          s.delete(h);
          l.onChange(s, l.solo);
        },
      });
    }
  const removable = chips.filter((c) => c.remove);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const list = open ? sugs : [];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (list.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length);
    } else if (e.key === 'Tab' && open && list.length && raw) {
      e.preventDefault();
      list[active]?.apply();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // A prefixed query picks the suggestion; plain text jumps between matches.
      if (prefix && list[active]) list[active].apply();
      else p.onStep?.(e.shiftKey);
      if (!prefix) setOpen(false);
    } else if (e.key === 'Escape') {
      if (open) setOpen(false);
      else p.onText('');
    } else if (e.key === 'Backspace' && !raw && removable.length) {
      e.preventDefault();
      removable[removable.length - 1].remove!();
    } else setOpen(true);
  };

  const groups: [string, (Sug & { i: number })[]][] = [];
  sugs.forEach((s, i) => {
    const g = groups.find(([n]) => n === s.group);
    if (g) g[1].push({ ...s, i });
    else groups.push([s.group, [{ ...s, i }]]);
  });
  const anyFilter = removable.length > 0 || !!raw;

  return (
    <div className={`hq ${open ? 'open' : ''}`} ref={box} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), input.current?.focus())}>
      <span className="hq-ico" aria-hidden>
        ⌕
      </span>
      {chips.map((c) => (
        <span key={c.key} className={`hq-chip ${c.kind}`} title={c.title} style={c.color ? ({ ['--c' as string]: c.color } as React.CSSProperties) : undefined}>
          {c.color ? <i className="hq-dot" /> : <i className="hq-chip-ico">{c.kind === 'author' ? '@' : c.kind === 'since' ? '◷' : '⎇'}</i>}
          <button
            className="hq-chip-l"
            onClick={() => {
              if (c.kind === 'scope') p.onText('on:');
              else if (c.kind === 'author') p.onText('@');
              else if (c.kind === 'since') p.onText('since:');
              setOpen(true);
              input.current?.focus();
            }}
          >
            {c.label}
          </button>
          {c.remove && (
            <button className="hq-x" onClick={c.remove} aria-label={`Remove ${c.label}`}>
              ×
            </button>
          )}
        </span>
      ))}
      <input
        ref={input}
        value={raw}
        onChange={(e) => {
          p.onText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={removable.length ? 'Refine…' : 'Search commits'}
        title="Message, sha or author · press / to focus"
        spellCheck={false}
        aria-label="Query history"
      />
      {!prefix && raw && p.matches != null && (
        <span className={`hq-n ${p.matches ? '' : 'none'}`} title="Enter: next match · Shift+Enter: previous">
          {p.matches}
        </span>
      )}
      {anyFilter && (
        <button
          className="hq-clear"
          title="Clear every filter"
          onClick={() => {
            p.onText('');
            removable.forEach((c) => c.remove!());
          }}
        >
          ×
        </button>
      )}
      <span className="hq-facets" onMouseDown={(e) => e.preventDefault()}>
        {(
          [
            ['on:', '⎇', 'Branch or tag', p.scope !== 'all'],
            ['@', '@', 'Author', !!p.author],
            ['since:', '◷', 'Time', !!p.sinceDays],
            ...(p.lanes ? ([['-', '◐', 'Lanes', p.lanes.hidden.size > 0 || !!p.lanes.solo]] as const) : []),
          ] as const
        ).map(([pre, ico, label, on]) => (
          <button
            key={pre}
            className={`hq-facet ${on ? 'on' : ''} ${prefix === pre ? 'cur' : ''}`}
            title={label}
            aria-label={label}
            onClick={() => {
              p.onText(prefix === pre ? '' : pre);
              setOpen(true);
              input.current?.focus();
            }}
          >
            {ico}
          </button>
        ))}
      </span>

      {open && (sugs.length > 0 || !!raw) && (
        <div className="hq-pop" onMouseDown={(e) => e.preventDefault()}>
          {!prefix && raw && (
            <div className="hq-find-row">
              <span className="muted small">↵</span> {p.textMode === 'find' ? 'Find' : 'Filter'} commits matching <b>“{raw.trim()}”</b>
              {p.matches != null && <span className="muted small"> · {p.matches} found</span>}
            </div>
          )}
          {groups.map(([g, list]) => (
            <div key={g} className="hq-group">
              <div className="hq-gh">{g}</div>
              {list.map((s) => (
                <button key={s.key} className={`hq-opt ${s.i === active ? 'on' : ''}`} onMouseEnter={() => setActive(s.i)} onClick={s.apply}>
                  <span className="hq-opt-dot" style={s.dot === '●' ? { color: branchColor(s.label) } : undefined}>
                    {s.dot ?? '⎇'}
                  </span>
                  <span className="hq-opt-l ellipsis">{s.label}</span>
                  {s.hint && <span className="hq-opt-h">{s.hint}</span>}
                </button>
              ))}
            </div>
          ))}
          {prefix && !sugs.length && <div className="hq-empty small muted">Nothing matches “{needle}”.</div>}
        </div>
      )}
    </div>
  );
}
