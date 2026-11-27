/**
 * The app's type scale (mirrors the --fs-* tokens in styles.css). Anything that computes a font size in code
 * snaps it to this scale, so no arbitrary sizes reach the screen.
 */
export const TYPE_SCALE = [12, 13, 14, 16, 18, 22, 28] as const;
const TOKENS = ['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl', '--fs-3xl'] as const;

/** The scale step nearest to `px` (ties go to the smaller step). */
export function snapFontPx(px: number): (typeof TYPE_SCALE)[number] {
  let best: (typeof TYPE_SCALE)[number] = TYPE_SCALE[0];
  for (const s of TYPE_SCALE) if (Math.abs(s - px) < Math.abs(best - px)) best = s;
  return best;
}

/** The CSS token for the scale step nearest to `px`, e.g. `var(--fs-sm)`. */
export function fontToken(px: number): string {
  return `var(${TOKENS[TYPE_SCALE.indexOf(snapFontPx(px))]})`;
}

/** The next larger / smaller step of the scale (for A+ / A− controls). */
export function stepFont(px: number, dir: 1 | -1, min = 12, max = 18): number {
  const i = TYPE_SCALE.indexOf(snapFontPx(px)) + dir;
  const next = TYPE_SCALE[Math.max(0, Math.min(TYPE_SCALE.length - 1, i))];
  return Math.max(min, Math.min(max, next));
}
