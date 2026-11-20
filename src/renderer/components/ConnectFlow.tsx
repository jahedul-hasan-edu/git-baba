import { useMemo, useRef, useState } from 'react';
import type { ProviderConnection } from '../../shared/types';
import { providerInfo, type ProviderId } from '../../shared/providers';
import { call, toFriendly } from '../services/api';
import { useApp } from '../state/AppState';
import { ProviderMono } from './ProviderMono';

/** Recognises a pasted token by its shape, so the user sees at once whether it is the right kind. */
function tokenKind(provider: ProviderId, t: string): { ok: boolean; label: string } | null {
  const v = t.trim();
  if (!v) return null;
  if (/\s/.test(v)) return { ok: false, label: 'Has spaces' };
  if (/^(gh[pousr]_|github_pat_)/.test(v)) return { ok: false, label: 'GitHub token' };
  if (provider === 'gitlab') return /^glpat-/.test(v) ? { ok: true, label: 'GitLab token' } : { ok: true, label: 'Token' };
  if (provider === 'bitbucket') return /^ATAT/.test(v) ? { ok: true, label: 'Atlassian API token' } : { ok: true, label: 'Token' };
  if (provider === 'gitea') return /^[0-9a-f]{40}$/.test(v) ? { ok: true, label: 'Access token' } : { ok: true, label: 'Token' };
  if (provider === 'azure') return v.length >= 52 ? { ok: true, label: 'Azure PAT' } : { ok: true, label: 'Token' };
  return { ok: true, label: 'Token' };
}

/** Where to create the token — GitLab even pre-fills the name and scopes. */
function tokenPage(provider: ProviderId, host: string, org: string): string | null {
  if (provider === 'gitlab') return `https://${host}/-/user_settings/personal_access_tokens?name=Git%20Baba&scopes=read_user,write_repository,read_api`;
  if (provider === 'gitea') return `https://${host}/user/settings/applications`;
  if (provider === 'azure') return org ? `https://dev.azure.com/${encodeURIComponent(org)}/_usersSettings/tokens` : null;
  if (provider === 'bitbucket') return 'https://id.atlassian.com/manage-profile/security/api-tokens';
  return null;
}

const SCOPES: Partial<Record<ProviderId, string[]>> = {
  gitlab: ['read_user', 'write_repository', 'read_api'],
  gitea: ['repository: read & write', 'user: read'],
  azure: ['Code: read & write'],
  bitbucket: ['Repositories: read & write', 'Account: read'],
};

type Phase = { k: 'idle' } | { k: 'checking' } | { k: 'error'; msg: string } | { k: 'done'; conn: ProviderConnection };

/**
 * Connect a provider in three steps that do the work for the user: pick the server (or organization) from what
 * the app already knows, open the token page with everything pre-filled, then paste — the token is recognised
 * and checked at once, and the account appears.
 */
