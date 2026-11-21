import type { ProviderId } from '../../shared/providers';
import { AppError } from '../git/errors';

export interface ConnectInput {
  provider: ProviderId;
  host: string;
  token: string;
  username?: string;
  /** Bitbucket: the Atlassian account email the API token belongs to. */
  email?: string;
  org?: string;
}

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

/** A bare host name (optionally with a port): no scheme, path, user info or spaces. */
export function asHost(v: string): string {
  const h = v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (!HOST.test(h) || h.length > 253) throw new AppError({ code: 'invalid-host', title: 'Invalid Server Address', message: `"${v}" is not a server address. Use something like gitlab.example.com.` });
  return h;
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'GitBaba', ...headers }, redirect: 'manual', signal: ctl.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null; // HTML sign-in pages and the like: not an API answer
    }
    return { status: res.status, body };
  } catch (err) {
    throw new AppError({
      code: 'connection-unreachable',
      title: 'Server Not Reachable',
      message: `Could not reach ${new URL(url).host}. Check the address and your network.`,
      technical: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(t);
  }
}

const refused = (host: string, what: string) =>
  new AppError({ code: 'connection-refused', title: 'Sign-in Refused', message: `${host} did not accept this ${what}. Check that it is correct, not expired, and has the scopes listed.` });

/**
 * Checks a token against the provider (only the host the user typed) and returns who it belongs to.
 * Nothing is stored here.
 */
export async function verifyConnection(i: ConnectInput): Promise<{ username: string; displayName: string | null }> {
  const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
  switch (i.provider) {
    case 'gitlab': {
      const r = await getJson(`https://${i.host}/api/v4/user`, { 'PRIVATE-TOKEN': i.token });
      const b = r.body as { username?: string; name?: string } | null;
      if (r.status !== 200 || !b?.username) throw refused(i.host, 'personal access token');
      return { username: b.username, displayName: b.name ?? null };
    }
    case 'gitea': {
      const r = await getJson(`https://${i.host}/api/v1/user`, { Authorization: `token ${i.token}` });
      const b = r.body as { login?: string; full_name?: string } | null;
      if (r.status !== 200 || !b?.login) throw refused(i.host, 'access token');
      return { username: b.login, displayName: b.full_name || null };
    }
    case 'bitbucket': {
      if (!i.username) throw new AppError({ code: 'connection-input', title: 'Username Needed', message: 'Enter your Bitbucket username (Git uses it with the token).' });
      // API tokens are checked with the Atlassian account email; Git itself uses the Bitbucket username.
      const r = await getJson('https://api.bitbucket.org/2.0/user', { Authorization: basic(i.email || i.username, i.token) });
      const b = r.body as { username?: string; display_name?: string } | null;
      if (r.status !== 200 || !b) throw refused('Bitbucket', 'username and API token');
      return { username: b.username ?? i.username, displayName: b.display_name ?? null };
    }
    case 'azure': {
      if (!i.org) throw new AppError({ code: 'connection-input', title: 'Organization Needed', message: 'Enter the Azure DevOps organization the token belongs to (the part after dev.azure.com/).' });
      const r = await getJson(`https://dev.azure.com/${encodeURIComponent(i.org)}/_apis/connectionData`, { Authorization: basic('', i.token) });
      const u = (r.body as { authenticatedUser?: { providerDisplayName?: string; properties?: { Account?: { $value?: string } } } } | null)?.authenticatedUser;
      if (r.status !== 200 || !u || !u.providerDisplayName || /anonymous/i.test(u.providerDisplayName)) throw refused(`Azure DevOps (${i.org})`, 'personal access token');
      return { username: u.properties?.Account?.$value ?? u.providerDisplayName, displayName: u.providerDisplayName };
    }
    default:
      throw new AppError({ code: 'connection-unsupported', title: 'No Sign-in For This Provider', message: 'This provider signs in through SSH or your system Git setup; there is nothing to connect.' });
  }
}

/** A repository the connection can see, with the address Git clones it from (HTTPS). */
export interface ProviderRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  description: string | null;
  updatedAt: string | null;
  cloneUrl: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

/**
 * Repositories a provider connection can see (newest activity first, at most 100). Only the connection's own host
 * is asked. Providers without a repository API (CodeCommit, plain Git servers) are not listed: paste a URL there.
 */
export async function listConnectionRepos(c: { provider: ProviderId; host: string; org: string | null; gitUsername: string }, token: string): Promise<ProviderRepo[]> {
  const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
  const need = (r: { status: number; body: unknown }, who: string) => {
    if (r.status !== 200 || !r.body) throw refused(who, 'token (it may lack read access to repositories)');
    return r.body as J;
  };
  const split = (full: string) => ({ owner: full.slice(0, full.lastIndexOf('/')), name: full.slice(full.lastIndexOf('/') + 1) });
  switch (c.provider) {
    case 'gitlab': {
      const b = need(await getJson(`https://${c.host}/api/v4/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at`, { 'PRIVATE-TOKEN': token }), c.host);
      return (Array.isArray(b) ? b : []).map((p: J) => ({
        fullName: p.path_with_namespace,
        ...split(String(p.path_with_namespace)),
        private: p.visibility !== 'public',
        fork: !!p.forked_from_project,
        archived: !!p.archived,
        description: p.description || null,
        updatedAt: p.last_activity_at ?? null,
        cloneUrl: p.http_url_to_repo,
      }));
    }
    case 'gitea': {
      const b = need(await getJson(`https://${c.host}/api/v1/user/repos?limit=100`, { Authorization: `token ${token}` }), c.host);
      return (Array.isArray(b) ? b : []).map((p: J) => ({
        fullName: p.full_name,
        ...split(String(p.full_name)),
        private: !!p.private,
        fork: !!p.fork,
        archived: !!p.archived,
        description: p.description || null,
        updatedAt: p.updated_at ?? null,
        cloneUrl: p.clone_url,
      }));
    }
    case 'bitbucket': {
      const b = need(await getJson('https://api.bitbucket.org/2.0/repositories?role=member&pagelen=100&sort=-updated_on', { Authorization: basic(c.gitUsername, token) }), 'Bitbucket');
      return ((b?.values as J[]) ?? []).map((p: J) => ({
        fullName: p.full_name,
        ...split(String(p.full_name)),
        private: !!p.is_private,
        fork: !!p.parent,
        archived: false,
        description: p.description || null,
        updatedAt: p.updated_on ?? null,
        cloneUrl: ((p.links?.clone as J[]) ?? []).find((l: J) => l.name === 'https')?.href?.replace(/^https:\/\/[^@/]+@/, 'https://') ?? `https://bitbucket.org/${p.full_name}.git`,
      }));
    }
    case 'azure': {
      if (!c.org) return [];
      const b = need(await getJson(`https://dev.azure.com/${encodeURIComponent(c.org)}/_apis/git/repositories?api-version=7.0`, { Authorization: basic('', token) }), `Azure DevOps (${c.org})`);
      return ((b?.value as J[]) ?? []).map((p: J) => ({
        fullName: `${c.org}/${p.project?.name}/${p.name}`,
        owner: `${c.org}/${p.project?.name}`,
        name: p.name,
        private: p.project?.visibility !== 'public',
        fork: !!p.isFork,
        archived: !!p.isDisabled,
        description: null,
        updatedAt: p.project?.lastUpdateTime ?? null,
        cloneUrl: String(p.remoteUrl ?? '').replace(/^https:\/\/[^@/]+@/, 'https://'),
      }));
    }
    default:
      return [];
  }
}
