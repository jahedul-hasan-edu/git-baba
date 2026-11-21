import { useEffect, useState } from 'react';
import type { ProviderConnection } from '../../shared/types';
import { PROVIDERS, providerInfo, type ProviderId, type ProviderInfo, type Support } from '../../shared/providers';
import { call } from '../services/api';
import { ConnectFlow } from './ConnectFlow';
import { useApp } from '../state/AppState';
import { Modal } from './Modal';
import { ProviderMono } from './ProviderMono';
import { openAccountsHub } from '../services/accountsHub';

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
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    void call('providers:connections').then(setConns).catch(() => undefined);
  }, []);

  const githubCount = accounts?.accounts.length ?? 0;
  const connected = (id: ProviderId) => (id === 'github' ? githubCount : conns.filter((c) => c.provider === id).length);
  const total = PROVIDERS.reduce((n, p) => n + (connected(p.id) > 0 ? 1 : 0), 0);

  const startConnect = (p: ProviderInfo) => {
    setForm({ provider: p.id, host: p.id === 'gitea' ? '' : (p.host ?? ''), token: '', username: '', email: '', org: '' });
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
          <ConnectFlow
            key={form.provider}
            provider={form.provider}
            onCancel={() => setForm(null)}
            onDone={async (c) => {
              setConns(await call('providers:connections'));
              setForm(null);
              toast(`Connected ${providerInfo(c.provider).name} as ${c.username}`);
              await refreshRepos().catch(() => undefined);
              bump();
            }}
          />
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
  const { accounts } = useApp();
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
              onClick={() => (p.id === 'github' ? openAccountsHub() : setOpen({ focus: p.connect ? p.id : undefined }))}
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
