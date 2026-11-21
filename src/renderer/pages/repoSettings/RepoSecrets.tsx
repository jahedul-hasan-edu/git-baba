import { useMemo, useState } from 'react';
import type { GhRepoContext, GhSecret, SecretScope, SecretsOverview } from '../../../shared/github';
import { ErrorPanel } from '../../components/ErrorPanel';
import { relTime, Skeleton, useGh, useMutation } from '../../components/github/common';
import { openExternal, SecureActionDialog } from '../../components/github/SecureActionDialog';
import { Modal } from '../../components/Modal';
import { call } from '../../services/api';
import { useApp } from '../../state/AppState';

import { Select } from '../../components/Select';
interface Store {
  key: string;
  scope: SecretScope;
  env?: string;
  icon: string;
  title: string;
  hint: string;
  secrets: GhSecret[] | null;
  error: string | null;
  manageable: boolean;
  protectedEnv?: boolean;
}

type Editing = { store: Store; name?: string } | null;
type Deleting = { store: Store; name: string } | null;

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stores(o: SecretsOverview): Store[] {
  const out: Store[] = [
    { key: 'repo', scope: 'repo', icon: '📦', title: 'Repository', hint: 'Available to every workflow in this repository.', secrets: o.repo, error: o.repoError, manageable: true },
    {
      key: 'copilot',
      scope: 'copilot',
      icon: '🤖',
      title: 'Copilot coding agent',
      hint: o.copilot.exists ? 'Secrets the Copilot coding agent can use (the “copilot” environment).' : 'Not set up yet — adding a secret creates the “copilot” environment for the agent.',
      secrets: o.copilot.exists ? o.copilot.secrets : [],
      error: o.copilot.error,
      manageable: true,
    },
    ...o.environments.map((e) => ({
      key: `env:${e.name}`,
      scope: 'env' as const,
      env: e.name,
      icon: e.protected ? '🛡' : '🌐',
      title: `Environment · ${e.name}`,
      hint: e.protected ? 'Protected environment — jobs may need approval before they can read these.' : 'Only jobs that target this environment can read these.',
      secrets: e.secrets,
      error: e.error,
      manageable: true,
      protectedEnv: e.protected,
    })),
  ];
  if (o.org) {
    out.push({
      key: 'org',
      scope: 'org',
      icon: '🏢',
      title: `Organisation · ${o.org.name}`,
      hint: o.org.manageable ? 'Shared with this repository by the organisation. You can manage organisation secrets.' : 'Shared with this repository by the organisation (read-only: managing them needs organisation admin).',
      secrets: o.org.secrets,
      error: o.org.error,
      manageable: o.org.manageable,
    });
  }
  return out;
}

/**
 * Every secret store that applies to this repository in one place — repository, Copilot coding agent,
 * environments and organisation — plus which workflows use each secret, and secrets referenced but missing.
 * Values are encrypted on this computer and are write-only: GitHub (and Git Baba) never shows them again.
 */
