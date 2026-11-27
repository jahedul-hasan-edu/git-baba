import { createPortal } from 'react-dom';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

const ModalCloseContext = createContext<(() => void) | null>(null);

/** Closes the dialog this component is rendered in (null outside a dialog). */
export function useEnclosingModalClose(): (() => void) | null {
  return useContext(ModalCloseContext);
}

interface Props {
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: 'narrow' | 'normal' | 'wide';
  children: ReactNode;
  /** Prevent closing with Escape while an operation is running. */
  locked?: boolean;
  /** While set, an animated "working" overlay covers the dialog body (see `Working`). */
  working?: ReactNode;
}

export function Modal({ title, icon, onClose, footer, size = 'normal', children, locked, working }: Props) {
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || locked) return;
      // With stacked dialogs, Escape closes only the top-most one.
      const all = document.querySelectorAll('.modal-backdrop');
      if (all.length && all[all.length - 1] !== backdrop.current) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, locked]);

  return createPortal(
    <div ref={backdrop} className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal ${size === 'normal' ? '' : size}`}>
        <div className="modal-header">
          {icon && <span style={{ fontSize: 'var(--fs-xl)' }}>{icon}</span>}
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} disabled={locked} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={`modal-body ${working ? 'is-working' : ''}`}>
          <ModalCloseContext.Provider value={onClose}>{children}</ModalCloseContext.Provider>
          {working && <div className="modal-working">{working}</div>}
        </div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
,
    document.body,
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row muted">
      <span className="spinner" /> {label}
    </span>
  );
}

/**
 * The animated "in progress" scene shown over a dialog while Git works: two ends joined by a wire with
 * packets travelling along it, and one short line of what is happening.
 */
export function Working({ from, to, label, icon = '⬆' }: { from?: ReactNode; to?: ReactNode; label: ReactNode; icon?: ReactNode }) {
  return (
    <div className="wk" role="status" aria-live="polite">
      <div className="wk-scene">
        {from != null && <span className="wk-end">{from}</span>}
        <span className="wk-wire">
          <i />
          <i />
          <i />
          <span className="wk-orb">{icon}</span>
        </span>
        {to != null && <span className="wk-end to">{to}</span>}
      </div>
      <div className="wk-label">{label}</div>
    </div>
  );
}
