import { describe, it, expect, vi } from 'vitest';
import { dispatchToastKey, pickActiveEntry, type ToastNavEntry } from '../toastKeyboardNav';

function makeEntry(priority = 0) {
  const entry = {
    priority,
    onLeft: vi.fn(),
    onRight: vi.fn(),
    onEnter: vi.fn(),
    onEscape: vi.fn(),
  };
  return entry satisfies ToastNavEntry;
}

describe('pickActiveEntry', () => {
  it('returns null for an empty stack', () => {
    expect(pickActiveEntry([])).toBeNull();
  });

  it('returns the highest-priority entry', () => {
    const low = makeEntry(0);
    const high = makeEntry(1);
    expect(pickActiveEntry([high, low])).toBe(high);
  });

  it('breaks ties by most-recently-registered (last in array)', () => {
    const first = makeEntry(0);
    const second = makeEntry(0);
    expect(pickActiveEntry([first, second])).toBe(second);
  });

  it('prefers priority over registration order', () => {
    const lateLow = makeEntry(0);
    const earlyHigh = makeEntry(2);
    expect(pickActiveEntry([earlyHigh, lateLow])).toBe(earlyHigh);
  });
});

describe('dispatchToastKey', () => {
  it('does nothing and reports unhandled when the stack is empty', () => {
    expect(dispatchToastKey('Enter', false, [])).toBe(false);
  });

  it('ignores keys while a text input is focused', () => {
    const entry = makeEntry();
    expect(dispatchToastKey('Enter', true, [entry])).toBe(false);
    expect(entry.onEnter).not.toHaveBeenCalled();
  });

  it('routes arrows, Enter and Escape to the active entry', () => {
    const entry = makeEntry();
    expect(dispatchToastKey('ArrowLeft', false, [entry])).toBe(true);
    expect(dispatchToastKey('ArrowRight', false, [entry])).toBe(true);
    expect(dispatchToastKey('Enter', false, [entry])).toBe(true);
    expect(dispatchToastKey('Escape', false, [entry])).toBe(true);
    expect(entry.onLeft).toHaveBeenCalledOnce();
    expect(entry.onRight).toHaveBeenCalledOnce();
    expect(entry.onEnter).toHaveBeenCalledOnce();
    expect(entry.onEscape).toHaveBeenCalledOnce();
  });

  it('only dispatches to the active entry, not lower ones', () => {
    const low = makeEntry(0);
    const high = makeEntry(1);
    dispatchToastKey('Enter', false, [low, high]);
    expect(high.onEnter).toHaveBeenCalledOnce();
    expect(low.onEnter).not.toHaveBeenCalled();
  });

  it('reports unhandled for unrelated keys', () => {
    const entry = makeEntry();
    expect(dispatchToastKey('a', false, [entry])).toBe(false);
    expect(dispatchToastKey('Tab', false, [entry])).toBe(false);
  });
});
