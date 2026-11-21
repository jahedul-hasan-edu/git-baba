import { useMemo, useState } from 'react';
import type { FileChange } from '../../shared/types';
import { KindIcon } from '../components/FileList';
import { Modal, Working } from '../components/Modal';

/**
 * Nothing is staged when the user asks to commit: pick the files that go in (all by default), stage them,
 * and continue to the commit. Toggling a row is the whole interaction.
 */
export function StagePickDialog({ files, onCancel, onStage }: { files: FileChange[]; onCancel: () => void; onStage: (paths: string[]) => Promise<void> }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(files.map((f) => f.path)));
  const [busy, setBusy] = useState(false);
  const all = picked.size === files.length;
  const n = picked.size;
  const toggle = (p: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const order = useMemo(() => [...files].sort((a, b) => a.path.localeCompare(b.path)), [files]);
  const go = async () => {
    if (!n) return;
    setBusy(true);
    try {
      await onStage(order.filter((f) => picked.has(f.path)).map((f) => f.path));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="What goes in this commit?"
      icon="✓"
      size="narrow"
      onClose={onCancel}
      locked={busy}
      working={busy ? <Working icon="＋" from={`${n} file${n === 1 ? '' : 's'}`} to="staged" label="Staging" /> : null}
      footer={
        <>
          <span className="small muted grow" title="Only the staging area changes — your files stay as they are">
            🛡 Files stay as they are
          </span>
          <button className="btn cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void go()} disabled={!n || busy}>
            Stage {n} &amp; commit →
          </button>
        </>
      }
    >
      <div
        className="sp"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void go();
        }}
      >
        <button className={`sp-all ${all ? 'on' : n ? 'some' : ''}`} onClick={() => setPicked(all ? new Set() : new Set(files.map((f) => f.path)))}>
          <span className="sp-box" aria-hidden />
          <span className="grow">{all ? 'All changes' : n ? `${n} of ${files.length} selected` : 'None selected'}</span>
          <span className="sp-meter" aria-hidden>
            <i style={{ width: `${(n / Math.max(1, files.length)) * 100}%` }} />
          </span>
        </button>
        <div className="sp-list" role="listbox" aria-multiselectable="true">
          {order.map((f) => {
            const on = picked.has(f.path);
            const slash = f.path.lastIndexOf('/');
            return (
              <button key={f.path} role="option" aria-selected={on} className={`sp-row ${on ? 'on' : ''}`} onClick={() => toggle(f.path)} title={f.path}>
                <span className="sp-box" aria-hidden />
                <KindIcon kind={f.kind} />
                <span className="sp-name ellipsis">
                  {f.path.slice(slash + 1)}
                  {slash > 0 && <span className="sp-dir"> {f.path.slice(0, slash)}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
