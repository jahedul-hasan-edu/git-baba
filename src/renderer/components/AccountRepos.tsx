import { useEffect, useMemo, useState } from 'react';
import type { RemoteRepoEntry } from '../../shared/types';
import type { AnyAccount } from '../hooks/useAllAccounts';
import { call, toFriendly } from '../services/api';
import { timeAgo } from '../services/format';
import { useApp } from '../state/AppState';

type Repo = RemoteRepoEntry & { cloneUrl: string };

/** Providers whose API lists repositories for a connection. */
export const LISTABLE = new Set(['gitlab', 'gitea', 'bitbucket', 'azure']);

/**
 * The repositories one provider connection can see, right inside its account card: filter, then Open (already in
 * the app) or Clone (opens Clone with the address and this account preselected).
 */
export function AccountRepos({ account, onClone, onOpen }: { account: AnyAccount; onClone: (url: string) => void; onOpen: (repoId: string) => void }) {
  const { repos: appRepos } = useApp();
  const [list, setList] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    setList(null);
    setError(null);
    call('providers:repos', { id: account.id })
      .then((r) => live && setList(r))
      .catch((e) => live && setError(toFriendly(e).message));
    return () => {
      live = false;
    };
  }, [account.id]);

  // Already in the app: same provider, same server, same path.
  const added = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of appRepos) if (r.provider && r.provider.id === account.provider) m.set(r.provider.path.toLowerCase(), r.id);
    return m;
  }, [appRepos, account.provider]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list ?? []).filter((r) => !t || r.fullName.toLowerCase().includes(t) || (r.description ?? '').toLowerCase().includes(t));
  }, [list, q]);

  if (error)
    return (
      <div className="acr acr-msg">
        <span>⚠ {error}</span>
        <button className="btn sm" onClick={() => onClone('')}>
          Clone by URL
        </button>
      </div>
    );
  if (!list) return <div className="acr acr-msg muted">Loading repositories…</div>;
  return (
    <div className="acr">
      <div className="acr-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${list.length} repositories…`} spellCheck={false} autoFocus />
        <button className="btn sm ghost" onClick={() => onClone('')} title="Paste any address from this server">
          🔗 URL
        </button>
      </div>
      <div className="acr-list">
        {shown.length === 0 && <div className="acr-msg muted small">{list.length ? 'No repository matches.' : 'This account sees no repositories.'}</div>}
        {shown.map((r) => {
          const have = added.get(r.fullName.toLowerCase());
          return (
            <div key={r.fullName} className="acr-row">
              <span className="grow ellipsis">
                <span className="muted">{r.owner}/</span>
                <strong>{r.name}</strong>
                {r.private && <span className="acr-tag">private</span>}
                {r.archived && <span className="acr-tag">archived</span>}
              </span>
              {r.updatedAt && <span className="small muted nowrap">{timeAgo(r.updatedAt)}</span>}
              {have ? (
                <button className="btn sm ghost" onClick={() => onOpen(have)} title="Already in the app">
                  Open ›
                </button>
              ) : (
                <button className="btn sm" onClick={() => onClone(r.cloneUrl)} disabled={!r.cloneUrl}>
                  Clone
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
