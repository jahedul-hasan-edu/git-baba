import { useEffect, useMemo, useState } from 'react';
import type { AccountRepo } from '../../../shared/github';
import type { FriendlyError } from '../../../shared/types';
import { ErrorPanel } from '../../components/ErrorPanel';
import { relTime, Skeleton } from '../../components/github/common';
import { openExternal } from '../../components/github/SecureActionDialog';
import { CloneDialog } from '../../dialogs/CloneDialog';
import { call, toFriendly } from '../../services/api';
import { useApp } from '../../state/AppState';

type Sort = 'pushed' | 'size' | 'commits' | 'stars' | 'name';
type Scope = 'all' | 'local' | 'private' | 'public' | 'archived';

export function formatSize(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / 1024 / 1024).toFixed(2)} GB`;
}

const SCOPES: [Scope, string][] = [
  ['all', 'All'],
  ['local', 'In the app'],
  ['private', 'Private'],
  ['public', 'Public'],
  ['archived', 'Archived'],
];
const SORTS: [Sort, string][] = [
  ['pushed', 'Recent'],
  ['size', 'Size'],
  ['commits', 'Commits'],
  ['stars', 'Stars'],
  ['name', 'A–Z'],
];

/**
 * The account's GitHub repositories as compact cards. A card opens the repository in the app when it is already
 * here, otherwise clones it (this account preselected); ↗ opens it on GitHub.
 */
export function AccountRepos() {
  const { repos: local, selectRepo, setAccountsOpen, bump } = useApp();
  const [list, setList] = useState<AccountRepo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('pushed');
  const [scope, setScope] = useState<Scope>('all');
  const [cloning, setCloning] = useState<string | null>(null);

  const load = async (after: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const r = await call('gh:acctRepos', { after });
      setList((cur) => (after ? [...cur, ...r.repos] : r.repos));
      setCursor(r.endCursor);
      setHasMore(r.hasNextPage);
      setTotal(r.total);
    } catch (err) {
      setError(toFriendly(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(null);
  }, []);

  // owner/name (lower case) → the repository's id in the app.
  const inApp = useMemo(() => new Map(local.filter((r) => r.github && !r.worktreeOf).map((r) => [`${r.github!.owner}/${r.github!.repo}`.toLowerCase(), r.id])), [local]);
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    const f = list.filter((r) => {
      if (query && !`${r.fullName} ${r.description ?? ''} ${r.language ?? ''}`.toLowerCase().includes(query)) return false;
      if (scope === 'private') return r.isPrivate;
      if (scope === 'public') return !r.isPrivate;
      if (scope === 'archived') return r.isArchived;
      if (scope === 'local') return inApp.has(r.fullName.toLowerCase());
      return true;
    });
    const num = (v: number | null) => v ?? -1;
    return [...f].sort((a, b) =>
      sort === 'size' ? b.sizeKb - a.sizeKb : sort === 'commits' ? num(b.commits) - num(a.commits) : sort === 'stars' ? b.stars - a.stars : sort === 'name' ? a.fullName.localeCompare(b.fullName) : (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''),
    );
  }, [list, q, sort, scope, inApp]);
  const totalSize = useMemo(() => list.reduce((s, r) => s + r.sizeKb, 0), [list]);

  const open = (r: AccountRepo) => {
    const id = inApp.get(r.fullName.toLowerCase());
    if (id) {
      setAccountsOpen(false);
      selectRepo(id);
    } else setCloning(`${r.url}.git`);
  };

  return (
    <div className="arx">
      <div className="arx-bar">
        <div className="arx-search">
          <span aria-hidden>⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find in ${total} repositories…`} spellCheck={false} />
          <span className="arx-sum" title={hasMore ? `${list.length} of ${total} loaded` : undefined}>
            {formatSize(totalSize)}
          </span>
        </div>
        <div className="arx-pills" role="radiogroup" aria-label="Show">
          {SCOPES.map(([v, label]) => (
            <button key={v} className={scope === v ? 'on' : ''} onClick={() => setScope(v)} aria-pressed={scope === v}>
              {label}
            </button>
          ))}
        </div>
        <div className="arx-pills sort" role="radiogroup" aria-label="Sort">
          {SORTS.map(([v, label]) => (
            <button key={v} className={sort === v ? 'on' : ''} onClick={() => setSort(v)} aria-pressed={sort === v}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorPanel error={error} />}
      {loading && list.length === 0 && <Skeleton kind="cards" rows={6} label="Loading repositories" />}
      {!loading && !error && shown.length === 0 && <div className="empty">No repository matches.</div>}

      <div className="arx-grid">
        {shown.map((r) => {
          const here = inApp.has(r.fullName.toLowerCase());
          return (
            <div key={r.fullName} className={`arx-card ${r.isArchived ? 'archived' : ''} ${here ? 'here' : ''}`} onClick={() => open(r)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(r)} title={here ? 'Open in Git Baba' : 'Clone into Git Baba'}>
              <div className="arx-top">
                <span className="arx-name ellipsis">
                  <span className="muted">{r.owner}/</span>
                  <strong>{r.name}</strong>
                </span>
                {r.isPrivate && (
                  <span className="arx-lock" title="Private">
                    🔒
                  </span>
                )}
                {r.isFork && <span className="arx-tag">fork</span>}
                {r.isArchived && <span className="arx-tag">archived</span>}
                <button
                  className="arx-ext"
                  onClick={(e) => {
                    e.stopPropagation();
                    openExternal(r.url);
                  }}
                  title="Open on GitHub"
                  aria-label="Open on GitHub"
                >
                  ↗
                </button>
              </div>
              {r.description && <div className="arx-desc ellipsis">{r.description}</div>}
              <div className="arx-meta">
                {r.language && (
                  <span>
                    <i className="lang-dot" style={{ background: r.languageColor ?? 'var(--text-3)' }} />
                    {r.language}
                  </span>
                )}
                <span title="Size">{formatSize(r.sizeKb)}</span>
                {r.commits !== null && <span title="Commits on the default branch">◉ {r.commits.toLocaleString()}</span>}
                {r.stars > 0 && <span title="Stars">★ {r.stars}</span>}
                <span className="grow" />
                <span title={r.pushedAt ? new Date(r.pushedAt).toLocaleString() : undefined}>{r.pushedAt ? relTime(r.pushedAt) : '—'}</span>
              </div>
              <span className={`arx-act ${here ? 'open' : ''}`}>{here ? 'Open ›' : '⤓ Clone'}</span>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <button className="arx-more" disabled={loading} onClick={() => void load(cursor)}>
          {loading ? 'Loading…' : `Show ${Math.min(30, total - list.length)} more`}
        </button>
      )}
      {cloning && (
        <CloneDialog
          from="url"
          initialRepository={cloning}
          onClose={() => setCloning(null)}
          onCloned={(repo) => {
            setCloning(null);
            bump();
            setAccountsOpen(false);
            selectRepo(repo.id);
          }}
        />
      )}
    </div>
  );
}
