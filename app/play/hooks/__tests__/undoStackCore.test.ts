import { describe, it, expect, vi } from 'vitest';
import {
  MAX_UNDO_ENTRIES,
  pushEntry,
  undoEntry,
  shouldClearUndoStack,
  reverseIsSafe,
  makeReverseAction,
  makeBatchReverseAction,
  type UndoEntry,
  type Captured,
} from '../undoStackCore';

const entry = (description: string, reverse: () => boolean = () => true): UndoEntry => ({
  description,
  reverseAction: reverse,
});

describe('pushEntry', () => {
  it('appends without mutating the input', () => {
    const stack: UndoEntry[] = [entry('a')];
    const next = pushEntry(stack, entry('b'));
    expect(next.map(e => e.description)).toEqual(['a', 'b']);
    expect(stack.map(e => e.description)).toEqual(['a']); // unchanged
  });

  it('evicts the oldest once past the max (length stays at max)', () => {
    let stack: UndoEntry[] = [];
    for (let i = 0; i < MAX_UNDO_ENTRIES; i++) stack = pushEntry(stack, entry(`e${i}`));
    expect(stack).toHaveLength(MAX_UNDO_ENTRIES);
    stack = pushEntry(stack, entry('overflow')); // 21st push
    expect(stack).toHaveLength(MAX_UNDO_ENTRIES);
    expect(stack[0].description).toBe('e1'); // e0 dropped
    expect(stack[stack.length - 1].description).toBe('overflow');
  });
});

describe('undoEntry', () => {
  it('returns empty + unchanged stack when nothing to peek', () => {
    const stack: UndoEntry[] = [];
    const { next, result } = undoEntry(stack);
    expect(result).toEqual({ status: 'empty' });
    expect(next).toBe(stack);
  });

  it('reverseAction returning true → applied, shrinks by one', () => {
    const stack = [entry('a'), entry('b', () => true)];
    const { next, result } = undoEntry(stack);
    expect(result).toEqual({ status: 'applied', description: 'b' });
    expect(next.map(e => e.description)).toEqual(['a']);
  });

  it('reverseAction returning false → refused, still shrinks by one (consume)', () => {
    const stack = [entry('a'), entry('b', () => false)];
    const { next, result } = undoEntry(stack);
    expect(result).toEqual({ status: 'refused', description: 'b' });
    expect(next.map(e => e.description)).toEqual(['a']);
  });

  it('reverseAction throwing → threw with error, still shrinks by one (consume)', () => {
    const boom = new Error('boom');
    const stack = [entry('a'), entry('b', () => { throw boom; })];
    const { next, result } = undoEntry(stack);
    expect(result).toEqual({ status: 'threw', description: 'b', error: boom });
    expect(next.map(e => e.description)).toEqual(['a']);
  });

  it('processes entries LIFO across successive calls', () => {
    let stack = [entry('first'), entry('second'), entry('third')];
    let r = undoEntry(stack); stack = r.next;
    expect(r.result).toMatchObject({ description: 'third' });
    r = undoEntry(stack); stack = r.next;
    expect(r.result).toMatchObject({ description: 'second' });
    r = undoEntry(stack); stack = r.next;
    expect(r.result).toMatchObject({ description: 'first' });
    expect(undoEntry(stack).result).toEqual({ status: 'empty' });
  });

  it('does not report applied unless reverseAction actually returned true (false-success regression)', () => {
    const { result } = undoEntry([entry('x', () => false)]);
    expect(result.status).toBe('refused');
    expect(result.status).not.toBe('applied');
  });
});

describe('shouldClearUndoStack', () => {
  it('clears only on the true → false edge', () => {
    expect(shouldClearUndoStack(true, false)).toBe(true);
    expect(shouldClearUndoStack(undefined, false)).toBe(false);
    expect(shouldClearUndoStack(false, false)).toBe(false);
    expect(shouldClearUndoStack(true, true)).toBe(false);
    expect(shouldClearUndoStack(false, true)).toBe(false);
    expect(shouldClearUndoStack(undefined, true)).toBe(false);
  });
});

describe('reverseIsSafe', () => {
  const captured = { expectedZone: 'territory', expectedOwnerId: '7' };

  it('true when zone + owner both match', () => {
    expect(reverseIsSafe(captured, { zone: 'territory', ownerId: '7' })).toBe(true);
  });
  it('false on zone change', () => {
    expect(reverseIsSafe(captured, { zone: 'discard', ownerId: '7' })).toBe(false);
  });
  it('false on owner change', () => {
    expect(reverseIsSafe(captured, { zone: 'territory', ownerId: '9' })).toBe(false);
  });
  it('false when the card no longer exists (deleted token)', () => {
    expect(reverseIsSafe(captured, undefined)).toBe(false);
  });
});

const cap = (over: Partial<Captured> = {}): Captured => ({
  cardId: 'c1',
  fromZone: 'hand',
  prevOwnerId: '1',
  posX: '0.1',
  posY: '0.2',
  expectedZone: 'territory',
  expectedOwnerId: '1',
  ...over,
});

describe('makeReverseAction', () => {
  it('does NOT call move and returns false when unsafe', () => {
    const move = vi.fn();
    const reverse = makeReverseAction({
      captured: cap(),
      lookup: () => ({ zone: 'discard', ownerId: '1' }), // moved away
      move,
    });
    expect(reverse()).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it('does NOT call move and returns false when the card is gone', () => {
    const move = vi.fn();
    const reverse = makeReverseAction({ captured: cap(), lookup: () => undefined, move });
    expect(reverse()).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it('calls move once with fromZone/prevOwnerId and returns true when safe', () => {
    const move = vi.fn();
    const reverse = makeReverseAction({
      captured: cap(),
      lookup: () => ({ zone: 'territory', ownerId: '1' }),
      move,
    });
    expect(reverse()).toBe(true);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith('c1', 'hand', '0.1', '0.2', '1');
  });
});

describe('makeBatchReverseAction', () => {
  it('returns true iff at least one card is safe, dispatching only safe ones', () => {
    const move = vi.fn();
    const items = [
      cap({ cardId: 'safe', expectedZone: 'territory', fromZone: 'hand' }),
      cap({ cardId: 'stale', expectedZone: 'territory', fromZone: 'hand' }),
    ];
    const reverse = makeBatchReverseAction({
      items,
      lookup: (id) => (id === 'safe' ? { zone: 'territory', ownerId: '1' } : { zone: 'discard', ownerId: '1' }),
      move,
    });
    expect(reverse()).toBe(true);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith('safe', 'hand', '0.1', '0.2', '1');
  });

  it('returns false and dispatches nothing when no card is safe', () => {
    const move = vi.fn();
    const reverse = makeBatchReverseAction({
      items: [cap({ cardId: 'a' }), cap({ cardId: 'b' })],
      lookup: () => undefined,
      move,
    });
    expect(reverse()).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });
});
