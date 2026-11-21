import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthInput, AuthMethod, AuthOption, GeneratedTokenInfo, GitHubAppConfig, KeyHandleInfo, ProviderConnection, SavedSshKey, SshKeyInput } from '../../shared/types';
import { providerInfo } from '../../shared/providers';
import { call } from '../services/api';
import { useApp } from '../state/AppState';
import { SshKeyFields } from './SshKeyFields';
import { remoteAuthDefault, type DefaultSource } from '../../shared/authDefaults';

export interface AuthSelection {
  input: AuthInput | null;
  /** Human description of the credential, without the secret. */
  summary: string;
}

interface Props {
  options: AuthOption[];
  githubApp?: GitHubAppConfig;
  /** owner/repo of the remote, used to prefill and to explain isolation. */
  remoteOwnerRepo?: { owner: string; repo: string } | null;
  canSave: boolean;
  savedSshKey?: SavedSshKey | null;
  /** Repository the operation is for (enables the saved App key for instant token generation). */
  repoId?: string;
  purpose: 'push' | 'fetch' | 'pr' | 'clone';
  onChange: (sel: AuthSelection) => void;
  /** "Merge as …" row with segmented buttons (same look as the pull-request merge), instead of the method tree. */
  asLabel?: string;
  /** GitHub login shown on the account-token button in the `asLabel` row. */
  account?: string | null;
}

const SOURCE_NOTE: Partial<Record<DefaultSource, string>> = {
  'github-app': 'Preselected: the GitHub App linked to this repository',
  'repo-setting': 'Preselected from this repository’s Security & access settings',
  remembered: 'Preselected: already set up for this repository',
};

const AS_VERB: Record<Props['purpose'], string> = { push: 'Push as', fetch: 'Sign in as', pr: 'Create as', clone: 'Clone as' };
const AS_ICON: Record<AuthMethod, string> = { pat: '👤', 'github-app': '🤖', ssh: '🔑', system: '💻', none: '○' };


