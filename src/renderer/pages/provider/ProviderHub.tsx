import { useEffect, useMemo, useState } from 'react';
import type { BranchInfo, RepoStatus, RepoSummary } from '../../../shared/types';
import { providerInfo, providerLinks } from '../../../shared/providers';
import { BranchPicker, toPickerItems } from '../../components/BranchPicker';
import { call } from '../../services/api';
import { useApp } from '../../state/AppState';
import { ProviderMono } from '../../components/ProviderMono';

/**
 * Pull / merge requests and pipelines for providers other than GitHub. Git Baba does not re-implement their
 * review and CI screens; it opens them on the provider's website with everything already filled in (the
 * branch you are on, the target branch), so nothing half-works inside the app.
 */
export function ProviderHub({ repo, status, kind }: { repo: RepoSummary; status: RepoStatus | null; kind: 'pulls' | 'pipelines' }) {
  const { showError } = useApp();
  const p = repo.provider!;
  const info = providerInfo(p.id);
  const links = useMemo(() => providerLinks(p), [p]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const branch = status?.branch ?? null;
  const [target, setTarget] = useState('');

  useEffect(() => {
    let live = true;
    void call('git:branches', { repoId: repo.id })
      .then((list) => {
        if (!live) return;
        setBranches(list);
        // Default target: the remote's default branch (main / master / develop), never the branch itself.
        const names = list.filter((b) => !b.remote).map((b) => b.name);
        const pick = ['main', 'master', 'develop', 'trunk'].find((n) => names.includes(n) && n !== branch) ?? names.find((n) => n !== branch) ?? '';
        setTarget((t) => t || pick);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repo.id, branch]);

  const open = (url: string | null) => url && void call('shell:openExternal', { url }).catch(showError);
  const published = !!status?.upstream && !status.upstreamGone;
  const label = kind === 'pulls' ? info.tabs.pulls ?? 'Pull Requests' : info.tabs.pipelines ?? 'Pipelines';
  const one = kind === 'pulls' ? (p.id === 'gitlab' ? 'merge request' : 'pull request') : 'pipeline';
  const create = branch && target && branch !== target ? links.newPull(branch, target) : null;

  return (
    <div className="pvh">
      <div className="pvh-head">
        <ProviderMono id={p.id} size={40} />
        <div className="pvh-title">
          <h2>{label} live on {info.name}</h2>
          <p className="small muted">
            {kind === 'pulls' ? `Git Baba prepares the ${one} and opens it on ${info.name} — review and merge happen there.` : `${info.name} runs the ${one}s; Git Baba takes you straight to them.`}
          </p>
        </div>
      </div>

      {kind === 'pulls' && (
        <div className="pvh-card">
          <div className="pvh-card-t">New {one}</div>
          {!branch ? (
            <p className="small muted">Check out a branch first.</p>
          ) : (
            <>
              <div className="pvh-route">
                <span className="pvh-k">From</span>
                <span className="branch-pill">{branch}</span>
                <span className="pvh-arrow">→</span>
                <span className="pvh-k">Into</span>
                <div className="pvh-picker">
                  <BranchPicker value={target} onChange={setTarget} items={toPickerItems(branches.filter((b) => !b.remote && b.name !== branch))} compact recentKey="provider-target" />
                </div>
              </div>
              {!published && (
                <div className="banner warn small">
                  <span className="icon">⬆</span>
                  <div className="grow">
                    <strong>{branch}</strong> is not on {info.name} yet. Publish it first so the {one} has something to show.
                  </div>
                  <button className="btn sm" onClick={() => window.dispatchEvent(new CustomEvent('gb:repo-dialog', { detail: 'push' }))}>
                    Publish…
                  </button>
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn primary" disabled={!create} onClick={() => open(create)} title={create ?? undefined}>
                  Open new {one} on {info.name} ↗
                </button>
                {branch === target && <span className="small muted">Pick a different target branch.</span>}
              </div>
            </>
          )}
        </div>
      )}

      <div className="pvh-links">
        {kind === 'pulls' && links.pulls && (
          <button className="pvh-link" onClick={() => open(links.pulls)}>
            <span>All {one}s</span>
            <span className="pvh-go">↗</span>
          </button>
        )}
        {kind === 'pipelines' && links.pipelines && (
          <button className="pvh-link" onClick={() => open(links.pipelines)}>
            <span>All {one}s</span>
            <span className="pvh-go">↗</span>
          </button>
        )}
        {branch && links.branch(branch) && (
          <button className="pvh-link" onClick={() => open(links.branch(branch))}>
            <span>
              <span className="mono">{branch}</span> on {info.name}
            </span>
            <span className="pvh-go">↗</span>
          </button>
        )}
        {links.home && (
          <button className="pvh-link" onClick={() => open(links.home)}>
            <span>Repository home</span>
            <span className="pvh-go">↗</span>
          </button>
        )}
      </div>
      <p className="small muted pvh-foot">
        {p.host}
        {p.path ? ` · ${p.path}` : ''}
      </p>
    </div>
  );
}
