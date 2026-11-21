import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileBytes } from '../../../shared/types';
import { call, toFriendly } from '../../services/api';
import { formatBytes } from './FileView';

const ext = (p: string) => (p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '');
const IMAGE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  // macOS formats: shown when the system can decode them, otherwise described.
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  icns: 'image/x-icns',
};
/** Image type for a file name (null when it is not an image). */
export const imageMime = (p: string): string | null => IMAGE[ext(p)] ?? null;
/** Files that are always shown with a viewer rather than as text. */
export const isViewablePath = (p: string) => !!IMAGE[ext(p)] && ext(p) !== 'svg' || ext(p) === 'pdf';

type Kind = 'image' | 'pdf' | 'other';
const kindOf = (p: string): Kind => (ext(p) === 'pdf' ? 'pdf' : IMAGE[ext(p)] ? 'image' : 'other');

/** What a file is, from its first bytes (when the name does not say). */
function sniff(b: Uint8Array): string {
  const s = (n: number) => String.fromCharCode(...b.slice(0, n));
  if (b[0] === 0x89 && s(4).slice(1) === 'PNG') return 'PNG image';
  if (b[0] === 0xff && b[1] === 0xd8) return 'JPEG image';
  if (s(4) === '%PDF') return 'PDF document';
  if (s(4) === 'GIF8') return 'GIF image';
  if (s(2) === 'PK') return 'ZIP archive (also .docx, .xlsx, .jar…)';
  if (b[0] === 0x7f && s(4).slice(1) === 'ELF') return 'Linux executable (ELF)';
  if (s(2) === 'MZ') return 'Windows executable or DLL';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip archive';
  if (s(4) === 'RIFF') return 'RIFF media (WAV, AVI or WebP)';
  if (String.fromCharCode(...b.slice(4, 8)) === 'ftyp') return 'MP4 / HEIC / MOV media';
  if (s(4) === 'icns') return 'macOS icon (ICNS)';
  if (s(2) === 'II' || s(2) === 'MM') return 'TIFF image';
  if (b[0] === 0xca && b[1] === 0xfe) return 'Java class or macOS universal binary';
  if ((b[0] === 0xcf || b[0] === 0xce) && b[1] === 0xfa) return 'macOS executable (Mach-O)';
  if (s(4) === 'wOFF' || s(4) === 'wOF2') return 'Web font';
  return 'Binary data';
}

const toBytes = (b64: string) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * Viewer for files that are not text: images on a checkerboard stage with zoom, PDFs page by page, and any
 * other binary as a hex dump that names what the file is. Loads the file's bytes on demand.
 */
export function BinaryView({ repoId, gitRef, path }: { repoId: string; /** null: the working copy. */ gitRef: string | null; path: string }) {
  const [data, setData] = useState<FileBytes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    call('code:bytes', { repoId, ref: gitRef, path })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(toFriendly(e).message));
    return () => {
      live = false;
    };
  }, [repoId, gitRef, path]);

  const bytes = useMemo(() => (data && !data.tooLarge ? toBytes(data.base64) : null), [data]);
  if (error) return <div className="bv-note">⚠ {error}</div>;
  if (!data) return <div className="bv-note bv-loading">Loading {path.split('/').pop()}…</div>;
  if (data.tooLarge || !bytes)
    return (
      <div className="bv-card">
        <div className="bv-card-ico">📦</div>
        <strong>{formatBytes(data.size)} is too large to preview here</strong>
        <span className="muted small">Files up to 30 MB are shown in the app.</span>
      </div>
    );
  const kind = kindOf(path);
  if (kind === 'image') return <ImageStage src={`data:${IMAGE[ext(path)]};base64,${data.base64}`} bytes={bytes} size={data.size} name={path} />;
  if (kind === 'pdf') return <PdfView bytes={bytes} size={data.size} />;
  return <HexView bytes={bytes} size={data.size} />;
}

