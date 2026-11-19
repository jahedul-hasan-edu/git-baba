import { useCallback, useEffect, useState } from 'react';
import { PaneIcon } from '../../components/PaneIcon';
import type { FriendlyError, RepoStatus } from '../../../shared/types';
import { useApp } from '../../state/AppState';
import { GitHistoryPage, type GraphFocus } from '../GitHistoryPage';
import { RepoRail } from './RepoRail';

interface Props {
  status: RepoStatus | null;
  reload: () => Promise<void>;
  error: FriendlyError | null;
}

/**
 * The Changes workspace: this repository's worktrees on the left (hideable); the commit graph in the
 * middle with your working changes on top; and on the right either the staging & commit panel or
 * the selected commit. A file you open from the working changes takes the graph's place until Esc.
 */
export function WorkspacePage({ status, reload, error }: Props) {
  const { activeRepo } = useApp();
  const repoId = activeRepo!.id;
  const [focus, setFocus] = useState<GraphFocus | null>(null);
  const onFocus = useCallback((f: Omit<GraphFocus, 'n'>) => setFocus((p) => ({ ...f, n: (p?.n ?? 0) + 1 })), []);
  // The worktree sidebar hides completely; the panel icon in the graph toolbar brings it back.
  const [railHidden, setRailHidden] = useState(() => {
    try {
      return localStorage.getItem('gb.ws.railCollapsed') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('gb.ws.railCollapsed', String(railHidden));
    } catch {
      /* per-viewer convenience */
    }
  }, [railHidden]);
  const railToggle = railHidden ? (
    <button className="ws-rail-show" onClick={() => setRailHidden(false)} title="Show worktrees (Ctrl+Shift+B)">
      <PaneIcon />
    </button>
  ) : null;
  return (
    <div className="content flush ws">
      <RepoRail repoId={repoId} status={status} onFocus={onFocus} hidden={railHidden} setHidden={setRailHidden} />
      <div className="ws-main">
        <GitHistoryPage workspace={{ status, reload, error, focus, railToggle }} />
      </div>
    </div>
  );
}
