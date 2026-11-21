/**
 * The Git hosting providers Git Baba works with, what it can do for each, and how a repository's provider is
 * recognised from its remote URL. Plain Git (clone, fetch, pull, push, branches, history…) works with every
 * provider; the rest is listed honestly per provider: done in the app, opened on the provider's website, or
 * not offered at all.
 */

export type ProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'codecommit' | 'gitea' | 'git';

/** How a feature is available for a provider: inside the app, on the provider's website, or not at all. */
export type Support = 'app' | 'web' | null;

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Short monogram for the provider tile. */
  mono: string;
  color: string;
  /** One line about the provider. */
  blurb: string;
  /** Default cloud host (null: always self-hosted / any server). */
  host: string | null;
  /** Can be self-hosted on your own domain. */
  selfHosted: boolean;
  features: {
    /** Clone, fetch, pull, push, branches, merge, worktrees, history, code. */
    git: Support;
    /** Sign in once (an account / connection kept by the app). */
    signIn: Support;
    pullRequests: Support;
    pipelines: Support;
    /** Releases, environments, notifications and repository insights. */
    insights: Support;
  };
  /** Tab names for this provider (null: the tab is not shown). */
  tabs: { pulls: string | null; pipelines: string | null };
  /** How a connection is made in the app (null: none — e.g. AWS CLI or SSH). */
  connect: null | {
    tokenName: string;
    tokenHelp: string;
    /** Where to create the token (for the cloud host). */
    tokenUrl: string | null;
    needsUsername: boolean;
    needsOrg: boolean;
    /** Username Git uses with the token over HTTPS (null: the account's username). */
    gitUsername: string | null;
  };
  /** How push / fetch sign in when there is no connection. */
  gitAuthHint: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'github',
    name: 'GitHub',
    mono: 'GH',
    color: '#8b949e',
    blurb: 'Everything: pull requests, Actions, releases, notifications and accounts in the app.',
    host: 'github.com',
    selfHosted: true,
    features: { git: 'app', signIn: 'app', pullRequests: 'app', pipelines: 'app', insights: 'app' },
    tabs: { pulls: 'Pull Requests', pipelines: 'Actions' },
    connect: null,
    gitAuthHint: 'GitHub account, personal access token, GitHub App or SSH',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    mono: 'GL',
    color: '#e2432a',
    blurb: 'Git and sign-in in the app; merge requests and pipelines open on GitLab, ready to go.',
    host: 'gitlab.com',
    selfHosted: true,
    features: { git: 'app', signIn: 'app', pullRequests: 'web', pipelines: 'web', insights: null },
    tabs: { pulls: 'Merge Requests', pipelines: 'Pipelines' },
    connect: {
      tokenName: 'Personal access token',
      tokenHelp: 'Scopes: read_user and write_repository (read_api to list projects).',
      tokenUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
      needsUsername: false,
      needsOrg: false,
      gitUsername: 'oauth2',
    },
    gitAuthHint: 'GitLab connection, access token or SSH',
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    mono: 'BB',
    color: '#2684ff',
    blurb: 'Git and sign-in in the app; pull requests and Pipelines open on Bitbucket.',
    host: 'bitbucket.org',
    selfHosted: false,
    features: { git: 'app', signIn: 'app', pullRequests: 'web', pipelines: 'web', insights: null },
    tabs: { pulls: 'Pull Requests', pipelines: 'Pipelines' },
    connect: {
      tokenName: 'API token',
      tokenHelp: 'Create an API token with repository read/write scopes. Use your Bitbucket username.',
      tokenUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
      needsUsername: true,
      needsOrg: false,
      gitUsername: null,
    },
    gitAuthHint: 'Bitbucket connection, API token or SSH',
  },
  {
    id: 'azure',
    name: 'Azure DevOps',
    mono: 'AZ',
    color: '#0a78d4',
    blurb: 'Git and sign-in in the app; pull requests and pipelines open in Azure DevOps.',
    host: 'dev.azure.com',
    selfHosted: false,
    features: { git: 'app', signIn: 'app', pullRequests: 'web', pipelines: 'web', insights: null },
    tabs: { pulls: 'Pull Requests', pipelines: 'Pipelines' },
    connect: {
      tokenName: 'Personal access token',
      tokenHelp: 'Scope: Code (Read & write). The token belongs to one organization.',
      tokenUrl: null,
      needsUsername: false,
      needsOrg: true,
      gitUsername: 'pat',
    },
    gitAuthHint: 'Azure DevOps connection, personal access token or SSH',
  },
  {
    id: 'codecommit',
    name: 'AWS CodeCommit',
    mono: 'CC',
    color: '#ed7100',
    blurb: 'Git in the app with your AWS CLI sign-in; pull requests open in the AWS console.',
    host: null,
    selfHosted: false,
    features: { git: 'app', signIn: null, pullRequests: 'web', pipelines: null, insights: null },
    tabs: { pulls: 'Pull Requests', pipelines: null },
    connect: null,
    gitAuthHint: 'Your AWS CLI credential helper (choose "Git identity only") or SSH',
  },
  {
    id: 'gitea',
    name: 'Gitea / Forgejo',
    mono: 'GT',
    color: '#609926',
    blurb: 'Self-hosted or Codeberg: Git and sign-in in the app; pull requests and Actions open on the server.',
    host: 'codeberg.org',
    selfHosted: true,
    features: { git: 'app', signIn: 'app', pullRequests: 'web', pipelines: 'web', insights: null },
    tabs: { pulls: 'Pull Requests', pipelines: 'Actions' },
    connect: {
      tokenName: 'Access token',
      tokenHelp: 'Settings → Applications → Generate token (repository read/write, user read).',
      tokenUrl: null,
      needsUsername: false,
      needsOrg: false,
      gitUsername: null,
    },
    gitAuthHint: 'Gitea connection, access token or SSH',
  },
  {
    id: 'git',
    name: 'Any Git server',
    mono: '⎇',
    color: '#8a5bff',
    blurb: 'Self-hosted or bare Git over SSH / HTTPS: everything Git does, right in the app.',
    host: null,
    selfHosted: true,
    features: { git: 'app', signIn: null, pullRequests: null, pipelines: null, insights: null },
    tabs: { pulls: null, pipelines: null },
    connect: null,
    gitAuthHint: 'SSH key, username + password/token, or your system Git sign-in',
  },
];

