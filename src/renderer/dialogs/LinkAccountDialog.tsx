import { useState, type ReactNode } from 'react';
import { providerInfo } from '../../shared/providers';
import type { RepoSummary } from '../../shared/types';
import { Avatar } from '../components/github/common';
import { Modal } from '../components/Modal';
import { ProviderMono } from '../components/ProviderMono';
import { connectionServes, useAllAccounts, type AnyAccount } from '../hooks/useAllAccounts';
import { call } from '../services/api';
import { useApp } from '../state/AppState';

/**
 * "Which account is this repository for?" — asked after adding an existing folder when it is not obvious (several
 * accounts on its server, or none matched its owner). The answer is remembered for the repository; opening it later
 * uses that account.
 */
export function LinkAccountDialog({ repo, candidates, onDone }: { repo: RepoSummary; candidates: AnyAccount[]; onDone: (r: RepoSummary) => void }) {
  const { showError, toast } = useApp();
  const [pick, setPick] = useState<string | null>(repo.account ? `gh:${repo.account.id}` : (candidates[0]?.key ?? null));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const id = pick?.startsWith('gh:') ? pick.slice(3) : null;
    if ((id ?? null) === (repo.account?.id ?? null)) return onDone(repo);
    setBusy(true);
    try {
      const next = await call('repo:setAccount', { repoId: repo.id, accountId: id });
      toast(id ? `${repo.name} uses ${candidates.find((c) => c.key === pick)?.login}` : `${repo.name} is not linked to an account`, 'info');
      onDone(next);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const p = repo.provider ? providerInfo(repo.provider.id) : null;
  return (
    <Modal
      title="Which account?"
      icon="👤"
      size="narrow"
      onClose={() => onDone(repo)}
      locked={busy}
      footer={
        <>
          <button className="btn cancel" onClick={() => onDone(repo)} disabled={busy}>
            Later
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            Use this account
          </button>
        </>
      }
    >
      <div className="lnk">
        <div className="lnk-repo">
          {p && <ProviderMono id={repo.provider!.id} size={22} />}
          <span className="grow ellipsis">
            <strong>{repo.name}</strong>
            {repo.identity && <span className="small muted"> · {repo.identity}</span>}
          </span>
        </div>
        <div className="lnk-list" role="radiogroup" aria-label="Account">
          {candidates.map((a) => (
            <button key={a.key} role="radio" aria-checked={pick === a.key} className={`lnk-opt ${pick === a.key ? 'on' : ''}`} onClick={() => setPick(a.key)}>
              <Avatar login={a.login} size={26} />
              <span className="grow ellipsis">
                <strong>{a.login}</strong>
                <span className="small muted"> {a.host}</span>
              </span>
              <span className="lnk-radio" aria-hidden />
            </button>
          ))}
          <button role="radio" aria-checked={pick === null} className={`lnk-opt ${pick === null ? 'on' : ''}`} onClick={() => setPick(null)}>
            <span className="lnk-none">○</span>
            <span className="grow">No account</span>
            <span className="lnk-radio" aria-hidden />
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * File → Open existing repository, shared by the sidebar and the welcome screen: pick a folder, add it, and when its
 * remote could belong to more than one account (or none was matched), ask which one.
 */
export function useAddExisting(): { openExisting: () => Promise<void>; linkPrompt: ReactNode } {
  const { bump, selectRepo, showError, toast, refreshRepos } = useApp();
  const { all } = useAllAccounts();
  const [linking, setLinking] = useState<{ repo: RepoSummary; candidates: AnyAccount[] } | null>(null);

  const finish = (r: RepoSummary) => {
    setLinking(null);
    bump();
    void refreshRepos();
    selectRepo(r.id);
  };

  const openExisting = async () => {
    try {
      const pick = await call('dialog:pickDirectory', { purpose: 'open' });
      if (!pick) return;
      const repo = await call('repo:addExisting', { selectionId: pick.selectionId });
      const host = repo.provider?.host ?? null;
      // GitHub: the accounts on the repository's server. Other providers sign in by server, so nothing to choose.
      const candidates = repo.github ? all.filter((a) => a.kind === 'github' && host && a.host === host) : [];
      const serving = !repo.github ? all.filter((a) => a.kind === 'connection' && a.connection && connectionServes(a.connection, repo)) : [];
      if (candidates.length > 1 || (candidates.length === 1 && !repo.account)) {
        setLinking({ repo, candidates });
        return;
      }
      const via = repo.account?.login ?? (serving.length === 1 ? `${providerInfo(serving[0].provider).name} · ${serving[0].login}` : null);
      toast(via ? `Added ${repo.name} · ${via}` : `Added ${repo.name}`);
      finish(repo);
    } catch (err) {
      showError(err);
    }
  };

  const linkPrompt = linking ? <LinkAccountDialog repo={linking.repo} candidates={linking.candidates} onDone={finish} /> : null;
  return { openExisting, linkPrompt };
}
