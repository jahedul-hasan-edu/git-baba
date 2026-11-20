import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProviderId } from '../../shared/providers';
import type { ProviderConnection } from '../../shared/types';
import type { Encryptor } from '../repositories/SecretStore';
import { ID_PATTERN } from '../util/validate';

/**
 * Sign-ins for providers other than GitHub (GitLab, Bitbucket, Azure DevOps, Gitea): who, on which host.
 * The token is encrypted by the operating system, one file per connection, and is only ever used for that
 * same host. Without OS encryption the token is kept in memory for this session only.
 */
export class ProviderConnectionStore {
  private list: ProviderConnection[] = [];
  private readonly memory = new Map<string, string>();

  constructor(
    private readonly file: string,
    private readonly secretDir: string,
    private readonly encryptor: Encryptor,
  ) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ProviderConnection[];
      this.list = Array.isArray(raw) ? raw.filter((c) => c && ID_PATTERN.test(c.id)) : [];
    } catch {
      this.list = [];
    }
  }

  all(): ProviderConnection[] {
    // Session-only connections whose token is gone (app restarted without OS encryption) are dropped.
    return this.list.filter((c) => c.remembered || this.memory.has(c.id));
  }

  get(id: string): ProviderConnection | undefined {
    return this.all().find((c) => c.id === id);
  }

  /** Known hosts → provider, so self-hosted servers are recognised once connected. */
  hostMap(): Record<string, ProviderId> {
    return Object.fromEntries(this.all().map((c) => [c.host, c.provider]));
  }

  /** Adds or replaces the connection for the same provider, host, organization and username. */
  save(c: Omit<ProviderConnection, 'id' | 'addedAt' | 'remembered'>, token: string): ProviderConnection {
    const same = this.list.find((x) => x.provider === c.provider && x.host === c.host && (x.org ?? '') === (c.org ?? '') && x.username.toLowerCase() === c.username.toLowerCase());
    const id = same?.id ?? crypto.randomBytes(12).toString('base64url');
    const remembered = this.encryptor.isAvailable();
    if (remembered) {
      fs.mkdirSync(this.secretDir, { recursive: true });
      fs.writeFileSync(this.secretFile(id), this.encryptor.encrypt(token), { mode: 0o600 });
    } else this.memory.set(id, token);
    const rec: ProviderConnection = { ...c, id, addedAt: same?.addedAt ?? new Date().toISOString(), remembered };
    this.list = [...this.list.filter((x) => x.id !== id), rec];
    this.persist();
    return rec;
  }

  token(id: string): string | null {
    if (this.memory.has(id)) return this.memory.get(id)!;
    const f = this.secretFile(id);
    if (!fs.existsSync(f) || !this.encryptor.isAvailable()) return null;
    try {
      return this.encryptor.decrypt(fs.readFileSync(f));
    } catch {
      return null;
    }
  }

  remove(id: string): void {
    this.list = this.list.filter((c) => c.id !== id);
    this.memory.delete(id);
    fs.rmSync(this.secretFile(id), { force: true });
    this.persist();
  }

  private secretFile(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error('Invalid connection id');
    return path.join(this.secretDir, `${id}.bin`);
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.list.filter((c) => c.remembered), null, 2));
  }
}
