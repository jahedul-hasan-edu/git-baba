import { useEffect, useState } from 'react';
import type { GhRepoContext } from '../../../shared/github';
import type { FriendlyError } from '../../../shared/types';
import { ErrorPanel } from '../../components/ErrorPanel';
import { call, toFriendly } from '../../services/api';
import { setSettingsSection, useSettingsSection } from '../../services/settingsNav';
import { useApp } from '../../state/AppState';
import { RepoSettingsPage } from '../RepoSettingsPage';
import { DangerZone } from './DangerZone';
import { RepoSecrets } from './RepoSecrets';
import { RepoAccess } from './RepoAccess';
import { RoleCard } from './RoleCard';

const TITLES = { general: 'General', access: 'Security & Access', secrets: 'Secrets' } as const;

/**
 * Repository settings, one page per item under Settings in the repository sidebar:
 * General (identity, remotes, your role, danger zone), Security & Access, and Secrets.
 * Secrets needs the GitHub context and an admin role, so it is only offered when that holds.
 */
export function RepoSettingsShell() {
  const { activeRepo, ghKey } = useApp();
  const repo = activeRepo!;
  const wanted = useSettingsSection();
  const [ctx, setCtx] = useState<GhRepoContext | null>(null);
  const [ctxError, setCtxError] = useState<FriendlyError | null>(null);

  useEffect(() => {
    if (!repo.github) return;
    let live = true;
    setCtxError(null);
    call('gh:context', { repoId: repo.id })
      .then((c) => live && setCtx(c))
      .catch((err) => {
        if (!live) return;
        setCtx(null);
        setCtxError(toFriendly(err));
      });
    return () => {
      live = false;
    };
  }, [repo.id, repo.github, ghKey]);

  const secretsOk = !!repo.github && !!ctx?.permissions.canAdmin;
  const current = wanted === 'secrets' && !secretsOk && (ctx || !repo.github) ? 'general' : wanted;

  return (
    <div className="repo-settings">
      <div className="settings-body">
        <h2 style={{ marginTop: 0 }}>{TITLES[current]}</h2>

        {current === 'general' && (
          <>
            <RepoSettingsPage onManageAccess={() => setSettingsSection('access')} />
            {repo.github && ctx && (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Your role</h3>
                <div className="role-in-general">
                  <RoleCard ctx={ctx} />
                </div>
              </div>
            )}
            <div className="card dz-card">
              <h3 style={{ marginTop: 0 }}>Danger zone</h3>
              <DangerZone ctx={ctx} />
            </div>
          </>
        )}
        {current === 'access' && <RepoAccess appsAvailable={!!ctx} />}
        {current === 'secrets' && ctxError && !ctx && <ErrorPanel error={ctxError} />}
        {current === 'secrets' && ctx && <RepoSecrets repoId={repo.id} ctx={ctx} />}
      </div>
    </div>
  );
}
