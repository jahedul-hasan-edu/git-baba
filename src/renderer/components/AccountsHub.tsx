import { useMemo, useState } from 'react';
import { PROVIDERS, providerInfo, type ProviderId } from '../../shared/providers';
import { AddAccountDialog } from '../dialogs/AddAccountDialog';
import { SignOutDialog } from '../dialogs/SignOutDialog';
import { announceConnections, useAllAccounts, type AnyAccount } from '../hooks/useAllAccounts';
import { call } from '../services/api';
import { useApp } from '../state/AppState';
import { ConnectFlow } from './ConnectFlow';
import { AccountRepos, LISTABLE } from './AccountRepos';
import { CloneDialog } from '../dialogs/CloneDialog';
import { Avatar } from './github/common';
import { Modal } from './Modal';
import { ProviderMono } from './ProviderMono';
import { ProvidersDialog } from './ProvidersDialog';

type Rail = 'all' | ProviderId;

/**
 * File → Accounts: every account the app knows, grouped by provider. The rail counts accounts per provider;
 * each card shows how many repositories belong to it and what can be done with it (sign in or out, manage,
 * remove). There is no "current account" to pick here — opening a repository uses its own account.
 */
export function AccountsHub({ onClose }: { onClose: () => void }) {
  const { setAccounts, refreshSession, refreshRepos, setView, showError, toast, bump, selectRepo } = useApp();
  const { all, reload, setConnections } = useAllAccounts();
  const [rail, setRail] = useState<Rail>('all');
  const [adding, setAdding] = useState<ProviderId | 'pick' | null>(null);
  const [signIn, setSignIn] = useState<AnyAccount | null>(null);
  const [signOut, setSignOut] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  // One account's repositories open at a time; Clone opens over this window with the account preselected.
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [cloning, setCloning] = useState<{ from: string; url?: string } | null>(null);
  // Picking another provider closes a connect form that belongs to a different one.
  const pickRail = (r: Rail) => {
    setRail(r);
    setAdding((a) => (a === r ? a : null));
  };
  const startAdding = (pid: ProviderId) => {
    setAdding(pid);
    if (rail !== 'all' && rail !== pid) setRail(pid);
    if (rail === 'all' && count(pid) === 0) setRail(pid);
  };

  const count = (p: ProviderId) => all.filter((a) => a.provider === p).length;
  const used = PROVIDERS.filter((p) => count(p.id) > 0);
  const unused = PROVIDERS.filter((p) => count(p.id) === 0);
  const shown = useMemo(() => (rail === 'all' ? used.map((p) => p.id) : [rail]), [rail, used]);
  const openRepo = (id: string) => {
    onClose();
    selectRepo(id);
  };

  const manage = async (a: AnyAccount) => {
    if (a.kind !== 'github') return;
    try {
      // The account window manages the account in use: make this one it first.
      if (!a.inUse) {
        setAccounts(await call('accounts:setActive', { accountId: a.id }));
        await refreshSession().catch(() => undefined);
      }
      onClose();
      setView('accounts');
    } catch (e) {
      showError(e);
    }
  };
  const removeConnection = async (id: string) => {
    try {
      setConnections(await call('providers:remove', { id, confirmed: true }));
      setRemoving(null);
      announceConnections();
      toast('Connection removed — its token was deleted from this computer');
      await refreshRepos().catch(() => undefined);
    } catch (e) {
      showError(e);
    }
  };

  const card = (a: AnyAccount) => (
    <div key={a.key} className="acx-cardwrap">
    <div className={`acx-card ${a.inUse ? 'inuse' : ''} ${browsing === a.key ? 'open' : ''}`}>
      <span className="acx-av">
        {a.kind === 'github' ? <Avatar login={a.login} size={34} /> : <span className="acx-ini">{(a.name ?? a.login).slice(0, 2).toUpperCase()}</span>}
        <span className={`acx-dot ${a.status.tone}`} title={a.status.title} />
      </span>
      <span className="acx-text">
        <strong className="ellipsis">{a.login}</strong>
        <span className="small muted ellipsis">
          {a.host}
          {a.org ? `/${a.org}` : ''}
          {a.name && a.name !== a.login ? ` · ${a.name}` : ''}
        </span>
      </span>
      <span className="acx-meta">
        <span className={`acx-chip ${a.status.tone}`} title={a.status.title}>
          {a.status.label}
        </span>
        <span className="acx-repos" title={`${a.repos} repositor${a.repos === 1 ? 'y' : 'ies'} in the sidebar`}>
          {a.repos} repo{a.repos === 1 ? '' : 's'}
        </span>
        {a.inUse && (
          <span className="acx-inuse" title="Used by the repository that is open now">
            in use
          </span>
        )}
      </span>
      <span className="acx-acts">
        {a.kind === 'github' || LISTABLE.has(a.provider) ? (
          <button className={`btn sm ${browsing === a.key ? 'primary' : ''}`} onClick={() => (a.kind === 'github' ? setCloning({ from: a.key }) : setBrowsing((b) => (b === a.key ? null : a.key)))} title={a.kind === 'github' ? 'Browse and clone its repositories' : 'Its repositories on the server'}>
            {a.kind === 'github' ? '⤓ Clone…' : browsing === a.key ? 'Repos ▴' : 'Repos ▾'}
          </button>
        ) : (
          <button className="btn sm" onClick={() => setCloning({ from: a.key })} title="Clone a repository from this server by its address">
            ⤓ Clone…
          </button>
        )}
        {a.kind === 'github' ? (
          <>
            {a.status.tone !== 'ok' && (
              <button className="btn sm" onClick={() => setSignIn(a)}>
                {a.github?.method === 'ssh' ? '⬆ Upgrade' : 'Sign in'}
              </button>
            )}
            <button className="btn sm ghost" onClick={() => void manage(a)} title="Profile, sessions, keys and Apps of this account">
              Manage
            </button>
            <button className="acx-x" onClick={() => setSignOut(a.id)} title="Sign out of this account">
              ⎋
            </button>
          </>
        ) : removing === a.id ? (
          <>
            <button className="btn sm danger" onClick={() => void removeConnection(a.id)}>
              Remove
            </button>
            <button className="btn sm ghost" onClick={() => setRemoving(null)}>
              Keep
            </button>
          </>
        ) : (
          <button className="acx-x" onClick={() => setRemoving(a.id)} title="Remove this connection (deletes its token)">
            ✕
          </button>
        )}
      </span>
    </div>
    {browsing === a.key && <AccountRepos account={a} onOpen={openRepo} onClone={(url) => setCloning({ from: a.key, url: url || undefined })} />}
    </div>
  );

  return (
    <Modal title="Accounts" icon="👥" size="wide" onClose={onClose}>
      <div className="acx">
        <nav className="acx-rail" aria-label="Providers">
          <button className="acx-add" onClick={() => (rail === 'all' ? setAdding((x) => (x === 'pick' ? null : 'pick')) : startAdding(rail))} title={rail === 'all' ? 'Add an account on any provider' : `Add a ${providerInfo(rail).name} account`}>
            ＋ Add account
          </button>
          <button className={`acx-rail-item ${rail === 'all' ? 'on' : ''}`} onClick={() => pickRail('all')}>
            <span className="acx-rail-all">◎</span>
            <span className="grow">All</span>
            <span className="acx-n">{all.length}</span>
          </button>
          {used.map((p) => (
            <button key={p.id} className={`acx-rail-item ${rail === p.id ? 'on' : ''}`} onClick={() => pickRail(p.id)}>
              <ProviderMono id={p.id} size={20} />
              <span className="grow ellipsis">{p.name}</span>
              <span className="acx-n">{count(p.id)}</span>
            </button>
          ))}
          {unused.length > 0 && <div className="acx-rail-h">Not connected</div>}
          {unused.map((p) => (
            <button key={p.id} className={`acx-rail-item dim ${rail === p.id ? 'on' : ''}`} onClick={() => pickRail(p.id)}>
              <ProviderMono id={p.id} size={20} />
              <span className="grow ellipsis">{p.name}</span>
            </button>
          ))}
          <span className="grow" />
          <button className="acx-rail-link small" onClick={() => setCompare(true)}>
            Compare providers →
          </button>
        </nav>

        <section className="acx-main">
          {adding === 'pick' && (
            <div className="acx-pick">
              {PROVIDERS.filter((p) => p.id === 'github' || p.connect).map((p) => (
                <button key={p.id} className="acx-pick-tile" onClick={() => startAdding(p.id)} style={{ ['--pc' as string]: p.color }}>
                  <ProviderMono id={p.id} size={28} />
                  <span>{p.name}</span>
                </button>
              ))}
              <button className="acx-pick-x" onClick={() => setAdding(null)} aria-label="Cancel">
                ×
              </button>
            </div>
          )}
          <div className="acx-groups">
            {shown.map((pid) => {
              const p = providerInfo(pid);
              const list = all.filter((a) => a.provider === pid);
              return (
                <div key={pid} className="acx-group" style={{ ['--pc' as string]: p.color }}>
                  <div className="acx-group-h">
                    <ProviderMono id={pid} size={18} />
                    <strong>{p.name}</strong>
                    <span className="acx-n">{list.length}</span>
                    <span className="grow" />
                    {(pid === 'github' || p.connect) && list.length > 0 && (
                      <button className="btn sm ghost" onClick={() => startAdding(pid)}>
                        ＋ another
                      </button>
                    )}
                  </div>
                  {adding === pid && pid !== 'github' && p.connect && (
                    <ConnectFlow
                      key={pid}
                      provider={pid}
                      onCancel={() => setAdding(null)}
                      onDone={async (c) => {
                        await reload();
                        announceConnections();
                        setAdding(null);
                        toast(`Connected ${providerInfo(c.provider).name} as ${c.username}`);
                        await refreshRepos().catch(() => undefined);
                        bump();
                        if (LISTABLE.has(c.provider)) setBrowsing(`conn:${c.id}`);
                      }}
                    />
                  )}
                  {list.length ? (
                    list.map(card)
                  ) : adding === pid && pid !== 'github' ? null : (
                    <button className="acx-empty" onClick={() => (pid === 'github' || p.connect ? startAdding(pid) : setCompare(true))}>
                      <ProviderMono id={pid} size={36} />
                      <span>
                        <strong>{pid === 'github' || p.connect ? `Connect ${p.name}` : `${p.name} works without an account`}</strong>
                        <span className="small muted">{pid === 'github' || p.connect ? 'Clone, push and see its repositories from the app' : p.gitAuthHint}</span>
                      </span>
                    </button>
                  )}
                </div>
              );
            })}
            {rail === 'all' && all.length === 0 && (
              <div className="acx-none">
                <div className="acx-none-ico">👥</div>
                <strong>No accounts yet</strong>
                <span className="small muted">Local repositories work without one. Add an account to clone, push and get notifications.</span>
              </div>
            )}
          </div>
        </section>
      </div>
      {(adding === 'github' || signIn) && (
        <AddAccountDialog
          account={signIn?.github}
          onClose={() => {
            setAdding(null);
            setSignIn(null);
          }}
        />
      )}
      {signOut && <SignOutDialog initial={signOut} onClose={() => setSignOut(null)} />}
      {compare && <ProvidersDialog onClose={() => setCompare(false)} />}
      {cloning && (
        <CloneDialog
          from={cloning.from}
          initialRepository={cloning.url}
          onClose={() => setCloning(null)}
          onCloned={(r) => {
            setCloning(null);
            bump();
            openRepo(r.id);
          }}
        />
      )}
    </Modal>
  );
}
