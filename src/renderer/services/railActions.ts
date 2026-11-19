/**
 * Lets other screens (the header branch menu) open the branch rail's own windows: New Branch and Stash.
 * The request is kept until the rail picks it up, so it also works while the rail is still mounting.
 */
export type RailAction = 'new-branch' | 'stash';

const EVENT = 'gb:rail-action';
let pending: RailAction | null = null;

export function requestRailAction(action: RailAction): void {
  pending = action;
  window.dispatchEvent(new CustomEvent<RailAction>(EVENT, { detail: action }));
}

/** Takes the waiting request, if any (each request is handled once). */
export function takeRailAction(): RailAction | null {
  const a = pending;
  pending = null;
  return a;
}

export function onRailAction(handler: (a: RailAction) => void): () => void {
  const on = () => {
    const a = takeRailAction();
    if (a) handler(a);
  };
  window.addEventListener(EVENT, on);
  on(); // a request made before this listener existed
  return () => window.removeEventListener(EVENT, on);
}
