import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountCredentialInput, AccountSummary, AuthInput, CloneState, DirectoryCheck, FriendlyError, RemoteRepoEntry, RepoSummary, SshKeyInput } from '../../shared/types';
import { detectProvider, providerInfo, type RepoProvider } from '../../shared/providers';
import { ProviderMono } from '../components/ProviderMono';
import { useAllAccounts } from '../hooks/useAllAccounts';
import { openAccountsHub } from '../services/accountsHub';
import { AccountCredentialFields } from '../components/AccountCredentialFields';
import { ErrorPanel } from '../components/ErrorPanel';
import { Modal } from '../components/Modal';
import { SshKeyFields } from '../components/SshKeyFields';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { call, onProgress, toFriendly } from '../services/api';
import { timeAgo } from '../services/format';
import { useApp } from '../state/AppState';
import { ConfirmDialog } from './ConfirmDialog';

import { Select } from '../components/Select';
import { Hourglass } from '../components/Hourglass';
type Source = 'github' | 'enterprise' | 'url';
type Protocol = 'https' | 'pat' | 'ssh';
type HttpsAuth = 'account' | 'system' | 'connection';

interface Target {
  host: string;
  /** "owner" or "group/subgroup" — everything before the repository name. */
  owner: string;
  repo: string;
}

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** A repository folder on this computer or a network share: C:\…, /…, \\server\…, file://… */
export function isLocalPath(v: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(v) || v.startsWith('/') || v.startsWith('\\\\') || /^file:\/\//i.test(v);
}

/** Reads owner/repo, https://host/owner/repo(.git), git@host:owner/repo.git, ssh://git@host[:port]/owner/repo or a local folder. */
function parseTarget(input: string, defaultHost: string | null): Target | null {
  const v = input.trim().replace(/[\\/]+$/, '');
  if (!v) return null;
  if (!defaultHost && isLocalPath(v)) {
    const repo = (v.split(/[\\/]/).pop() ?? '').replace(/\.git$/, '');
    return repo ? { host: 'this computer', owner: '', repo } : null;
  }
  if (defaultHost && SLUG_RE.test(v)) {
    const [owner, repo] = v.split('/');
    return { host: defaultHost, owner, repo: repo.replace(/\.git$/, '') };
  }
  let host = '';
  let path = '';
  const scp = /^[A-Za-z0-9._-]+@([^:/\s]+):(.+)$/.exec(v);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    try {
      const u = new URL(v);
      if (!['https:', 'http:', 'ssh:'].includes(u.protocol)) return null;
      host = u.hostname;
      path = u.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }
  const parts = path.replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { host: host.toLowerCase(), owner: parts.slice(0, -1).join('/'), repo: parts[parts.length - 1] };
}

function hostOfAccount(a: AccountSummary): string {
  if (!a.apiBaseUrl) return 'github.com';
  try {
    const h = new URL(a.apiBaseUrl).hostname.toLowerCase();
    return h === 'api.github.com' ? 'github.com' : h;
  } catch {
    return 'github.com';
  }
}

function cleanHost(v: string): string {
  return v.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
}


function nodeParent(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.slice(0, i) : p;
}

function mask(v: string): string {
  return v.length <= 8 ? '••••••••' : `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

const PARENT_KEY = 'gitbaba.clone.parent';
function readLastParent(): string {
  try {
    return localStorage.getItem(PARENT_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeLastParent(p: string): void {
  try {
    localStorage.setItem(PARENT_KEY, p);
  } catch {
    // per-viewer convenience only
  }
}

function Req({ show, children }: { show: boolean; children: React.ReactNode }) {
  return show ? <div className="field-hint">{children}</div> : null;
}

/** Clone: source (GitHub.com / Enterprise / URL) → protocol (HTTPS / PAT / SSH) → authenticate → clone → verify → add. */
/** The clone address for another provider: the pasted one when it already uses the transport, else derived. */
function providerCloneUrl(p: RepoProvider, transport: 'https' | 'ssh', pasted: string, pastedIsSsh: boolean, pastedIsHttps: boolean): string {
  if ((transport === 'ssh' && pastedIsSsh) || (transport === 'https' && pastedIsHttps)) return pasted;
  if (transport === 'https') return p.web ? (p.id === 'azure' ? p.web : p.id === 'codecommit' ? `https://${p.host}/v1/repos/${p.path}` : `${p.web}.git`) : pasted;
  if (p.id === 'azure' && p.org && p.project) return `git@ssh.dev.azure.com:v3/${p.org}/${p.project}/${p.path.split('/').pop()}`;
  if (p.id === 'codecommit') return `ssh://${p.host}/v1/repos/${p.path}`;
  return `git@${p.host}:${p.path}.git`;
}

