import { describe, expect, it } from 'vitest';
import { detectProvider, providerForHost, providerLinks, PROVIDERS } from '../src/shared/providers';

describe('detectProvider', () => {
  it('recognises GitHub, GitLab (nested groups), Bitbucket and Gitea over https and ssh', () => {
    expect(detectProvider('https://github.com/acme/app.git')).toMatchObject({ id: 'github', path: 'acme/app', web: 'https://github.com/acme/app' });
    expect(detectProvider('git@gitlab.com:group/sub/team/app.git')).toMatchObject({ id: 'gitlab', path: 'group/sub/team/app', web: 'https://gitlab.com/group/sub/team/app' });
    expect(detectProvider('https://bitbucket.org/ws/app.git')).toMatchObject({ id: 'bitbucket', path: 'ws/app' });
    expect(detectProvider('ssh://git@codeberg.org/me/tool.git')).toMatchObject({ id: 'gitea', web: 'https://codeberg.org/me/tool' });
  });

  it('understands every Azure DevOps remote form', () => {
    const want = { id: 'azure', org: 'contoso', project: 'Web App', web: 'https://dev.azure.com/contoso/Web%20App/_git/site' };
    expect(detectProvider('https://contoso@dev.azure.com/contoso/Web%20App/_git/site')).toMatchObject(want);
    expect(detectProvider('git@ssh.dev.azure.com:v3/contoso/Web App/site')).toMatchObject(want);
    expect(detectProvider('https://contoso.visualstudio.com/DefaultCollection/Web%20App/_git/site')).toMatchObject(want);
  });

  it('understands AWS CodeCommit (https, ssh and codecommit::)', () => {
    expect(detectProvider('https://git-codecommit.eu-west-1.amazonaws.com/v1/repos/payments')).toMatchObject({ id: 'codecommit', region: 'eu-west-1', path: 'payments' });
    expect(detectProvider('codecommit::us-east-2://dev@payments')).toMatchObject({ id: 'codecommit', region: 'us-east-2', path: 'payments' });
  });

  it('uses known self-hosted hosts, the SSH alias target, and falls back to a plain Git server', () => {
    expect(detectProvider('https://code.acme.io/team/app.git', { known: { 'code.acme.io': 'gitlab' } })).toMatchObject({ id: 'gitlab', web: 'https://code.acme.io/team/app' });
    expect(detectProvider('git@work:acme/app.git', { resolvedHost: 'github.com' })).toMatchObject({ id: 'github', web: 'https://github.com/acme/app' });
    expect(detectProvider('ssh://git@10.0.0.5:2222/srv/app.git')).toMatchObject({ id: 'git', web: null });
    expect(providerForHost('gitlab.internal.acme.com')).toBe('gitlab');
  });

  it('has no provider for local remotes', () => {
    expect(detectProvider('C:\repos\bare.git')).toBeNull();
    expect(detectProvider('/srv/git/app.git')).toBeNull();
    expect(detectProvider('file:///srv/git/app.git')).toBeNull();
  });
});

describe('providerLinks', () => {
  it('builds create-merge-request links per provider', () => {
    expect(providerLinks(detectProvider('git@gitlab.com:g/app.git')!).newPull('feat/x', 'main')).toBe('https://gitlab.com/g/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat%2Fx&merge_request%5Btarget_branch%5D=main');
    expect(providerLinks(detectProvider('https://bitbucket.org/ws/app.git')!).newPull('f', 'main')).toBe('https://bitbucket.org/ws/app/pull-requests/new?source=f&dest=main');
    expect(providerLinks(detectProvider('https://dev.azure.com/o/p/_git/r')!).pipelines).toBe('https://dev.azure.com/o/p/_build');
    expect(providerLinks(detectProvider('ssh://git@10.0.0.5/srv/app.git')!).pulls).toBeNull();
  });

  it('every provider declares what it supports, and only GitHub has in-app pull requests', () => {
    expect(PROVIDERS.filter((p) => p.features.pullRequests === 'app').map((p) => p.id)).toEqual(['github']);
    expect(PROVIDERS.every((p) => p.features.git === 'app')).toBe(true);
  });
});
