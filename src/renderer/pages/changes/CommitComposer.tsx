import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeKind } from '../../../shared/types';
import { fitMenu } from '../../components/menuFit';

const TYPES: [string, string, string][] = [
  ['feat', '✨', 'A new feature'],
  ['fix', '🐛', 'A bug fix'],
  ['docs', '📝', 'Documentation only'],
  ['style', '🎨', 'Formatting, no code change'],
  ['refactor', '♻', 'Code change that neither fixes a bug nor adds a feature'],
  ['perf', '⚡', 'Performance improvement'],
  ['test', '🧪', 'Adding or fixing tests'],
  ['chore', '🔧', 'Build, tooling, dependencies'],
];
const PREFIX = /^(\w+)(\(([^)]*)\))?(!)?:\s?/;

export type CommitAction = 'commit' | 'commit-push' | 'amend' | 'review';

export interface StagedFile {
  path: string;
  kind: ChangeKind;
  add: number;
  del: number;
}

interface Props {
  repoId: string;
  message: string;
  setMessage: (m: string) => void;
  staged: StagedFile[];
  canCommit: boolean;
  /** Label of the main button, e.g. "Commit staged (3)". */
  primaryLabel: string;
  blockedReason: string | null;
  /** Amend is offered only while the last commit exists locally only. */
  amendAllowed: boolean;
  amendHint: string;
  busy: boolean;
  onCommit: (action: CommitAction) => void;
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const stem = (p: string) => base(p).replace(/\.[^.]+$/, '');

/**
 * A draft message from the staged files alone (no AI, nothing leaves the computer): the conventional type from
 * what kind of files changed, a summary naming them, and a description listing each file with its line counts.
 */
function draftMessage(files: StagedFile[]): { type: string; subject: string; body: string } {
  const paths = files.map((f) => f.path.toLowerCase());
  const all = (re: RegExp) => paths.length > 0 && paths.every((p) => re.test(p));
  const type = all(/\.(md|mdx|txt|rst|adoc)$|(^|\/)docs?\//)
    ? 'docs'
    : all(/(\.|_|\/)(test|spec)s?[./]|__tests__\//)
      ? 'test'
      : all(/\.(css|scss|sass|less|styl)$/)
        ? 'style'
        : all(/(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|\.github\/|\.gitignore|tsconfig[^/]*\.json|\.eslintrc|vite\.config|webpack\.config|dockerfile)/)
          ? 'chore'
          : files.every((f) => f.kind === 'added' || f.kind === 'untracked')
            ? 'feat'
            : files.every((f) => f.kind === 'deleted')
              ? 'chore'
              : 'refactor';
  const verb = files.every((f) => f.kind === 'added' || f.kind === 'untracked') ? 'add' : files.every((f) => f.kind === 'deleted') ? 'remove' : 'update';
  const names = [...new Set(files.map((f) => stem(f.path)))];
  const subject = names.length === 1 ? `${verb} ${names[0]}` : names.length === 2 ? `${verb} ${names[0]} and ${names[1]}` : `${verb} ${names[0]}, ${names[1]} and ${names.length - 2} more`;
  const kindWord: Partial<Record<ChangeKind, string>> = { added: 'Add', untracked: 'Add', deleted: 'Remove', renamed: 'Rename', copied: 'Copy' };
  const body = files.map((f) => `- ${kindWord[f.kind] ?? 'Update'} ${f.path}${f.add || f.del ? ` (+${f.add} −${f.del})` : ''}`).join('\n');
  return { type, subject, body };
}

/** Commit composer: type chip, summary with a 72-character counter, optional description, Generate, and the commit split button. */
export function CommitComposer({ repoId, message, setMessage, staged, canCommit, primaryLabel, blockedReason, amendAllowed, amendHint, busy, onCommit }: Props) {
  const [subject, ...rest] = message.split('\n');
  const body = rest.join('\n').replace(/^\n/, '');
  const [showBody, setShowBody] = useState(!!body);
  const [drafted, setDrafted] = useState<number | null>(null);
  const [typeMenu, setTypeMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const draftKey = `gb.draft.${repoId}`;
  const m = PREFIX.exec(subject);
  const type = m?.[1] ?? null;
  const scope = m?.[3] ?? '';
  const text = m ? subject.slice(m[0].length) : subject;

  // Restore / keep the draft for this repository.
  useEffect(() => {
    try {
      const d = localStorage.getItem(draftKey);
      if (d && !message) setMessage(d);
    } catch {
      /* drafts are a convenience */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  // A commit undone from the Push window puts its message back here.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ repoId: string; message: string }>).detail;
      if (d?.repoId === repoId && !message.trim()) setMessage(d.message);
    };
    window.addEventListener('gb:draft-restored', on);
    return () => window.removeEventListener('gb:draft-restored', on);
  }, [repoId, message, setMessage]);
  useEffect(() => {
    try {
      if (message) localStorage.setItem(draftKey, message);
      else localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  }, [draftKey, message]);
  // A cleared message (after a commit) drops the "drafted" note.
  useEffect(() => {
    if (!message) setDrafted(null);
    if (body) setShowBody(true);
  }, [message, body]);

  const compose = (t: string | null, sc: string, tx: string, b: string) => {
    const head = t ? `${t}${sc ? `(${sc})` : ''}: ${tx}` : tx;
    setMessage(b.trim() ? `${head}\n\n${b}` : head);
  };
  const generate = () => {
    if (!staged.length) return;
    const d = draftMessage(staged);
    compose(d.type, scope, d.subject, d.body);
    setShowBody(true);
    setDrafted(staged.length);
  };
  const len = subject.length;

  // Menus: the type list under its chip, the commit options above the button.
  const typeBtn = useRef<HTMLButtonElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (typeMenu && typeRef.current && typeBtn.current) {
      const b = typeBtn.current.getBoundingClientRect();
      fitMenu(typeRef.current, b.left, b.top - typeRef.current.offsetHeight - 6);
    }
  }, [typeMenu]);
  useLayoutEffect(() => {
    if (moreMenu && moreRef.current && moreBtn.current) {
      const b = moreBtn.current.getBoundingClientRect();
      fitMenu(moreRef.current, b.right - moreRef.current.offsetWidth, b.top - moreRef.current.offsetHeight - 6);
    }
  }, [moreMenu]);
  useEffect(() => {
    if (!typeMenu && !moreMenu) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (typeMenu && !typeRef.current?.contains(n) && !typeBtn.current?.contains(n)) setTypeMenu(false);
      if (moreMenu && !moreRef.current?.contains(n) && !moreBtn.current?.contains(n)) setMoreMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTypeMenu(false);
        setMoreMenu(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [typeMenu, moreMenu]);

  const run = (a: CommitAction) => {
    setMoreMenu(false);
    onCommit(a);
  };

  return (
    <div
      className="cc2"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canCommit && !busy) {
          e.preventDefault();
          onCommit(e.shiftKey ? 'commit-push' : 'commit');
        }
      }}
    >
      <div className={`cc2-box ${showBody ? 'open' : ''}`}>
        <div className="cc2-line">
          <button ref={typeBtn} className={`cc2-type ${type ? 'set' : ''}`} onClick={() => setTypeMenu((o) => !o)} title="Commit type (conventional commits)" aria-haspopup="menu" aria-expanded={typeMenu}>
            {type ?? 'type'}
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2.5 3.8 5 6.3l2.5-2.5" />
            </svg>
          </button>
          <input
            className="cc2-subject"
            value={text}
            onChange={(e) => compose(type, scope, e.target.value, body)}
            placeholder="Summary (required)"
            spellCheck
            aria-label="Commit summary"
          />
          <span className={`cc2-count ${len > 72 ? 'long' : len > 50 ? 'ok' : ''}`} title="Keep the summary under 50 characters (72 at most)">
            {len}/72
          </span>
        </div>
        {showBody && (
          <textarea className="cc2-body" rows={4} value={body} onChange={(e) => compose(type, scope, text, e.target.value)} placeholder="Description — why this change, anything reviewers should know…" aria-label="Commit description" />
        )}
        <div className="cc2-tools">
          <button className="cc2-link" onClick={() => setShowBody((s) => !s)}>
            {showBody ? '− Hide description' : '+ Add description'}
          </button>
          <span className="grow" />
          {drafted !== null && (
            <span className="cc2-drafted" title="Drafted from the staged file names and line counts — edit it freely">
              ✦ Drafted from {drafted} staged file{drafted === 1 ? '' : 's'}
            </span>
          )}
          {drafted !== null ? (
            <button className="cc2-icon" onClick={generate} disabled={!staged.length} title="Draft again">
              ↻
            </button>
          ) : (
            <button className="cc2-gen" onClick={generate} disabled={!staged.length} title={staged.length ? 'Draft a type, summary and description from the staged files' : 'Stage files first'}>
              ✦ Generate
            </button>
          )}
        </div>
      </div>

      <div className="cc2-go">
        <button className="cc2-main" disabled={!canCommit || busy} onClick={() => onCommit('commit')} title={blockedReason ?? 'Commit (Ctrl+Enter)'}>
          {busy ? 'Committing…' : primaryLabel}
        </button>
        <button ref={moreBtn} className={`cc2-caret ${moreMenu ? 'on' : ''}`} disabled={busy} onClick={() => setMoreMenu((o) => !o)} aria-label="More commit options" aria-haspopup="menu" aria-expanded={moreMenu}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2.5 3.8 5 6.3l2.5-2.5" />
          </svg>
        </button>
      </div>
      {blockedReason && <div className="cc2-foot">{blockedReason}</div>}

      {typeMenu && (
        <div ref={typeRef} className="ctx-menu cc2-menu" role="menu">
          {TYPES.map(([t, ico, desc]) => (
            <div
              key={t}
              role="menuitem"
              className={`dropdown-item ${type === t ? 'on' : ''}`}
              onClick={() => {
                setTypeMenu(false);
                compose(t, scope, text, body);
              }}
            >
              <span className="ctx-ico">{ico}</span>
              <div>
                <div>{t}</div>
                <div className="small muted">{desc}</div>
              </div>
            </div>
          ))}
          {type && (
            <>
              <div className="dropdown-sep" />
              <div
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  setTypeMenu(false);
                  compose(null, '', text, body);
                }}
              >
                <span className="ctx-ico">✕</span> No type
              </div>
            </>
          )}
        </div>
      )}

      {moreMenu && (
        <div ref={moreRef} className="ctx-menu cc2-menu wide" role="menu">
          <MenuItem title="Commit" desc="Save staged changes locally" kbd="Ctrl ↵" disabled={!canCommit} onClick={() => run('commit')} />
          <MenuItem title="Commit & Push" desc="Commit, then push to the remote" kbd="Ctrl ⇧ ↵" disabled={!canCommit} onClick={() => run('commit-push')} />
          <MenuItem title="Amend last commit" desc={amendHint} disabled={!amendAllowed || !canCommit} onClick={() => run('amend')} />
          <MenuItem title="Commit with review" desc="Check files, author and signing first" disabled={!canCommit} onClick={() => run('review')} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ title, desc, kbd, disabled, onClick }: { title: string; desc: string; kbd?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <div role="menuitem" aria-disabled={disabled} className={`dropdown-item cc2-item ${disabled ? 'disabled' : ''}`} onClick={disabled ? undefined : onClick}>
      <div className="grow">
        <div className="cc2-item-t">{title}</div>
        <div className="small muted">{desc}</div>
      </div>
      {kbd && <span className="cc2-kbd">{kbd}</span>}
    </div>
  );
}
