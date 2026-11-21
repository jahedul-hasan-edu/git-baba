import type { AccountSummary } from "../../shared/types";

export function accountLabel(a: AccountSummary): string {
  return a.orgs.length
    ? `Personal · ${a.orgs.slice(0, 3).join(", ")}${a.orgs.length > 3 ? "…" : ""}`
    : "Personal";
}

export type AccountTone = "ok" | "info" | "warn" | "muted";

/** One short status for an account: signed in now / token remembered / SSH only / needs sign-in. */
export function accountStatus(
  a: AccountSummary,
  signedIn: boolean,
): { tone: AccountTone; label: string; title: string } {
  if (signedIn)
    return {
      tone: "ok",
      label: "Signed in",
      title: "GitHub features are available (session kept in memory)",
    };
  if (a.method === "ssh" && !a.remembered)
    return {
      tone: "warn",
      label: "SSH only",
      title:
        "Push & pull over SSH work. Sign in with a browser or token for pull requests, Actions and profile.",
    };
  if (a.remembered)
    return {
      tone: "info",
      label: "Remembered",
      title:
        "A token is remembered in the OS keychain — signing in needs no typing",
    };
  return {
    tone: "muted",
    label: "Needs sign-in",
    title:
      "Sign in when a GitHub feature needs it. Git operations on your repositories work without it.",
  };
}
