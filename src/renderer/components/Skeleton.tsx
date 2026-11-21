import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * What the loading placeholder is shaped like. Each kind mirrors the layout it stands in for, so the page does
 * not jump when the real content arrives.
 */
export type SkeletonKind =
  | 'list' // avatar + two lines + meta
  | 'pr' // status icon, title, labels, avatars
  | 'runs' // status dot, workflow, branch chip, duration
  | 'timeline' // dots on a vertical line
  | 'checks' // status icon + name + time
  | 'files' // file tree beside a diff
  | 'source' // one file: line numbers and indented code
  | 'code' // file table: icon, name, message, date
  | 'detail' // title block, meta chips, body paragraphs
  | 'cards' // tile grid
  | 'form' // label + field rows
  | 'settings' // rows of option pills
  | 'secrets' // environment tabs + rows
  | 'profile' // avatar, name, stats
  | 'nav' // short sidebar items
  | 'about' // key/value lines
  | 'line' // a single bar
  | 'graph'; // commit graph: lanes, dots, messages

interface Props {
  kind?: SkeletonKind;
  rows?: number;
  /** Says what is loading; shown after a moment, with the elapsed time when it takes long. */
  label?: string;
}

const W = [72, 54, 63, 46, 80, 58, 67, 50, 75, 42];
const w = (i: number, k = 0) => `${W[(i + k) % W.length]}%`;
const bar = (width: string, cls = '') => <i className={`skb ${cls}`} style={{ width }} />;
/** Several bars side by side (keyed). */
const many = (els: ReactNode[]) => els.map((e, i) => <Fragment key={i}>{e}</Fragment>);

