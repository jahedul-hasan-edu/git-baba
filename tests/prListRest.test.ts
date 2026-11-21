import { describe, expect, it } from 'vitest';
import { listFromRest } from '../src/main/github/services/pullRequests';

const row = (n: number, state: string, merged: boolean, login = 'octo', draft = false) => ({
  number: n,
  node_id: `PR_${n}`,
  title: `PR ${n}`,
  state,
  merged_at: merged ? '2026-01-02T00:00:00Z' : null,
  draft,
  user: { login, avatar_url: '', type: 'User' },
  labels: [],
  assignees: [],
  requested_reviewers: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  base: { ref: 'main' },
  head: { ref: `f${n}` },
});

function client(rows: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  return { calls, c: { get: async (_path: string, opts: { query: Record<string, unknown> }) => (calls.push(opts.query), rows) } as never };
}

describe('listFromRest (pull requests when GraphQL is refused)', () => {
  it('maps open pull requests', async () => {
    const t = client([row(1, 'open', false), row(2, 'open', false, 'bob', true)]);
    const res = await listFromRest(t.c, { owner: 'o', name: 'r' }, 'is:pr is:open');
    expect(t.calls[0]).toMatchObject({ state: 'open' });
    expect(res.source).toBe('rest');
    expect(res.items.map((p) => [p.number, p.state, p.isDraft])).toEqual([
      [1, 'OPEN', false],
      [2, 'OPEN', true],
    ]);
  });

  it('tells merged from closed', async () => {
    const rows = [row(3, 'closed', true), row(4, 'closed', false)];
    expect((await listFromRest(client(rows).c, { owner: 'o', name: 'r' }, 'is:pr is:merged')).items.map((p) => p.number)).toEqual([3]);
    expect((await listFromRest(client(rows).c, { owner: 'o', name: 'r' }, 'is:pr is:closed')).items.map((p) => p.number)).toEqual([4]);
  });
});