export function ConnectFlow({ provider, onDone, onCancel }: { provider: ProviderId; onDone: (c: ProviderConnection) => void; onCancel: () => void }) {
  const { repos, showError } = useApp();
  const info = providerInfo(provider);
  // Servers / organizations the app has already seen in repository remotes.
  const known = useMemo(() => {
    const hosts = new Set<string>();
    const orgs = new Set<string>();
    for (const r of repos) {
      if (r.provider?.id !== provider) continue;
      if (r.provider.host) hosts.add(r.provider.host);
      if (r.provider.org) orgs.add(r.provider.org);
    }
    if (info.host && provider !== 'azure') hosts.add(info.host);
    return { hosts: [...hosts], orgs: [...orgs] };
  }, [repos, provider, info.host]);

  const fixedHost = provider === 'bitbucket' ? 'bitbucket.org' : provider === 'azure' ? 'dev.azure.com' : null;
  const [host, setHost] = useState(fixedHost ?? (known.hosts[0] ?? ''));
  const [typingHost, setTypingHost] = useState(!fixedHost && known.hosts.length === 0);
  const [org, setOrg] = useState(known.orgs[0] ?? '');
  const [typingOrg, setTypingOrg] = useState(known.orgs.length === 0);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [reveal, setReveal] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const tokenRef = useRef<HTMLInputElement>(null);

  const where = provider === 'azure' ? !!org.trim() : provider === 'bitbucket' ? !!username.trim() : !!host.trim();
  const page = tokenPage(provider, host.trim() || info.host || '', org.trim());
  const kind = tokenKind(provider, token);
  const step = phase.k === 'done' ? 3 : where ? 2 : 1;

  const check = async (t = token) => {
    const v = t.trim();
    if (!v || !where || phase.k === 'checking') return;
    setPhase({ k: 'checking' });
    try {
      const conn = await call('providers:connect', {
        provider,
        host: fixedHost ? undefined : host.trim(),
        token: v,
        username: username.trim() || undefined,
        email: email.trim() || undefined,
        org: org.trim() || undefined,
      });
      setToken('');
      setPhase({ k: 'done', conn });
    } catch (e) {
      setPhase({ k: 'error', msg: toFriendly(e).message });
    }
  };
  const pasteToken = async () => {
    try {
      const { text } = await call('app:readClipboard');
      if (!text) return tokenRef.current?.focus();
      setToken(text);
      void check(text);
    } catch (e) {
      showError(e);
    }
  };
  const open = (url: string | null) => url && void call('shell:openExternal', { url }).catch(showError);

  return (
    <div className="cf" style={{ ['--pc' as string]: info.color }}>
      <div className="cf-head">
        <ProviderMono id={provider} size={34} />
        <div className="cf-steps" aria-label="Steps">
          {['Where', 'Token', 'Ready'].map((label, i) => (
            <span key={label} className={`cf-step ${step > i + 1 ? 'done' : step === i + 1 ? 'on' : ''}`}>
              <i>{step > i + 1 ? '✓' : i + 1}</i>
              {label}
            </span>
          ))}
        </div>
        <button className="cf-x" onClick={onCancel} title="Close" aria-label="Close">
          ✕
        </button>
      </div>

      {phase.k === 'done' ? (
        <div className="cf-ready">
          <span className="cf-avatar">{(phase.conn.displayName ?? phase.conn.username).slice(0, 2).toUpperCase()}</span>
          <div className="cf-who">
            <strong>{phase.conn.displayName ?? phase.conn.username}</strong>
            <span className="mono">
              {phase.conn.username} · {phase.conn.host}
              {phase.conn.org ? `/${phase.conn.org}` : ''}
            </span>
          </div>
          <span className="cf-lock" title={phase.conn.remembered ? 'Encrypted on this computer, sent only to this server' : 'Kept for this session only'}>
            🔒
          </span>
          <button className="btn primary" onClick={() => onDone(phase.conn)}>
            Done
          </button>
        </div>
      ) : (
        <>
          {/* 1 · Where */}
          <div className="cf-row">
            <span className="cf-n">1</span>
            {provider === 'azure' ? (
              <div className="cf-chips">
                {known.orgs.map((o) => (
                  <button key={o} className={`cf-chip ${!typingOrg && org === o ? 'on' : ''}`} onClick={() => (setOrg(o), setTypingOrg(false))}>
                    dev.azure.com/<b>{o}</b>
                  </button>
                ))}
                {typingOrg ? (
                  <span className="cf-type">
                    dev.azure.com/
                    <input autoFocus value={org} onChange={(e) => setOrg(e.target.value)} placeholder="organization" spellCheck={false} />
                  </span>
                ) : (
                  <button className="cf-chip add" onClick={() => (setOrg(''), setTypingOrg(true))}>
                    ＋
                  </button>
                )}
              </div>
            ) : provider === 'bitbucket' ? (
              <div className="cf-chips">
                <span className="cf-type">
                  <span className="cf-pre">@</span>
                  <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" spellCheck={false} />
                </span>
                <span className="cf-type">
                  <span className="cf-pre">✉</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Atlassian email" spellCheck={false} />
                </span>
              </div>
            ) : (
              <div className="cf-chips">
                {known.hosts.map((h) => (
                  <button key={h} className={`cf-chip ${!typingHost && host === h ? 'on' : ''}`} onClick={() => (setHost(h), setTypingHost(false))}>
                    {h === info.host ? '☁ ' : '🏢 '}
                    <b>{h}</b>
                  </button>
                ))}
                {typingHost ? (
                  <span className="cf-type">
                    <span className="cf-pre">🏢</span>
                    <input autoFocus value={host} onChange={(e) => setHost(e.target.value)} placeholder={provider === 'gitlab' ? 'gitlab.company.com' : 'git.company.com'} spellCheck={false} />
                  </span>
                ) : (
                  <button className="cf-chip add" onClick={() => (setHost(''), setTypingHost(true))} title="Self-hosted server">
                    ＋ 🏢
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 2 · Token */}
          <div className={`cf-row ${where ? '' : 'off'}`}>
            <span className="cf-n">2</span>
            <div className="cf-token">
              <div className="cf-get">
                <button className="cf-open" disabled={!where || !page} onClick={() => open(page)}>
                  <ProviderMono id={provider} size={18} /> Get a token ↗
                </button>
                <span className="cf-scopes">
                  {(SCOPES[provider] ?? []).map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </span>
              </div>
              <div
                className={`cf-drop ${phase.k === 'checking' ? 'checking' : ''} ${phase.k === 'error' ? 'bad' : ''} ${kind?.ok ? 'ok' : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const t = e.dataTransfer.getData('text/plain').trim();
                  if (t) {
                    setToken(t);
                    void check(t);
                  }
                }}
              >
                <button className="cf-paste" disabled={!where || phase.k === 'checking'} onClick={() => void pasteToken()} title="Paste the token from the clipboard">
                  📋
                </button>
                <input
                  ref={tokenRef}
                  type={reveal ? 'text' : 'password'}
                  value={token}
                  disabled={!where || phase.k === 'checking'}
                  onChange={(e) => {
                    setToken(e.target.value);
                    if (phase.k === 'error') setPhase({ k: 'idle' });
                  }}
                  onPaste={(e) => {
                    const t = e.clipboardData.getData('text').trim();
                    if (t) {
                      e.preventDefault();
                      setToken(t);
                      void check(t);
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void check()}
                  placeholder="Paste token"
                  autoComplete="off"
                  spellCheck={false}
                />
                {kind && <span className={`cf-kind ${kind.ok ? '' : 'bad'}`}>{kind.label}</span>}
                <button className="cf-eye" onClick={() => setReveal((r) => !r)} title={reveal ? 'Hide' : 'Show'} disabled={!token}>
                  {reveal ? '🙈' : '👁'}
                </button>
                {phase.k === 'checking' ? (
                  <span className="cf-spin" aria-label="Checking" />
                ) : (
                  <button className="cf-go" disabled={!token.trim() || !where} onClick={() => void check()} title="Check and connect">
                    →
                  </button>
                )}
              </div>
              {phase.k === 'error' && <div className="cf-err">{phase.msg}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