export function RepoSecrets({ repoId, ctx }: { repoId: string; ctx: GhRepoContext }) {
  const overview = useGh(() => call('gh:adminSecrets', { repoId }), [repoId]);
  const usage = useGh(() => call('gh:adminSecretUsage', { repoId }), [repoId]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Deleting>(null);
  const [newEnv, setNewEnv] = useState(false);
  const [active, setActive] = useState('repo');
  const [view, setView] = useState<'list' | 'matrix'>('list');

  const list = useMemo(() => (overview.data ? stores(overview.data) : []), [overview.data]);
  const defined = useMemo(() => new Set(list.flatMap((s) => (s.secrets ?? []).map((x) => x.name))), [list]);
  const missing = useMemo(() => Object.entries(usage.data ?? {}).filter(([n]) => !defined.has(n)), [usage.data, defined]);
  const query = q.trim().toUpperCase();
  const reload = () => {
    void overview.reload();
  };

  if (overview.error) return <ErrorPanel error={overview.error} />;
  if (!overview.data) return <Skeleton rows={6} />;

  const current = list.find((s) => s.key === active) ?? list[0];
  const names = [...defined].sort();
  const hits = query ? list.flatMap((s) => (s.secrets ?? []).filter((x) => x.name.includes(query)).map((x) => ({ s, x }))) : [];

  const row = (s: Store, x: GhSecret, showStore = false) => {
    const used = usage.data?.[x.name];
    return (
      <div key={`${s.key}:${x.name}`} className={`sx-row ${usage.data && !used ? 'idle' : ''}`}>
        <span className="sx-lock">🔒</span>
        <strong className="mono sx-name">{x.name}</strong>
        {showStore && <span className="sx-store-tag">{s.icon} {s.env ?? s.title}</span>}
        <span className="sx-uses grow">
          {used ? used.map((w) => <span key={w} className="wf-use">{w}</span>) : usage.data ? <span className="muted small">unused</span> : null}
        </span>
        <span className="small muted" title={x.updatedAt ?? undefined}>{relTime(x.updatedAt)}</span>
        {s.manageable && (
          <span className="sx-acts">
            <button className="sx-ib" onClick={() => setEditing({ store: s, name: x.name })} title="Replace the value">✎</button>
            <button className="sx-ib danger-text" onClick={() => setDeleting({ store: s, name: x.name })} title="Delete">🗑</button>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="sx">
      {/* Environments as tabs: each one is its own secret store. */}
      <div className="sx-envs" role="tablist">
        {list.map((s) => (
          <button key={s.key} role="tab" aria-selected={s.key === current.key && view === 'list' && !query} className={`sx-env ${s.key === current.key && view === 'list' && !query ? 'on' : ''} ${s.protectedEnv ? 'protected' : ''}`} onClick={() => (setActive(s.key), setView('list'), setQ(''))} title={s.hint}>
            <span>{s.icon}</span>
            <span className="ellipsis">{s.env ?? s.title.split(' · ')[0]}</span>
            <span className="sx-n">{s.secrets?.length ?? 0}</span>
          </button>
        ))}
        <button className="sx-env add" onClick={() => setNewEnv(true)} title="New environment">
          ＋
        </button>
        <span className="grow" />
        <div className="seg">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="One environment at a time">
            ☰
          </button>
          <button className={view === 'matrix' ? 'on' : ''} onClick={() => setView('matrix')} title="Every secret across every environment">
            ▦
          </button>
        </div>
        <div className="actions-search sx-search">
          <span>⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find…" spellCheck={false} />
        </div>
      </div>

      {missing.length > 0 && (
        <div className="sx-missing">
          <span className="text-warn">⚠ Missing</span>
          {missing.map(([n, wfs]) => (
            <button key={n} className="secret-missing" title={`Used in: ${wfs.join(', ')} — click to add`} onClick={() => setEditing({ store: list[0], name: n })}>
              {n} ＋
            </button>
          ))}
        </div>
      )}

      {query ? (
        <div className="sx-panel">
          {hits.length ? hits.map(({ s, x }) => row(s, x, true)) : <div className="sx-empty small muted">No secret matches “{q}”.</div>}
        </div>
      ) : view === 'matrix' ? (
        <div className="sx-panel sx-matrix-wrap">
          <table className="sx-matrix">
            <thead>
              <tr>
                <th />
                {list.map((s) => (
                  <th key={s.key} title={s.title}>
                    <span>{s.icon}</span> {s.env ?? s.title.split(' · ')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {names.map((n) => (
                <tr key={n}>
                  <td className="mono">{n}</td>
                  {list.map((s) => {
                    const has = (s.secrets ?? []).some((x) => x.name === n);
                    return (
                      <td key={s.key}>
                        {has ? (
                          <button className="sx-cell on" disabled={!s.manageable} onClick={() => setEditing({ store: s, name: n })} title={`Replace ${n} in ${s.title}`}>
                            ●
                          </button>
                        ) : (
                          <button className="sx-cell" disabled={!s.manageable} onClick={() => setEditing({ store: s, name: n })} title={`Add ${n} to ${s.title}`}>
                            ＋
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {names.length === 0 && (
                <tr>
                  <td colSpan={list.length + 1} className="sx-empty small muted">
                    No secrets yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`sx-panel ${current.protectedEnv ? 'protected' : ''}`}>
          <div className="sx-head">
            <span className="sx-head-ico">{current.icon}</span>
            <strong className="grow ellipsis" title={current.hint}>
              {current.title}
              {current.protectedEnv && <span className="badge warn sx-badge">needs approval</span>}
            </strong>
            {current.scope === 'env' && (
              <button className="btn sm ghost" onClick={() => openExternal(`https://github.com/${ctx.owner}/${ctx.name}/settings/environments`)} title="Reviewers, wait timers and branch limits">
                Rules ↗
              </button>
            )}
            {current.manageable && (
              <button className="btn sm primary" onClick={() => setEditing({ store: current })}>
                ＋ Secret
              </button>
            )}
          </div>
          {current.error && <div className="small text-danger sx-empty">{current.error}</div>}
          {!current.error && (current.secrets ?? []).length === 0 && (
            <div className="sx-empty">
              <span className="sx-empty-ico">🔐</span>
              <span className="small muted">Nothing here yet</span>
            </div>
          )}
          {(current.secrets ?? []).map((x) => row(current, x))}
        </div>
      )}

      {editing && <SecretEditor repoId={repoId} ctx={ctx} stores={list.filter((s) => s.manageable)} initial={editing} onClose={() => setEditing(null)} onDone={reload} />}
      {deleting && (
        <SecureActionDialog
          title={`Delete secret ${deleting.name}`}
          icon="🗑"
          danger
          confirmLabel="Delete secret"
          repoId={repoId}
          needs="admin access, or “Secrets: write” (fine-grained)"
          typeToConfirm={deleting.name}
          impact={usage.data?.[deleting.name] ? `Workflows that use it will fail: ${usage.data[deleting.name].join(', ')}.` : 'Any job that reads it gets an empty value.'}
          onClose={() => setDeleting(null)}
          onConfirm={async (auth) => {
            await call('gh:adminDeleteSecret', { repoId, scope: deleting.store.scope, env: deleting.store.env, name: deleting.name, auth, confirmed: true });
            reload();
          }}
        >
          <p>
            Deletes <strong className="mono">{deleting.name}</strong> from <strong>{deleting.store.title}</strong>. It cannot be recovered.
          </p>
        </SecureActionDialog>
      )}
      {newEnv && (
        <NewEnvDialog
          repoId={repoId}
          onClose={() => setNewEnv(false)}
          onDone={(name) => {
            reload();
            setActive(`env:${name}`);
            setView('list');
          }}
        />
      )}
    </div>
  );
}

/** Two steps: compose (store, name, value) → authenticate. The value lives only in this dialog and is cleared after use. */
function SecretEditor({ repoId, ctx, stores: list, initial, onClose, onDone }: { repoId: string; ctx: GhRepoContext; stores: Store[]; initial: NonNullable<Editing>; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [storeKey, setStoreKey] = useState(initial.store.key);
  const [name, setName] = useState(initial.name ?? '');
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [orgVisibility, setOrgVisibility] = useState<'all' | 'private' | 'selected'>('selected');
  const [step, setStep] = useState<1 | 2>(1);
  const store = list.find((s) => s.key === storeKey) ?? list[0];
  const upper = name.trim().toUpperCase();
  const exists = (store.secrets ?? []).some((x) => x.name === upper);
  const nameErr = !upper ? null : !NAME_RE.test(upper) ? 'Letters, digits and _ only, not starting with a digit.' : upper.startsWith('GITHUB_') ? 'Names starting with GITHUB_ are reserved.' : null;
  const looks = value.includes('PRIVATE KEY') ? 'a private key' : /^gh[pousr]_[A-Za-z0-9]{20,}$/.test(value.trim()) ? 'a GitHub token' : /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value.trim()) ? 'a JWT' : null;
  const close = () => {
    setValue('');
    onClose();
  };

  if (step === 2) {
    return (
      <SecureActionDialog
        title={`${exists ? 'Update' : 'Create'} secret ${upper}`}
        icon="🔐"
        confirmLabel={exists ? 'Replace value' : 'Save secret'}
        repoId={repoId}
        needs={store.scope === 'org' ? 'organisation admin, or “Organization secrets: write”' : 'admin access, or “Secrets: write” (fine-grained)'}
        impact={exists ? 'The current value is replaced for every workflow run that starts from now on.' : undefined}
        onClose={close}
        onConfirm={async (auth) => {
          await call('gh:adminPutSecret', { repoId, scope: store.scope, env: store.env, name: upper, value, orgVisibility: store.scope === 'org' ? orgVisibility : undefined, auth, confirmed: true });
          toast(`Secret ${upper} saved`);
          setValue('');
          onDone();
        }}
      >
        <div className="card">
          <dl className="kv">
            <dt>Secret</dt>
            <dd className="mono">{upper}</dd>
            <dt>Store</dt>
            <dd>
              {store.icon} {store.title}
            </dd>
            <dt>Value</dt>
            <dd>
              {'•'.repeat(Math.min(value.length, 24))} <span className="small muted">({value.length} characters)</span>
            </dd>
            <dt>Protection</dt>
            <dd className="small" title={`Sealed with ${ctx.owner}/${ctx.name}’s public key before it is sent`}>🔒 Encrypted here · write-only</dd>
          </dl>
        </div>
      </SecureActionDialog>
    );
  }

  return (
    <Modal
      title={exists ? `Update ${upper}` : 'New secret'}
      icon="🔐"
      size="wide"
      onClose={close}
      footer={
        <>
          <button className="btn cancel" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!upper || !!nameErr || !value} onClick={() => setStep(2)}>
            Review & authenticate →
          </button>
        </>
      }
    >
      <div className="field">
        <label>Where</label>
        <div className="store-picker">
          {list.map((s) => (
            <button key={s.key} className={`store-opt ${s.key === store.key ? 'on' : ''}`} onClick={() => setStoreKey(s.key)} disabled={!!initial.name}>
              <span>{s.icon}</span> {s.title}
            </button>
          ))}
        </div>
        <div className="hint">{store.hint}</div>
      </div>
      {store.scope === 'org' && (
        <div className="field">
          <label>Repository access</label>
          <Select value={orgVisibility} onChange={(e) => setOrgVisibility(e.target.value as typeof orgVisibility)}>
            <option value="selected">Only this repository (selected)</option>
            <option value="private">All private repositories</option>
            <option value="all">All repositories</option>
          </Select>
        </div>
      )}
      <div className={`field ${nameErr ? 'invalid' : ''}`}>
        <label>
          Name <span className="req">*</span>
        </label>
        <input className="mono" value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, '_'))} placeholder="API_TOKEN" disabled={!!initial.name} spellCheck={false} autoComplete="off" />
        {nameErr && <div className="field-hint">{nameErr}</div>}
        {!nameErr && upper && exists && !initial.name && <div className="small text-warn">A secret with this name exists — saving replaces its value.</div>}
      </div>
      <div className="field">
        <label>
          Value <span className="req">*</span>
        </label>
        <div className="secret-value">
          <textarea
            className={`code ${show ? '' : 'masked'}`}
            rows={4}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="Paste the value"
          />
          <button type="button" className="btn sm ghost" onClick={() => setShow((s) => !s)}>
            {show ? '🙈 Hide' : '👁 Show'}
          </button>
        </div>
        <div className="hint">
          {value.length} characters
          {looks ? ` · looks like ${looks}` : ''}
          {value !== value.trim() ? ' · ⚠ leading/trailing spaces' : ''}
        </div>
      </div>
    </Modal>
  );
}

function NewEnvDialog({ repoId, onClose, onDone }: { repoId: string; onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState('');
  const { busy, run } = useMutation();
  const ok = /^[^/\\'"]{1,255}$/.test(name.trim());
  return (
    <Modal
      title="New environment"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button className="btn cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!ok || busy}
            onClick={() =>
              void run(() => call('gh:adminCreateEnv', { repoId, name: name.trim() }).then(() => true), `Environment ${name.trim()} created`).then((r) => {
                if (r) {
                  onDone(name.trim());
                  onClose();
                }
              })
            }
          >
            Create
          </button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="production" autoFocus />
        <div className="hint">e.g. staging, production</div>
      </div>
    </Modal>
  );
}
