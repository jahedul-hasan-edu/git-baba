import { useCallback, useEffect, useState } from 'react';
import type { CommitInfo, CommitPreview, FriendlyError, SigningMethod } from '../../shared/types';
import { ErrorPanel } from '../components/ErrorPanel';
import { KindIcon } from '../components/FileList';
import { Modal, Spinner, Working } from '../components/Modal';
import { ResultCard } from '../components/ResultCard';
import { call, toFriendly } from '../services/api';

interface Props {
  repoId: string;
  mode: 'commit' | 'continue';
  initialMessage?: string;
  onClose: () => void;
  onDone: (commit: CommitInfo | null) => void;
}

/**
 * Every commit (and every merge/rebase continuation, which also creates commits)
 * goes through this dialog: review files, identity and signing method, then confirm.
 */
const SIGN_ICON: Record<SigningMethod, string> = { none: '✎', gpg: '🔏', ssh: '🔑', x509: '📜' };

export function CommitDialog({ repoId, mode, initialMessage = '', onClose, onDone }: Props) {
  const [preview, setPreview] = useState<CommitPreview | null>(null);
  const [message, setMessage] = useState(initialMessage);
  const [signing, setSigning] = useState<SigningMethod>('none');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CommitInfo | 'continued' | null>(null);
  const [idName, setIdName] = useState('');
  const [idEmail, setIdEmail] = useState('');
  const [asAccount, setAsAccount] = useState(false); // chosen once when loaded; read-only in the dialog
  const [showFiles, setShowFiles] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = mode === 'commit' ? await call('commit:prepare', { repoId }) : await call('conflict:prepareContinue', { repoId });
      setPreview(p);
      setSigning(p.defaultSigning);
      setIdName(p.identity.name ?? '');
      setIdEmail(p.identity.email ?? '');
      // Default to the account's identity when the git identity is clearly someone else's.
      const a = p.accountAuthor;
      const mine = !!a && [p.identity.name, p.identity.email].some((v) => (v ?? '').toLowerCase().includes(a.login.toLowerCase()));
      setAsAccount(!!a && !mine);
    } catch (err) {
      setError(toFriendly(err));
    }
  }, [repoId, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const identityMissing = !!preview && (!preview.identity.name || !preview.identity.email);

  const saveIdentity = async () => {
    setBusy(true);
    try {
      await call('git:setIdentity', { repoId, name: idName, email: idEmail });
      await load();
    } catch (err) {
      setError(toFriendly(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'commit') {
        const c = await call('commit:execute', { repoId, confirmationId: preview.confirmationId, message, signing, authorAccount: asAccount && !!preview.accountAuthor });
        // The composer may be unmounted after a commit, so drop the saved draft here or it comes back later.
        try {
          localStorage.removeItem(`gb.draft.${repoId}`);
        } catch {
          /* drafts are a convenience */
        }
        setDone(c);
      } else {
        await call('conflict:continue', { repoId, confirmationId: preview.confirmationId, signing });
        setDone('continued');
      }
    } catch (err) {
      setError(toFriendly(err));
      // The confirmation id is single-use; prepare a fresh review.
      await load();
    } finally {
      setBusy(false);
    }
  };

  const opName = preview?.operation === 'rebase' ? 'rebase' : 'merge';
  const title = mode === 'commit' ? 'Commit' : `Continue ${opName}`;

  if (done) {
    const finish = () => onDone(done === 'continued' ? null : done);
    return (
      <ResultCard
        tone="ok"
        title={done === 'continued' ? `The ${opName} is complete` : 'Committed'}
        subtitle={done === 'continued' ? undefined : done.subject}
        chips={[<>⎇ {preview?.branch ?? 'HEAD'}</>, ...(preview?.files.length ? [<>{preview.files.length} file{preview.files.length === 1 ? '' : 's'}</>] : [])]}
        sha={done === 'continued' ? null : done.hash}
        actions={[{ label: '⬆ Push', primary: true, title: 'Commits stay on this computer until you push', run: () => (finish(), window.dispatchEvent(new CustomEvent('gb:repo-dialog', { detail: 'push' }))) }]}
        note="Saved locally — nothing was sent to the remote yet."
        onClose={finish}
      />
    );
  }

  const canConfirm = !!preview && (!identityMissing || (asAccount && !!preview.accountAuthor)) && (mode === 'continue' || message.trim().length > 0) && !busy;
  const subjectLen = message.split('\n')[0].length;
  const author = asAccount && preview?.accountAuthor ? preview.accountAuthor : preview && !identityMissing ? preview.identity : null;

  return (
    <Modal
      title={title}
      icon="✓"
      size="narrow"
      onClose={onClose}
      locked={busy}
      working={busy && preview ? <Working icon="✓" from={`${preview.files.length} file${preview.files.length === 1 ? '' : 's'}`} to={`⎇ ${preview.branch ?? 'HEAD'}`} label={mode === 'commit' ? 'Committing' : `Continuing the ${opName}`} /> : null}
      footer={
        <>
          <button className="btn cancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm} disabled={!canConfirm} title="Ctrl+Enter">
            {mode === 'commit' ? '✓ Commit' : `✓ Continue ${opName}`}
            <span className="kbd">Ctrl ↵</span>
          </button>
        </>
      }
    >
      {error && <ErrorPanel error={error} onSwitched={() => void load()} />}
      {!preview && !error && <Spinner label="Preparing…" />}
      {preview && (
        <div
          className="cmt"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canConfirm) {
              e.preventDefault();
              void confirm();
            }
          }}
        >
          <div className="cmt-top">
            <span className="pu-branch">⎇ {preview.branch ?? 'detached HEAD'}</span>
            <button className={`pu-chip cmt-files-btn ${showFiles ? 'on' : ''}`} onClick={() => setShowFiles((v) => !v)} aria-expanded={showFiles}>
              {preview.files.length} file{preview.files.length === 1 ? '' : 's'} {showFiles ? '▴' : '▾'}
            </button>
            {preview.hooksEnabled && (
              <span className="pu-chip warn" title="pre-commit / commit-msg hooks from this repository will run">
                ⚙ hooks
              </span>
            )}
          </div>
          {showFiles && (
            <div className="cmt-files">
              {preview.files.map((f) => (
                <div key={f.path} className="row mono small">
                  <KindIcon kind={f.kind} /> {f.path}
                </div>
              ))}
              {preview.files.length === 0 && <span className="muted small">Merge result only — no staged files.</span>}
            </div>
          )}

          {mode === 'commit' && (
            <div className="cmt-msg">
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="What did you change?" autoFocus aria-label="Commit message" />
              {message && <span className={`cmt-count ${subjectLen > 72 ? 'long' : ''}`}>{subjectLen}/72</span>}
            </div>
          )}

          {identityMissing && !(asAccount && preview.accountAuthor) ? (
            <div className="cmt-ident">
              <input value={idName} onChange={(e) => setIdName(e.target.value)} placeholder="Your name" aria-label="Name" />
              <input value={idEmail} onChange={(e) => setIdEmail(e.target.value)} placeholder="Email" aria-label="Email" />
              <button className="btn" onClick={saveIdentity} disabled={busy || !idName || !idEmail}>
                Save
              </button>
            </div>
          ) : (
            author && (
              <div className="cmt-row">
                <span className="cmt-k">Author</span>
                <span className="cd-author" title={`${author.name} <${author.email}> — fixed for this commit`}>
                  <span className="cd-lock" aria-hidden>
                    🔒
                  </span>
                  <strong>{author.name}</strong>
                  {asAccount && preview.accountAuthor && <span className="badge">@{preview.accountAuthor.login}</span>}
                </span>
              </div>
            )
          )}
          <div className="cmt-row">
            <span className="cmt-k">Sign</span>
            <div className="segmented sm">
              {preview.signingOptions.map((o) => (
                <button key={o.method} className={signing === o.method ? 'on' : ''} onClick={() => setSigning(o.method)} title={o.description}>
                  {SIGN_ICON[o.method]} {o.label}
                  {o.method === preview.defaultSigning && o.method !== 'none' && <span className="as-dot" title="Configured for this repository" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
