import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BlameInfo, FileAtCommit } from '../../../shared/types';
import { loadBlame, whenText } from '../../components/DiffViewer';
import { authorColor, initials } from '../history/graphStyle';
import { Markdown } from '../../components/Markdown';
import { BinaryView, ImageStage, isViewablePath } from './BinaryView';
import { langFor, tokenize } from './syntax';

export const isMarkdown = (p: string) => /\.(md|markdown|mdx)$/i.test(p);

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function highlight(line: string, term: string): ReactNode {
  if (!term) return line || ' ';
  const lower = line.toLowerCase();
  const out: ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, at)) {
    out.push(line.slice(at, i), <mark key={i}>{line.slice(i, i + term.length)}</mark>);
    at = i + term.length;
  }
  out.push(line.slice(at));
  return out;
}

/** Indent unit of a file (2, 4 or tab), from its indented lines. */
function indentUnit(lines: string[]): number {
  const counts = new Map<number, number>();
  let prev = 0;
  for (const l of lines.slice(0, 2000)) {
    if (!l.trim()) continue;
    const w = /^[ ]*/.exec(l)![0].length;
    const d = Math.abs(w - prev);
    if (d === 2 || d === 4 || d === 8) counts.set(d, (counts.get(d) ?? 0) + 1);
    prev = w;
  }
  if (lines.some((l) => l.startsWith('\t'))) return 4;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 4;
}

/**
 * Read-only file view, IDE style (like JetBrains Rider): a file tab, syntax colours, a sticky line-number
 * gutter, indent guides, the caret line, search marks on the scrollbar and a status bar. It scrolls on its
 * own, inside the page. Markdown files can be previewed.
 */
