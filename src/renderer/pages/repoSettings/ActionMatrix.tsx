import { useState } from 'react';
import type { RepoSettingsPatch } from '../../../shared/api';
import type { ActionAuth, ApiAuthPreference, AuthMethod, RemoteAuthPreference, RepoAccessOverview } from '../../../shared/types';
import { call } from '../../services/api';
import { useApp } from '../../state/AppState';

const GIT_OPTS: [RemoteAuthPreference, string, string][] = [
  ['ssh', '🔑', 'SSH'],
  ['pat', '👤', 'Token'],
  ['system', '💻', 'Git'],
];
const API_OPTS: [ApiAuthPreference, string, string][] = [
  ['session', '👤', 'Account'],
  ['pat', '🎟', 'Token'],
  ['github-app', '🤖', 'App'],
];
const SHORT: Record<AuthMethod, string> = { ssh: 'SSH', pat: 'Token', system: 'Git', 'github-app': 'App', none: '—' };

type Opt = { v: string; ico: string; label: string; off?: string };

/**
 * One row per action — commit, push, pull, merge, pull-request merge, deploy — each with its own default
 * sign-in. "Auto" follows what is set up; the dialogs preselect the choice and still let you change it.
 */
export function ActionMatrix({ o }: { o: RepoAccessOverview }) {
  const { activeRepo, bump, toast, showError } = useApp();
  const repo = activeRepo!;
  const [saving, setSaving] = useState<string | null>(null);
  const a = repo.settings.actionAuth ?? {};
  const app = !!repo.settings.githubApp;

  const save = async (key: string, settings: RepoSettingsPatch, msg: string) => {
    setSaving(key);
    try {
      await call('repo:updateSettings', { repoId: repo.id, settings });
      toast(msg);
      bump();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(null);
    }
  };

  const gitOpts: Opt[] = GIT_OPTS.map(([v, ico, label]) => ({ v, ico, label, off: o.available.includes(v) ? undefined : 'Not available for this remote' }));
  const apiOpts: Opt[] = API_OPTS.map(([v, ico, label]) => ({ v, ico, label, off: v === 'github-app' && !app ? 'Link a GitHub App below first' : undefined }));
  const autoGit = app && o.available.includes('github-app') ? 'App' : SHORT[o.effective.remote.method ?? 'none'];
  const setAction = (k: keyof ActionAuth, label: string) => (v: string | null) =>
    void save(k, { actionAuth: { [k]: v } as RepoSettingsPatch['actionAuth'] }, `${label}: ${v ? (([...GIT_OPTS, ...API_OPTS].find(([x]) => x === v)?.[2]) ?? v) : 'automatic'}`);

  const rows: { k: string; ico: string; label: string; value: string | undefined; auto: string; opts: Opt[]; onPick: (v: string | null) => void }[] = [
    {
      k: 'commit',
      ico: '✎',
      label: 'Commit',
      value: repo.settings.commitSigning,
      auto: o.effective.commit.method === 'none' ? 'Unsigned' : 'Signed',
      opts: [
        { v: 'signed', ico: '🔏', label: 'Signed', off: !o.signing.signedMethod || !o.signing.signingKey ? 'No signing key in git config' : undefined },
        { v: 'unsigned', ico: '✍', label: 'Unsigned' },
      ],
      onPick: (v) => void save('commit', { commitSigning: v as 'signed' | 'unsigned' | null }, `Commit: ${v ?? 'automatic'}`),
    },
    { k: 'push', ico: '⬆', label: 'Push', value: a.push, auto: autoGit, opts: gitOpts, onPick: setAction('push', 'Push') },
    { k: 'pull', ico: '⬇', label: 'Pull & fetch', value: a.pull, auto: autoGit, opts: gitOpts, onPick: setAction('pull', 'Pull') },
    { k: 'merge', ico: '⤵', label: 'Merge branches', value: a.merge, auto: autoGit, opts: gitOpts, onPick: setAction('merge', 'Merge') },
  ];
  if (repo.github) {
    rows.push(
      { k: 'prMerge', ico: '⇄', label: 'Merge pull requests', value: a.prMerge, auto: app ? 'App' : 'Account', opts: apiOpts.filter((x) => x.v !== 'pat'), onPick: setAction('prMerge', 'Pull request merge') },
      { k: 'deploy', ico: '🚀', label: 'Deploy (run workflows)', value: a.deploy, auto: app ? 'App' : 'Account', opts: apiOpts, onPick: setAction('deploy', 'Deploy') },
    );
  }

  return (
    <div className="am">
      {rows.map((r) => (
        <div key={r.k} className={`am-row ${r.value ? 'custom' : ''}`}>
          <span className="am-ico">{r.ico}</span>
          <span className="am-label">{r.label}</span>
          <div className="am-opts" role="radiogroup" aria-label={r.label}>
            <button role="radio" aria-checked={!r.value} className={`am-opt auto ${!r.value ? 'on' : ''}`} disabled={saving === r.k} onClick={() => r.value && r.onPick(null)} title="Follow what is set up">
              Auto <span className="am-auto">→ {r.auto}</span>
            </button>
            {r.opts.map((x) => (
              <button key={x.v} role="radio" aria-checked={r.value === x.v} className={`am-opt ${r.value === x.v ? 'on' : ''}`} disabled={!!x.off || saving === r.k} title={x.off} onClick={() => r.value !== x.v && r.onPick(x.v)}>
                <span>{x.ico}</span> {x.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
