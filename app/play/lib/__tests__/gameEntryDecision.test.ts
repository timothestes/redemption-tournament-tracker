import { describe, it, expect } from 'vitest';
import { finishedGameToReuseOnCreate } from '../gameEntryDecision';

// Regression coverage for the duplicate-game ('Z6NJ') incident: a connection-
// reset remount replayed a stale `role: 'create'` instruction AFTER the
// original game had already finished. The upstream reconnect lookup ignores
// finished games, so createGame fired again and spawned a duplicate game under
// the same code. This guard reuses the finished game instead of re-creating.

describe('finishedGameToReuseOnCreate', () => {
  it('reuses a finished game when re-entering to create with the same code', () => {
    // The exact bug shape: only a finished row for this code exists.
    const games = [{ id: 98315n, code: 'Z6NJ', status: 'finished' }];
    expect(finishedGameToReuseOnCreate('create', games, 'Z6NJ')).toBe(98315n);
  });

  it('returns null for a genuine first creation (no game with that code yet)', () => {
    const games = [{ id: 1n, code: 'AAAA', status: 'waiting' }];
    expect(finishedGameToReuseOnCreate('create', games, 'Z6NJ')).toBeNull();
  });

  it('returns null when only an active game with that code exists (active reconnect is handled upstream)', () => {
    const games = [{ id: 5n, code: 'Z6NJ', status: 'waiting' }];
    expect(finishedGameToReuseOnCreate('create', games, 'Z6NJ')).toBeNull();
  });

  it('does not apply to joiners — they fall through to joinGame and get the normal error', () => {
    const games = [{ id: 98315n, code: 'Z6NJ', status: 'finished' }];
    expect(finishedGameToReuseOnCreate('join', games, 'Z6NJ')).toBeNull();
  });

  it('ignores finished games with a different code', () => {
    const games = [{ id: 42n, code: 'OTHR', status: 'finished' }];
    expect(finishedGameToReuseOnCreate('create', games, 'Z6NJ')).toBeNull();
  });
});
