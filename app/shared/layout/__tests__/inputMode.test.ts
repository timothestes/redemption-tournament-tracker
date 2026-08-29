import { describe, it, expect } from 'vitest';
import { resolveInputMode, parseInputOverride } from '../inputMode';

describe('resolveInputMode', () => {
  it('returns touch when the pointer is coarse', () => {
    expect(resolveInputMode(true, null)).toBe('touch');
  });

  it('returns pointer when the pointer is fine', () => {
    expect(resolveInputMode(false, null)).toBe('pointer');
  });

  it('lets an explicit override win over coarse detection', () => {
    expect(resolveInputMode(true, 'pointer')).toBe('pointer');
    expect(resolveInputMode(false, 'touch')).toBe('touch');
  });

  it('ignores an unrecognised override', () => {
    expect(resolveInputMode(true, 'banana')).toBe('touch');
    expect(resolveInputMode(false, 'banana')).toBe('pointer');
  });
});

describe('parseInputOverride', () => {
  it('reads the input param', () => {
    expect(parseInputOverride('?input=touch')).toBe('touch');
    expect(parseInputOverride('?foo=1&input=pointer')).toBe('pointer');
  });

  it('returns null when absent', () => {
    expect(parseInputOverride('')).toBeNull();
    expect(parseInputOverride('?foo=1')).toBeNull();
  });
});
