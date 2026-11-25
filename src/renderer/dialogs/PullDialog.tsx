import { useEffect, useState } from 'react';
import type { AuthContext, ErrorAction, FileDiff, FriendlyError, PullPreview, PullResult, PullStrategy } from '../../shared/types';
import { AuthMethodPicker, type AuthSelection } from '../components/AuthMethodPicker';
import { DiffViewer } from '../components/DiffViewer';
import { Stepper } from '../components/Stepper';
import { ErrorPanel } from '../components/ErrorPanel';
import { ResultCard } from '../components/ResultCard';
import { Modal, Spinner, Working } from '../components/Modal';
import { MethodGlyph } from '../pages/github/MergeDialog';
import { SecurityReportView } from '../components/SecurityReportView';
import { call, toFriendly } from '../services/api';
import { ownerRepoFromUrl } from '../services/format';
import { useApp } from '../state/AppState';

interface Props {
  repoId: string;
  onClose: () => void;
  onDone: (result: PullResult | null) => void;
  /**
   * Direct pull: fetch and integrate in one go, without the review step (fast-forward when possible,
   * otherwise a merge). If the security scan flags anything, it still stops on the review.
   */
  direct?: boolean;
}

type Step = 'auth' | 'fetching' | 'review' | 'pulling' | 'result';

const STRATEGIES: [PullStrategy, 'ff' | 'merge' | 'rebase', string, string][] = [
  ['ff-only', 'ff', 'Fast-forward', 'Move your branch forward. Stops if you have your own new commits.'],
  ['merge', 'merge', 'Merge', 'Join both sides with a merge commit.'],
  ['rebase', 'rebase', 'Rebase', 'Replay your unpushed commits on top.'],
];

