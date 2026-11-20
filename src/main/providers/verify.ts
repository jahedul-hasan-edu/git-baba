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
