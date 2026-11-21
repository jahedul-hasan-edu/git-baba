import { describe, expect, it } from 'vitest';
import { AppError } from '../src/main/git/errors';
import { GitHubClient } from '../src/main/github/client/GitHubClient';

const reply = (status: number, message: string, headers: Record<string, string> = {}) => async () => new Response(JSON.stringify({ message }), { status, headers: { 'content-type': 'application/json', ...headers } });

async function codeOf(c: GitHubClient): Promise<AppError> {
  try {
    await c.get('/repos/o/r/pulls', { action: 'load pull requests' });
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected a failure');
}

describe('GitHub 403 answers', () => {
  it('reads a secondary rate limit as a rate limit, not a missing permission', async () => {
    const c = new GitHubClient('https://api.github.com', 't', reply(403, 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.', { 'x-ratelimit-remaining': '4000' }), async () => undefined);
    expect((await codeOf(c)).friendly.code).toBe('rate-limited');
  });

  it("quotes GitHub's own words for a real refusal", async () => {
    const c = new GitHubClient('https://api.github.com', 't', reply(403, 'Must have admin rights to Repository.'), async () => undefined);
    const e = await codeOf(c);
    expect(e.friendly.code).toBe('forbidden');
    expect(e.friendly.message).toContain('Must have admin rights to Repository.');
  });
});

describe('GraphQL without read:org', () => {
  it('asks again without team fields instead of failing the whole query', async () => {
    const bodies: string[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      const body = String(init.body);
      bodies.push(body);
      const payload = /on Team/.test(body)
        ? { data: null, errors: [{ type: 'INSUFFICIENT_SCOPES', message: "Your token has not been granted the required scopes to execute this query. The 'name' field requires one of the following scopes: ['read:org']" }] }
        : { data: { ok: true } };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const c = new GitHubClient('https://api.github.com', 't', fetchImpl as never, async () => undefined);
    const d = await c.graphql<{ ok: boolean }>('query { x { requestedReviewer { ... on User { login } ... on Team { name } } } }', {}, 'load pull requests');
    expect(d).toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toMatch(/Team/);
    expect(bodies[1]).toMatch(/on User \{ login \}/);
  });
});

describe('withoutOrgFields', () => {
  it('drops organizations blocks and team fragments, keeps the rest', async () => {
    const { withoutOrgFields } = await import('../src/main/github/client/GitHubClient');
    const q = 'query { viewer { login organizations(first: 20) { nodes { login avatarUrl } } bio } x { ... on User { login } ... on Team { name } } }';
    const out = withoutOrgFields(q);
    expect(out).not.toMatch(/organizations|Team/);
    expect(out).toMatch(/viewer \{ login\s+bio \}/);
    expect(out).toMatch(/on User \{ login \}/);
  });
});
