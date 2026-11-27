import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodeEntry } from '../../../shared/types';
import { call } from '../../services/api';

const ancestorsOf = (path: string) => {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
};

const sortEntries = (list: CodeEntry[]) => [...list].sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

/** File icon colour by extension, so the tree reads at a glance. */
function fileTone(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (['ts', 'tsx'].includes(ext)) return 'ts';
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'js';
  if (['json', 'yml', 'yaml', 'toml'].includes(ext)) return 'cfg';
  if (['md', 'markdown', 'mdx', 'txt'].includes(ext)) return 'doc';
  if (['css', 'scss', 'less', 'html'].includes(ext)) return 'web';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext)) return 'img';
  return 'any';
}

/**
 * Explorer tree of the repository at a branch, tag or commit: folders load as they are opened, the open file
 * is highlighted and its folders unfold, and a filter narrows the folders already loaded.
 */
export function CodeTree({
  repoId,
  viewRef,
  activePath,
  changes,
  onOpen,
  onDir,
  onHide,
}: {
  repoId: string;
  viewRef: string;
  activePath: string | null;
  changes: Map<string, string>;
  onOpen: (path: string) => void;
  onDir: (path: string) => void;
  onHide: () => void;
}) {
  const [dirs, setDirs] = useState<Record<string, CodeEntry[] | 'loading' | 'error'>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set(['']));
  const [filter, setFilter] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // A different branch or commit is a different tree.
  useEffect(() => {
    setDirs({});
    setOpen(new Set(['', ...(activePath ? ancestorsOf(activePath) : [])]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, viewRef]);

  const load = (path: string) => {
    setDirs((d) => (d[path] && d[path] !== 'error' ? d : { ...d, [path]: 'loading' }));
    call('code:tree', { repoId, ref: viewRef, path })
      .then((list) => setDirs((d) => ({ ...d, [path]: sortEntries(list) })))
      .catch(() => setDirs((d) => ({ ...d, [path]: 'error' })));
  };
  useEffect(() => {
    for (const p of open) if (!dirs[p]) load(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewRef]);

  // Opening a file elsewhere (search, links, the folder list) unfolds its folders here and scrolls to it.
  useEffect(() => {
    if (!activePath) return;
    setOpen((o) => {
      const need = ancestorsOf(activePath).filter((a) => !o.has(a));
      return need.length ? new Set([...o, ...need]) : o;
    });
    const t = window.setTimeout(() => box.current?.querySelector('.ct-row.on')?.scrollIntoView({ block: 'nearest' }), 120);
    return () => window.clearTimeout(t);
  }, [activePath]);

  const toggle = (path: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  // Folders containing uncommitted changes get a dot.
  const changedDirs = useMemo(() => {
    const s = new Set<string>();
    for (const p of changes.keys()) for (const a of ancestorsOf(p)) s.add(a);
    return s;
  }, [changes]);

  const q = filter.trim().toLowerCase();
  // With a filter: every loaded entry whose path matches, plus the folders leading to it.
  const visible = useMemo(() => {
    if (!q) return null;
    const keep = new Set<string>();
    for (const list of Object.values(dirs)) {
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        if (e.path.toLowerCase().includes(q)) {
          keep.add(e.path);
          for (const a of ancestorsOf(e.path)) keep.add(a);
        }
      }
    }
    return keep;
  }, [dirs, q]);

  const render = (path: string, depth: number): React.ReactNode => {
    const list = dirs[path];
    if (list === 'loading' || list === undefined) return <div className="ct-note" style={{ paddingLeft: 12 + depth * 14 }}>Loading…</div>;
    if (list === 'error')
      return (
        <button className="ct-note link" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => load(path)}>
          Couldn’t load · retry
        </button>
      );
    return list
      .filter((e) => !visible || visible.has(e.path))
      .map((e) => {
        const isDir = e.type === 'dir';
        const isOpen = isDir && (open.has(e.path) || (!!visible && visible.has(e.path)));
        const mark = changes.get(e.path);
        return (
          <div key={e.path} role="treeitem" aria-expanded={isDir ? isOpen : undefined}>
            <button
              className={`ct-row ${depth ? 'tn' : ''} ${activePath === e.path ? 'on' : ''} ${isDir ? 'dir' : 'file'}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={e.path}
              onClick={() => {
                if (isDir) {
                  toggle(e.path);
                  onDir(e.path);
                } else if (e.type === 'file' || e.type === 'symlink') onOpen(e.path);
              }}
            >
              {Array.from({ length: depth }, (_, i) => (
                <span key={i} className="ct-guide" style={{ left: 14 + i * 14 }} aria-hidden />
              ))}
              <span className={`ct-chev ${isDir ? (isOpen ? 'open' : '') : 'none'}`} aria-hidden>
                ▸
              </span>
              <span className={`ct-ico ${isDir ? (isOpen ? 'dir open' : 'dir') : `f-${fileTone(e.name)}`}`} aria-hidden />
              <span className="ct-name ellipsis">{e.name}</span>
              {mark && <span className={`ct-mark ${mark}`} title={mark}>{mark === 'added' ? 'U' : mark === 'deleted' ? 'D' : 'M'}</span>}
              {!mark && isDir && changedDirs.has(e.path) && <span className="ct-dot" title="Contains changes" />}
            </button>
            {isOpen && <div role="group">{render(e.path, depth + 1)}</div>}
          </div>
        );
      });
  };

  return (
    <aside className="ct" aria-label="Files">
      <div className="ct-head">
        <span className="ct-title">Explorer</span>
        <span className="spacer" />
        <button className="ct-btn" title="Collapse all folders" onClick={() => setOpen(new Set(['']))}>
          ⊟
        </button>
        <button className="ct-btn" title="Hide the explorer" onClick={onHide}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2.5" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" />
          </svg>
        </button>
      </div>
      <div className="ct-filter">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter open folders…" onKeyDown={(e) => e.key === 'Escape' && setFilter('')} />
      </div>
      <div className="ct-list" ref={box} role="tree">
        {render('', 0)}
        {visible && visible.size === 0 && <div className="ct-note">No loaded file matches “{filter.trim()}”. Open more folders to search them.</div>}
      </div>
    </aside>
  );
}