function mask(v: string): string {
  if (!v) return '';
  return v.length <= 8 ? '••••••••' : `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

/**
 * Lets the user choose and fill in the authentication method for ONE operation.
 * Only methods applicable to the repository are listed. Secrets live in local
 * component state only and disappear when the dialog closes.
 */
export function AuthMethodPicker({ options, githubApp, remoteOwnerRepo, canSave, savedSshKey = null, repoId, purpose, onChange, asLabel, account: accountProp }: Props) {
  const { showError, toast, activeAccount, session, repos } = useApp();
  // Default to the account the repository belongs to.
  const account = accountProp !== undefined ? accountProp : (repos.find((r) => r.id === repoId)?.account?.login ?? null);
  // The repository's account is the active one and signed in: git can use that sign-in directly
  // (instead of whatever Git Credential Manager has cached for github.com).
  const accountReady = !!account && !!activeAccount && activeAccount.login.toLowerCase() === account.toLowerCase() && (!!session?.active || activeAccount.remembered) && options.some((o) => o.method === 'pat');
  // Preselect what the repository is configured for (GitHub App > repository setting > already set up > Git identity).
  const repoRecord = repos.find((r) => r.id === repoId);
  const preset = remoteAuthDefault({
    available: options.map((o) => o.method),
    githubAppLinked: !!githubApp,
    preference: repoRecord?.settings.remoteAuth,
    sshKeyRemembered: !!savedSshKey,
    patSaved: !!options.find((o) => o.method === 'pat')?.hasSaved,
  });
  const [method, setMethodRaw] = useState<AuthMethod | null>(preset.method);
  // A provider connection (GitLab, Bitbucket, Azure DevOps, Gitea) for this repository's own server.
  const provider = repoRecord?.provider ?? null;
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [connId, setConnId] = useState<string | null>(null);
  useEffect(() => {
    if (!provider || provider.id === 'github' || purpose === 'pr') return;
    let live = true;
    void call('providers:connections')
      .then((list) => {
        if (!live) return;
        const mine = list.filter((c) => c.provider === provider.id && (provider.id === 'azure' ? (c.org ?? '').toLowerCase() === (provider.org ?? '').toLowerCase() : c.host === provider.host));
        setConnections(mine);
        if (mine.length) setConnId((cur) => cur ?? mine[0].id);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id, provider?.host, provider?.org, purpose]);
  const setMethod = (m: AuthMethod) => {
    setConnId(null);
    setMethodRaw(m);
  };
  const conn = connections.find((c) => c.id === connId) ?? null;
  const [useAcct, setUseAcct] = useState(true);
  // SSH
  const [ssh, setSsh] = useState<{ input: SshKeyInput | null; summary: string }>({ input: null, summary: '' });
  const onSsh = useCallback((input: SshKeyInput | null, summary: string) => setSsh({ input, summary }), []);
  // PAT
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [useSavedPat, setUseSavedPat] = useState(() => !!options.find((o) => o.method === 'pat')?.hasSaved);
  const [savePat, setSavePat] = useState(false);
  // GitHub App
  const [editingApp, setEditingApp] = useState(!githubApp);
  const [appId, setAppId] = useState(githubApp?.appId ?? '');
  const [owner, setOwner] = useState(githubApp?.owner ?? remoteOwnerRepo?.owner ?? '');
  const [repo, setRepo] = useState(githubApp?.repo ?? remoteOwnerRepo?.repo ?? '');
  const [installationId, setInstallationId] = useState(githubApp?.installationId ?? '');
  const [rememberApp, setRememberApp] = useState(true);
  const [tokenMode, setTokenMode] = useState<'generate' | 'existing'>('generate');
  const [existingToken, setExistingToken] = useState('');
  const [generated, setGenerated] = useState<GeneratedTokenInfo | null>(null);
  const [savedKeyAvailable, setSavedKeyAvailable] = useState(() => !!options.find((o) => o.method === 'github-app')?.hasSaved);
  const [forgetting, setForgetting] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [keyMode, setKeyMode] = useState<'file' | 'paste' | 'saved'>(savedKeyAvailable ? 'saved' : 'file');
  const [pem, setPem] = useState('');
  const [keyInfo, setKeyInfo] = useState<KeyHandleInfo | null>(null);
  const [saveKey, setSaveKey] = useState(false);
  const keyHandleRef = useRef<string | null>(null);
  const tokenHandleRef = useRef<string | null>(null);

  // Drop unused secrets from main-process memory when the picker goes away.
  useEffect(
    () => () => {
      if (keyHandleRef.current) void call('github:discardKey', { handle: keyHandleRef.current }).catch(() => undefined);
      if (tokenHandleRef.current) void call('github:discardToken', { handle: tokenHandleRef.current }).catch(() => undefined);
    },
    [],
  );

  const appChanged = !githubApp || githubApp.appId !== appId.trim() || githubApp.owner !== owner.trim() || githubApp.repo !== repo.trim();
  const appBase = { method: 'github-app' as const, appId: appId.trim(), owner: owner.trim(), repo: repo.trim(), installationId: installationId.trim() || undefined };
  const keyFields = keyMode === 'saved' ? { useSavedKey: true } : keyMode === 'file' && keyInfo ? { keyHandle: keyInfo.handle } : keyMode === 'paste' && pem.includes('PRIVATE KEY') ? { privateKey: pem } : null;

  useEffect(() => {
    let sel: AuthSelection = { input: null, summary: '' };
    if (conn) {
      onChange({ input: { method: 'pat', connectionId: conn.id }, summary: `${providerInfo(conn.provider).name} connection ${conn.username} (${conn.host}${conn.org ? `/${conn.org}` : ''})` });
      return;
    }
    switch (method) {
      case 'ssh':
        if (ssh.input) sel = { input: { method: 'ssh', ...ssh.input }, summary: ssh.summary };
        break;
      case 'pat':
        if (accountReady && useAcct) sel = { input: { method: 'pat', useAccount: true }, summary: `GitHub account ${account} (signed in)` };
        else if (useSavedPat) sel = { input: { method: 'pat', useSaved: true, username: username || undefined }, summary: 'Saved personal access token (encrypted on this computer)' };
        else if (token.trim())
          sel = {
            input: { method: 'pat', token: token.trim(), username: username.trim() || undefined, saveForRepo: savePat },
            summary: `Personal access token ${mask(token.trim())}${username ? ` as ${username}` : ''}`,
          };
        break;
      case 'github-app': {
        if (tokenMode === 'existing') {
          if (generated) sel = { input: { method: 'github-app', tokenMode, tokenHandle: generated.handle, appId: '', owner: '', repo: '' }, summary: `Installation token ${generated.maskedToken} (generated now)` };
          else if (existingToken.trim()) sel = { input: { method: 'github-app', tokenMode, existingToken: existingToken.trim(), appId: '', owner: '', repo: '' }, summary: `Installation token ${mask(existingToken.trim())}` };
          break;
        }
        if (appBase.appId && appBase.owner && appBase.repo && keyFields) {
          sel = {
            input: { ...appBase, tokenMode, ...keyFields, saveKeyForRepo: keyMode !== 'saved' && saveKey, rememberApp: appChanged && rememberApp },
            summary: `GitHub App ${appBase.appId} → new installation token for ${appBase.owner}/${appBase.repo} (revoked after use)`,
          };
        }
        break;
      }
      case 'system':
        sel = { input: { method: 'system' }, summary: 'Git identity only — your existing Git setup (no credentials entered here)' };
        break;
      case 'none':
        sel = { input: { method: 'none' }, summary: 'None (local remote)' };
        break;
    }
    onChange(sel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, accountReady, useAcct, account, method, ssh, username, token, useSavedPat, savePat, appId, owner, repo, installationId, keyMode, pem, keyInfo, saveKey, rememberApp, tokenMode, existingToken, generated, onChange]);

  const loadKey = async () => {
    try {
      const info = await call('github:loadKeyFile');
      if (info) {
        if (keyHandleRef.current) void call('github:discardKey', { handle: keyHandleRef.current }).catch(() => undefined);
        keyHandleRef.current = info.handle;
        setKeyInfo(info);
      }
    } catch (err) {
      showError(err);
    }
  };

  /** Forget the saved private key of this repository (the toggle switched off). */
  const forgetKey = async () => {
    if (!repoId) return;
    setForgetting(true);
    try {
      await call('repo:forgetSecrets', { repoId, kind: 'githubAppKey' });
      setSavedKeyAvailable(false);
      setKeyMode('file');
      toast('Saved private key removed from this computer.', 'info');
    } catch (err) {
      showError(err);
    } finally {
      setForgetting(false);
    }
  };
  /** A dropped or pasted .pem: read as text, kept in this dialog only. */
  const takePem = (text: string) => {
    if (!text.includes('PRIVATE KEY')) return toast('That is not a private key (.pem).', 'warning');
    if (keyHandleRef.current) void call('github:discardKey', { handle: keyHandleRef.current }).catch(() => undefined);
    keyHandleRef.current = null;
    setKeyInfo(null);
    setPem(text.trim());
    setKeyMode('paste');
  };
  const clearKey = () => {
    if (keyHandleRef.current) void call('github:discardKey', { handle: keyHandleRef.current }).catch(() => undefined);
    keyHandleRef.current = null;
    setKeyInfo(null);
    setPem('');
    setKeyMode('file');
  };

  const copyGenerated = async () => {
    if (!generated) return;
    try {
      await call('github:copyToken', { handle: generated.handle, clearClipboardAfterSeconds: 30 });
      toast('Token copied. The clipboard is cleared in 30 seconds.');
    } catch (err) {
      showError(err);
    }
  };

  if (options.length === 0) {
    return <div className="banner warn">No authentication method is applicable to this repository's remote.</div>;
  }

  const current = options.find((o) => o.method === method);
  const patOption = options.find((o) => o.method === 'pat');

  const pemLoaded = keyMode === 'paste' && pem.includes('PRIVATE KEY');
  const keyReady = keyMode === 'saved' || !!keyInfo || pemLoaded;
  const appFields = (
    <div className="ga">
      {githubApp && !editingApp ? (
        <button className="ga-id" onClick={() => setEditingApp(true)} title="Edit App ID, owner and repository">
          <span className="ga-id-ico">🤖</span>
          <span className="grow ellipsis">
            App <strong>{githubApp.appId}</strong> · {githubApp.owner}/{githubApp.repo}
          </span>
          <span className="ga-id-edit">✎</span>
        </button>
      ) : (
        <div className="ga-fields">
          <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="App ID" spellCheck={false} aria-label="GitHub App ID" />
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" spellCheck={false} aria-label="Owner" />
          <span className="ga-slash">/</span>
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repository" spellCheck={false} aria-label="Repository" />
          <input value={installationId} onChange={(e) => setInstallationId(e.target.value)} placeholder="install ID · auto" spellCheck={false} aria-label="Installation ID (optional)" />
          {repoId && appChanged && (
            <label className="ga-remember" title="Remember App ID, owner and repository for this repository (never the key)">
              <input type="checkbox" checked={rememberApp} onChange={(e) => setRememberApp(e.target.checked)} /> remember
            </label>
          )}
        </div>
      )}

      {/* The private key: one slot. Saved → a locked card with a switch; otherwise drop, pick or paste. */}
      <div
        className={`ga-key ${keyReady ? 'ready' : ''} ${dropping ? 'drop' : ''} ${keyMode === 'saved' ? 'saved' : ''}`}
        tabIndex={0}
        onDragOver={(e) => {
          if (keyMode === 'saved') return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          const f = e.dataTransfer.files[0];
          if (f) void f.text().then(takePem);
        }}
        onPaste={(e) => {
          if (keyMode === 'saved') return;
          const t = e.clipboardData.getData('text');
          if (t) {
            e.preventDefault();
            takePem(t);
          }
        }}
      >
        <span className="ga-key-ico" aria-hidden>
          {keyMode === 'saved' ? '🔐' : keyReady ? '🔑' : '⇣'}
        </span>
        <span className="grow ga-key-text">
          {keyMode === 'saved' ? (
            <>
              <strong>Saved private key</strong>
              <span className="muted small">encrypted · this repository</span>
            </>
          ) : keyInfo ? (
            <>
              <strong className="ellipsis">{keyInfo.fileName}</strong>
              <span className="mono muted small ellipsis">{keyInfo.fingerprint.slice(0, 23)}…</span>
            </>
          ) : pemLoaded ? (
            <>
              <strong>Pasted private key</strong>
              <span className="mono muted small">{pem.split('\n').length} lines</span>
            </>
          ) : (
            <>
              <strong>Private key</strong>
              <span className="muted small">
                drop a .pem, <a onClick={loadKey}>choose file</a> or paste (Ctrl+V)
              </span>
            </>
          )}
        </span>
        {keyMode !== 'saved' && keyReady && (
          <button className="ga-key-x" onClick={clearKey} title="Remove this key" aria-label="Remove key">
            ×
          </button>
        )}
        {keyMode !== 'saved' && !keyReady && (
          <button className="btn sm" onClick={loadKey}>
            Choose…
          </button>
        )}
        {(keyMode === 'saved' || (keyReady && canSave)) && (
          <label className={`ga-switch ${keyMode === 'saved' || saveKey ? 'on' : ''}`} title={keyMode === 'saved' ? 'Switch off to forget the saved key' : 'Save this key encrypted for this repository'}>
            <input
              type="checkbox"
              checked={keyMode === 'saved' || saveKey}
              disabled={forgetting}
              onChange={(e) => {
                if (keyMode === 'saved') {
                  if (!e.target.checked) void forgetKey();
                } else setSaveKey(e.target.checked);
              }}
            />
            <span className="ga-switch-track" aria-hidden>
              <i />
            </span>
            <span className="small">{forgetting ? 'Forgetting…' : keyMode === 'saved' || saveKey ? 'Saved' : 'Save'}</span>
          </label>
        )}
      </div>
      {savedKeyAvailable && keyMode !== 'saved' && (
        <a className="small ga-use-saved" onClick={() => setKeyMode('saved')}>
          ↩ use the saved key
        </a>
      )}
      {keyMode === 'saved' && (
        <a className="small ga-use-saved" onClick={() => setKeyMode('file')}>
          use a different key
        </a>
      )}
    </div>
  );

  return (
    <div>
      <div className="mg-as mb">
        <span className="small muted">{asLabel ?? AS_VERB[purpose]}</span>
        <div className="segmented">
          {connections.map((c) => (
            <button key={c.id} className={connId === c.id ? 'on' : ''} onClick={() => setConnId(c.id)} title={`Your ${providerInfo(c.provider).name} connection on ${c.host}${c.org ? `/${c.org}` : ''}`}>
              <span className="pv-mono sm" style={{ ['--pc' as string]: providerInfo(c.provider).color }}>
                {providerInfo(c.provider).mono}
              </span>{' '}
              {c.username}
            </button>
          ))}
          {options.map((o) => (
            <button key={o.method} className={!conn && method === o.method ? 'on' : ''} onClick={() => setMethod(o.method)} title={o.description}>
              {AS_ICON[o.method]} {o.method === 'pat' && account ? account : o.method === 'github-app' ? 'GitHub App' : o.label}
              {(o.hasSaved || (o.method === 'ssh' && savedSshKey) || (o.method === 'github-app' && githubApp)) && <span className="as-dot" title="Saved for this repository" />}
            </button>
          ))}
        </div>
      </div>
      {conn && (
        <p className="small auth-preset-note">
          ✓ Signs in with your {providerInfo(conn.provider).name} connection <strong>{conn.username}</strong>. The token stays encrypted in the app and is only sent to {conn.host}.
        </p>
      )}
      {!conn && method === preset.method && SOURCE_NOTE[preset.source] && <p className="small auth-preset-note">✓ {SOURCE_NOTE[preset.source]}</p>}
      {!conn && current?.viaHttps && (
        <p className="small muted auth-via" title={`This one push goes over HTTPS to ${current.viaHttps}; the remote URL is not changed.`}>
          ⇄ via HTTPS for this push
        </p>
      )}

      {!conn && method === 'ssh' && (
        <>
          {current?.viaSsh && (
            <p className="small muted auth-via" title={`This one push goes over SSH to ${current.viaSsh}; the remote URL is not changed.`}>
              ⇄ via SSH for this push
            </p>
          )}
          <SshKeyFields savedKey={savedSshKey} onChange={onSsh} />
        </>
      )}

      {!conn && method === 'pat' && (
        <div className="auth-form">
          {accountReady && (
            <label className="check">
              <input type="checkbox" checked={useAcct} onChange={(e) => setUseAcct(e.target.checked)} />
              <span>
                Use <strong>{account}</strong>’s sign-in
              </span>
            </label>
          )}
          {!(accountReady && useAcct) && patOption?.hasSaved && (
            <label className="check">
              <input type="checkbox" checked={useSavedPat} onChange={(e) => setUseSavedPat(e.target.checked)} />
              <span>Use the token saved for this repository</span>
            </label>
          )}
          {!(accountReady && useAcct) && !useSavedPat && (
            <>
              <div className="grid-2">
                <div className="field">
                  <label>Username</label>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={provider && provider.id !== 'github' ? (providerInfo(provider.id).connect?.gitUsername ? `${providerInfo(provider.id).connect!.gitUsername} (${providerInfo(provider.id).name} default)` : 'your username') : 'x-access-token (GitHub default)'} autoComplete="off" spellCheck={false} />
                </div>
                <div className="field">
                  <label>Personal access token</label>
                  <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… or github_pat_…" autoComplete="off" spellCheck={false} />
                </div>
              </div>
              {canSave && (
                <label className="check small">
                  <input type="checkbox" checked={savePat} onChange={(e) => setSavePat(e.target.checked)} />
                  <span>Save for this repository</span>
                </label>
              )}
            </>
          )}
        </div>
      )}

      {!conn && method === 'github-app' && (
        <div className="auth-form">
          {tokenMode === 'generate' && (
            <>
              {appFields}
              <a className="small ga-alt" onClick={() => setTokenMode('existing')} title="Paste an installation token you already have">
                or paste an installation token
              </a>
            </>
          )}

          {tokenMode === 'existing' && (
            <div className="mt">
              {generated ? (
                <div className="card" style={{ marginBottom: 8 }}>
                  <div className="row">
                    <span className="token-box grow">{generated.maskedToken}</span>
                    <button className="btn sm" onClick={copyGenerated}>
                      Copy
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        if (tokenHandleRef.current) void call('github:discardToken', { handle: tokenHandleRef.current }).catch(() => undefined);
                        tokenHandleRef.current = null;
                        setGenerated(null);
                      }}
                    >
                      Discard
                    </button>
                  </div>
                  <div className="small muted mt">
                    {Object.entries(generated.permissions)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(', ')}{' '}
                    · revoked {new Date(generated.clearsAt).toLocaleTimeString()}
                  </div>
                </div>
              ) : (
                <>
                  <div className="ga-tok">
                    <input type="password" value={existingToken} onChange={(e) => setExistingToken(e.target.value)} placeholder="Installation token · ghs_…" autoComplete="off" spellCheck={false} aria-label="Installation token" />
                    <a className="small" onClick={() => setTokenMode('generate')}>
                      generate instead
                    </a>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!conn && method === 'system' && (
        <p className="small muted auth-via" title="SSH remotes use ssh-agent / ~/.ssh; HTTPS remotes use Git Credential Manager">
          💻 Uses the Git sign-in already on this computer.
        </p>
      )}
    </div>
  );
}
