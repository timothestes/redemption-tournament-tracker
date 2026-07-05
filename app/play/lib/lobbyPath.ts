// Session key under which the lobby stashes a game's join params (see
// GameLobby / ForgeGameLobby). Mirrors SESSION_KEY_PREFIX in play/[code]/client.tsx.
const SESSION_KEY_PREFIX = 'stdb_game_params_';

/**
 * Resolve which play lobby to return to from a `/play/[code]` game screen.
 *
 * Error boundaries (connection-reset fatal screen, route error.tsx) have no
 * game state to read `isForge` from, so we recover it from the params the
 * lobby stashed in sessionStorage when it created/joined the game. Forge games
 * return to the Forge play lobby; everyone else to the public lobby.
 *
 * Call from a click handler (or otherwise client-side) — during SSR it safely
 * falls back to '/play'.
 */
export function resolveLobbyPath(): string {
  if (typeof window === 'undefined') return '/play';
  const code = window.location.pathname.match(/\/play\/([^/]+)/)?.[1];
  if (!code) return '/play';
  try {
    const raw = window.sessionStorage.getItem(`${SESSION_KEY_PREFIX}${code}`);
    if (raw && JSON.parse(raw)?.isForge === true) return '/forge/play';
  } catch {
    // Malformed JSON or unavailable storage — fall through to the public lobby.
  }
  return '/play';
}
