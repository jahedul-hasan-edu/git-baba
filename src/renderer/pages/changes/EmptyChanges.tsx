import { useEffect, useState, type ReactNode } from 'react';
import type { RepoStatus } from '../../../shared/types';
import { call } from '../../services/api';
import { useApp } from '../../state/AppState';
import { requestBranchPicker } from '../../components/RepoSyncBar';
import { requestNewBranch } from './CleanSlate';

/** The Changes panel with nothing to commit: "All caught up" and what to do next. */
export function EmptyChanges({ repoId, status }: { repoId: string; status: RepoStatus }) {
  const { activeRepo, setPrDraft, setRepoTab, repoTab } = useApp();
  const [locals, setLocals] = useState<number | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const branch = status.branch;
  const isGitHub = !!activeRepo?.github;

  useEffect(() => {
    let live = true;
    call('git:branches', { repoId })
      .then((b) => live && setLocals(b.filter((x) => !x.remote).length))
      .catch(() => undefined);
    if (isGitHub)
      call('gh:context', { repoId })
        .then((c) => live && setBase(c.defaultBranch))
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repoId, isGitHub]);

  // A pull request makes sense from a branch other than the default one.
  const canPr = isGitHub && !!branch && !!base && branch !== base;

  return (
    <div className="chg chg-empty-panel">

      <div className="chg-tabs" role="tablist">
        <button role="tab" aria-selected className="on">
          Changes <span className="chg-tab-n">0</span>
        </button>
        <button role="tab" aria-selected={false}>
          Staged <span className="chg-tab-n">0</span>
        </button>
      </div>

      <div className="chg-caught">
        <div className="chg-caught-orb" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </div>
        <div className="chg-caught-title">All caught up</div>
        <div className="chg-caught-text">Nothing to commit. Here’s what you might do next:</div>
      </div>

      <div className="chg-next">
        {canPr && (
          <NextRow
            icon={<path d="M6 3v12M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 17V9a3 3 0 0 0-3-3h-4m0 0 2-2m-2 2 2 2" />}
            title="Create pull request"
            sub={`${branch} → ${base}`}
            end={<span className="chg-next-chev">›</span>}
            onClick={() => {
              setPrDraft({ base: base!, head: branch! });
              setRepoTab('pulls');
            }}
          />
        )}
        <NextRow
          icon={<path d="M6 3v12M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9c0 6-12 3-12 8" />}
          title="Switch branch"
          sub={locals === null ? 'Local branches' : `${locals} local branch${locals === 1 ? '' : 'es'}`}
          end={<kbd className="chg-kbd">Ctrl B</kbd>}
          onClick={requestBranchPicker}
        />
        <NextRow
          icon={<path d="M12 5v14M5 12h14" />}
          title="Create new branch"
          sub={branch ? `From ${branch}` : 'From the current commit'}
          end={<kbd className="chg-kbd">Ctrl Shift N</kbd>}
          onClick={() => {
            if (repoTab !== 'changes') setRepoTab('changes'); // the New Branch window lives on the History page
            requestNewBranch(branch ?? undefined);
          }}
        />
      </div>
    </div>
  );
}

function NextRow({ icon, title, sub, end, onClick }: { icon: ReactNode; title: string; sub: string; end: ReactNode; onClick: () => void }) {
  return (
    <button className="chg-next-row" onClick={onClick}>
      <span className="chg-next-ico" aria-hidden>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <span className="chg-next-text">
        <span className="chg-next-title">{title}</span>
        <span className="chg-next-sub">{sub}</span>
      </span>
      {end}
    </button>
  );
}
