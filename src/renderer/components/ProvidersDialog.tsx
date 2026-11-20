import { useEffect, useState } from 'react';
import type { ProviderConnection } from '../../shared/types';
import { PROVIDERS, providerInfo, type ProviderId, type ProviderInfo, type Support } from '../../shared/providers';
import { call, toFriendly } from '../services/api';
import { useApp } from '../state/AppState';
import { Modal } from './Modal';
import { ProviderMono } from './ProviderMono';

const SUPPORT: Record<'app' | 'web', { label: string; cls: string }> = {
  app: { label: 'In the app', cls: 'app' },
  web: { label: 'On the website', cls: 'web' },
};

function Feature({ name, s }: { name: string; s: Support }) {
  return (
    <span className={`pvd-feat f-${s ?? 'none'}`} title={s ? `${name}: ${SUPPORT[s].label.toLowerCase()}` : `${name}: not available`}>
      <i aria-hidden>{s === 'app' ? '●' : s === 'web' ? '↗' : '–'}</i>
      {name}
    </span>
  );
}

/** Where to create a token on this server (for the form's "Create a token" link). */
function tokenPage(p: ProviderInfo, host: string, org: string): string | null {
  if (p.id === 'gitlab') return `https://${host || 'gitlab.com'}/-/user_settings/personal_access_tokens`;
  if (p.id === 'gitea') return host ? `https://${host}/user/settings/applications` : null;
  if (p.id === 'azure') return org ? `https://dev.azure.com/${encodeURIComponent(org)}/_usersSettings/tokens` : null;
  return p.connect?.tokenUrl ?? null;
}

/**
 * Every Git hosting provider the app works with, what it can do for each (in the app, on the website, or not
 * at all), the connections you have, and a short form to connect another one.
 */
