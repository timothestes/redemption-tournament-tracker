import { describe, it, expect } from 'vitest';
import { shouldGateForPortrait } from '../orientationGate';

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
