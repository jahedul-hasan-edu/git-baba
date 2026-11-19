import type { NewBranchChanges } from '../../shared/types';

/** One short line per choice, for summaries once the choice is made. */
export function changesSummary(mode: NewBranchChanges, count: number, from: string, to: string): string {
  const n = `${count} change${count === 1 ? '' : 's'}`;
  if (mode === 'carry') return `${n} → ${to}`;
  if (mode === 'stash') return `${n} stashed on ${from}`;
  return `${n} stay on ${from}`;
}

/**
 * What happens to uncommitted changes when a new branch is created. Asked before anything is published, so
 * creating a branch never quietly drags work along or leaves it behind. Kept short: a title and one hint each.
 */
export function ChangesChoice({ value, onChange, from, to, compact, disabled }: { value: NewBranchChanges; onChange: (v: NewBranchChanges) => void; count?: number; from: string; to: string; compact?: boolean; disabled?: boolean }) {
  const options: { id: NewBranchChanges; icon: string; title: string; hint: string; tip: string }[] = [
    { id: 'carry', icon: '➜', title: 'Bring along', hint: 'Switch with your files', tip: `Switch to ${to}. Your files come along uncommitted.` },
    { id: 'stash', icon: '⧈', title: 'Stash', hint: 'Switch with a clean folder', tip: `Save them in a stash on ${from}; ${to} opens clean.` },
    { id: 'leave', icon: '⏸', title: 'Leave here', hint: `Stay on ${from}`, tip: `Create ${to} without switching.` },
  ];
  return (
    <div className={`chc ${compact ? 'compact' : ''}`} role="radiogroup" aria-label="Uncommitted changes">
      {options.map((o) => (
        <label key={o.id} className={`chc-opt ${value === o.id ? 'on' : ''}`} title={o.tip}>
          <input type="radio" name="chc" checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
          <span className="chc-ic" aria-hidden>
            {o.icon}
          </span>
          <span className="chc-txt">
            <strong>{o.title}</strong>
            <span className="small muted ellipsis">{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