/** A placeholder in the shape of the content it replaces, with a shimmer and a "still loading" note. */
export function Skeleton({ kind = 'list', rows = 5, label }: Props) {
  const n = Math.max(1, rows);
  const idx = Array.from({ length: n }, (_, i) => i);
  let body: ReactNode;
  switch (kind) {
    case 'graph':
      return <GraphSkeleton rows={n} label={label ?? 'Reading history'} />;
    case 'pr':
      body = idx.map((i) => (
        <div key={i} className="skr">
          <i className="skc dot" />
          <div className="skcol grow">
            {bar(w(i), 'h')}
            <div className="skrow">{many([bar('46px', 'pill'), bar('60px', 'pill'), bar(w(i, 3).replace('%', 'px'), 'sm')])}</div>
          </div>
          <i className="skc av" />
          <i className="skc av" style={{ marginLeft: -8 }} />
        </div>
      ));
      break;
    case 'runs':
      body = idx.map((i) => (
        <div key={i} className="skr">
          <i className="skc dot" />
          <div className="skcol grow">
            {bar(w(i, 2), 'h')}
            {bar(`${W[(i + 5) % W.length] / 2}%`, 'sm')}
          </div>
          {bar('70px', 'pill')}
          {bar('44px', 'sm')}
        </div>
      ));
      break;
    case 'timeline':
      body = (
        <div className="sktl">
          {idx.map((i) => (
            <div key={i} className="skr flat">
              <i className="skc tl" />
              <i className="skc av sm" />
              <div className="skcol grow">
                {bar(w(i), 'h')}
                {bar('30%', 'sm')}
              </div>
              {bar('56px', 'mono')}
            </div>
          ))}
        </div>
      );
      break;
    case 'checks':
      body = idx.map((i) => (
        <div key={i} className="skr flat">
          <i className="skc ico" />
          {bar(w(i, 1), 'grow-bar')}
          {bar('40px', 'sm')}
        </div>
      ));
      break;
    case 'files':
      body = (
        <div className="skfiles">
          <div className="skcol">
            {idx.map((i) => (
              <div key={i} className="skrow" style={{ paddingLeft: (i % 3) * 12 }}>
                <i className="skc ico sm" />
                {bar(w(i, 4))}
              </div>
            ))}
          </div>
          <div className="skcol skdiff">
            {Array.from({ length: n + 4 }, (_, i) => (
              <div key={i} className={`skline ${i % 5 === 2 ? 'del' : i % 4 === 1 ? 'add' : ''}`}>
                {bar('18px', 'sm')}
                {bar(w(i, 2))}
              </div>
            ))}
          </div>
        </div>
      );
      break;
    case 'source':
      body = (
        <div className="skcol skdiff">
          {Array.from({ length: n * 3 }, (_, i) => (
            <div key={i} className="skline" style={{ paddingLeft: [0, 14, 28, 14, 0, 14][i % 6] }}>
              {bar('18px', 'sm')}
              {i % 7 === 6 ? null : bar(w(i, 1).replace(/\d+/, (x) => String(Math.round(Number(x) * 0.7))))}
            </div>
          ))}
        </div>
      );
      break;
    case 'code':
      body = (
        <div className="sktable">
          <div className="skr head">
            <i className="skc av sm" />
            {bar('30%')}
            <span className="grow" />
            {bar('70px', 'sm')}
          </div>
          {idx.map((i) => (
            <div key={i} className="skr flat">
              <i className="skc ico sm" />
              {bar(`${12 + (i % 4) * 4}%`)}
              {bar(w(i, 3).replace(/\d+/, (x) => String(Math.round(Number(x) / 1.6))), 'grow-bar muted')}
              {bar('60px', 'sm')}
            </div>
          ))}
        </div>
      );
      break;
    case 'detail':
      body = (
        <div className="skcol gap">
          {bar('58%', 'xl')}
          <div className="skrow">
            <i className="skc av sm" />
            {many([bar('90px', 'sm'), bar('64px', 'pill'), bar('80px', 'pill')])}
          </div>
          <div className="skcard">{many(Array.from({ length: Math.max(3, n - 2) }, (_, i) => bar(i === n - 3 ? '40%' : w(i, 6))))}</div>
        </div>
      );
      break;
    case 'cards':
      body = (
        <div className="skgrid">
          {idx.map((i) => (
            <div key={i} className="skcard">
              <div className="skrow">
                <i className="skc ico" />
                {bar(w(i), 'h')}
              </div>
              {bar(w(i, 2), 'sm')}
              {bar('35%', 'sm')}
            </div>
          ))}
        </div>
      );
      break;
    case 'form':
      body = idx.map((i) => (
        <div key={i} className="skcol" style={{ marginBottom: 12 }}>
          {bar(`${14 + (i % 3) * 5}%`, 'sm')}
          <i className="skfield" style={i % 4 === 3 ? { height: 64 } : undefined} />
        </div>
      ));
      break;
    case 'settings':
      body = idx.map((i) => (
        <div key={i} className="skr box">
          <i className="skc ico" />
          {bar(`${16 + (i % 3) * 4}%`, 'h')}
          <span className="grow" />
          {many([bar('54px', 'pill'), bar('48px', 'pill'), bar('52px', 'pill')])}
        </div>
      ));
      break;
    case 'secrets':
      body = (
        <>
          <div className="skrow" style={{ marginBottom: 10 }}>
            {[90, 70, 80, 64].map((x, i) => (
              <i key={i} className="skb tab" style={{ width: x }} />
            ))}
          </div>
          <div className="skcard flush">
            {idx.map((i) => (
              <div key={i} className="skr flat">
                <i className="skc ico sm" />
                {bar(`${18 + (i % 4) * 5}%`, 'mono')}
                <span className="grow" />
                {bar('64px', 'pill')}
                {bar('40px', 'sm')}
              </div>
            ))}
          </div>
        </>
      );
      break;
    case 'profile':
      body = (
        <div className="skcol gap">
          <div className="skrow">
            <i className="skc av xl" />
            <div className="skcol grow">
              {bar('34%', 'xl')}
              {bar('22%', 'sm')}
              {bar('56%')}
            </div>
          </div>
          <div className="skgrid four">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skcard">{many([bar('40%', 'xl'), bar('60%', 'sm')])}</div>)}</div>
        </div>
      );
      break;
    case 'nav':
      body = idx.map((i) => (
        <div key={i} className="skrow" style={{ padding: '7px 8px' }}>
          <i className="skc ico sm" />
          {bar(w(i, 1).replace(/\d+/, (x) => String(Math.round(Number(x) * 0.8))))}
        </div>
      ));
      break;
    case 'about':
      body = idx.map((i) => (
        <div key={i} className="skrow" style={{ padding: '4px 0' }}>
          {bar('22%', 'sm')}
          {bar(w(i, 2).replace(/\d+/, (x) => String(Math.round(Number(x) * 0.6))))}
        </div>
      ));
      break;
    case 'line':
      body = bar('70%');
      break;
    default:
      body = idx.map((i) => (
        <div key={i} className="skr">
          <i className="skc av" />
          <div className="skcol grow">
            {bar(w(i), 'h')}
            {bar(w(i, 4).replace(/\d+/, (x) => String(Math.round(Number(x) / 2))), 'sm')}
          </div>
          {bar('48px', 'sm')}
        </div>
      ));
  }
  return (
    <div className={`sk-wrap sk-${kind}`} aria-busy="true" aria-live="polite" style={{ '--n': n } as CSSProperties}>
      {body}
      {label && <SlowNote label={label} />}
    </div>
  );
}

