import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountCredentialInput, CreateRepoState, DirectorySelection, FriendlyError, RepoSummary } from '../../shared/types';
import { AccountCredentialFields } from '../components/AccountCredentialFields';
import { ErrorPanel } from '../components/ErrorPanel';
import { Modal } from '../components/Modal';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { call, onProgress, toFriendly } from '../services/api';
import { useApp } from '../state/AppState';
import { AddAccountDialog } from './AddAccountDialog';

import { Select } from '../components/Select';
import { ProviderMono } from '../components/ProviderMono';
import { providerInfo } from '../../shared/providers';
import { githubHost } from '../hooks/useAllAccounts';
type Stage = 'info' | 'summary' | 'workflow';

/**
 * Create Repository: information → summary → authenticate (at the point of creation) →
 * state-machine progress with retry / fix / cancel for each step.
 */
export function CreateRepoWizard({ onClose, onCreated, from }: { onClose: () => void; onCreated: (r: RepoSummary) => void; /** Preselect: `gh:<id>` or 'local'. */ from?: string }) {
  const { accounts, activeAccount, repos, bump, toast, refreshRepos } = useApp();
  const [stage, setStage] = useState<Stage>('info');
  const [folder, setFolder] = useState<DirectorySelection | null>(null);
  const [subfolder, setSubfolder] = useState('');
  const [localOnly, setLocalOnly] = useState(from === 'local' || !accounts?.accounts.length);
  const [accountId, setAccountId] = useState<string | null>(from?.startsWith('gh:') ? from.slice(3) : (activeAccount?.id ?? accounts?.accounts[0]?.id ?? null));
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [state, setState] = useState<CreateRepoState | null>(null);
  const [credential, setCredential] = useState<AccountCredentialInput | null>(null);
  const [credKey, setCredKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const onCred = useCallback((c: AccountCredentialInput | null) => setCredential(c), []);

  const account = accounts?.accounts.find((a) => a.id === accountId) ?? null;
  const owners = useMemo(() => (account ? [account.login, ...account.orgs] : []), [account]);

  useEffect(() => {
    if (account && !owners.includes(owner)) setOwner(account.login);
  }, [account, owners, owner]);

  // Live step updates pushed from the main process.
  useEffect(
    () =>
      onProgress((e) => {
        if (e.kind === 'create') setState((cur) => (cur && cur.workflowId === e.state.workflowId ? e.state : cur));
      }),
    [],
  );

  useEffect(() => {
    if (state?.phase === 'done' && state.repoId) {
      void refreshRepos().then(() => bump());
    }
  }, [state?.phase, state?.repoId, refreshRepos, bump]);

  const pickFolder = async () => {
    try {
      const p = await call('dialog:pickDirectory', { purpose: 'create' });
      if (p) {
        setFolder(p);
        if (!name) setName(p.path.split(/[\\/]/).pop() ?? '');
      }
    } catch (err) {
      setError(toFriendly(err));
    }
  };

  const localPath = folder ? (subfolder ? `${folder.path}${folder.path.endsWith('\\') || folder.path.endsWith('/') ? '' : '\\'}${subfolder}` : folder.path) : '';
  const nameValid = /^[A-Za-z0-9._-]{1,100}$/.test(name) && !name.endsWith('.git');
  const infoComplete = !!folder && nameValid && (localOnly || (!!account && !!owner));

  const start = async () => {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      const s = await call('create:start', {
        input: { selectionId: folder.selectionId, folderName: subfolder.trim() || undefined, accountId: localOnly ? null : accountId, name, owner: localOnly ? '' : owner, visibility, description: description.trim() || undefined, localOnly },
      });
      setFolder(null); // selection ids are single use
      setState(s);
      setStage('workflow');
    } catch (err) {
      setError(toFriendly(err));
    } finally {
      setBusy(false);
    }
  };

  const wf = async (fn: () => Promise<CreateRepoState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
    } catch (err) {
      setError(toFriendly(err));
    } finally {
      setBusy(false);
    }
  };

  const authenticate = () =>
    wf(async () => {
      const s = await call('create:authenticate', { workflowId: state!.workflowId, credential: credential! });
      setCredKey((k) => k + 1); // the typed token is cleared from the form after each attempt
      return s;
    });

  const finish = () => {
    const r = state?.repoId ? repos.find((x) => x.id === state.repoId) : null;
    if (r) {
      onCreated(r);
      toast(`${r.name} is ready. Review its files in Changes and make the first commit.`);
    }
    onClose();
  };

  const cancelWorkflow = async () => {
    if (state && state.phase !== 'done' && state.phase !== 'cancelled') {
      try {
        setState(await call('create:cancel', { workflowId: state.workflowId }));
        return;
      } catch {
        // workflow already gone
      }
    }
    onClose();
  };

  // ------------------------------------------------------------------

  if (stage === 'info' || stage === 'summary') {
    return (
      <Modal
        title="Create Repository"
        size="wide"
        onClose={onClose}
        locked={busy}
        footer={
          <>
            <span className="spacer" />
            <button className="btn cancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn primary" disabled={!infoComplete || busy} onClick={start}>
              {busy ? 'Starting…' : localOnly ? 'Create' : 'Create & sign in'}
            </button>
          </>
        }
      >
        <div className="repo-modal">
          {error && <ErrorPanel error={error} />}
          {/* Where it lives: one chip per account that can host it, or this computer only. */}
          <div className="from-strip" role="radiogroup" aria-label="Create on">
            {(accounts?.accounts ?? []).map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={!localOnly && accountId === a.id}
                className={`from-chip ${!localOnly && accountId === a.id ? 'on' : ''}`}
                onClick={() => {
                  setLocalOnly(false);
                  setAccountId(a.id);
                }}
                title={`GitHub · ${githubHost(a)}`}
                style={{ ['--pc' as string]: providerInfo('github').color }}
              >
                <ProviderMono id="github" size={16} />
                <span className="ellipsis">{a.login}</span>
                {githubHost(a) !== 'github.com' && <span className="from-host">{githubHost(a)}</span>}
              </button>
            ))}
            <button role="radio" aria-checked={localOnly} className={`from-chip url ${localOnly ? 'on' : ''}`} onClick={() => setLocalOnly(true)}>
              💻 Local only
            </button>
            <button className="from-add" onClick={() => setAddingAccount(true)} title="Add a GitHub account" aria-label="Add a GitHub account">
              ＋
            </button>
          </div>

          <div className="field">
            <label>Name</label>
            <input className={`cr-name ${name && !nameValid ? 'bad' : ''}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" spellCheck={false} autoFocus />
            {name && !nameValid && <span className="field-hint">Letters, numbers, . - _ only.</span>}
          </div>

          {!localOnly && (
            <div className="cr-row">
              <div className="field grow">
                <label>Owner</label>
                {accounts?.accounts.length ? (
                  <div className="row" style={{ gap: 6 }}>
                    <Select kind="account" value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!account} aria-label="Owner">
                      {owners.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <button className="btn" onClick={() => setAddingAccount(true)}>
                    + Add GitHub account
                  </button>
                )}
              </div>
              <div className="field">
                <label>Visibility</label>
                <div className="cr-vis" role="radiogroup" aria-label="Visibility">
                  {(
                    [
                      ['private', '🔒', 'Private'],
                      ['public', '🌐', 'Public'],
                    ] as const
                  ).map(([v, ico, label]) => (
                    <button key={v} className={visibility === v ? 'on' : ''} onClick={() => setVisibility(v)} aria-pressed={visibility === v}>
                      {ico} {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="field">
            <label>Save to</label>
            <div className="clone-dest">
              <span className="clone-dest-ico" aria-hidden>
                📁
              </span>
              <button className="clone-dest-pick mono ellipsis" onClick={pickFolder} title="Choose folder">
                {folder?.path ?? 'Choose a folder…'}
              </button>
              <span className="clone-dest-sep">/</span>
              <input
                className="clone-dest-folder mono"
                value={subfolder}
                onChange={(e) => setSubfolder(e.target.value)}
                placeholder="(same folder)"
                spellCheck={false}
                style={{ width: `${Math.min(28, Math.max(13, subfolder.length + 2))}ch` }}
              />
            </div>
          </div>

          {!localOnly && (
            <div className="field">
              <label>
                Description <span className="muted">· optional</span>
              </label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={350} />
            </div>
          )}

          <div className={`cr-preview ${infoComplete ? 'ready' : ''}`}>
            <span className="cr-preview-ico" aria-hidden>
              {localOnly ? '💻' : visibility === 'private' ? '🔒' : '🌐'}
            </span>
            <span className="grow ellipsis">
              <strong>{localOnly ? name || 'name' : `${owner || 'owner'}/${name || 'name'}`}</strong>
              <span className="mono small muted"> → {localPath || 'folder'}</span>
            </span>
            <span className={`cr-preview-dot ${infoComplete ? 'ok' : ''}`} />
          </div>
          {addingAccount && <AddAccountDialog onClose={() => setAddingAccount(false)} onAdded={(a) => (setAccountId(a.id), setLocalOnly(false))} />}
        </div>
      </Modal>
    );
  }

  // ------------------------------------------------------------------ workflow
  const s = state!;
  const awaitingAuth = s.phase === 'awaiting-auth';
  const done = s.phase === 'done';
  const failed = s.phase === 'failed';
  const cancelled = s.phase === 'cancelled';

  return (
    <Modal
      title="Create Repository"
      size="wide"
      onClose={done || cancelled ? (done ? finish : onClose) : cancelWorkflow}
      locked={busy || s.phase === 'running'}
      footer={
        <>
          {s.githubUrl && (
            <button className="btn ghost" onClick={() => call('shell:openExternal', { url: s.githubUrl! }).catch(() => undefined)}>
              Open on GitHub
            </button>
          )}
          <span className="spacer" />
          {done && (
            <button className="btn primary" onClick={finish}>
              Open Repository
            </button>
          )}
          {cancelled && (
            <button className="btn" onClick={onClose}>
              Close
            </button>
          )}
          {failed && (
            <>
              <button className="btn cancel" onClick={cancelWorkflow} disabled={busy}>
                Cancel
              </button>
              {s.fixes.map((f) => (
                <button key={f.id} className="btn" onClick={() => wf(() => call('create:fix', { workflowId: s.workflowId, fixId: f.id }))} disabled={busy}>
                  {f.label}
                </button>
              ))}
              <button className="btn primary" onClick={() => wf(() => call('create:retry', { workflowId: s.workflowId }))} disabled={busy}>
                {s.incomplete ? 'Retry Local Setup' : 'Retry'}
              </button>
            </>
          )}
          {awaitingAuth && (
            <>
              <button className="btn cancel" onClick={cancelWorkflow} disabled={busy}>
                Cancel
              </button>
              <button className="btn primary" onClick={authenticate} disabled={busy || !credential}>
                {busy ? 'Authenticating…' : 'Authenticate'}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="repo-modal">
      {error && <ErrorPanel error={error} />}
      <div className="clone-run-head">
        <span className={`clone-run-dot ${s.phase}`} />
        <strong className="ellipsis">{s.summary.localOnly ? s.summary.name : `${s.summary.owner}/${s.summary.name}`}</strong>
        <span className="mono small muted ellipsis grow" title={s.summary.localPath}>
          → {s.summary.localPath}
        </span>
      </div>

      {awaitingAuth && account && (
        <div className="card">
          <h3>🔐 Sign in as {account.login}</h3>
          <AccountCredentialFields key={credKey} account={account} encryptionAvailable={!!accounts?.encryptionAvailable} purpose="create this repository" onChange={onCred} />
        </div>
      )}

      {s.incomplete && (
        <div className={`banner ${cancelled ? 'info' : 'warn'}`}>
          <span className="icon">{cancelled ? 'ℹ' : '⚠'}</span>
          <div>
            {s.incomplete}
          </div>
        </div>
      )}
      {done && (
        <div className="banner ok">
          <span className="icon">✓</span>
          <div>
            <strong>Created.</strong> Make the first commit in Changes.
          </div>
        </div>
      )}
      <WorkflowSteps steps={s.steps} onReviewAuth={awaitingAuth ? () => setCredKey((k) => k + 1) : undefined} />
      </div>
    </Modal>
  );
}