/** An image on a checkerboard, fitted to the view; zoom with the buttons or Ctrl + wheel. */
export function ImageStage({ src, size, name, bytes }: { src: string; size: number; name: string; bytes?: Uint8Array }) {
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [bg, setBg] = useState<'check' | 'dark' | 'light'>('check');
  const [failed, setFailed] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // A new image starts fitted; inline images can finish loading before this runs, so read their size here too.
  useEffect(() => {
    setZoom('fit');
    setFailed(false);
    const el = img.current;
    setDims(el && el.complete && el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null);
  }, [src]);

  const fitScale = () => {
    const el = stage.current;
    if (!el || !dims) return 1;
    return Math.min(1, (el.clientWidth - 48) / dims.w, (el.clientHeight - 48) / dims.h);
  };
  const scale = zoom === 'fit' ? fitScale() : zoom;
  const step = (d: number) => setZoom(Math.min(16, Math.max(0.05, Math.round((scale * (d > 0 ? 1.25 : 0.8)) * 100) / 100)));

  if (failed)
    return (
      <div className="bv-card">
        <div className="bv-card-ico">🖼</div>
        <strong>This image format can’t be previewed here</strong>
        <span className="muted small">
          {name.split('/').pop()} · {bytes ? sniff(bytes) : 'image'} · {formatBytes(size)}. HEIC, TIFF and ICNS images from macOS are not shown by the built-in viewer.
        </span>
        {bytes && <HexView bytes={bytes} size={size} compact />}
      </div>
    );

  return (
    <div className="bv">
      <div className="bv-bar">
        <span className="bv-meta">
          {dims ? `${dims.w} × ${dims.h}` : '…'} · {formatBytes(size)}
        </span>
        <span className="spacer" />
        <div className="segmented bv-bg" title="Background">
          {(['check', 'dark', 'light'] as const).map((b) => (
            <button key={b} className={bg === b ? 'on' : ''} onClick={() => setBg(b)} aria-label={`${b} background`}>
              <i className={`bv-sw ${b}`} />
            </button>
          ))}
        </div>
        <button className="cv-tool" onClick={() => step(-1)} title="Zoom out">
          −
        </button>
        <span className="bv-zoom">{Math.round(scale * 100)}%</span>
        <button className="cv-tool" onClick={() => step(1)} title="Zoom in">
          +
        </button>
        <button className={`cv-tool ${zoom === 'fit' ? 'on' : ''}`} onClick={() => setZoom('fit')} title="Fit to view">
          Fit
        </button>
        <button className={`cv-tool ${zoom === 1 ? 'on' : ''}`} onClick={() => setZoom(1)} title="Actual size">
          1:1
        </button>
      </div>
      <div
        className={`bv-stage ${bg}`}
        ref={stage}
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          step(-e.deltaY);
        }}
        onDoubleClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}
      >
        <img
          ref={img}
          src={src}
          alt={name}
          draggable={false}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
          onError={() => setFailed(true)}
          style={dims ? { width: dims.w * scale, height: dims.h * scale } : { opacity: 0 }}
        />
      </div>
    </div>
  );
}