export const providerInfo = (id: ProviderId): ProviderInfo => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];

/** The provider a repository's remote points to, with what is needed to build links. */
export interface RepoProvider {
  id: ProviderId;
  host: string;
  /** Path on the provider (e.g. group/subgroup/repo, workspace/repo, org/project/repo). */
  path: string;
  /** Repository home page (null when the server has no known web UI). */
  web: string | null;
  /** Azure DevOps organization / project; CodeCommit region. */
  org?: string;
  project?: string;
  region?: string;
}

interface RawRemote {
  host: string;
  path: string;
  scheme: string;
}

function splitRemote(url: string): RawRemote | null {
  const u = url.trim();
  const grc = /^codecommit::([a-z0-9-]+):\/\/(?:[^@/]+@)?([A-Za-z0-9._-]+)$/i.exec(u);
  if (grc) return { host: `git-codecommit.${grc[1].toLowerCase()}.amazonaws.com`, path: `v1/repos/${grc[2]}`, scheme: 'codecommit' };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    try {
      const p = new URL(u);
      const scheme = p.protocol.replace(':', '').toLowerCase();
      if (scheme === 'file') return null;
      return { host: p.hostname.toLowerCase(), path: decodeURIComponent(p.pathname), scheme };
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(u) || u.startsWith('/') || u.startsWith('\\\\') || u.startsWith('.')) return null;
  const scp = /^(?:[^@]+@)?([A-Za-z0-9.-]+):(?!\/\/)(.+)$/.exec(u);
  if (scp) return { host: scp[1].toLowerCase(), path: scp[2], scheme: 'ssh' };
  return null;
}

const clean = (p: string) => p.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');

/** Which provider a host belongs to (known self-hosted hosts first). */
export function providerForHost(host: string, known: Record<string, ProviderId> = {}, githubHosts: string[] = ['github.com']): ProviderId {
  const h = host.toLowerCase();
  if (known[h]) return known[h];
  if (githubHosts.includes(h) || h === 'github.com' || h === 'ssh.github.com') return 'github';
  if (h === 'gitlab.com' || h === 'altssh.gitlab.com' || /(^|\.)gitlab\./.test(h)) return 'gitlab';
  if (h === 'bitbucket.org' || h === 'altssh.bitbucket.org') return 'bitbucket';
  if (h === 'dev.azure.com' || h === 'ssh.dev.azure.com' || h.endsWith('.visualstudio.com') || h === 'vs-ssh.visualstudio.com') return 'azure';
  if (/^git-codecommit(-fips)?\.[a-z0-9-]+\.amazonaws\.com$/.test(h)) return 'codecommit';
  if (h === 'codeberg.org' || /(^|\.)(gitea|forgejo)\./.test(h)) return 'gitea';
  return 'git';
}

/**
 * Recognises the provider of a remote URL (https, ssh, scp-like or codecommit::). `resolvedHost` is the real
 * host when an SSH alias from ~/.ssh/config was used. Local paths and file:// remotes have no provider.
 */