/** "Loading pull requests…" after 1.2 s, and the seconds so far once it takes more than 4 s. */
function SlowNote({ label }: { label: string }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setT(Math.floor((Date.now() - start) / 1000)), 400);
    return () => window.clearInterval(id);
  }, []);
  if (t < 1) return null;
  return (
    <div className="sk-note">
      <span className="sk-pulse" />
      {label}
      {t >= 4 && <span className="sk-time">{t}s</span>}
    </div>
  );
}

const LANE_X = [18, 38, 58, 78];
/** Placeholder for the commit graph: lanes being drawn top to bottom, dots arriving, message bars beside them. */
function GraphSkeleton({ rows, label }: { rows: number; label: string }) {
  const H = 30;
  const lane = (i: number) => (i % 7 === 3 || i % 7 === 4 ? 1 : i % 11 === 6 ? 2 : 0);
  return (
    <div className="sk-wrap sk-graph" aria-busy="true" aria-live="polite">
      <svg className="skg-svg" width={96} height={rows * H} aria-hidden>
        {[0, 1, 2].map((l) => (
          <line key={l} className={`skg-lane l${l}`} x1={LANE_X[l]} x2={LANE_X[l]} y1={l ? 3.5 * H : H / 2} y2={l ? (l === 1 ? 5.5 * H : 7.5 * H) : rows * H} />
        ))}
        <path className="skg-lane l1" d={`M${LANE_X[0]} ${2.5 * H} C ${LANE_X[0]} ${3 * H}, ${LANE_X[1]} ${3 * H}, ${LANE_X[1]} ${3.5 * H}`} />
        <path className="skg-lane l1" d={`M${LANE_X[1]} ${5.5 * H} C ${LANE_X[1]} ${6 * H}, ${LANE_X[0]} ${6 * H}, ${LANE_X[0]} ${6.5 * H}`} />
        {Array.from({ length: rows }, (_, i) => (
          <circle key={i} className={`skg-dot l${lane(i)}`} cx={LANE_X[lane(i)]} cy={i * H + H / 2} r={4.5} style={{ animationDelay: `${i * 70}ms` }} />
        ))}
      </svg>
      <div className="skg-rows">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skg-row" style={{ height: H, animationDelay: `${i * 70}ms` }}>
            {i % 6 === 0 && <i className="skb pill" style={{ width: 64 }} />}
            {bar(w(i), 'h')}
            <span className="grow" />
            <i className="skc av sm" />
            {bar('52px', 'sm')}
          </div>
        ))}
      </div>
      <SlowNote label={label} />
    </div>
  );
}
