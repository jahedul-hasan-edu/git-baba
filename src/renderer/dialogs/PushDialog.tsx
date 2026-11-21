import { useCallback, useEffect, useState } from 'react';
import type { ErrorAction, FriendlyError, PushPreview, PushRuleReport } from '../../shared/types';
import { AuthMethodPicker, type AuthSelection } from '../components/AuthMethodPicker';
import { ErrorPanel } from '../components/ErrorPanel';
import { PushRulesPanel } from '../components/PushRulesPanel';
import { PublishBranchDialog } from './BranchDialogs';
import { Modal, Spinner, Working } from '../components/Modal';
import { ResultCard, type ResultAction } from '../components/ResultCard';
import { call, toFriendly } from '../services/api';
import { ownerRepoFromUrl } from '../services/format';
import { useApp } from '../state/AppState';
import { UndoCommits } from '../pages/changes/UndoCommits';

interface Props {
  repoId: string;
  onClose: () => void;
  onDone: () => void;
  onRequestPull?: () => void;
}

/** Review → Authenticate → Confirm → Push. A fresh authentication is required every time. */
export function PushDialog({ repoId, onClose, onDone, onRequestPull }: Props) {
  const { repos, info, setPrDraft, setRepoTab, bump } = useApp();
  const repo = repos.find((r) => r.id === repoId);
  const [preview, setPreview] = useState<PushPreview | null>(null);
  /** Set when GitHub's rules rejected the push: drives the guided resolution panel. */
  const [rules, setRules] = useState<PushRuleReport | null>(null);
  const [toBranch, setToBranch] = useState<{ name: string; base: string; target: string } | null>(null);
  const [auth, setAuth] = useState<AuthSelection>({ input: null, summary: '' });
  const [authKey, setAuthKey] = useState(0);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: string; authDescription: string; tokenRevoked: boolean | null } | null>(null);
  const [tab, setTab] = useState<'commits' | 'files'>('commits');
  const [showLeft, setShowLeft] = useState(false);

  const load = useCallback(async () => {
    try {
      setPreview(await call('push:prepare', { repoId }));
    } catch (err) {
      setPreview(null);
      setError(toFriendly(err));
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const push = async () => {
    if (!preview || !auth.input) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await call('push:execute', { repoId, confirmationId: preview.confirmationId, auth: auth.input }));
    } catch (err) {
      const friendly = toFriendly(err);
      if (friendly.pushRules) {
        setRules(friendly.pushRules);
        setError(null);
      } else setError(friendly);
      // Single-use secrets (loaded App keys, generated tokens) are gone after an attempt, so reset the
      // form — except for SSH, where the user only needs to fix the passphrase or key.
      if (auth.input?.method !== 'ssh') setAuthKey((k) => k + 1);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onErrorAction = (a: ErrorAction) => {
    if (a === 'review-auth') setAuthKey((k) => k + 1);
    if (a === 'retry') void push();
    if (a === 'pull') {
      onClose();
      onRequestPull?.();
    }
  };

  if (result) {
    const n = preview?.commits.length ?? 0;
    const left = preview?.uncommittedFiles.length ?? 0;
    const gh = repo?.github;
    const branch = preview?.branch ?? '';
    const isNew = !!preview?.isNewRemoteBranch;
    const actions: ResultAction[] = [];
    if (gh && branch) {
      actions.push({
        label: '⇄ Create pull request',
        primary: isNew,
        title: `Open a pull request from ${branch}`,
        run: () => {
          setPrDraft({ base: '', head: preview?.remoteBranch ?? branch });
          setRepoTab('pulls');
          onDone();
        },
      });
      actions.push({ label: 'View on GitHub ↗', run: () => void call('shell:openExternal', { url: `https://github.com/${gh.owner}/${gh.repo}/tree/${encodeURIComponent(preview?.remoteBranch ?? branch)}` }).catch(() => undefined) });
    }
    return (
      <ResultCard
        tone={left || result.tokenRevoked === false ? 'warn' : 'ok'}
        title={isNew ? <>Published {branch}</> : <>Pushed {n} commit{n === 1 ? '' : 's'}</>}
        subtitle={n === 0 ? 'Branch pointer moved — no new commits to upload.' : left ? `${left} uncommitted file${left === 1 ? '' : 's'} left behind` : undefined}
        chips={[
          <>
            ⎇ {branch} → ☁ {preview?.remote}/{preview?.remoteBranch}
          </>,
        ]}
        sha={preview?.headOid}
        actions={actions}
        note={
          <>
            Signed in with {result.authDescription}
            {result.tokenRevoked === true && ' · temporary token revoked ✓'}
            {result.tokenRevoked === false && ' · temporary token not revoked — it expires within 1 hour'}
          </>
        }
        details={result.summary}
        onClose={onDone}
      />
    );
  }

  return (
    <Modal
      title="Push"
      icon="⬆"
      onClose={onClose}
      locked={busy}
      working={busy && preview ? <Working from={`⎇ ${preview.branch}`} to={`☁ ${preview.remote}/${preview.remoteBranch}`} label={preview.isNewRemoteBranch ? 'Publishing' : `Pushing ${preview.commits.length} commit${preview.commits.length === 1 ? '' : 's'}`} /> : null}
      size="wide"
      footer={
        <>
          <span className="grow" />
          <button className="btn cancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={push} disabled={!preview || !auth.input || busy}>
            {rules
                ? 'Push again'
                : preview?.isNewRemoteBranch
                  ? `⬆ Publish ${preview.branch}`
                  : `⬆ Push ${preview?.commits.length ?? 0} commit${preview?.commits.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      {error && (
        <ErrorPanel
          error={error}
          onAction={onErrorAction}
          available={['review-auth', 'retry', ...(onRequestPull ? (['pull'] as ErrorAction[]) : [])]}
          onSwitched={() => {
            // Stay open: reload the push for the account just switched to.
            setError(null);
            setAuthKey((k) => k + 1);
            void load();
          }}
        />
      )}
      {rules && (
        <PushRulesPanel
          repoId={repoId}
          report={rules}
          onHistoryChanged={load}
          onRequestPull={
            onRequestPull
              ? () => {
                  onClose();
                  onRequestPull();
                }
              : undefined
          }
          onPushToBranch={() =>
            setToBranch({ name: `${rules.branch || preview?.branch || 'changes'}-pr`, base: rules.branch || preview?.branch || '', target: rules.remoteBranch || preview?.remoteBranch || '' })
          }
        />
      )}
      {toBranch && (
        <PublishBranchDialog
          repoId={repoId}
          name={toBranch.name}
          base={toBranch.base}
          onClose={() => setToBranch(null)}
          onDone={() => {
            const t = toBranch;
            setToBranch(null);
            setPrDraft({ base: t.target, head: t.name });
            onDone();
            setRepoTab('pulls');
          }}
        />
      )}
      {!preview && !error && <Spinner label="Preparing…" />}
      {preview && (
        <div className="pu">
          {/* The route: what goes where, at a glance. */}
          <div className="pu-route">
            <div className="pu-end">
              <span className="pu-k">From</span>
              <span className="pu-branch">⎇ {preview.branch}</span>
            </div>
            <div className="pu-wire">
              <span className="pu-wire-label">
                {preview.commits.length} commit{preview.commits.length === 1 ? '' : 's'} · {preview.files.length} file{preview.files.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="pu-end right">
              <span className="pu-k">To</span>
              <span className="pu-branch remote">
                ☁ {preview.remote}/{preview.remoteBranch}
                {preview.isNewRemoteBranch && <span className="pu-new">new</span>}
              </span>
            </div>
          </div>
          <div className="pu-chips">
            {preview.account && (
              <span className="pu-chip" title="GitHub account">
                👤 {preview.account.login}
              </span>
            )}
            <span className="pu-chip ok" title={`${preview.remote}/${preview.remoteBranch} will point to ${preview.headOid.slice(0, 10)} — only this exact commit is pushed, never forced.
${preview.remoteUrl}`}>
              🛡 Safe push
            </span>
            {preview.hooksEnabled && <span className="pu-chip warn" title="A pre-push hook from this repository may run">⚙ hooks</span>}
          </div>

          {preview.uncommittedFiles.length > 0 && (
            <div className="pu-left">
              <button className="pu-left-head" onClick={() => setShowLeft((v) => !v)}>
                <span className="pu-left-ico">✎</span>
                <span className="grow">
                  <strong>
                    {preview.uncommittedFiles.length} uncommitted file{preview.uncommittedFiles.length === 1 ? '' : 's'} not included
                  </strong>
                </span>
                <span className="muted">{showLeft ? '▴' : '▾'}</span>
              </button>
              {showLeft && (
                <div className="pu-left-list mono small">
                  {preview.uncommittedFiles.map((f) => (
                    <div key={f} className="ellipsis" title={f}>
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="pu-cols">
            <section className="pu-card">
              <div className="pu-card-head">
                <span className="pu-step">1</span>
                <strong className="grow">Review</strong>
                <div className="seg">
                  <button className={tab === 'commits' ? 'on' : ''} onClick={() => setTab('commits')}>
                    Commits {preview.commits.length}
                  </button>
                  <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
                    Files {preview.files.length}
                  </button>
                </div>
              </div>
              {tab === 'commits' ? (
                <UndoCommits
                  repoId={repoId}
                  commits={preview.commits}
                  disabled={busy}
                  onChanged={() => {
                    // The branch moved: the old push review is no longer valid.
                    setAuthKey((k) => k + 1);
                    void load();
                    bump();
                  }}
                />
              ) : preview.files.length > 0 ? (
                <div className="pu-files">
                  {preview.files.map((f) => {
                    const st = f.status.toLowerCase();
                    return (
                      <div key={f.path} className="pu-file" title={`${f.status} · ${f.path}`}>
                        <span className={`fx-st ${st}`}>{st.charAt(0).toUpperCase()}</span>
                        <span className="ellipsis grow">
                          {f.path.includes('/') && <span className="muted">{f.path.slice(0, f.path.lastIndexOf('/') + 1)}</span>}
                          {f.path.split('/').pop()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="uc-empty">
                  <span>☁</span>
                  <div className="small muted">{preview.isNewRemoteBranch ? 'Creates the branch — no files to upload.' : 'No file changes.'}</div>
                </div>
              )}
            </section>
            <section className="pu-card">
              <div className="pu-card-head">
                <span className={`pu-step ${auth.input ? 'done' : ''}`}>{auth.input ? '✓' : '2'}</span>
                <strong className="grow">Sign in</strong>
              </div>
              <div className="pu-auth">
                <AuthMethodPicker
                  key={authKey}
                  options={preview.authOptions}
                  githubApp={preview.githubApp}
                  savedSshKey={preview.savedSshKey}
                  repoId={repoId}
                  purpose="push"
                  remoteOwnerRepo={ownerRepoFromUrl(preview.remoteUrl)}
                  canSave={!!repo?.settings.allowSavedCredentials && !!info?.encryptionAvailable}
                  onChange={setAuth}
                />
              </div>
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
