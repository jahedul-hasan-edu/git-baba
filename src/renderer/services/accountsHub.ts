/** Opens File → Accounts from anywhere in the window. */
export const ACCOUNTS_HUB_EVENT = 'gb:accounts-hub';
export const openAccountsHub = () => window.dispatchEvent(new Event(ACCOUNTS_HUB_EVENT));