/** PDF pages drawn with PDF.js (no plugins, no frames), rendered as they scroll into view. */
function PdfView({ bytes, size }: { bytes: Uint8Array; size: number }) {
  const [doc, setDoc] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: false });
      const d = await task.promise;
      if (live) setDoc(d);
    })().catch((e) => live && setErr(String(e?.message ?? e)));
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [bytes]);

  // The page in the middle of the view drives the page counter.
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    const pages = [...el.querySelectorAll<HTMLElement>('.bv-page')];
    const hit = pages.find((p) => p.offsetTop + p.offsetHeight > mid);
    if (hit) setPage(Number(hit.dataset.n));
  };
  const goTo = (n: number) => box.current?.querySelector(`[data-n="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (err)
    return (
      <div className="bv-card">
        <div className="bv-card-ico">📄</div>
        <strong>This PDF couldn’t be opened</strong>
        <span className="muted small">{err}</span>
      </div>
    );
  return (
    <div className="bv">
      <div className="bv-bar">
        <span className="bv-meta">
          {doc ? `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}` : 'Opening…'} · {formatBytes(size)}
        </span>
        <span className="spacer" />
        {doc && doc.numPages > 1 && (
          <span className="bv-pager">
            <button className="cv-tool" disabled={page <= 1} onClick={() => goTo(page - 1)} title="Previous page">
              ‹
            </button>
            <span className="bv-zoom">
              {page} / {doc.numPages}
            </span>
            <button className="cv-tool" disabled={page >= doc.numPages} onClick={() => goTo(page + 1)} title="Next page">
              ›
            </button>
          </span>
        )}
        <button className="cv-tool" onClick={() => setZoom((z) => Math.max(0.4, Math.round(z * 0.8 * 100) / 100))} title="Zoom out">
          −
        </button>
        <span className="bv-zoom">{Math.round(zoom * 100)}%</span>
        <button className="cv-tool" onClick={() => setZoom((z) => Math.min(4, Math.round(z * 1.25 * 100) / 100))} title="Zoom in">
          +
        </button>
        <button className={`cv-tool ${zoom === 1 ? 'on' : ''}`} onClick={() => setZoom(1)} title="Fit width">
          Fit
        </button>
      </div>
      <div className="bv-pages" ref={box} onScroll={onScroll}>
        {!doc && <div className="bv-note bv-loading">Opening PDF…</div>}
        {doc && Array.from({ length: Math.min(doc.numPages, 300) }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} zoom={zoom} root={box} />)}
        {doc && doc.numPages > 300 && <div className="bv-note">Showing the first 300 of {doc.numPages} pages.</div>}
      </div>
    </div>
  );
}

function PdfPage({ doc, n, zoom, root }: { doc: import('pdfjs-dist').PDFDocumentProxy; n: number; zoom: number; root: React.RefObject<HTMLDivElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(n <= 2);
  const [ratio, setRatio] = useState(1.294);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { root: root.current, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    let render: { cancel: () => void } | null = null;
    void doc.getPage(n).then((p) => {
      if (!live || !canvas.current || !wrap.current) return;
      const base = p.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const width = Math.min(wrap.current.parentElement!.clientWidth - 40, 1100) * zoom;
      const vp = p.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
      const c = canvas.current;
      c.width = vp.width;
      c.height = vp.height;
      c.style.width = `${width}px`;
      c.style.height = `${width * (base.height / base.width)}px`;
      const task = p.render({ canvasContext: c.getContext('2d')!, viewport: vp });
      render = task;
      task.promise.catch(() => undefined);
    });
    return () => {
      live = false;
      render?.cancel();
    };
  }, [visible, doc, n, zoom]);

  return (
    <div className="bv-page" data-n={n} ref={wrap}>
      <canvas ref={canvas} style={visible ? undefined : { width: `calc((100% - 40px) * ${zoom})`, aspectRatio: `1 / ${ratio}` }} />
      <span className="bv-page-n">{n}</span>
    </div>
  );
}

/** Offset · hex · text dump of the first bytes, with what the file appears to be. */
function HexView({ bytes, size, compact }: { bytes: Uint8Array; size: number; compact?: boolean }) {
  const [rows, setRows] = useState(compact ? 8 : 64);
  const shown = bytes.slice(0, rows * 16);
  const lines = [];
  for (let o = 0; o < shown.length; o += 16) {
    const chunk = shown.slice(o, o + 16);
    lines.push(
      <div key={o} className="bv-hex-row">
        <span className="bv-off">{o.toString(16).padStart(8, '0')}</span>
        <span className="bv-hex">{Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ')}</span>
        <span className="bv-asc">{Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')}</span>
      </div>,
    );
  }
  if (compact) return <div className="bv-hexbox compact">{lines}</div>;
  return (
    <div className="bv">
      <div className="bv-bar">
        <span className="bv-kind">{sniff(bytes)}</span>
        <span className="bv-meta">{formatBytes(size)}</span>
        <span className="spacer" />
        <span className="bv-meta">first {formatBytes(shown.length)} shown</span>
      </div>
      <div className="bv-hexbox">
        {lines}
        {rows * 16 < bytes.length && (
          <button className="btn sm bv-more" onClick={() => setRows((r) => r * 4)}>
            Show more bytes
          </button>
        )}
      </div>
    </div>
  );
}
