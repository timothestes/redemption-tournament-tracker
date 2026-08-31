import { describe, it, expect } from 'vitest';
import { shouldGateForPortrait, isCompactTouchViewport } from '../orientationGate';

describe('shouldGateForPortrait', () => {
  it('gates a phone in portrait', () => {
    expect(shouldGateForPortrait(393, 852, 'touch')).toBe(true);
    expect(shouldGateForPortrait(375, 667, 'touch')).toBe(true);
  });

  it('does not gate a phone in landscape', () => {
    expect(shouldGateForPortrait(852, 393, 'touch')).toBe(false);
  });

  it('does not gate an iPad in portrait - it letterboxes but works', () => {
    expect(shouldGateForPortrait(834, 1112, 'touch')).toBe(false);
    expect(shouldGateForPortrait(768, 1024, 'touch')).toBe(false);
  });

  it('never gates a pointer device, however narrow the window', () => {
    expect(shouldGateForPortrait(400, 900, 'pointer')).toBe(false);
  });

  it('does not gate before the viewport has been measured', () => {
    expect(shouldGateForPortrait(0, 0, 'touch')).toBe(false);
  });
});

describe('isCompactTouchViewport', () => {
  it('is compact for a landscape phone (short viewport)', () => {
    expect(isCompactTouchViewport(852, 393, 'touch')).toBe(true);
    expect(isCompactTouchViewport(667, 375, 'touch')).toBe(true);
  });

  it('is compact for phone portrait behind "Continue anyway"', () => {
    // The regression this guards: portrait fell through to the desktop
    // profile (height-only check) and got a microfilm-strip board.
    expect(isCompactTouchViewport(393, 852, 'touch')).toBe(true);
  });

  it('keeps the standard profile on an iPad, either orientation', () => {
    expect(isCompactTouchViewport(834, 1112, 'touch')).toBe(false);
    expect(isCompactTouchViewport(1112, 834, 'touch')).toBe(false);
  });

  it('is never compact for a pointer device', () => {
    expect(isCompactTouchViewport(400, 900, 'pointer')).toBe(false);
    expect(isCompactTouchViewport(900, 400, 'pointer')).toBe(false);
  });

  it('is not compact before the viewport has been measured', () => {
    expect(isCompactTouchViewport(0, 0, 'touch')).toBe(false);
  });
});
