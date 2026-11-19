import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitService } from '../src/main/git/GitService';

function dirtyRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-nbc-')));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' }).toString().trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Ada');
  git('config', 'user.email', 'ada@example.com');
  git('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nedited\n');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'brand new\n');
  return { repo, git, svc: new GitService(repo) };
}

describe('GitService.createBranchWithChanges', () => {
  it('carry: switches and the changes come along', async () => {
    const { repo, git, svc } = dirtyRepo();
    expect(await svc.createBranchWithChanges('feature/x', null, 'carry', 'main')).toBeNull();
    expect(git('branch', '--show-current')).toBe('feature/x');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('one\nedited\n');
    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(true);
  });

  it('stash: the new branch opens clean and the changes wait in a named stash', async () => {
    const { repo, git, svc } = dirtyRepo();
    const msg = await svc.createBranchWithChanges('feature/x', null, 'stash', 'main');
    expect(msg).toContain('main');
    expect(git('branch', '--show-current')).toBe('feature/x');
    expect(git('status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(false);
    expect(git('stash', 'list')).toContain(msg!);
    git('stash', 'pop', '-q');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('one\nedited\n');
    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(true);
  });

  it('leave: creates the branch without switching; the changes stay put', async () => {
    const { repo, git, svc } = dirtyRepo();
    expect(await svc.createBranchWithChanges('feature/x', null, 'leave', 'main')).toBeNull();
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('rev-parse', '--verify', 'refs/heads/feature/x')).toBe(git('rev-parse', 'HEAD'));
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('one\nedited\n');
  });

  it('stash: a failed switch puts the changes back untouched', async () => {
    const { repo, git, svc } = dirtyRepo();
    git('branch', 'taken');
    await expect(svc.createBranchWithChanges('taken', null, 'stash', 'main')).rejects.toThrow();
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('stash', 'list')).toBe('');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('one\nedited\n');
    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(true);
  });
});
