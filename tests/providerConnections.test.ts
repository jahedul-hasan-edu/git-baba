import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAuth } from '../src/main/github/authResolver';
import { ProviderConnectionStore } from '../src/main/providers/ConnectionStore';
import { asHost } from '../src/main/providers/verify';
import type { SecretStore } from '../src/main/repositories/SecretStore';
import { EphemeralVault } from '../src/main/security/EphemeralVault';
import type { RepoRecord } from '../src/shared/types';

const enc = { isAvailable: () => true, encrypt: (s: string) => Buffer.from(`enc:${s}`), decrypt: (b: Buffer) => b.toString().slice(4) };
const repo: RepoRecord = { id: 'repoAAAAAAAA', name: 'app', path: '/x', addedAt: '', settings: { runHooks: false, allowSystemCredentials: false, allowSavedCredentials: false } };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-conn-'));
  const store = new ProviderConnectionStore(path.join(dir, 'c.json'), path.join(dir, 's'), enc);
  const gl = store.save({ provider: 'gitlab', host: 'gitlab.example.com', org: null, username: 'ada', displayName: 'Ada', gitUsername: 'oauth2', lastVerifiedAt: null }, 'glpat-secret');
  const az = store.save({ provider: 'azure', host: 'dev.azure.com', org: 'contoso', username: 'ada@contoso.com', displayName: 'Ada', gitUsername: 'pat', lastVerifiedAt: null }, 'az-secret');
  const deps = { secrets: { getPat: () => null } as unknown as SecretStore, vault: new EphemeralVault(), githubFor: () => { throw new Error('unused'); }, connections: store } as never;
  return { dir, store, gl, az, deps };
}

describe('provider connections', () => {
  it('keeps the token encrypted on disk and recognises the self-hosted host', () => {
    const { dir, store, gl } = setup();
    expect(fs.readFileSync(path.join(dir, 'c.json'), 'utf8')).not.toContain('glpat-secret');
    expect(store.token(gl.id)).toBe('glpat-secret');
    expect(store.hostMap()['gitlab.example.com']).toBe('gitlab');
    const again = new ProviderConnectionStore(path.join(dir, 'c.json'), path.join(dir, 's'), enc);
    expect(again.all().map((c) => c.username)).toEqual(['ada', 'ada@contoso.com']);
  });

  it('signs in on its own host, switching an SSH remote to HTTPS for the operation', async () => {
    const { gl, deps } = setup();
    const r = await resolveAuth(deps, repo, 'git@gitlab.example.com:team/app.git', { method: 'pat', connectionId: gl.id }, 'push');
    expect(r.git).toMatchObject({ kind: 'basic', username: 'oauth2', password: 'glpat-secret', httpPrefix: 'https://gitlab.example.com/' });
    expect(r.transportUrl).toBe('https://gitlab.example.com/team/app.git');
  });

  it('never sends a token to another server or another Azure organization', async () => {
    const { gl, az, deps } = setup();
    await expect(resolveAuth(deps, repo, 'https://gitlab.com/team/app.git', { method: 'pat', connectionId: gl.id }, 'push')).rejects.toThrow(/only ever sent to its own server/);
    await expect(resolveAuth(deps, repo, 'https://dev.azure.com/fabrikam/p/_git/r', { method: 'pat', connectionId: az.id }, 'fetch')).rejects.toThrow(/only ever sent/);
    const ok = await resolveAuth(deps, repo, 'git@ssh.dev.azure.com:v3/contoso/Web/site', { method: 'pat', connectionId: az.id }, 'fetch');
    expect(ok.transportUrl).toBe('https://dev.azure.com/contoso/Web/_git/site');
  });

  it('accepts only a bare server address', () => {
    expect(asHost('https://Git.Example.com/')).toBe('git.example.com');
    expect(asHost('git.example.com:8443')).toBe('git.example.com:8443');
    expect(() => asHost('git.example.com/evil')).toThrow();
    expect(() => asHost('user@host')).toThrow();
  });
});
