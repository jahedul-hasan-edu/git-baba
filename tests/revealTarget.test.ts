import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { revealTarget } from '../src/main/util/paths';

describe('revealTarget', () => {
  const root = path.resolve('/repos/demo');

  it('opens the repository folder itself for the root', () => {
    for (const p of ['', '.', './', '.\\']) expect(revealTarget(root, p)).toEqual({ kind: 'folder', full: root });
  });

  it('reveals files inside the repository', () => {
    expect(revealTarget(root, 'src/a.ts')).toEqual({ kind: 'item', full: path.join(root, 'src', 'a.ts') });
  });

  it('still refuses paths that leave the repository', () => {
    expect(() => revealTarget(root, '../other')).toThrow(/escapes/);
    expect(() => revealTarget(root, '..')).toThrow(/escapes/);
    expect(() => revealTarget(root, 'C:/Windows')).toThrow();
  });
});
