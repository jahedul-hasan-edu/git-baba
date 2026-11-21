import { useState } from "react";
import type { AccountProfile } from "../../../shared/github";
import { Avatar, SessionGate } from "../../components/github/common";
import { openExternal } from "../../components/github/SecureActionDialog";
import { accountStatus } from "../../components/AccountSwitcher";
import {
  AddAccountDialog,
  type SignInMethod,
} from "../../dialogs/AddAccountDialog";
import { useApp } from "../../state/AppState";
import { AccountRepos } from "./AccountRepos";
import { ProfileOverview } from "./ProfileOverview";
import { CredentialsPage } from "./settings/CredentialsPage";
import { KeysPage } from "./settings/KeysPage";
import { PublicProfile } from "./settings/PublicProfile";

type Tab = "overview" | "repos" | "settings";
type Section = "profile" | "keys" | "credentials";

const SECTIONS: { id: Section; icon: string; label: string }[] = [
  { id: "profile", icon: "🪪", label: "Profile" },
  { id: "keys", icon: "🔑", label: "SSH & GPG keys" },
  { id: "credentials", icon: "🧩", label: "Credentials & Apps" },
];

/** Account level: who you are on GitHub, your repositories, and account-wide settings. */
export function AccountCenter() {
  const { activeAccount, session } = useApp();
  const [tab, setTab] = useState<Tab>(activeAccount ? "overview" : "settings");
  const [section, setSection] = useState<Section>("profile");
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [signIn, setSignIn] = useState<{
    initial?: SignInMethod;
    upgrade: boolean;
  } | null>(null);
  const st = activeAccount
    ? accountStatus(activeAccount, !!session?.active)
    : null;

  /** Without an account the GitHub-data tabs show a friendly invitation instead of a form. */
  const noAccount = (what: string) => (
    <div className="ax-acc-empty">
      <div className="ax-acc-empty-ico">👋</div>
      <div className="grow">
        <strong>Sign in to see {what}</strong>

      </div>
      <button
        className="btn primary sm"
        onClick={() => setSignIn({ initial: "browser", upgrade: false })}
      >
        🌐 Sign in with browser
      </button>
      <button className="btn sm" onClick={() => setSignIn({ upgrade: false })}>
        Other ways…
      </button>
    </div>
  );

  return (
    <div className="content account-center">
      <div className="acct-hero ach">
        <Avatar login={activeAccount?.login ?? "?"} size={40} />
        <div className="ach-id">
          <strong className="ellipsis">{profile?.name || activeAccount?.name || activeAccount?.login || "No account"}</strong>
          {activeAccount && (
            <span className="ach-sub">
              <span className={`ach-dot ${st?.tone ?? ""}`} title={st?.title} />
              {activeAccount.login}
            </span>
          )}
        </div>
        {profile && (
          <div className="ach-stats">
            <span title="Repositories you own"><strong>{profile.ownedRepos}</strong> repos</span>
            <span title="Followers"><strong>{profile.followers}</strong> followers</span>
            <span title="Contributions this year"><strong>{profile.contributions.total.toLocaleString()}</strong> contributions</span>
          </div>
        )}
        <span className="grow" />
        {activeAccount && !session?.active && (
          <button className="btn sm primary" onClick={() => setSignIn({ upgrade: true })}>
            {activeAccount.method === "ssh" ? "⬆ Upgrade" : "Sign in"}
          </button>
        )}
        {!activeAccount && (
          <button className="btn sm primary" onClick={() => setSignIn({ initial: "browser", upgrade: false })}>
            🌐 Sign in
          </button>
        )}
        {activeAccount && (
          <button className="ach-ext" onClick={() => openExternal(`https://github.com/${activeAccount.login}`)} title="Open on GitHub" aria-label="Open on GitHub">
            ↗
          </button>
        )}
      </div>

      <div className="tabs" style={{ margin: "12px 0 16px" }}>
        {(
          [
            ["overview", "Overview"],
            ["repos", "Repositories"],
            ["settings", "Settings"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <div
            key={id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </div>
        ))}
      </div>

      {tab === "overview" &&
        (activeAccount ? (
          <SessionGate what="your profile">
            <ProfileOverview onProfile={setProfile} />
          </SessionGate>
        ) : (
          noAccount("your profile")
        ))}
      {tab === "repos" &&
        (activeAccount ? (
          <SessionGate what="your repositories">
            <AccountRepos />
          </SessionGate>
        ) : (
          noAccount("your GitHub repositories")
        ))}
      {tab === "settings" && (
        <div className="settings-layout">
          <nav className="settings-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`settings-nav-item ${section === s.id ? "on" : ""}`}
                onClick={() => setSection(s.id)}
              >
                <span className="settings-nav-ico">{s.icon}</span>
                <span className="grow settings-nav-label">{s.label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-body">
            {!activeAccount ? (
              noAccount(
                SECTIONS.find((s) => s.id === section)!.label.toLowerCase(),
              )
            ) : (
              <SessionGate
                what={SECTIONS.find(
                  (s) => s.id === section,
                )!.label.toLowerCase()}
              >
                {section === "profile" && <PublicProfile />}
                {section === "keys" && <KeysPage />}
                {section === "credentials" && <CredentialsPage />}
              </SessionGate>
            )}
          </div>
        </div>
      )}
      {signIn && (
        <AddAccountDialog
          account={signIn.upgrade ? (activeAccount ?? undefined) : undefined}
          initial={signIn.initial}
          onClose={() => setSignIn(null)}
        />
      )}
    </div>
  );
}
