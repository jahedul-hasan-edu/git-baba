/**
 * A changed file picked in the Changes panel on a page that has no diff area (Code, Pull requests, Settings…).
 * The app switches to History, whose Changes panel then opens the file; the request waits until it is mounted.
 */
export interface OpenFileRequest {
  path: string;
  area: 'staged' | 'unstaged' | 'untracked' | 'conflicted';
}

let pending: OpenFileRequest | null = null;
const EVENT = 'gb:open-file';

export function requestOpenFile(r: OpenFileRequest): void {
  pending = r;
  window.dispatchEvent(new Event(EVENT));
}
export const peekOpenFile = (): OpenFileRequest | null => pending;
export const clearOpenFile = (): void => {
  pending = null;
};
export const OPEN_FILE_EVENT = EVENT;