export function detectProvider(url: string, opts: { resolvedHost?: string | null; known?: Record<string, ProviderId>; githubHosts?: string[] } = {}): RepoProvider | null {
  const raw = splitRemote(url);
  if (!raw) return null;
  const host = (opts.resolvedHost ?? raw.host).toLowerCase();
  const id = providerForHost(host, opts.known, opts.githubHosts);
  const path = clean(raw.path);
  const webHost = host.replace(/^(ssh|altssh)\./, '');
  switch (id) {
    case 'azure': {
      // https://dev.azure.com/org/project/_git/repo · https://org.visualstudio.com/[DefaultCollection/]project/_git/repo
      // git@ssh.dev.azure.com:v3/org/project/repo
      let org = '';
      let project = '';
      let repo = '';
      const parts = path.split('/').filter(Boolean);
      if (host === 'ssh.dev.azure.com' || host === 'vs-ssh.visualstudio.com') {
        const i = parts[0] === 'v3' ? 1 : 0;
        [org, project, repo] = [parts[i], parts[i + 1], parts[i + 2]];
      } else if (host.endsWith('.visualstudio.com')) {
        org = host.split('.')[0];
        const g = parts.indexOf('_git');
        project = parts[g - 1];
        repo = parts[g + 1];
      } else {
        const g = parts.indexOf('_git');
        org = parts[0];
        project = g > 1 ? parts[g - 1] : parts[1];
        repo = parts[g + 1] ?? parts[2];
      }
      if (!org || !project || !repo) return { id, host, path, web: null };
      const enc = (s: string) => encodeURIComponent(s);
      return { id, host, path: `${org}/${project}/${repo}`, org, project, web: `https://dev.azure.com/${enc(org)}/${enc(project)}/_git/${enc(repo)}` };
    }
    case 'codecommit': {
      const region = /^git-codecommit(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com$/.exec(host)?.[1] ?? '';
      const name = path.replace(/^v1\/repos\//, '');
      return { id, host, path: name, region, web: region ? `https://${region}.console.aws.amazon.com/codesuite/codecommit/repositories/${encodeURIComponent(name)}/browse?region=${region}` : null };
    }
    case 'git':
      return { id, host, path, web: null };
    default:
      return { id, host: webHost, path, web: path ? `https://${webHost}/${path}` : null };
  }
}

/** Links to the provider's website for one repository (null: not available there). */
export function providerLinks(p: RepoProvider) {
  const w = p.web;
  const e = encodeURIComponent;
  const none = { home: w, branch: (_b: string) => null as string | null, commit: (_s: string) => null as string | null, pulls: null as string | null, newPull: (_head: string, _base: string) => null as string | null, pipelines: null as string | null };
  if (!w) return none;
  switch (p.id) {
    case 'github':
      return { home: w, branch: (b: string) => `${w}/tree/${b}`, commit: (s: string) => `${w}/commit/${s}`, pulls: `${w}/pulls`, newPull: (h: string, b: string) => `${w}/compare/${b}...${h}?expand=1`, pipelines: `${w}/actions` };
    case 'gitlab':
      return {
        home: w,
        branch: (b: string) => `${w}/-/tree/${b}`,
        commit: (s: string) => `${w}/-/commit/${s}`,
        pulls: `${w}/-/merge_requests`,
        newPull: (h: string, b: string) => `${w}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${e(h)}&merge_request%5Btarget_branch%5D=${e(b)}`,
        pipelines: `${w}/-/pipelines`,
      };
    case 'bitbucket':
      return { home: w, branch: (b: string) => `${w}/src/${e(b)}`, commit: (s: string) => `${w}/commits/${s}`, pulls: `${w}/pull-requests`, newPull: (h: string, b: string) => `${w}/pull-requests/new?source=${e(h)}&dest=${e(b)}`, pipelines: `${w}/pipelines` };
    case 'azure':
      return {
        home: w,
        branch: (b: string) => `${w}?version=GB${e(b)}`,
        commit: (s: string) => `${w}/commit/${s}`,
        pulls: `${w}/pullrequests`,
        newPull: (h: string, b: string) => `${w}/pullrequestcreate?sourceRef=${e(h)}&targetRef=${e(b)}`,
        pipelines: p.org && p.project ? `https://dev.azure.com/${e(p.org)}/${e(p.project)}/_build` : null,
      };
    case 'codecommit': {
      const base = `https://${p.region}.console.aws.amazon.com/codesuite/codecommit/repositories/${e(p.path)}`;
      return { home: w, branch: (b: string) => `${base}/browse/refs/heads/${e(b)}?region=${p.region}`, commit: (s: string) => `${base}/commit/${s}?region=${p.region}`, pulls: `${base}/pull-requests?region=${p.region}`, newPull: () => `${base}/pull-requests/new?region=${p.region}`, pipelines: null };
    }
    case 'gitea':
      return { home: w, branch: (b: string) => `${w}/src/branch/${b}`, commit: (s: string) => `${w}/commit/${s}`, pulls: `${w}/pulls`, newPull: (h: string, b: string) => `${w}/compare/${b}...${h}`, pipelines: `${w}/actions` };
    default:
      return none;
  }
}