/** Pull = fetch → scan → review → explicit confirmation → integrate the exact reviewed commit. */
export function PullDialog({ repoId, onClose, onDone, direct = false }: Props) {
  const { repos, info } = useApp();
  const repo = repos.find((r) => r.id === repoId);
  const [step, setStep] = useState<Step>('auth');
  const [options, setOptions] = useState<(AuthContext & { remoteUrl: string | null }) | null>(null);
  const [auth, setAuth] = useState<AuthSelection>({ input: null, summary: '' });
  const [authKey, setAuthKey] = useState(0);
  const [preview, setPreview] = useState<PullPreview | null>(null);
  const [strategy, setStrategy] = useState<PullStrategy>('ff-only');
  const [ack, setAck] = useState(false);
  const [tab, setTab] = useState<'security' | 'commits' | 'files'>('security');
  const [selected, setSelected] = useState<FileDiff | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [result, setResult] = useState<PullResult | null>(null);

  useEffect(() => {
    call('repo:authOptions', { repoId, purpose: 'fetch' })
      .then(setOptions)
      .catch((err) => setError(toFriendly(err)));
  }, [repoId]);

  const fetchAndReview = async () => {
    if (!auth.input) return;
    setStep('fetching');
    setError(null);
    try {
      const p = await call('pull:prepare', { repoId, auth: auth.input });
      setPreview(p);
      const strat: PullStrategy = p.canFastForward ? 'ff-only' : 'merge';
      setStrategy(strat);
      setTab(p.report.status === 'NO_ISSUES_DETECTED' ? 'files' : 'security');
      setSelected(p.files[0] ?? null);
      // Direct pull: integrate straight away unless the scan flagged something.
      if (direct && p.report.status === 'NO_ISSUES_DETECTED') {
        setStep('pulling');
        try {
          setResult(await call('pull:execute', { repoId, reviewId: p.reviewId, strategy: strat, acknowledgedRisk: false }));
          setStep('result');
        } catch (err) {
          setError(toFriendly(err));
          setPreview(null);
          setStep('auth');
        }
        return;
      }
      setStep('review');
    } catch (err) {
      setError(toFriendly(err));
      setAuthKey((k) => k + 1);
      setStep('auth');
    }
  };

  const cancel = async () => {
    if (preview && step === 'review') await call('pull:cancel', { repoId, reviewId: preview.reviewId }).catch(() => undefined);
    onClose();
  };

  const pull = async () => {
    if (!preview) return;
    setStep('pulling');
    setError(null);
    try {
      setResult(await call('pull:execute', { repoId, reviewId: preview.reviewId, strategy, acknowledgedRisk: ack }));
      setStep('result');
    } catch (err) {
      setError(toFriendly(err));
      setStep('auth');
      setPreview(null);
    }
  };

  const openFile = (path: string) => {
    setTab('files');
    setSelected(preview?.files.find((f) => f.newPath === path || f.oldPath === path) ?? null);
  };

  const needsAck = !!preview && preview.report.status !== 'NO_ISSUES_DETECTED';

  if (step === 'result' && result) {
    const conflicts = result.outcome === 'conflicts';
    const n = preview?.commits.length ?? 0;
    const titles: Record<string, string> = {
      'fast-forward': `Pulled ${n} commit${n === 1 ? '' : 's'}`,
      merged: `Merged ${n} incoming commit${n === 1 ? '' : 's'}`,
      rebased: 'Rebased onto the remote',
      'up-to-date': 'Already up to date',
      conflicts: 'The pull stopped on conflicts',
    };
    return (
      <ResultCard
        tone={conflicts ? 'warn' : 'ok'}
        title={titles[result.outcome] ?? 'Pull finished'}
        subtitle={conflicts || result.outcome === 'up-to-date' ? undefined : result.message}
        chips={preview ? [<>☁ {preview.upstream} → ⎇ {preview.branch}</>] : []}
        details={conflicts || result.outcome === 'up-to-date' ? result.message : undefined}
        sha={conflicts ? null : preview?.targetOid}
        actions={conflicts ? [{ label: 'Resolve conflicts', primary: true, run: () => onDone(result) }] : []}
        onClose={() => onDone(result)}
      />
    );
  }

  const footer =
    step === 'auth' || step === 'fetching' ? (
      <>
        <button className="btn cancel" onClick={onClose} disabled={step === 'fetching'}>
          Cancel
        </button>
        <button className="btn primary" onClick={fetchAndReview} disabled={!auth.input || step === 'fetching'}>
          {direct ? '⬇ Pull' : <>Fetch &amp; review →</>}
        </button>
      </>
    ) : (
      <>
        {needsAck && (
          <label className="check grow">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I reviewed the flagged changes</span>
          </label>
        )}
        <button className="btn cancel" onClick={cancel} disabled={step === 'pulling'}>
          Cancel
        </button>
        <button className={`btn ${preview?.report.status === 'REVIEW_REQUIRED' ? 'danger solid' : 'primary'}`} onClick={pull} disabled={step === 'pulling' || (needsAck && !ack) || !preview || preview.upToDate}>
          ⬇ Pull
        </button>
      </>
    );

  const working =
    step === 'fetching' ? (
      <Working icon="🔍" from="☁ remote" to="🛡 scan" label="Fetching & scanning" />
    ) : step === 'pulling' && preview ? (
      <Working icon="⬇" from={`☁ ${preview.upstream}`} to={`⎇ ${preview.branch}`} label="Pulling" />
    ) : null;
  const status = preview?.report.status;
  const dot = status === 'REVIEW_REQUIRED' ? 'danger' : status === 'REVIEW_RECOMMENDED' ? 'warn' : '';

  return (
    <Modal title="Pull" icon="⬇" onClose={cancel} size="wide" locked={step === 'fetching' || step === 'pulling'} footer={footer} working={working}>
      <Stepper
        steps={[
          { label: 'Sign in', detail: auth.summary ? auth.summary.slice(0, 28) : undefined },
          { label: 'Fetch & scan', detail: preview ? `${preview.commits.length} commit(s)` : undefined },
          { label: 'Review', detail: preview ? (preview.report.status === 'REVIEW_REQUIRED' ? 'flagged' : 'looks clean') : undefined },
          { label: 'Pull' },
        ]}
        current={{ auth: 0, fetching: 1, review: 2, pulling: 3, result: 4 }[step]}
        busy={step === 'fetching' || step === 'pulling'}
        failed={error && step === 'auth' ? 0 : undefined}
        canSelect={(i) => step === 'review' && i === 0}
        onSelect={() => {
          setAck(false);
          setStep('auth');
        }}
      />
      {error && <ErrorPanel error={error} onAction={(a: ErrorAction) => a === 'review-auth' && setAuthKey((k) => k + 1)} available={['review-auth']} onSwitched={() => { setError(null); setAuthKey((k) => k + 1); }} />}

      {(step === 'auth' || step === 'fetching') && (
        <div className="pl-auth">
          {!options ? (
            <Spinner />
          ) : (
            <AuthMethodPicker
              key={authKey}
              options={options.authOptions}
              githubApp={options.githubApp}
              savedSshKey={options.savedSshKey}
              repoId={repoId}
              purpose="fetch"
              remoteOwnerRepo={ownerRepoFromUrl(options.remoteUrl)}
              canSave={!!repo?.settings.allowSavedCredentials && !!info?.encryptionAvailable}
              onChange={setAuth}
            />
          )}
          <div className="pl-safe">
            {direct ? '🛡 Fetches and updates your branch in one step; it stops for review only if the security scan flags something.' : '🛡 Your files stay untouched until you confirm the reviewed changes.'}
          </div>
        </div>
      )}

      {(step === 'review' || step === 'pulling') && preview && (
        <div className="pl">
          {preview.upToDate ? (
            <div className="bm-ready small">
              <span className="text-ok">✓</span> Already up to date — {preview.branch} has everything from {preview.upstream}.
            </div>
          ) : (
            <>
              <div className="pu-route">
                <div className="pu-end">
                  <span className="pu-k">From</span>
                  <span className="pu-branch remote" title={preview.targetOid}>
                    ☁ {preview.upstream}
                  </span>
                </div>
                <div className="pu-wire">
                  <span className="pu-wire-label">
                    {preview.commits.length} commit{preview.commits.length === 1 ? '' : 's'} · {preview.files.length} file{preview.files.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="pu-end right">
                  <span className="pu-k">Into</span>
                  <span className="pu-branch">⎇ {preview.branch}</span>
                </div>
              </div>
              {(preview.localChangeCount > 0 || preview.unrelated) && (
                <div className="pu-chips">
                  {preview.localChangeCount > 0 && (
                    <span className="pu-chip warn" title="Git stops rather than overwrite them">
                      ✎ {preview.localChangeCount} uncommitted file{preview.localChangeCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {preview.unrelated && (
                    <span className="pu-chip warn" title="Usually the remote was created with its own first commit (README or license). Merge joins both histories; files on both sides with different content become conflicts.">
                      ⚠ No shared history — use Merge
                    </span>
                  )}
                </div>
              )}

              <div className="pl-tabs" role="tablist">
                <button role="tab" className={`pl-tab ${tab === 'security' ? 'on' : ''}`} onClick={() => setTab('security')}>
                  <span className={`pl-dot ${dot}`} /> Security <span className="pl-n">{preview.report.findings.length}</span>
                </button>
                <button role="tab" className={`pl-tab ${tab === 'commits' ? 'on' : ''}`} onClick={() => setTab('commits')}>
                  Commits <span className="pl-n">{preview.commits.length}</span>
                </button>
                <button role="tab" className={`pl-tab ${tab === 'files' ? 'on' : ''}`} onClick={() => setTab('files')}>
                  Files <span className="pl-n">{preview.files.length}</span>
                </button>
              </div>
              {tab === 'security' && <SecurityReportView report={preview.report} onOpenFile={openFile} />}
              {tab === 'commits' && (
                <table className="list">
                  <tbody>
                    {preview.commits.map((c) => (
                      <tr key={c.hash}>
                        <td className="mono small">{c.shortHash}</td>
                        <td>{c.subject}</td>
                        <td className="muted small">{c.author}</td>
                        <td className="muted small">{new Date(c.date).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === 'files' && (
                <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 10, minHeight: 300 }}>
                  <div style={{ maxHeight: 420, overflow: 'auto', borderRight: '1px solid var(--border)' }}>
                    {preview.files.map((f) => {
                      const p = f.status === 'deleted' ? f.oldPath : f.newPath;
                      const flagged = preview.report.flaggedFiles.includes(p);
                      return (
                        <div key={p} className={`file-row ${selected === f ? 'selected' : ''}`} onClick={() => setSelected(f)}>
                          <span className={`kind ${f.status}`}>{f.status[0].toUpperCase()}</span>
                          <span className="path mono">
                            <bdi>{p}</bdi>
                          </span>
                          {flagged && <span className="badge warn">!</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ maxHeight: 420, overflow: 'auto' }}>
                    <DiffViewer diff={selected} />
                  </div>
                </div>
              )}

              <div className="mg-methods" role="radiogroup" aria-label="How to bring the changes in">
                {STRATEGIES.map(([value, glyph, label, desc]) => {
                  const off = value === 'ff-only' && !preview.canFastForward;
                  return (
                    <button key={value} role="radio" aria-checked={strategy === value} className={`mg-method ${strategy === value ? 'on' : ''}`} disabled={off} title={off ? 'Your branch has its own new commits' : desc} onClick={() => setStrategy(value)}>
                      <MethodGlyph m={glyph} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="small muted mg-method-desc">{STRATEGIES.find(([v]) => v === strategy)?.[3]}</div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
