import { useEffect, useMemo, useState } from 'react';
import type { BlameInfo, FileCommit } from '../../../shared/types';
import { loadBlame, whenText } from '../../components/DiffViewer';
import { relative } from '../../components/FileDiffList';
import { Modal } from '../../components/Modal';
import { call } from '../../services/api';
import { authorColor, initials } from '../history/graphStyle';

interface Person {
  key: string;
  name: string;
  commits: FileCommit[];
  /** Lines of the file as it is now that this person last changed. */
  lines: number;
}

/**
 * Who changed this file: everyone who ever committed to it (renames followed), how much of today's file
 * is theirs, and when they worked on it — a timeline dot per commit. Click a person for their commits.
 */
export function FilePeople({ repoId, gitRef, path, onClose }: { repoId: string; gitRef: string | null; path: string; onClose: () => void }) {
  const [history, setHistory] = useState<FileCommit[] | null>(null);
  const [blame, setBlame] = useState<BlameInfo | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void call('code:fileHistory', { repoId, ref: gitRef, path })
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory([]));
    void loadBlame(repoId, gitRef ?? 'HEAD', path).then((b) => live && setBlame(b));
    return () => {
      live = false;
    };
  }, [repoId, gitRef, path]);

  const people = useMemo<Person[]>(() => {
    const map = new Map<string, Person>();
    const keyOf = (name: string, email: string) => (email || name).toLowerCase();
    for (const c of history ?? []) {
      const k = keyOf(c.author, c.email);
      const p = map.get(k) ?? { key: k, name: c.author, commits: [], lines: 0 };
      p.commits.push(c);
      map.set(k, p);
    }
    for (const hash of blame?.lines ?? []) {
      const c = blame!.commits[hash];
      if (!c) continue;
      const k = keyOf(c.author, c.email);
      const p = map.get(k) ?? { key: k, name: c.author, commits: [], lines: 0 };
      p.lines++;
      map.set(k, p);
    }
    return [...map.values()].sort((a, b) => b.commits.length - a.commits.length || b.lines - a.lines);
  }, [history, blame]);

  const total = history?.length ?? 0;
  const lineCount = blame?.lines.length ?? 0;
  const times = (history ?? []).map((c) => Date.parse(c.date)).filter((t) => !Number.isNaN(t));
  const first = times.length ? Math.min(...times) : 0;
  const last = times.length ? Math.max(...times) : 0;
  const span = Math.max(1, last - first);
  const name = path.split('/').pop() ?? path;

  return (
    <Modal title={`People · ${name}`} size="wide" onClose={onClose}>
      {!history ? (
        <div className="fp-empty mm-shimmer">Reading the file's history…</div>
      ) : people.length === 0 ? (
        <div className="fp-empty">No commits have touched this file yet.</div>
      ) : (
        <div className="fp">
          <div className="fp-sum">
            <strong>{people.length}</strong> {people.length === 1 ? 'person' : 'people'} · <strong>{total}</strong> commit{total === 1 ? '' : 's'}
            {first > 0 && (
              <span className="muted">
                {' '}
                · {new Date(first).toLocaleDateString()} → {relative(new Date(last).toISOString())}
              </span>
            )}
          </div>

          {lineCount > 0 && (
            <div className="fp-own" title="Who last changed each line of the file as it is now">
              {people
                .filter((p) => p.lines > 0)
                .map((p) => (
                  <i key={p.key} style={{ width: `${(p.lines / lineCount) * 100}%`, background: authorColor(p.key) }} title={`${p.name} · ${p.lines} line${p.lines === 1 ? '' : 's'}`} />
                ))}
            </div>
          )}

          <div className="fp-list">
            {people.map((p) => {
              const c = authorColor(p.key);
              const isOpen = open === p.key;
              const latest = p.commits[0];
              return (
                <div key={p.key} className={`fp-person ${isOpen ? 'open' : ''}`} style={{ ['--c' as string]: c }}>
                  <button className="fp-row" onClick={() => setOpen(isOpen ? null : p.key)} aria-expanded={isOpen}>
                    <span className="fp-av">{initials(p.name)}</span>
                    <span className="fp-who">
                      <span className="fp-name ellipsis">{p.name}</span>
                      <span className="fp-meta">
                        {p.commits.length} commit{p.commits.length === 1 ? '' : 's'}
                        {lineCount > 0 && ` · ${Math.round((p.lines / lineCount) * 100)}% of lines`}
                        {latest && ` · ${relative(latest.date)}`}
                      </span>
                    </span>
                    <span className="fp-track" aria-hidden>
                      {p.commits.map((cm) => (
                        <i key={cm.hash} style={{ left: `${((Date.parse(cm.date) - first) / span) * 100}%` }} />
                      ))}
                    </span>
                    <span className="fp-chev">{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && (
                    <div className="fp-commits">
                      {p.commits.length === 0 && <div className="fp-none">Only owns lines carried over from before a rename.</div>}
                      {p.commits.slice(0, 50).map((cm) => (
                        <div key={cm.hash} className="fp-commit" title={cm.subject}>
                          <span className="mono fp-sha">{cm.hash.slice(0, 7)}</span>
                          <span className="ellipsis grow">{cm.subject}</span>
                          <span className="fp-when">{whenText(cm.date).split(' · ')[0]}</span>
                        </div>
                      ))}
                      {p.commits.length > 50 && <div className="fp-none">+{p.commits.length - 50} more</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
