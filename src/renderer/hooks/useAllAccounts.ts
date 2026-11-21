import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountSummary, ProviderConnection, RepoSummary } from '../../shared/types';
import type { ProviderId } from '../../shared/providers';
import { accountStatus, type AccountTone } from '../components/AccountSwitcher';
import { call } from '../services/api';
import { useApp } from '../state/AppState';

/** Fired after a provider connection was added or removed. */
export const CONNECTIONS_CHANGED = 'gb:connections-changed';
export const announceConnections = () => window.dispatchEvent(new Event(CONNECTIONS_CHANGED));

/** One account the app knows, whatever the provider: a GitHub account or a provider connection. */
export interface AnyAccount {
  /** Unique across kinds: `gh:<id>` or `conn:<id>`. */
  key: string;
  kind: 'github' | 'connection';
  provider: ProviderId;
  /** Account id (GitHub) or connection id. */
  id: string;
  login: string;
  name: string | null;
  host: string;
  org: string | null;
  /** Repositories in the sidebar that belong to it. */
  repos: number;
  /** The account in use right now (the open repository's). GitHub accounts only. */
  inUse: boolean;
  status: { tone: AccountTone; label: string; title: string };
  github?: AccountSummary;
  connection?: ProviderConnection;
}

export function githubHost(a: Pick<AccountSummary, 'apiBaseUrl'>): string {
  if (!a.apiBaseUrl) return 'github.com';
  try {
    const h = new URL(a.apiBaseUrl).hostname.toLowerCase();
    return h === 'api.github.com' ? 'github.com' : h;
  } catch {
    return 'github.com';
  }
}

/** A provider connection serves a repository when it is on the connection's server (and Azure organization). */
export function connectionServes(c: ProviderConnection, r: RepoSummary): boolean {
  const p = r.provider;
  if (!p || p.id !== c.provider) return false;
  if (c.provider === 'azure') return (p.org ?? '').toLowerCase() === (c.org ?? '').toLowerCase();
  return p.host === c.host;
}

/**
 * Every account across providers — GitHub accounts and GitLab / Bitbucket / Azure DevOps / Gitea / … connections —
 * with how many repositories each one owns. `reload` re-reads the connections (after connecting or removing one).
 */
export function useAllAccounts(): { all: AnyAccount[]; connections: ProviderConnection[]; reload: () => Promise<void>; setConnections: (c: ProviderConnection[]) => void } {
  const { accounts, repos, session } = useApp();
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const reload = useCallback(async () => {
    setConnections(await call('providers:connections').catch(() => [] as ProviderConnection[]));
  }, []);
  useEffect(() => {
    void reload();
    // A connection added or removed elsewhere (e.g. File → Accounts over a dialog) shows up here too.
    const on = () => void reload();
    window.addEventListener(CONNECTIONS_CHANGED, on);
    return () => window.removeEventListener(CONNECTIONS_CHANGED, on);
  }, [reload]);

  const all = useMemo<AnyAccount[]>(() => {
    const gh: AnyAccount[] = (accounts?.accounts ?? []).map((a) => ({
      key: `gh:${a.id}`,
      kind: 'github',
      provider: 'github',
      id: a.id,
      login: a.login,
      name: a.name,
      host: githubHost(a),
      org: null,
      repos: repos.filter((r) => r.account?.id === a.id).length,
      inUse: a.active,
      status: accountStatus(a, a.active && !!session?.active),
      github: a,
    }));
    const cn: AnyAccount[] = connections.map((c) => ({
      key: `conn:${c.id}`,
      kind: 'connection',
      provider: c.provider,
      id: c.id,
      login: c.username,
      name: c.displayName,
      host: c.host,
      org: c.org,
      repos: repos.filter((r) => connectionServes(c, r)).length,
      inUse: false,
      status: c.remembered ? { tone: 'ok', label: 'Connected', title: 'Token kept encrypted on this computer' } : { tone: 'warn', label: 'This session', title: 'No OS encryption available: kept until the app closes' },
      connection: c,
    }));
    return [...gh, ...cn];
  }, [accounts, repos, session?.active, connections]);

  return { all, connections, reload, setConnections };
}
