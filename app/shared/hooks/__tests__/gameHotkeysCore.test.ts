import { describe, it, expect } from 'vitest';
import { shouldRunUndo } from '../gameHotkeysCore';

describe('shouldRunUndo', () => {
  it('goldfish, no repeat → true', () => {
    expect(shouldRunUndo({ mode: 'goldfish', isMyTurn: false, repeat: false })).toBe(true);
  });
  it('goldfish, repeat → false', () => {
    expect(shouldRunUndo({ mode: 'goldfish', isMyTurn: true, repeat: true })).toBe(false);
  });
  it('multiplayer, my turn, no repeat → true', () => {
    expect(shouldRunUndo({ mode: 'multiplayer', isMyTurn: true, repeat: false })).toBe(true);
  });
  it('multiplayer, not my turn → false', () => {
    expect(shouldRunUndo({ mode: 'multiplayer', isMyTurn: false, repeat: false })).toBe(false);
  });
  it('multiplayer, my turn but repeat → false', () => {
    expect(shouldRunUndo({ mode: 'multiplayer', isMyTurn: true, repeat: true })).toBe(false);
  });
});
