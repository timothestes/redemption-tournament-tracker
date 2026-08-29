import { describe, it, expect } from 'vitest';
import {
  checkTargetSize, checkFontSize, MOBILE_VIEWPORTS,
  MIN_TARGET_PX, ABSOLUTE_MIN_TARGET_PX, MIN_FONT_PX,
} from '../layoutRules';

describe('checkTargetSize', () => {
  it('passes a 44x44 target', () => {
    expect(checkTargetSize({ width: 44, height: 44 }).ok).toBe(true);
  });

  it('passes a larger target', () => {
    expect(checkTargetSize({ width: 80, height: 50 }).ok).toBe(true);
  });

  it('flags a target under the AA floor as an error', () => {
    const r = checkTargetSize({ width: 20, height: 20 });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('flags a target between the AA floor and the AAA target as a warning', () => {
    const r = checkTargetSize({ width: 30, height: 30 });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('warning');
  });

  it('uses the smaller dimension - a wide but short target still fails', () => {
    expect(checkTargetSize({ width: 200, height: 18 }).severity).toBe('error');
  });
});

describe('checkFontSize', () => {
  it('passes 11px and above', () => {
    expect(checkFontSize(11).ok).toBe(true);
    expect(checkFontSize(15).ok).toBe(true);
  });

  it('flags 8px - the pre-change GameToolbar label size', () => {
    expect(checkFontSize(8).ok).toBe(false);
  });
});

describe('thresholds', () => {
  it('match the documented standards', () => {
    expect(MIN_TARGET_PX).toBe(44);
    expect(ABSOLUTE_MIN_TARGET_PX).toBe(24);
    expect(MIN_FONT_PX).toBe(11);
  });
});

describe('MOBILE_VIEWPORTS', () => {
  it('covers phone landscape, tablet landscape, phone portrait and a desktop baseline', () => {
    const names = MOBILE_VIEWPORTS.map((v) => v.name);
    expect(names).toContain('iphone-14-pro-landscape');
    expect(names).toContain('ipad-mini-landscape');
    expect(names).toContain('iphone-14-pro-portrait');
    expect(names).toContain('desktop-baseline');
  });

  it('has a portrait entry that the orientation gate would catch', () => {
    const p = MOBILE_VIEWPORTS.find((v) => v.name === 'iphone-14-pro-portrait')!;
    expect(p.width).toBeLessThan(p.height);
    expect(p.width).toBeLessThan(700);
  });
});
