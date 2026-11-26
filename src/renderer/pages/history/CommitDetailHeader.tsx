import type { ReactNode } from 'react';
import type { CommitDetails } from '../../../shared/types';
import type { CommitAction } from './CommitActions';
import { relative } from '../../components/FileDiffList';
import { authorColor, initials } from './graphStyle';

const I = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg className="cdv-svg" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const ICON = {
  back: 'M10 3.5 5.5 8l4.5 4.5',
  up: 'M4 10l4-4 4 4',
  down: 'M4 6l4 4 4-4',
  copy: 'M5.5 5.5V3.2c0-.4.3-.7.7-.7h6.6c.4 0 .7.3.7.7v6.6c0 .4-.3.7-.7.7H10.5M2.5 6.2c0-.4.3-.7.7-.7h6.6c.4 0 .7.3.7.7v6.6c0 .4-.3.7-.7.7H3.2a.7.7 0 0 1-.7-.7z',
  checkout: 'M2 8h8M7 5l3 3-3 3M13.5 3v10',
  cherry: 'M4.5 4.5a1.5 1.5 0 1 0 0-.01M4.5 6v6M11.5 6.5a1.5 1.5 0 1 0 0-.01M11.5 8c0 2-2 2.5-7 3.5',
  revert: 'M3 5.5h6.5a3.5 3.5 0 0 1 0 7H6M3 5.5 5.5 3M3 5.5 5.5 8',
};

interface Props {
  details: CommitDetails;
  /** Branch the commit was made on (from the graph). */
  branch: string | null;
  /** Position in the loaded list (0-based, -1 when not in it) and the list length. */
  index: number;
  total: number;
  onStep: (d: -1 | 1) => void;
  /** Workspace only: back to the working changes, with their count. */
  onBack?: () => void;
  dirty?: number;
  onCopySha: () => void;
  onParent: (hash: string) => void;
  canOpenParent: (hash: string) => boolean;
  onAction?: (a: CommitAction) => void;
  onMenu?: (el: HTMLElement) => void;
  onTitle: () => void;
  /** Extra chips (tags, merged badge) after the branch. */
  extra?: ReactNode;
}

/** The selected commit, workspace style: back bar with a pager, a message card, and quick actions. */
export function CommitDetailHeader({ details, branch, index, total, onStep, onBack, dirty = 0, onCopySha, onParent, canOpenParent, onAction, onMenu, onTitle, extra }: Props) {
  const n = details.files.length;
  return (
    <div className="cdv">
      <div className="cdv-top">
        {onBack && (
          <button className="cdv-back" onClick={onBack} title="Back to your working changes (Esc / W)">
            <I d={ICON.back} />
            <span>Back to changes</span>
            <span className={`cdv-count ${dirty ? 'dirty' : ''}`}>{dirty}</span>
          </button>
        )}
        <span className="cdv-grow" />
        <div className="cdv-pager">
          <button onClick={() => onStep(-1)} disabled={index <= 0} title="Newer commit (↑)" aria-label="Newer commit">
            <I d={ICON.up} />
          </button>
          <span className="cdv-pos">
            {index >= 0 ? index + 1 : '–'} of {total}
          </span>
          <button onClick={() => onStep(1)} disabled={index === -1 || index >= total - 1} title="Older commit (↓)" aria-label="Older commit">
            <I d={ICON.down} />
          </button>
        </div>
      </div>

      <div className="cdv-card">
        <h2 className="cdv-title" title="Show all details" onClick={onTitle}>
          {details.subject}
        </h2>
        {details.body && <p className="cdv-body">{details.body}</p>}
        <div className="cdv-author">
          <span className="cdv-avatar" style={{ background: authorColor(details.email || details.author) }}>{initials(details.author)}</span>
          <span className="cdv-who">
            <span className="cdv-name" title={details.email}>
              {details.author}
            </span>
            <span className="cdv-when" title={new Date(details.date).toLocaleString()}>
              committed {relative(details.date)}
            </span>
          </span>
          <button className="cdv-sha" onClick={onCopySha} title="Copy full SHA (C)">
            <span>{details.hash.slice(0, 7)}</span>
            <I d={ICON.copy} size={13} />
          </button>
        </div>
        <div className="cdv-meta">
          {branch && (
            <span className="cdv-branch" title={branch}>
              {branch}
            </span>
          )}
          {extra}
          {details.parents.length > 0 && (
            <span className="cdv-parent">
              {details.parents.length > 1 ? 'parents' : 'parent'}
              {details.parents.map((p) => (
                <button key={p} disabled={!canOpenParent(p)} onClick={() => onParent(p)} title="Go to parent">
                  {p.slice(0, 7)}
                </button>
              ))}
            </span>
          )}
          <span className="cdv-grow" />
          <span className="cdv-stat">
            <span className="cdv-add">+{details.additions}</span>
            <span className="cdv-del">−{details.deletions}</span>
            <span className="cdv-files">
              · {n} file{n === 1 ? '' : 's'}
            </span>
          </span>
        </div>
      </div>

      {onAction && (
        <div className="cdv-actions">
          <button className="cdv-act" onClick={() => onAction('checkout')} title="Check out this commit">
            <I d={ICON.checkout} />
            Checkout
          </button>
          <button className="cdv-act" onClick={() => onAction('cherry-pick')} title="Apply this commit onto the current branch (P)">
            <I d={ICON.cherry} />
            Cherry-pick
          </button>
          <button className="cdv-act" onClick={() => onAction('revert')} title="Undo this commit with a new commit">
            <I d={ICON.revert} />
            Revert
          </button>
          {onMenu && (
            <button className="cdv-more" onClick={(e) => onMenu(e.currentTarget)} title="Branch, tag, reset, rebase… (right-click a commit)" aria-label="More actions">
              ···
            </button>
          )}
        </div>
      )}
    </div>
  );
}
