import { useEffect, useState } from 'react';
import type { ProviderConnection } from '../../shared/types';
import { PROVIDERS, type ProviderId, type ProviderInfo } from '../../shared/providers';
import { call } from '../services/api';
import { useApp } from '../state/AppState';
import { ProviderMono } from './ProviderMono';
import { openAccountsHub } from '../services/accountsHub';
import { CONNECTIONS_CHANGED } from '../hooks/useAllAccounts';

/**
 * The welcome screen: every provider as a large tile with its logo — connected ones lit with a count, what
 * works in the app (●) or on the website (↗) as small marks. A click connects it (or manages GitHub accounts).
 */
export function ProviderGallery() {
  const { accounts } = useApp();
  const [conns, setConns] = useState<ProviderConnection[]>([]);
  useEffect(() => {
    void call('providers:connections').then(setConns).catch(() => undefined);
    const on = () => void call('providers:connections').then(setConns).catch(() => undefined);
    window.addEventListener(CONNECTIONS_CHANGED, on);
    return () => window.removeEventListener(CONNECTIONS_CHANGED, on);
  }, []);
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
              onClick={() => openAccountsHub(p.id)}
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
    </>
  );
}
