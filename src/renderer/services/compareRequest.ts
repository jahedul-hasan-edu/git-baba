/**
 * Opens the Compare window from the tab bar. The graph (Changes tab) owns the window; the request waits
 * until it is mounted, so it also works from another tab.
 */
const EVENT = 'gb:open-compare';
let pending = false;

export function requestCompare(): void {
  pending = true;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onCompareRequest(handler: () => void): () => void {
  const on = () => {
    if (!pending) return;
    pending = false;
    handler();
  };
  window.addEventListener(EVENT, on);
  on(); // a request made before this listener existed
  return () => window.removeEventListener(EVENT, on);
}
