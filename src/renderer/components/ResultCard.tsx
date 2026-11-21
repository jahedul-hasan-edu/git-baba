import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call } from '../services/api';
import { useApp } from '../state/AppState';

export interface ResultAction {
  label: string;
  run: () => void;
  primary?: boolean;
  title?: string;
}

interface Props {
  tone: 'ok' | 'warn';
  title: ReactNode;
  /** One short line under the title. */
  subtitle?: ReactNode;
  /** Small facts shown as chips, e.g. ["main → origin/main", "3 commits"]. */
  chips?: ReactNode[];
  /** A commit id shown as a copyable chip. */
  sha?: string | null;
  /** Next steps; the first primary one gets focus. "Done" is always added last. */
  actions?: ResultAction[];
  /** Fine print (authentication used, token revocation…). */
  note?: ReactNode;
  /** Raw output, collapsed. */
  details?: string;
  onClose: () => void;
}

/**
 * Outcome window for commit / push / pull / merge: an animated check, one headline, the route and commit as
 * chips, and equal-size next steps. Sign-in notes and raw git output fold behind one "Details" toggle.
 * Esc closes; Enter runs the focused (primary) button.
 */
export function ResultCard({ tone, title, subtitle, chips = [], sha, actions = [], note, details, onClose }: Props) {
  const { toast } = useApp();
  const [copied, setCopied] = useState(false);
  const [more, setMore] = useState(false);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  const copy = () => {
    if (!sha) return;
    void call('app:copyText', { text: sha })
      .then(() => {
        setCopied(true);
        toast('Commit id copied');
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  const primaryIdx = actions.findIndex((a) => a.primary);
  const hasMore = !!note || !!details;
  return (
    <div className="modal-backdrop rc-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`rc ${tone}`} role="dialog" aria-modal="true" aria-live="polite">
        <button className="rc-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="rc-burst" aria-hidden>
          <span className="rc-halo" />
          <svg viewBox="0 0 52 52" width="56" height="56">
            <circle className="rc-ring" cx="26" cy="26" r="23" fill="none" />
            {tone === 'ok' ? <path className="rc-tick" fill="none" d="M15 27 l7 7 l15 -16" /> : <path className="rc-tick" fill="none" d="M26 14 v16 M26 37 v1" />}
          </svg>
          {tone === 'ok' && (
            <span className="rc-sparks">
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} style={{ ['--r' as string]: `${i * 36}deg` }} />
              ))}
            </span>
          )}
        </div>
        <div className="rc-title">{title}</div>
        {subtitle && <div className="rc-sub">{subtitle}</div>}
        {(chips.length > 0 || sha) && (
          <div className="rc-chips">
            {chips.map((c, i) => (
              <span key={i} className="rc-chip">
                {c}
              </span>
            ))}
            {sha && (
              <button className={`rc-chip mono rc-sha ${copied ? 'copied' : ''}`} onClick={copy} title="Copy the full commit id">
                {copied ? '✓ copied' : <>⧉ {sha.slice(0, 7)}</>}
              </button>
            )}
          </div>
        )}
        <div className="rc-actions">
          {actions.map((a, i) => (
            <button key={a.label} ref={i === primaryIdx ? first : undefined} className={`btn rc-btn ${a.primary ? 'primary' : 'cancel'}`} onClick={a.run} title={a.title}>
              {a.label}
            </button>
          ))}
          <button ref={primaryIdx < 0 ? first : undefined} className={`btn rc-btn ${primaryIdx < 0 ? 'primary' : 'cancel'}`} onClick={onClose}>
            Done
          </button>
        </div>
        {hasMore && (
          <>
            <button className={`rc-more ${more ? 'on' : ''}`} onClick={() => setMore((v) => !v)} aria-expanded={more}>
              Details <span className="rc-caret">▾</span>
            </button>
            {more && (
              <div className="rc-fold">
                {note && <div className="rc-note">{note}</div>}
                {details && <pre>{details}</pre>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A deliberate confirm: press and hold (mouse, touch, Enter or Space) until the bar fills. Releasing early
 * cancels. Replaces a separate "I confirm" checkbox for actions that change shared history.
 */
export function HoldToConfirm({ label, holdingLabel = 'Keep holding…', disabled, danger, ms = 900, onConfirm }: { label: string; holdingLabel?: string; disabled?: boolean; danger?: boolean; ms?: number; onConfirm: () => void }) {
  const [p, setP] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const done = useRef(false);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (!done.current) setP(0);
  };
  const begin = () => {
    if (disabled || raf.current) return;
    done.current = false;
    start.current = performance.now();
    const tick = (t: number) => {
      const v = Math.min(1, (t - start.current) / ms);
      setP(v);
      if (v >= 1) {
        done.current = true;
        raf.current = null;
        onConfirm();
        window.setTimeout(() => setP(0), 400);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button
      className={`btn hold-btn ${danger ? 'danger solid' : 'primary'} ${p > 0 ? 'holding' : ''}`}
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => (e.key === 'Enter' || e.key === ' ') && stop()}
      onBlur={stop}
      title="Press and hold to confirm (mouse, Enter or Space)"
    >
      <span className="hold-fill" style={{ transform: `scaleX(${p})` }} aria-hidden />
      <span className="hold-text">{p > 0 && p < 1 ? holdingLabel : label}</span>
    </button>
  );
}