export function CloneDialog({ onClose, onCloned, initialRepository, from: fromProp }: { onClose: () => void; onCloned: (r: RepoSummary) => void; initialRepository?: string; /** Preselect the account to clone from (`gh:<id>` / `conn:<id>` / 'url'). */ from?: string }) {
  const { accounts, activeAccount, repos: appRepos, toast } = useApp();
  const [source, setSource] = useState<Source>('url');
  const [enterpriseHost, setEnterpriseHost] = useState('');
  const [typedRepository, setTypedRepository] = useState(initialRepository ?? '');
  // GitHub.com tab: browse the account's repositories instead of typing one.
  const [remoteRepos, setRemoteRepos] = useState<RemoteRepoEntry[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoFilter, setRepoFilter] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const repository = source === 'github' ? (picked ?? '') : typedRepository;
  const [destPath, setDestPath] = useState(readLastParent);
  const [destCheck, setDestCheck] = useState<DirectoryCheck | null>(null);
  const [folder, setFolder] = useState('');
  const [folderTouched, setFolderTouched] = useState(false);
  const [protocol, setProtocol] = useState<Protocol>('https');
  const [httpsAuth, setHttpsAuth] = useState<HttpsAuth>('account');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [credential, setCredential] = useState<AccountCredentialInput | null>(null);
  const onCred = useCallback((c: AccountCredentialInput | null) => setCredential(c), []);
  const [patUser, setPatUser] = useState('');
  const [patToken, setPatToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [ssh, setSsh] = useState<{ input: SshKeyInput | null; summary: string }>({ input: null, summary: '' });
  const onSsh = useCallback((input: SshKeyInput | null, summary: string) => setSsh({ input, summary }), []);
  const [authKey, setAuthKey] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [state, setState] = useState<CloneState | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Other providers (GitLab, Bitbucket, Azure DevOps, CodeCommit, Gitea, any Git server): their own sign-ins.
  const { all: everyAccount, connections } = useAllAccounts();
  const [connId, setConnId] = useState<string | null>(null);
  // "Clone from": one chip per account (any provider) plus "Any URL". It sets the source and the sign-in together.
  const [from, setFrom] = useState<string>(() => fromProp ?? (initialRepository ? 'url' : activeAccount ? `gh:${activeAccount.id}` : 'url'));
  const pickFrom = useCallback(
    (k: string) => {
      setFrom(k);
      if (k === 'url') return setSource('url');
      const a = everyAccount.find((x) => x.key === k);
      if (!a) return;
      setProtocol('https');
      if (a.kind === 'github') {
        if (a.host === 'github.com') setSource('github');
        else {
          setSource('enterprise');
          setEnterpriseHost(a.host);
        }
        setAccountId(a.id);
        setHttpsAuth('account');
      } else {
        setSource('url');
        setConnId(a.id);
        setHttpsAuth('connection');
      }
    },
    [everyAccount],
  );
  // Apply the starting choice once the accounts are known.
  const fromApplied = useRef(false);
  useEffect(() => {
    if (fromApplied.current) return;
    if (from !== 'url' && !everyAccount.some((a) => a.key === from)) return;
    fromApplied.current = true;
    pickFrom(from);
  }, [everyAccount, from, pickFrom]);

  const defaultHost = source === 'github' ? 'github.com' : source === 'enterprise' ? cleanHost(enterpriseHost) || null : null;
  const target = useMemo(() => parseTarget(repository, defaultHost), [repository, defaultHost]);
  const host = target?.host ?? defaultHost;
  const hostAccounts = (accounts?.accounts ?? []).filter((a) => host && hostOfAccount(a) === host);
  const account = hostAccounts.find((a) => a.id === accountId) ?? null;

  // Keep the chosen account valid for the current host.
  useEffect(() => {
    if (account) return;
    const pick = hostAccounts.find((a) => a.id === activeAccount?.id) ?? hostAccounts[0] ?? null;
    setAccountId(pick?.id ?? null);
    if (!pick && httpsAuth === 'account') setHttpsAuth('system');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, accounts]);

  // Folder name follows the repository until the user edits it (always, on the GitHub.com tab).
  useEffect(() => {
    if (!folderTouched || source === 'github') setFolder(target?.repo ?? '');
  }, [target?.repo, folderTouched, source]);

  // Destination: the folder used last time, otherwise the drive root of this computer.
  useEffect(() => {
    if (destPath) return;
    call('clone:resolveFolder', {})
      .then((d) => setDestPath((cur) => cur || d.path))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live check of the typed destination.
  useEffect(() => {
    if (!destPath.trim() || state) {
      setDestCheck(null);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      call('clone:resolveFolder', { path: destPath })
        .then((d) => !stale && setDestCheck(d))
        .catch(() => !stale && setDestCheck({ path: destPath, exists: false, isDirectory: false, selectionId: null }));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [destPath, state]);

  // A different account or tab means a different list.
  useEffect(() => {
    setRemoteRepos(null);
    setPicked(null);
    setRepoFilter('');
  }, [accountId, source]);

  const loadRepos = useCallback(async () => {
    if (!credential) return;
    setLoadingRepos(true);
    setError(null);
    try {
      const res = await call('clone:listRepos', { credential });
      setRemoteRepos(res.repos);
    } catch (err) {
      setError(toFriendly(err));
    } finally {
      setLoadingRepos(false);
    }
  }, [credential]);

  // A remembered credential needs no typing, so the list can load straight away.
  useEffect(() => {
    if (source === 'github' && credential?.useRemembered && credential.accountId === accountId && remoteRepos === null && !loadingRepos) void loadRepos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, credential?.useRemembered, credential?.accountId, accountId]);

  useEffect(
    () =>
      onProgress((e) => {
        if (e.kind === 'clone') setState((cur) => (cur && cur.workflowId === e.state.workflowId ? e.state : cur));
      }),
    [],
  );

  // A pasted URL that already uses the chosen transport is cloned as-is (keeps custom ports and paths).
  const pasted = repository.trim();
  const pastedIsSsh = /^ssh:\/\//i.test(pasted) || /^[A-Za-z0-9._-]+@[^:/\s]+:/.test(pasted);
  const pastedIsHttps = /^https?:\/\//i.test(pasted);
  const local = source === 'url' && !!target && isLocalPath(pasted);
  // A pasted git@… / ssh:// address means SSH; a pasted https:// address means HTTPS. Follow it.
  useEffect(() => {
    if (state) return;
    if (pastedIsSsh) setProtocol('ssh');
    else if (pastedIsHttps) setProtocol((p) => (p === 'ssh' ? 'https' : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastedIsSsh, pastedIsHttps]);
  const knownHosts = useMemo(() => Object.fromEntries(connections.map((c) => [c.host, c.provider])), [connections]);
  const prov = source === 'url' && !local && pasted ? detectProvider(pasted, { known: knownHosts }) : null;
  const other = prov && prov.id !== 'github' ? prov : null;
  const otherInfo = other ? providerInfo(other.id) : null;
  const otherConns = other ? connections.filter((c) => c.provider === other.id && (other.id === 'azure' ? (c.org ?? '').toLowerCase() === (other.org ?? '').toLowerCase() : c.host === other.host)) : [];
  const conn = otherConns.find((c) => c.id === connId) ?? null;
  // On another provider, HTTPS signs in with its connection when there is one (else the system's Git sign-in).
  useEffect(() => {
    if (!other || state) return;
    setConnId((cur) => (otherConns.some((c) => c.id === cur) ? cur : otherConns[0]?.id ?? null));
    setHttpsAuth(otherConns.length ? 'connection' : 'system');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other?.id, other?.host, other?.org, otherConns.length]);
  const cloneUrl = !target ? '' : local ? pasted : other ? providerCloneUrl(other, protocol === 'ssh' ? 'ssh' : 'https', pasted, pastedIsSsh, pastedIsHttps) : (protocol === 'ssh' && pastedIsSsh) || (protocol !== 'ssh' && pastedIsHttps) ? pasted : protocol === 'ssh' ? `git@${target.host}:${target.owner}/${target.repo}.git` : `https://${target.host}/${target.owner}/${target.repo}.git`;

  const auth: { kind: 'account'; credential: AccountCredentialInput } | { kind: 'other'; input: AuthInput; summary: string } | null = local
    ? { kind: 'other', input: { method: 'none' }, summary: 'None needed — a folder on this computer' }
    : protocol === 'https'
      ? httpsAuth === 'connection'
        ? conn
          ? { kind: 'other', input: { method: 'pat', connectionId: conn.id }, summary: `${providerInfo(conn.provider).name} · ${conn.username}` }
          : null
        : httpsAuth === 'account'
        ? credential && account
          ? { kind: 'account', credential }
          : null
        : { kind: 'other', input: { method: 'system' }, summary: 'Your existing Git credentials (credential manager)' }
      : protocol === 'pat'
        ? patToken.trim()
          ? { kind: 'other', input: { method: 'pat', token: patToken.trim(), username: patUser.trim() || undefined }, summary: `Personal access token ${mask(patToken.trim())}${patUser.trim() ? ` as ${patUser.trim()}` : ''}` }
          : null
        : ssh.input
          ? { kind: 'other', input: { method: 'ssh', ...ssh.input }, summary: ssh.summary }
          : null;

  // Everything still missing, in the order the user meets it.
  const missing: { id: string; text: string }[] = [];
  if (source === 'enterprise' && !cleanHost(enterpriseHost)) missing.push({ id: 'host', text: 'Enterprise server address' });
  if (source === 'github') {
    if (!picked) missing.push({ id: 'repo', text: remoteRepos ? 'Pick a repository from the list' : 'Load and pick a repository' });
  } else if (!repository.trim()) missing.push({ id: 'repo', text: 'Repository' });
  else if (!target) missing.push({ id: 'repo', text: 'A valid repository (owner/name or a clone URL)' });
  if (source !== 'github' && !folder.trim()) missing.push({ id: 'folder', text: 'Folder name' });
  if (!state) {
    if (!destPath.trim()) missing.push({ id: 'dest', text: 'Destination folder' });
    else if (destCheck && destCheck.exists && !destCheck.isDirectory) missing.push({ id: 'dest', text: 'Destination is a file, not a folder' });
  }
  if (!auth) {
    missing.push({
      id: 'auth',
      text:
        protocol === 'https' ? (other ? `A ${otherInfo!.name} sign-in` : account ? `Token for ${account.login}` : 'A GitHub account for this server') : protocol === 'pat' ? 'Personal access token' : 'SSH key',
    });
  }
  const isMissing = (id: string) => missing.some((m) => m.id === id);
  const flag = (id: string) => attempted && isMissing(id);

  const browse = async () => {
    try {
      const p = await call('dialog:pickDirectory', { purpose: 'clone-parent' });
      if (p) setDestPath(p.path);
    } catch (err) {
      setError(toFriendly(err));
    }
  };

  const clonedKeys = useMemo(() => new Set(appRepos.filter((r) => r.github).map((r) => `${r.github!.owner}/${r.github!.repo}`.toLowerCase())), [appRepos]);
  const available = useMemo(() => {
    const q = repoFilter.trim().toLowerCase();
    return (remoteRepos ?? []).filter((r) => !clonedKeys.has(r.fullName.toLowerCase()) && (!q || r.fullName.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)));
  }, [remoteRepos, clonedKeys, repoFilter]);

  const authenticateAndClone = async () => {
    setAttempted(true);
    if (missing.length || !auth || !target) return;
    setBusy(true);
    setError(null);
    try {
      let s = state;
      if (!s || s.phase === 'cancelled') {
        // Typed paths are registered (and created when missing) just before use.
        const dest = await call('clone:resolveFolder', { path: destPath, register: true, create: true });
        if (!dest.selectionId) throw new Error(`${dest.path} is not a folder.`);
        writeLastParent(dest.path);
        s = await call('clone:start', {
          input: { selectionId: dest.selectionId, folderName: folder.trim(), repository: cloneUrl, accountId: auth.kind === 'account' ? auth.credential.accountId : null },
        });
        setState(s);
      }
      const next = await call('clone:authenticate', auth.kind === 'account' ? { workflowId: s.workflowId, credential: auth.credential } : { workflowId: s.workflowId, auth: auth.input });
      setState(next);
      setPatToken('');
      setAuthKey((k) => k + 1);
      if (next.phase === 'done' && next.repo) {
        let repo = next.repo;
        const want = from.startsWith('gh:') ? from.slice(3) : null;
        if (want && repo.github && repo.account?.id !== want) repo = await call('repo:setAccount', { repoId: repo.id, accountId: want }).catch(() => repo);
        toast(`Cloned ${repo.name}`);
        onCloned(repo);
      }
    } catch (err) {
      setError(toFriendly(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (state && state.phase === 'running') {
      try {
        setState(await call('clone:cancel', { workflowId: state.workflowId }));
      } catch (err) {
        setError(toFriendly(err));
      }
      return;
    }
    onClose();
  };

  const running = state?.phase === 'running';
  const done = state?.phase === 'done';
  const locked = !!state;
  const showSetup = !state || state.phase === 'awaiting-auth';
  const tokenUrl = host && host !== 'github.com' ? `https://${host}/settings/tokens/new?scopes=repo&description=Git%20Baba` : 'https://github.com/settings/tokens/new?scopes=repo&description=Git%20Baba';
  const sshUrl = host && host !== 'github.com' ? `https://${host}/settings/ssh/new` : 'https://github.com/settings/ssh/new';
  const open = (url: string) => void call('shell:openExternal', { url }).catch(() => undefined);

  return (
    <Modal
      title="Clone Repository"
      size="wide"
      onClose={running ? cancel : onClose}
      locked={busy && !running}
      footer={
        done ? (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : running ? (
          <button className="btn danger" onClick={cancel}>
            Cancel clone
          </button>
        ) : (
          <>
            {state?.leftoverFolder && (
              <button className="btn danger" onClick={() => setConfirmRemove(true)}>
                Remove partial folder…
              </button>
            )}
            {attempted && missing.length > 0 && (
              <span className="small text-danger ellipsis" title={missing.map((m) => m.text).join('\n')}>
                Needs: {missing.map((m) => m.text).join(' · ')}
              </span>
            )}
            <span className="spacer" />
            <button className="btn cancel" onClick={onClose} disabled={busy}>
              {state?.phase === 'cancelled' || state?.phase === 'failed' ? 'Close' : 'Cancel'}
            </button>
            {state?.phase !== 'failed' && state?.phase !== 'cancelled' ? (
              <button
                className="btn primary"
                onClick={authenticateAndClone}
                disabled={busy}
                title={missing.length ? `Still needed:\n${missing.map((m) => `• ${m.text}`).join('\n')}` : undefined}
              >
                {busy ? 'Authenticating…' : state ? 'Retry authentication' : 'Clone'}
              </button>
            ) : (
              <button
                className="btn primary"
                title={state?.leftoverFolder ? 'Remove the incomplete folder first, or use another folder name' : undefined}
                onClick={() => {
                  setState(null);
                  setError(null);
                  setAttempted(false);
                  setAuthKey((k) => k + 1);
                }}
              >
                Start over
              </button>
            )}
          </>
        )
      }
    >
      <div className="repo-modal">
      {error && <ErrorPanel error={error} />}

      {showSetup && (
        <>
          {/* 1. Where from */}
          <div className="clone-section">
            <div className="from-strip" role="radiogroup" aria-label="Clone from">
              {everyAccount.map((a) => (
                <button
                  key={a.key}
                  role="radio"
                  aria-checked={from === a.key}
                  className={`from-chip ${from === a.key ? 'on' : ''}`}
                  onClick={() => pickFrom(a.key)}
                  disabled={locked}
                  title={`${providerInfo(a.provider).name} · ${a.host}${a.org ? `/${a.org}` : ''}`}
                  style={{ ['--pc' as string]: providerInfo(a.provider).color }}
                >
                  <ProviderMono id={a.provider} size={16} />
                  <span className="ellipsis">{a.login}</span>
                  {a.host !== 'github.com' && a.host !== providerInfo(a.provider).host && <span className="from-host">{a.host}</span>}
                </button>
              ))}
              <button role="radio" aria-checked={from === 'url'} className={`from-chip url ${from === 'url' ? 'on' : ''}`} onClick={() => pickFrom('url')} disabled={locked}>
                🔗 Any URL
              </button>
              <button className="from-add" onClick={() => openAccountsHub()} disabled={locked} title="Add an account" aria-label="Add an account">
                ＋
              </button>
            </div>

            {source === 'github' ? (
              <div className={`field ${flag('repo') ? 'invalid' : ''}`}>
                {hostAccounts.length === 0 ? (
                  <div className="banner info small">
                    <span className="icon">ℹ</span>
                    <div>
                      No GitHub.com account yet — <a onClick={() => pickFrom('url')}>paste a URL</a> instead.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="repo-browse-auth">
                      {account && <AccountCredentialFields key={`${authKey}-${account.id}`} account={account} encryptionAvailable={!!accounts?.encryptionAvailable} purpose="list and clone your repositories" onChange={onCred} />}
                      <div className="row mt">
                        <button className="btn" onClick={() => void loadRepos()} disabled={!credential || credential.accountId !== accountId || loadingRepos || locked}>
                          {loadingRepos ? 'Loading…' : remoteRepos ? <><Hourglass /> Reload repositories</> : 'Load my repositories'}
                        </button>
                      </div>
                    </div>

                    {remoteRepos && (
                      <div className="repo-browser">
                        <input value={repoFilter} onChange={(e) => setRepoFilter(e.target.value)} placeholder={`Filter ${available.length} repositories…`} spellCheck={false} disabled={locked} />
                        <div className="repo-browser-list" role="listbox">
                          {available.length === 0 && (
                            <div className="small muted pad">
                              {remoteRepos.length === 0 ? 'No repositories found for this account.' : repoFilter ? 'No repositories match.' : 'Every repository of this account is already cloned.'}
                            </div>
                          )}
                          {available.map((r) => (
                            <div
                              key={r.fullName}
                              role="option"
                              aria-selected={picked === r.fullName}
                              className={`repo-row ${picked === r.fullName ? 'selected' : ''}`}
                              onClick={() => !locked && setPicked(r.fullName)}
                            >
                              <div className="grow" style={{ minWidth: 0 }}>
                                <div className="row" style={{ gap: 6 }}>
                                  <strong className="ellipsis">{r.fullName}</strong>
                                  {r.private && <span className="badge warn">private</span>}
                                  {r.fork && <span className="badge">fork</span>}
                                  {r.archived && <span className="badge">archived</span>}
                                </div>
                                {r.description && <div className="small muted ellipsis">{r.description}</div>}
                              </div>
                              {r.updatedAt && <span className="small muted nowrap">{timeAgo(r.updatedAt)}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                
              </div>
            ) : (
              <>
                <div className={`field ${flag('repo') ? 'invalid' : ''}`}>
                  <input
                    value={typedRepository}
                    onChange={(e) => setTypedRepository(e.target.value)}
                    placeholder={source === 'url' ? (from.startsWith('conn:') ? `https://${everyAccount.find((a) => a.key === from)?.host ?? 'host'}/group/repository` : 'Paste a clone URL or folder path') : 'owner/repository'}
                    autoFocus
                    spellCheck={false}
                    disabled={locked}
                  />
                  <Req show={flag('repo') && !!typedRepository.trim()}>Not a repository address.</Req>
                  {target && (
                    <div className="clone-target">
                      {local ? (
                        <>
                          📁 Folder on this computer · <strong>{target.repo}</strong>
                        </>
                      ) : (
                        <>
                          {target.host} · <strong>{target.owner}/{target.repo}</strong>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className={`field ${flag('dest') || flag('folder') ? 'invalid' : ''}`}>
              <label>Save to</label>
              <div className="clone-dest">
                <span className="clone-dest-ico" aria-hidden>📁</span>
                <input
                  className="clone-dest-parent mono"
                  value={state?.summary.destination ? nodeParent(state.summary.destination) : destPath}
                  onChange={(e) => setDestPath(e.target.value)}
                  placeholder="C:\\Workspace"
                  spellCheck={false}
                  disabled={locked}
                />
                <span className="clone-dest-sep">/</span>
                <input
                  className="clone-dest-folder mono"
                  value={folder}
                  onChange={(e) => {
                    setFolder(e.target.value);
                    setFolderTouched(true);
                  }}
                  placeholder="folder"
                  spellCheck={false}
                  disabled={locked || source === 'github'}
                  style={{ width: `${Math.min(28, Math.max(7, folder.length + 2))}ch` }}
                />
                <button className="clone-dest-btn" onClick={browse} disabled={locked} title="Choose folder">
                  …
                </button>
              </div>
              {destCheck && !state && destCheck.exists && !destCheck.isDirectory && <div className="field-hint">That path is a file.</div>}
              {destCheck && !state && !destCheck.exists && destPath.trim() && <div className="small text-warn mt-xs">New folder — will be created.</div>}
            </div>
          </div>

          {/* 2. How to authenticate */}
          {local ? (
            <div className="banner info small">
              <span className="icon">📁</span>
              <div>Local folder — no sign-in needed.</div>
            </div>
          ) : (
          <div className="clone-section">
            <div className="proto-pills" role="radiogroup" aria-label="Authentication">
              {(
                [
                  ['https', 'HTTPS', '🔐'],
                  ['pat', otherInfo?.connect ? otherInfo.connect.tokenName : 'Token', '🔑'],
                  ['ssh', 'SSH', '🗝'],
                ] as [Protocol, string, string][]
              ).map(([id, label, ico]) => (
                <button key={id} className={`proto-pill ${protocol === id ? 'on' : ''}`} onClick={() => setProtocol(id)} disabled={locked} aria-pressed={protocol === id}>
                  <span aria-hidden>{ico}</span> {label}
                </button>
              ))}
            </div>

            <div className={`auth-panel ${flag('auth') ? 'invalid' : ''}`}>
              {protocol === 'https' && other && otherInfo && (
                <div className="cl-prov">
                  <div className="cl-prov-head">
                    <ProviderMono id={other.id} size={28} />
                    <span className="grow">
                      <strong>{otherInfo.name}</strong> <span className="muted small">{other.host}</span>
                    </span>
                  </div>
                  <div className="cl-prov-opts">
                    {otherConns.map((c) => (
                      <button key={c.id} className={`cl-prov-opt ${httpsAuth === 'connection' && connId === c.id ? 'on' : ''}`} onClick={() => (setHttpsAuth('connection'), setConnId(c.id))} disabled={locked}>
                        <span className="cl-av">{(c.displayName ?? c.username).slice(0, 2).toUpperCase()}</span>
                        <span className="ellipsis">{c.username}</span>
                        <i>✓</i>
                      </button>
                    ))}
                    {otherInfo.connect && (
                      <button className="cl-prov-opt add" onClick={() => openAccountsHub(other.id)} disabled={locked}>
                        <span className="cl-av">＋</span>
                        <span>Connect</span>
                      </button>
                    )}
                    <button className={`cl-prov-opt ${httpsAuth === 'system' ? 'on' : ''}`} onClick={() => setHttpsAuth('system')} disabled={locked} title={other.id === 'codecommit' ? 'Your AWS CLI credential helper' : 'The Git credential manager on this computer'}>
                      <span className="cl-av">{other.id === 'codecommit' ? '☁' : '⚙'}</span>
                      <span>{other.id === 'codecommit' ? 'AWS CLI' : 'This computer'}</span>
                    </button>
                  </div>
                </div>
              )}
              {protocol === 'https' && !other && (
                <>
                  <div className="segmented mb">
                    <button className={httpsAuth === 'account' ? 'on' : ''} onClick={() => setHttpsAuth('account')} disabled={locked}>
                      Account
                    </button>
                    <button className={httpsAuth === 'system' ? 'on' : ''} onClick={() => setHttpsAuth('system')} disabled={locked}>
                      This computer
                    </button>
                  </div>
                  {httpsAuth === 'account' &&
                    (hostAccounts.length === 0 ? (
                      <div className="banner info small">
                        <span className="icon">ℹ</span>
                        <div>
                          No account for <strong>{host ?? 'this server'}</strong> — use a <a onClick={() => setProtocol('pat')}>token</a> or <a onClick={() => setHttpsAuth('system')}>this computer</a>.
                        </div>
                      </div>
                    ) : source === 'github' ? (
                      <p className="small muted">
                        {credential && credential.accountId === accountId ? (
                          <>✓ {account?.login}</>
                        ) : (
                          <>Sign in as <strong>{account?.login}</strong> above.</>
                        )}
                      </p>
                    ) : (
                      <>
                        {hostAccounts.length > 1 && (
                          <div className="field">
                            <label>
                              Account <span className="req">*</span>
                            </label>
                            <Select kind="account" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value)} disabled={locked}>
                              {hostAccounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.login}
                                  {a.active ? ' (default)' : ''}
                                </option>
                              ))}
                            </Select>
                          </div>
                        )}
                        {account && <AccountCredentialFields key={`${authKey}-${account.id}`} account={account} encryptionAvailable={!!accounts?.encryptionAvailable} purpose="verify access and clone" onChange={onCred} />}
                      </>
                    ))}
                  {httpsAuth === 'system' && (
                    <p className="small muted">Uses the Git sign-in already on this computer.</p>
                  )}
                </>
              )}

              {protocol === 'pat' && (
                <>
                  <div className="grid-2">
                    <div className={`field ${flag('auth') ? 'invalid' : ''}`}>
                      <label>Token</label>
                      <div className="row">
                        <input
                          className="grow mono"
                          type={showToken ? 'text' : 'password'}
                          value={patToken}
                          onChange={(e) => setPatToken(e.target.value)}
                          placeholder={otherInfo ? `${otherInfo.name} ${otherInfo.connect?.tokenName.toLowerCase() ?? 'token'}` : 'ghp_… or github_pat_…'}
                          autoComplete="off"
                          spellCheck={false}
                          disabled={busy}
                        />
                        <button type="button" className="btn sm ghost" onClick={() => setShowToken((s) => !s)} title={showToken ? 'Hide token' : 'Show token'}>
                          {showToken ? '🙈' : '👁'}
                        </button>
                      </div>
                      
                    </div>
                    <div className="field">
                      <label>Username <span className="muted">· optional</span></label>
                      <input value={patUser} onChange={(e) => setPatUser(e.target.value)} placeholder={otherInfo ? (otherInfo.connect?.gitUsername ?? 'your username') : 'your GitHub login'} spellCheck={false} disabled={busy} />
                    </div>
                  </div>
                  <div className="row small">
                    <span className="grow" />
                    <a onClick={() => open(tokenUrl)}>New token ↗</a>
                  </div>
                </>
              )}

              {protocol === 'ssh' && (
                <>
                  <SshKeyFields key={authKey} savedKey={null} onChange={onSsh} />
                  <div className="row small mt">
                    <span className="grow" />
                    <a onClick={() => open(sshUrl)}>Add key on {host ?? 'GitHub'} ↗</a>
                  </div>
                </>
              )}
            </div>
          </div>
          )}

        </>
      )}

      {state && (
        <>
          {state.phase !== 'awaiting-auth' && (
            <div className="clone-run-head">
              <span className={`clone-run-dot ${state.phase}`} />
              <strong className="ellipsis">{state.summary.repository}</strong>
              <span className="mono small muted ellipsis grow" title={state.summary.destination}>
                → {state.summary.destination}
              </span>
            </div>
          )}
          {state.progress && (
            <div className="card">
              <div className="row small">
                <span className="grow">{state.progress.text}</span>
                {state.progress.percent !== null && <strong>{state.progress.percent}%</strong>}
              </div>
              {state.progress.percent !== null && (
                <div className="progress">
                  <div className="progress-bar" style={{ width: `${state.progress.percent}%` }} />
                </div>
              )}
            </div>
          )}
          {done && state.repo && (
            <div className="banner ok">
              <span className="icon">✓</span>
              <div>
                <strong>{state.repo.name}</strong> cloned.
              </div>
            </div>
          )}
          {state.phase === 'cancelled' && (
            <div className="banner info">
              <span className="icon">ℹ</span>
              <div>Cancelled.{state.leftoverFolder ? ` Partial folder left at ${state.leftoverFolder}.` : ''}</div>
            </div>
          )}
          <WorkflowSteps steps={state.steps} onReviewAuth={() => setAuthKey((k) => k + 1)} />
        </>
      )}
      {confirmRemove && state?.leftoverFolder && (
        <ConfirmDialog
          title="Remove Incomplete Clone Folder"
          danger
          explanation={<>Deletes the folder created by this interrupted clone.</>}
          impact={`${state.leftoverFolder} and everything in it will be deleted. It did not exist before this clone started.`}
          affected={[state.leftoverFolder]}
          confirmLabel="Delete folder"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            try {
              setState(await call('clone:removeLeftover', { workflowId: state.workflowId, confirmed: true }));
            } catch (err) {
              setError(toFriendly(err));
            }
            setConfirmRemove(false);
          }}
        />
      )}
      </div>
    </Modal>
  );
}
