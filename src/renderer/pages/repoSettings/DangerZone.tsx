import { useState } from 'react';
import type { GhRepoContext } from '../../../shared/github';
import { SecureActionDialog } from '../../components/github/SecureActionDialog';
import { RemoveRepoDialog } from '../../dialogs/RepoActionDialogs';
import { call } from '../../services/api';
import { useApp } from '../../state/AppState';

type Step = 'idle' | 'github' | 'local';

/**
 * Removing a repository, layer by layer: from Git Baba (always), the local folder (to the Recycle Bin /
 * Trash — recoverable) and the repository on GitHub (admins only, behind re-authentication and its typed
 * name). GitHub goes first; the local part then verifies access exactly like the plain remove.
 */
export function DangerZone({ ctx }: { ctx: GhRepoContext | null }) {
  const { activeRepo, selectRepo, toast, bump } = useApp();
  const repo = activeRepo!;
  const [folder, setFolder] = useState(false);
  const [remote, setRemote] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const full = ctx ? `${ctx.owner}/${ctx.name}` : (repo.identity ?? '');
  const canDeleteRemote = !!ctx?.permissions.canAdmin;

  const start = () => setStep(remote && canDeleteRemote ? 'github' : 'local');
  const what = ['remove from Git Baba', folder && 'trash the folder', remote && canDeleteRemote && `delete ${full} on GitHub`].filter(Boolean).join(' · ');

  return (
    <div className="dz">
      <Layer icon="📌" title="Remove from Git Baba" sub="Sidebar entry and saved credentials" on locked />
      {repo.exists && <Layer icon="🗑" title="Move the folder to the Recycle Bin" sub={repo.path} mono on={folder} onToggle={() => setFolder((v) => !v)} />}
      {repo.github && (
        <Layer
          icon="☁"
          title={`Delete ${full || 'the repository'} on GitHub`}
          sub={canDeleteRemote ? 'Code, issues, PRs, Actions — for everyone' : ctx ? `Needs admin — you are ${ctx.permissions.level.toLowerCase()}` : 'Sign in to check your permission'}
          on={remote && canDeleteRemote}
          disabled={!canDeleteRemote}
          danger
          onToggle={() => setRemote((v) => !v)}
        />
      )}

      <div className="dz-foot">
        <span className="small muted grow">{what}</span>
        <button className="btn danger solid" onClick={start}>
          {remote && canDeleteRemote ? 'Delete…' : 'Remove…'}
        </button>
      </div>

      {step === 'github' && ctx && (
        <SecureActionDialog
          title={`Delete ${full}`}
          icon="🗑"
          danger
          confirmLabel="Delete on GitHub"
          repoId={repo.id}
          needs="admin access and the “delete_repo” scope (classic) or “Administration: write” (fine-grained)"
          typeToConfirm={full}
          impact={<>Cannot be undone from Git Baba. Open pull requests close; deploy keys and webhooks stop.{ctx.isPrivate ? ' Private: no forks keep a copy.' : ''}</>}
          onClose={() => setStep((s) => (s === 'github' ? 'idle' : s))}
          onConfirm={async (auth) => {
            await call('gh:adminDeleteRepo', { repoId: repo.id, typedName: full, auth, confirmed: true });
            toast(`${full} deleted on GitHub`);
            setStep('local');
          }}
        >
          <div className="pu-chips">
            <span className="pu-chip">{ctx.isPrivate ? '🔒 private' : '🌐 public'}</span>
            <span className="pu-chip">⎇ {ctx.defaultBranch}</span>
            <span className="pu-chip ok">👑 {ctx.permissions.level.toLowerCase()}</span>
          </div>
        </SecureActionDialog>
      )}
      {step === 'local' && (
        <RemoveRepoDialog
          repo={repo}
          deleteFolder={folder}
          onClose={() => {
            setStep('idle');
            bump();
          }}
          onRemoved={(_missing, trashed) => {
            toast(trashed ? `${repo.name} removed and its folder moved to the Recycle Bin` : `${repo.name} removed from Git Baba`, 'info');
            selectRepo(null);
            bump();
          }}
        />
      )}
    </div>
  );
}

function Layer({ icon, title, sub, on, locked, disabled, danger, mono, onToggle }: { icon: string; title: string; sub: string; on: boolean; locked?: boolean; disabled?: boolean; danger?: boolean; mono?: boolean; onToggle?: () => void }) {
  return (
    <button type="button" className={`dz-layer ${on ? 'on' : ''} ${danger ? 'danger' : ''}`} disabled={locked || disabled} onClick={onToggle} aria-pressed={on}>
      <span className="dz-ico">{icon}</span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="dz-title">{title}</span>
        <span className={`dz-sub ellipsis ${mono ? 'mono' : ''}`} title={sub}>
          {sub}
        </span>
      </span>
      {locked ? <span className="dz-lock">always</span> : <span className="dz-switch" aria-hidden />}
    </button>
  );
}