export function ProvidersDialog({ onClose, focus }: { onClose: () => void; focus?: ProviderId }) {
  const { showError, toast, setView, accounts, bump, refreshRepos } = useApp();
  const [conns, setConns] = useState<ProviderConnection[]>([]);
  const [form, setForm] = useState<{ provider: ProviderId; host: string; token: string; username: string; email: string; org: string } | null>(() => {
    const p = focus ? providerInfo(focus) : null;
    return p?.connect ? { provider: p.id, host: p.id === 'gitea' ? '' : (p.host ?? ''), token: '', username: '', email: '', org: '' } : null;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    void call('providers:connections').then(setConns).catch(() => undefined);
  }, []);

  const githubCount = accounts?.accounts.length ?? 0;
  const connected = (id: ProviderId) => (id === 'github' ? githubCount : conns.filter((c) => c.provider === id).length);
  const total = PROVIDERS.reduce((n, p) => n + (connected(p.id) > 0 ? 1 : 0), 0);

  const open = (url: string | null) => url && void call('shell:openExternal', { url }).catch(showError);
  const startConnect = (p: ProviderInfo) => {
    setErr(null);
    setForm({ provider: p.id, host: p.id === 'gitea' ? '' : (p.host ?? ''), token: '', username: '', email: '', org: '' });
  };
  const submit = async () => {
    if (!form) return;
    setBusy(true);
    setErr(null);
    try {
      const c = await call('providers:connect', {
        provider: form.provider,
        host: form.host || undefined,
        token: form.token.trim(),
        username: form.username.trim() || undefined,
        email: form.email.trim() || undefined,
        org: form.org.trim() || undefined,
      });
      setConns(await call('providers:connections'));
      setForm(null);
      toast(`Connected ${providerInfo(c.provider).name} as ${c.username}`);
      // Repositories on a newly known self-hosted server now show their provider.
      await refreshRepos().catch(() => undefined);
      bump();
    } catch (e) {
      setErr(toFriendly(e).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      setConns(await call('providers:remove', { id, confirmed: true }));
      setRemoving(null);
      toast('Connection removed — its token was deleted from this computer');
      await refreshRepos().catch(() => undefined);
    } catch (e) {
      showError(e);
    }
  };

  const fp = form ? providerInfo(form.provider) : null;
  return (
    <Modal title="Git providers" size="wide" onClose={onClose}>
      <div className="pvd">
        <p className="pvd-sum">
          Git Baba works with <strong>{PROVIDERS.length} kinds of Git hosting</strong>. Everything Git does runs in the app for all of them; the rest is shown per provider.
          <span className="pvd-count">{total} connected</span>
        </p>
        <div className="pvd-legend small muted">
          <span className="pvd-feat f-app">
            <i>●</i>In the app
          </span>
          <span className="pvd-feat f-web">
            <i>↗</i>On the provider's website
          </span>
          <span className="pvd-feat f-none">
            <i>–</i>Not available
          </span>
        </div>
        <div className="pvd-grid">
          {PROVIDERS.map((p) => {
            const mine = conns.filter((c) => c.provider === p.id);
            const n = connected(p.id);
            return (
              <div key={p.id} className={`pvd-card ${n ? 'on' : ''}`} style={{ ['--pc' as string]: p.color }}>
                <div className="pvd-head">
                  <ProviderMono id={p.id} size={30} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <strong>{p.name}</strong>
                    <div className="small muted">{p.selfHosted ? (p.host ? `${p.host} or self-hosted` : 'Any server') : p.host}</div>
                  </div>
                  {n > 0 && <span className="pvd-n">{n} connected</span>}
                </div>
                <div className="pvd-feats">
                  <Feature name="Git" s={p.features.git} />
                  <Feature name="Sign-in" s={p.features.signIn} />
                  <Feature name={p.tabs.pulls ?? 'Pull requests'} s={p.features.pullRequests} />
                  <Feature name={p.tabs.pipelines ?? 'Pipelines'} s={p.features.pipelines} />
                  <Feature name="Insights" s={p.features.insights} />
                </div>
                {mine.map((c) => (
                  <div key={c.id} className="pvd-conn">
                    <span className="ellipsis grow" title={`${c.username} @ ${c.host}${c.org ? `/${c.org}` : ''}`}>
                      <strong>{c.displayName ?? c.username}</strong> <span className="muted">{c.host === p.host ? (c.org ?? '') : c.host}</span>
                    </span>
                    {!c.remembered && <span className="pvd-tag" title="No OS encryption available: kept for this session only">session</span>}
                    {removing === c.id ? (
                      <>
                        <button className="btn sm danger" onClick={() => void remove(c.id)}>
                          Remove
                        </button>
                        <button className="btn sm ghost" onClick={() => setRemoving(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button className="pvd-x" onClick={() => setRemoving(c.id)} title="Remove this connection">
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <div className="pvd-foot">
                  {p.id === 'github' ? (
                    <button
                      className="btn sm"
                      onClick={() => {
                        onClose();
                        setView('accounts');
                      }}
                    >
                      Manage GitHub accounts
                    </button>
                  ) : p.connect ? (
                    <button className="btn sm" onClick={() => startConnect(p)}>
                      ＋ Connect {mine.length ? 'another' : ''}
                    </button>
                  ) : (
                    <span className="small muted">{p.gitAuthHint}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {form && fp?.connect && (
          <div className="pvd-form" style={{ ['--pc' as string]: fp.color }}>
            <div className="pvd-form-head">
              <ProviderMono id={fp.id} size={24} />
              <strong>Connect {fp.name}</strong>
              <span className="grow" />
              <button className="btn sm ghost" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
            </div>
            <div className="grid-2">
              {(fp.id === 'gitlab' || fp.id === 'gitea') && (
                <div className="field">
                  <label>Server</label>
                  <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder={fp.id === 'gitlab' ? 'gitlab.com or gitlab.your-company.com' : 'codeberg.org or git.your-company.com'} spellCheck={false} />
                </div>
              )}
              {fp.connect.needsOrg && (
                <div className="field">
                  <label>Organization</label>
                  <input value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })} placeholder="dev.azure.com/your-org" spellCheck={false} />
                </div>
              )}
              {fp.connect.needsUsername && (
                <>
                  <div className="field">
                    <label>Bitbucket username</label>
                    <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} spellCheck={false} />
                  </div>
                  <div className="field">
                    <label>Atlassian account email</label>
                    <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="checks the API token" spellCheck={false} />
                  </div>
                </>
              )}
              <div className="field">
                <label>{fp.connect.tokenName}</label>
                <input type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} autoComplete="off" spellCheck={false} />
              </div>
            </div>
            <p className="small muted">
              {fp.connect.tokenHelp}{' '}
              {tokenPage(fp, form.host.trim(), form.org.trim()) && <a onClick={() => open(tokenPage(fp, form.host.trim(), form.org.trim()))}>Create a token ↗</a>}
            </p>
            <p className="small muted">Checked with {fp.name} now, then kept encrypted on this computer and only sent to that server.</p>
            {err && <div className="banner danger small">{err}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" disabled={busy || !form.token.trim() || (fp.connect.needsOrg && !form.org.trim()) || (fp.connect.needsUsername && !form.username.trim()) || ((fp.id === 'gitea' || fp.id === 'gitlab') && !form.host.trim())} onClick={() => void submit()}>
                {busy ? 'Checking…' : `Connect ${fp.name}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * The welcome screen: every provider as a large tile with its logo — connected ones lit with a count, what
 * works in the app (●) or on the website (↗) as small marks. A click connects it (or manages GitHub accounts).
 */
export function ProviderGallery() {
  const { accounts, setView } = useApp();
  const [conns, setConns] = useState<ProviderConnection[]>([]);
  const [open, setOpen] = useState<{ focus?: ProviderId } | null>(null);
  useEffect(() => {
    if (!open) void call('providers:connections').then(setConns).catch(() => undefined);
  }, [open]);
  const n = (id: ProviderId) => (id === 'github' ? accounts?.accounts.length ?? 0 : conns.filter((c) => c.provider === id).length);
  const marks: [keyof ProviderInfo['features'], string][] = [
    ['git', 'Git'],
    ['signIn', 'Sign-in'],
    ['pullRequests', 'Pull requests'],
    ['pipelines', 'Pipelines'],
  ];
  return (
    <>
      <div className="pvg">
        {PROVIDERS.map((p, i) => {
          const count = n(p.id);
          return (
            <button
              key={p.id}
              className={`pvg-tile ${count ? 'on' : ''}`}
              style={{ ['--pc' as string]: p.color, animationDelay: `${i * 45}ms` }}
              onClick={() => (p.id === 'github' ? setView('accounts') : setOpen({ focus: p.connect ? p.id : undefined }))}
              title={`${p.name} — ${p.blurb}`}
            >
              <span className="pvg-logo">
                <ProviderMono id={p.id} size={46} />
                {count > 0 && <span className="pvg-on">✓</span>}
              </span>
              <strong>{p.name}</strong>
              <span className="pvg-marks" aria-label="What works">
                {marks.map(([k, label]) => {
                  const s = p.features[k];
                  return (
                    <i key={k} className={`m-${s ?? 'none'}`} title={`${label}: ${s === 'app' ? 'in the app' : s === 'web' ? 'on the website' : 'not available'}`}>
                      {s === 'app' ? '●' : s === 'web' ? '↗' : '·'}
                    </i>
                  );
                })}
              </span>
              <span className="pvg-state">{count ? `${count} connected` : p.connect ? 'Connect' : p.id === 'github' ? 'Sign in' : 'Ready'}</span>
            </button>
          );
        })}
      </div>
      <button className="pvg-more" onClick={() => setOpen({})}>
        Compare providers →
      </button>
      {open && <ProvidersDialog focus={open.focus} onClose={() => setOpen(null)} />}
    </>
  );
}
