import type { ProviderId } from '../../shared/providers';

/** Opens File → Accounts from anywhere in the window (optionally on one provider, ready to connect it). */
export const ACCOUNTS_HUB_EVENT = 'gb:accounts-hub';
export const openAccountsHub = (focus?: ProviderId) => window.dispatchEvent(new CustomEvent<ProviderId | undefined>(ACCOUNTS_HUB_EVENT, { detail: focus }));
