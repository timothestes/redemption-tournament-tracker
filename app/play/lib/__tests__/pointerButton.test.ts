import { describe, it, expect } from 'vitest';
import { isPrimaryPointer } from '../pointerButton';

describe('isPrimaryPointer', () => {
  it('accepts a left mouse button', () => {
    expect(isPrimaryPointer({ button: 0 })).toBe(true);
  });

  it('rejects middle and right buttons', () => {
    expect(isPrimaryPointer({ button: 1 })).toBe(false);
    expect(isPrimaryPointer({ button: 2 })).toBe(false);
  });

  it('accepts a TouchEvent, which has no button property', () => {
    expect(isPrimaryPointer({})).toBe(true);
    expect(isPrimaryPointer({ button: undefined })).toBe(true);
  });
});
