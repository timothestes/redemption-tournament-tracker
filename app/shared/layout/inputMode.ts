/**
 * Input mode detection, split from the React hook so the decision logic is
 * unit-testable (vitest runs pure .ts only — no jsdom in this repo).
 */

export type InputMode = 'pointer' | 'touch';

/** Query-param override, e.g. `?input=touch`. Lets the e2e harness force
 *  touch mode inside a desktop Chromium. */
export function parseInputOverride(search: string): string | null {
  if (!search) return null;
  const q = search.startsWith('?') ? search.slice(1) : search;
  for (const pair of q.split('&')) {
    const [k, v] = pair.split('=');
    if (k === 'input' && v) return decodeURIComponent(v);
  }
  return null;
}

/** An explicit, recognised override always wins; otherwise fall back to the
 *  `(pointer: coarse)` media query. */
export function resolveInputMode(coarsePointer: boolean, override: string | null): InputMode {
  if (override === 'touch' || override === 'pointer') return override;
  return coarsePointer ? 'touch' : 'pointer';
}
