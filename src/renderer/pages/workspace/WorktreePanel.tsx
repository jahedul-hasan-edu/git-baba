import { useEffect, useState } from 'react';
import type { BranchInfo, WorktreeInfo } from '../../../shared/types';
import { BranchPicker, toPickerItems } from '../../components/BranchPicker';
import { Modal } from '../../components/Modal';
import { call } from '../../services/api';

const COLORS = ['#5b8cff', '#3ecf8e', '#f5b84a', '#ff6b6b', '#b18cff', '#6cc4ff', '#ff9f6b', '#9fd36b'];
export const branchColor = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};
const folderOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/');
const parentOf = (p: string) => {
  const s = sepOf(p);
  const t = p.replace(/[\\/]+$/, '');
  return t.slice(0, t.lastIndexOf(s)) || t;
};
const slug = (b: string) => b.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

export interface AddRequest {
  branch?: string;
  create?: boolean;
}

/** Creates a worktree from an existing or a new branch (used by the Changes sidebar). */
export function AddWorktreeDialog(props: {
  repoId: string;
  repoPath: string;
  repoName: string;
  branches: BranchInfo[];
  taken: Set<string>;
  initial: AddRequest;
  onClose: () => void;
  onDone: (w: WorktreeInfo, open: boolean) => void;
}) {
  const { repoId, repoPath, repoName, branches, taken, initial, onClose, onDone } = props;
  const local = branches.filter((b) => !b.remote);
  const remote = branches.filter((b) => b.remote && !b.name.endsWith('/HEAD'));
  const free = local.filter((b) => !taken.has(b.name));
  const [mode, setMode] = useState<'existing' | 'new'>(initial.create || (!initial.branch && free.length === 0) ? 'new' : 'existing');
  const [existing, setExisting] = useState(initial.create ? '' : (initial.branch ?? free[0]?.name ?? ''));
  const [name, setName] = useState(initial.create ? (initial.branch ?? '') : '');
  const [base, setBase] = useState('');
  const [folder, setFolder] = useState('');
  const [edited, setEdited] = useState(false);
  const [openAfter, setOpenAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picking a remote branch creates a local branch tracking it.
  const isRemotePick = mode === 'existing' && remote.some((b) => b.name === existing) && !local.some((b) => b.name === existing);
  const branch = mode === 'new' ? name.trim() : isRemotePick ? existing.slice(existing.indexOf('/') + 1) : existing;
  const suggested = branch ? `${parentOf(repoPath)}${sepOf(repoPath)}${repoName}-${slug(branch)}` : '';
  useEffect(() => {
    if (!edited) setFolder(suggested);
  }, [suggested, edited]);

  const clash = mode === 'existing' && !isRemotePick && taken.has(existing);
  const nameTaken = mode === 'new' && local.some((b) => b.name === branch);
  const can = !!branch && !!folder.trim() && !clash && !nameTaken && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const create = mode === 'new' || isRemotePick;
      const w = await call('git:worktreeAdd', { repoId, path: folder.trim(), branch, create, base: mode === 'new' ? base || undefined : isRemotePick ? existing : undefined });
      onDone(w, openAfter);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New Worktree"
      icon="🗂"
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <label className="check small" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} /> Open it in Git Baba
          </label>
          <button className="btn cancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" disabled={!can} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create worktree'}
          </button>
        </>
      }
    >
      <div className="segmented mb" role="tablist">
        <button className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')}>
          ⎇ Existing branch
        </button>
        <button className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>
          ＋ New branch
        </button>
      </div>

      {mode === 'existing' ? (
        <div className="field">
          <label>Branch to check out</label>
          <BranchPicker value={existing} onChange={setExisting} items={toPickerItems([...free, ...remote])} placeholder="Choose a branch…" recentKey="worktree-branch" />
          {clash && <div className="small text-danger mt">This branch is already checked out in another worktree.</div>}
          {isRemotePick && <div className="small muted mt">Creates the local branch {branch}, tracking {existing}.</div>}
          {free.length < local.length && <div className="small muted mt">Branches already checked out in a worktree are not listed — a branch can be in one worktree at a time.</div>}
        </div>
      ) : (
        <div className="grid-2">
          <div className="field">
            <label>New branch name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/side-quest" spellCheck={false} autoFocus />
            {nameTaken && <div className="small text-danger">A branch with this name already exists.</div>}
          </div>
          <div className="field">
            <label>Start from</label>
            <BranchPicker
              value={base}
              onChange={setBase}
              items={toPickerItems([...local, ...remote])}
              special={[{ name: '', label: 'Current commit (HEAD)', icon: '◉', subject: 'Start from where this window is' }]}
              recentKey="branch-start"
            />
          </div>
        </div>
      )}

      <div className="field">
        <label>Folder</label>
        <input
          value={folder}
          onChange={(e) => {
            setFolder(e.target.value);
            setEdited(true);
          }}
          placeholder="Choose a new, empty folder"
          spellCheck={false}
          className="mono"
        />
        {edited && suggested && folder !== suggested && (
          <button className="link small" onClick={() => setEdited(false)}>
            Use {folderOf(suggested)} next to the repository
          </button>
        )}
      </div>

      {mode === 'new' && base && (
        <div className="small muted mb">
          ⇣ This worktree keeps up with <strong>{base.replace(/^[^/]+\//, (m) => (remote.some((b) => b.name === base) ? '' : m))}</strong>: when anyone adds commits there, it offers to bring them in.
        </div>
      )}
      {branch && folder && (
        <div className="wt-preview" style={{ ['--bc' as string]: branchColor(branch) }}>
          <div className="wt-preview-row">
            <span>🏠</span>
            <span className="ellipsis grow">{repoName}</span>
            <span className="muted small">this repository</span>
          </div>
          <div className="wt-preview-row new">
            <span>🗂</span>
            <span className="ellipsis grow mono">{folderOf(folder)}</span>
            <span className="wt-branch">⎇ {branch}</span>
          </div>
        </div>
      )}
      {error && <div className="banner danger small mt">{error}</div>}
    </Modal>
  );
}
