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
