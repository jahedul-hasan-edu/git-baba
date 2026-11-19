import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitService } from '../src/main/git/GitService';

describe('GitService.blame', () => {
  it('names the author and commit of every line', async () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-blame-')));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' }).toString().trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Ada');
    git('config', 'user.email', 'ada@example.com');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first lines');
    const first = git('rev-parse', 'HEAD');
    git('config', 'user.name', 'Grace');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
    git('commit', '-qam', 'add three');
    const second = git('rev-parse', 'HEAD');

    const b = await new GitService(repo).blame('main', 'a.txt');
    expect(b.lines).toEqual([first, first, second]);
    expect(b.commits[first]).toMatchObject({ author: 'Ada', email: 'ada@example.com', summary: 'first lines' });
    expect(b.commits[second]).toMatchObject({ author: 'Grace', summary: 'add three' });
    expect(Date.parse(b.commits[second].date)).not.toBeNaN();
    await expect(new GitService(repo).blame('--evil', 'a.txt')).rejects.toThrow();
  });
});

describe('GitService.fileBytes', () => {
  it('returns binary files byte-for-byte, from a commit and from the working copy', async () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-bytes-')));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' }).toString().trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Ada');
    git('config', 'user.email', 'ada@example.com');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x10, 0x80, 0x0d, 0x0a]);
    fs.writeFileSync(path.join(repo, 'pic.png'), png);
    git('add', '.');
    git('commit', '-q', '-m', 'add picture');
    const svc = new GitService(repo);
    const committed = await svc.fileBytes('main', 'pic.png');
    expect(Buffer.from(committed.base64, 'base64').equals(png)).toBe(true);
    expect(committed).toMatchObject({ size: png.length, tooLarge: false });
    const local = await svc.fileBytes(null, 'pic.png');
    expect(Buffer.from(local.base64, 'base64').equals(png)).toBe(true);
    expect((await svc.fileBytes('main', 'pic.png', 4)).tooLarge).toBe(true);
    await expect(svc.fileBytes('main', '../outside.png')).rejects.toThrow();
  });
});
