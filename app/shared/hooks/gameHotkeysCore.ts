// Pure decision logic extracted from useGameHotkeys so it can be unit-tested
// without a DOM. Goldfish mode is never turn-gated; multiplayer undo only runs
// on the local player's turn and never on held-key autorepeat.

export function shouldRunUndo(args: {
  mode: 'goldfish' | 'multiplayer';
  isMyTurn: boolean;
  repeat: boolean;
}): boolean {
  if (args.repeat) return false;
  if (args.mode === 'goldfish') return true;
  return args.isMyTurn;
}