export function FileView({ file, line, term, onLink, toolbar, blame, source }: { file: FileAtCommit; line: number | null; term: string; onLink: (href: string) => void; toolbar: ReactNode; /** Where to read line history from; hover a line to see who changed it and when. */ blame?: { repoId: string; rev: string }; /** Where to load the bytes of images, PDFs and other binary files from (ref null: working copy). */ source?: { repoId: string; ref: string | null } }) {
  const svg = /\.svg$/i.test(file.path);
  const md = isMarkdown(file.path) || svg;
  // Images, PDFs and other binary files open in a viewer instead of as text.
  const viewer = (file.binary || isViewablePath(file.path)) && !!source;
  const [mode, setMode] = useState<'preview' | 'code'>(md ? 'preview' : 'code');
  const [active, setActive] = useState<number | null>(line);
  const [wrap, setWrap] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => {
    const l = file.content.replace(/\r\n/g, '\n').split('\n');
    if (l.length > 1 && l[l.length - 1] === '') l.pop();
    return l;
  }, [file.content]);
  const lang = useMemo(() => langFor(file.path), [file.path]);
  const toks = useMemo(() => (file.binary ? [] : tokenize(lines, lang.key)), [lines, lang.key, file.binary]);
  const unit = useMemo(() => indentUnit(lines), [lines]);
  const crlf = file.content.includes('\r\n');

  // ---- line history (git blame): a strip per author, a card on hover, the caret line's author inline ----
  const [bl, setBl] = useState<BlameInfo | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; n: number } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setBl(null);
    setHover(null);
    if (!blame || file.binary || viewer) return;
    let live = true;
    void loadBlame(blame.repoId, blame.rev, file.path).then((b) => live && setBl(b));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blame?.repoId, blame?.rev, file.path, file.hash, file.binary]);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !hover) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(hover.x + 14, window.innerWidth - w - 8))}px`;
    el.style.top = `${hover.y + 18 + h > window.innerHeight - 8 ? Math.max(8, hover.y - h - 12) : hover.y + 18}px`;
  }, [hover]);
  const commitAt = (n: number) => {
    const h = bl?.lines[n - 1];
    return h ? { hash: h, c: bl!.commits[h] } : null;
  };
  const onMove = (e: React.MouseEvent) => {
    const tr = (e.target as HTMLElement).closest('tr');
    const n = Number(tr?.dataset.ln);
    window.clearTimeout(hoverTimer.current);
    if (!n || !commitAt(n)) {
      hoverTimer.current = window.setTimeout(() => setHover(null), 80);
      return;
    }
    const { clientX: x, clientY: y } = e;
    const same = hover && commitAt(hover.n)?.hash === commitAt(n)?.hash;
    if (same) {
      setHover({ x, y, n });
      return;
    }
    hoverTimer.current = window.setTimeout(() => setHover({ x, y, n }), hover ? 0 : 260);
  };
  const hv = hover ? commitAt(hover.n) : null;
  const hvCount = hv && bl ? bl.lines.filter((x) => x === hv.hash).length : 0;
  const lens = active ? commitAt(active) : null;

  useEffect(() => {
    setMode(md && !line ? 'preview' : 'code');
    setActive(line);
  }, [file.path, file.hash, line, md]);

  useEffect(() => {
    if (mode !== 'code') return;
    if (!active) body.current?.scrollTo({ top: 0 });
    else body.current?.querySelector(`[data-ln="${active}"]`)?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, file.path]);
  useEffect(() => {
    if (mode === 'code' && active) body.current?.querySelector(`[data-ln="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, mode]);

  const t = term.trim().toLowerCase();
  const hits = useMemo(() => (t ? lines.map((l, i) => (l.toLowerCase().includes(t) ? i + 1 : 0)).filter(Boolean) : []), [lines, t]);
  const name = file.path.split('/').pop()!;

  // Arrow keys move the caret line while the code has focus.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'PageDown' && e.key !== 'PageUp' && e.key !== 'Home' && e.key !== 'End') return;
    if (!e.ctrlKey && (e.key === 'Home' || e.key === 'End')) return;
    e.preventDefault();
    const page = Math.max(1, Math.floor((body.current?.clientHeight ?? 400) / 20) - 2);
    const cur = active ?? 0;
    const next = e.key === 'ArrowDown' ? cur + 1 : e.key === 'ArrowUp' ? cur - 1 : e.key === 'PageDown' ? cur + page : e.key === 'PageUp' ? cur - page : e.key === 'Home' ? 1 : lines.length;
    setActive(Math.max(1, Math.min(lines.length, next)));
  };

  const renderLine = (l: string, i: number) => {
    const lead = /^[ \t]*/.exec(l)![0];
    const width = lead.replace(/\t/g, ' '.repeat(unit)).length;
    const levels = l.trim() ? Math.floor(width / unit) : 0;
    const lineToks = toks[i] ?? [{ k: 'plain' as const, t: l }];
    // Leading whitespace is drawn as indent guides; the tokens carry the rest.
    let skip = lead.length;
    const parts: ReactNode[] = [];
    lineToks.forEach((tk, n) => {
      let text = tk.t;
      if (skip > 0) {
        const cut = Math.min(skip, text.length);
        text = text.slice(cut);
        skip -= cut;
      }
      if (!text) return;
      parts.push(
        <span key={n} className={`tk-${tk.k}`}>
          {highlight(text, t)}
        </span>,
      );
    });
    return (
      <>
        {levels > 0 && (
          <span className="cv-indent">
            {Array.from({ length: levels }, (_, k) => (
              <span key={k} className="cv-guide">
                {' '.repeat(unit)}
              </span>
            ))}
            {' '.repeat(Math.max(0, width - levels * unit))}
          </span>
        )}
        {levels === 0 && lead && <span>{lead.replace(/\t/g, ' '.repeat(unit))}</span>}
        {parts.length ? parts : !lead ? ' ' : null}
      </>
    );
  };

  return (
    <div className={`file-panel cv fade-in ${mode === 'code' && !file.binary && !viewer ? 'is-code' : ''} ${viewer || (svg && mode === 'preview') ? 'is-viewer' : ''}`}>
      <div className="cv-tabs">
        <span className="cv-tab" title={file.path}>
          <span className={`cv-dot lang-${lang.key}`} aria-hidden />
          {name}
        </span>
        {md && !viewer && (
          <div className="segmented cv-mode">
            <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>
              Preview
            </button>
            <button className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>
              Code
            </button>
          </div>
        )}
        <span className="spacer" />
        {mode === 'code' && !file.binary && !viewer && (
          <button className={`cv-tool ${wrap ? 'on' : ''}`} onClick={() => setWrap((w) => !w)} title="Soft-wrap long lines">
            ↩ Wrap
          </button>
        )}
        <div className="cv-actions">{toolbar}</div>
      </div>
      {viewer ? (
        <BinaryView repoId={source!.repoId} gitRef={source!.ref} path={file.path} />
      ) : file.binary ? (
        <div className="empty">This is a binary file and cannot be displayed.</div>
      ) : mode === 'preview' && svg ? (
        <ImageStage src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`} size={new Blob([file.content]).size} name={file.path} />
      ) : mode === 'preview' ? (
        <div className="file-panel-md cv-scroll">
          <Markdown source={file.content} onLink={onLink} />
        </div>
      ) : (
        <div className="cv-frame">
          <div
            className={`code-lines cv-scroll ${wrap ? 'wrap' : ''} ${bl ? 'blamed' : ''}`}
            ref={body}
            tabIndex={0}
            onKeyDown={onKey}
            onMouseMove={bl ? onMove : undefined}
            onMouseLeave={() => {
              window.clearTimeout(hoverTimer.current);
              setHover(null);
            }}
            onScroll={() => hover && setHover(null)}
          >
            <table>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} data-ln={i + 1} className={active === i + 1 ? 'active' : t && hits.includes(i + 1) ? 'hit' : undefined} onClick={() => setActive(i + 1)}>
                    <td
                      className="ln"
                      style={bl && commitAt(i + 1) ? { ['--bl' as string]: authorColor(commitAt(i + 1)!.c.email || commitAt(i + 1)!.c.author) } : undefined}
                      data-b={bl && commitAt(i + 1) ? '' : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActive(active === i + 1 ? null : i + 1);
                      }}
                    >
                      {i + 1}
                    </td>
                    <td className="lc">
                      {renderLine(l, i)}
                      {lens && active === i + 1 && (
                        <span className="cv-lens" aria-hidden>
                          {lens.c.author}, {lens.c.date ? whenText(lens.c.date).split(' · ')[0] : ''} · {lens.c.summary}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Marker stripe: search hits and the caret line, like an IDE's scrollbar marks. */}
          <div className="cv-stripe" aria-hidden>
            {hits.slice(0, 400).map((n) => (
              <i key={n} className="hit" style={{ top: `${((n - 1) / Math.max(1, lines.length)) * 100}%` }} onClick={() => setActive(n)} />
            ))}
            {active && <i className="caret" style={{ top: `${((active - 1) / Math.max(1, lines.length)) * 100}%` }} />}
          </div>
        </div>
      )}
      {hover &&
        hv &&
        createPortal(
          <div ref={card} className="bl-card" role="tooltip" style={{ ['--bl' as string]: authorColor(hv.c.email || hv.c.author) }}>
            <div className="bl-card-head">
              <span className="bl-avatar">{initials(hv.c.author)}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bl-author">
                  <span className="ellipsis">{hv.c.author}</span>
                </div>
                <div className="bl-when" title={hv.c.date ? new Date(hv.c.date).toLocaleString() : ''}>
                  {hv.c.date ? whenText(hv.c.date) : 'date unknown'}
                </div>
              </div>
            </div>
            <div className="bl-summary">{hv.c.summary || '(no message)'}</div>
            <div className="bl-foot">
              <span className="mono">{hv.hash.slice(0, 7)}</span>
              <span>
                {hvCount} line{hvCount === 1 ? '' : 's'} in this file
              </span>
            </div>
          </div>,
          document.body,
        )}
      <div className="cv-status">
        {mode === 'code' && !file.binary && !viewer && <span>{active ? `Ln ${active}` : `${lines.length} lines`}</span>}
        {bl && mode === 'code' && <span className="cv-blame-on" title="Hover a line to see who changed it and when">👤 {Object.keys(bl.commits).length} commit{Object.keys(bl.commits).length === 1 ? '' : 's'} · {new Set(Object.values(bl.commits).map((c) => c.email || c.author)).size} author{new Set(Object.values(bl.commits).map((c) => c.email || c.author)).size === 1 ? '' : 's'}</span>}
        {t && <span className="cv-found">{hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'no matches'}</span>}
        <span className="spacer" />
        {!file.binary && !viewer && (
          <>
            <span>{formatBytes(new Blob([file.content]).size)}</span>
            <span>{crlf ? 'CRLF' : 'LF'}</span>
            <span>UTF-8</span>
            <span>{lines.some((x) => x.startsWith('\t')) ? 'Tab' : `${unit} spaces`}</span>
          </>
        )}
        <span className="cv-lang">{viewer ? (/\.pdf$/i.test(file.path) ? 'PDF' : /\.(png|jpe?g|gif|webp|bmp|ico|avif|heic|heif|tiff?|icns)$/i.test(file.path) ? 'Image' : 'Binary') : file.binary ? 'Binary' : lang.name}</span>
        {file.truncated && <span className="cv-warn">first 1 MB shown</span>}
      </div>
    </div>
  );
}

/** Plain-text editor with a line-number gutter, Tab indentation and Ctrl+S to save. */
export function CodeEditor({ value, onChange, onSave }: { value: string; onChange: (v: string) => void; onSave: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const count = value.split('\n').length;

  useEffect(() => {
    area.current?.focus();
    area.current?.setSelectionRange(0, 0);
  }, []);

  return (
    <div className="editor">
      <div className="editor-gutter" ref={gutter} aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={area}
        className="editor-area"
        value={value}
        spellCheck={false}
        wrap="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            onSave();
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: s, selectionEnd: end } = el;
            const next = `${value.slice(0, s)}  ${value.slice(end)}`;
            onChange(next);
            requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
          }
        }}
      />
    </div>
  );
}
