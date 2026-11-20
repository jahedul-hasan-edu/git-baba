import { useEffect, useRef, useState } from 'react';
import { ProviderGallery } from '../components/ProvidersDialog';
import type { RepoSummary } from '../../shared/types';
import { CloneDialog, isLocalPath } from '../dialogs/CloneDialog';
import { CreateRepoWizard } from '../dialogs/CreateRepoWizard';
import { call } from '../services/api';
import { useApp } from '../state/AppState';

type Detected = { kind: 'github' | 'url' | 'ssh' | 'folder'; label: string; url: string } | null;

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** What the quick box holds: owner/repo, an https or ssh clone URL, or a repository folder. */
export function detectSource(raw: string): Detected {
  const v = raw.trim();
  if (!v) return null;
  if (SLUG_RE.test(v)) return { kind: 'github', label: `GitHub · ${v.replace(/\.git$/, '')}`, url: `https://github.com/${v.replace(/\.git$/, '')}.git` };
  if (/^https?:\/\/\S+\/\S+/i.test(v)) {
    try {
      const u = new URL(v);
      return { kind: 'url', label: `${u.hostname} · ${u.pathname.replace(/^\/+|\.git$|\/+$/g, '')}`, url: v };
    } catch {
      return null;
    }
  }
  const scp = /^[A-Za-z0-9._-]+@([^:/\s]+):(\S+)$/.exec(v);
  if (scp) return { kind: 'ssh', label: `SSH · ${scp[1]} · ${scp[2].replace(/\.git$/, '')}`, url: v };
  if (/^ssh:\/\/\S+/i.test(v)) return { kind: 'ssh', label: `SSH · ${v.replace(/^ssh:\/\/(?:[^@/]+@)?/i, '')}`, url: v };
  if (isLocalPath(v)) return { kind: 'folder', label: `Folder · ${v.split(/[\\/]/).filter(Boolean).pop() ?? v}`, url: v };
  return null;
}

const ICON: Record<NonNullable<Detected>['kind'], string> = { github: '🐙', url: '🌐', ssh: '🔑', folder: '📁' };

/** Launchpad shown when no repository is open: one smart box, three actions, and recent repositories. */
export function WelcomePage() {
  const { info, showError, bump, selectRepo } = useApp();
  const [dialog, setDialog] = useState<'create' | 'clone' | null>(null);
  const [quick, setQuick] = useState('');
  const [cloneFrom, setCloneFrom] = useState<string | undefined>(undefined);
  const box = useRef<HTMLInputElement>(null);
  const detected = detectSource(quick);

  const open = async () => {
    try {
      const pick = await call('dialog:pickDirectory', { purpose: 'open' });
      if (!pick) return;
      const repo = await call('repo:addExisting', { selectionId: pick.selectionId });
      bump();
      selectRepo(repo.id);
    } catch (err) {
      showError(err);
    }
  };
  const onCreated = (r: RepoSummary) => {
    bump();
    selectRepo(r.id);
  };
  const startClone = (from?: string) => {
    setCloneFrom(from);
    setDialog('clone');
  };

  // Single-key shortcuts while nothing is typed into a field: O open, N create, C clone, / quick box.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (dialog || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-backdrop')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') void open();
      else if (k === 'n') setDialog('create');
      else if (k === 'c') startClone();
      else if (k === '/') box.current?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);


  return (
    <div className="content">
      <div className="welcome lp">
        <div className="lp-hero">
          <div className="lp-orb" aria-hidden>
            <span className="lp-ring" />
            <span className="lp-core">⎇</span>
          </div>
          <div>
            <h1>Every Git, one place</h1>
          </div>
        </div>

        {info && !info.gitVersion && (
          <div className="banner danger">
            <span className="icon">⚠</span>
            <div>
              Git was not found. Install Git from <a onClick={() => void call('shell:openExternal', { url: 'https://git-scm.com/downloads' }).catch(() => undefined)}>git-scm.com</a> and restart the app.
            </div>
          </div>
        )}

        <form
          className={`lp-quick ${detected ? 'ok' : quick.trim() ? 'bad' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (detected) startClone(detected.url);
          }}
        >
          <span className="lp-quick-ico">{detected ? ICON[detected.kind] : '⌕'}</span>
          <input
            ref={box}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuick('')}
            placeholder="Paste a clone URL, owner/repo, git@host:owner/repo.git or a folder path…"
            spellCheck={false}
            aria-label="Repository to clone"
          />
          {detected ? (
            <button className="btn primary sm" type="submit" title={detected.url}>
              ⬇ Clone <span className="lp-quick-what">{detected.label}</span>
            </button>
          ) : quick.trim() ? (
            <span className="small muted nowrap">Not a repository address yet</span>
          ) : (
            <kbd title="Press / to focus">/</kbd>
          )}
        </form>

        <ProviderGallery />
      </div>
      {dialog === 'create' && <CreateRepoWizard onClose={() => setDialog(null)} onCreated={onCreated} />}
      {dialog === 'clone' && <CloneDialog initialRepository={cloneFrom} onClose={() => setDialog(null)} onCloned={onCreated} />}
    </div>
  );
}
