import { useCallback, useState } from 'react';
import type { FriendlyError, RepoStatus } from '../../../shared/types';
import { useApp } from '../../state/AppState';
import { GitHistoryPage, type GraphFocus } from '../GitHistoryPage';
import { RepoRail } from './RepoRail';

interface Props {
  status: RepoStatus | null;
  reload: () => Promise<void>;
  error: FriendlyError | null;
}

const noop = () => undefined;

/**
 * The Changes workspace: the commit graph with your working changes on top, and on the right either the
 * staging & commit panel or the selected commit. Worktrees live in the repository sidebar now; the old
 * worktree rail stays hidden but mounted, so its branch dialogs (new branch, stash, branch menu) still work.
 */
export function WorkspacePage({ status, reload, error }: Props) {
  const { activeRepo } = useApp();
  const repoId = activeRepo!.id;
  const [focus, setFocus] = useState<GraphFocus | null>(null);
  const onFocus = useCallback((f: Omit<GraphFocus, 'n'>) => setFocus((p) => ({ ...f, n: (p?.n ?? 0) + 1 })), []);
  return (
    <div className="content flush ws">
      <RepoRail repoId={repoId} status={status} onFocus={onFocus} hidden setHidden={noop} />
      <div className="ws-main">
        <GitHistoryPage workspace={{ status, reload, error, focus, railToggle: null }} />
      </div>
    </div>
  );
}
