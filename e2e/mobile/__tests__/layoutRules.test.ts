import { describe, it, expect } from 'vitest';
import {
  checkTargetSize, checkFontSize, MOBILE_VIEWPORTS,
  checkHandBandOcclusion, handBandOcclusionPct, handBandCoveragePct,
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

describe('checkHandBandOcclusion', () => {
  // 393px-tall phone; the hand band is the bottom ~69px.
  const handBand = { top: 324, left: 0, width: 852, height: 69 };

  it('passes an overlay that sits entirely above the hand', () => {
    const rail = { top: 250, left: 0, width: 852, height: 60 };
    expect(checkHandBandOcclusion(rail, handBand).ok).toBe(true);
  });

  it('flags the pre-fix toolbar, which covered 93% of the hand', () => {
    // bottom: 8, 56px tall -> top 329, covering 324..385 of a 324..393 band
    const toolbar = { top: 329, left: 8, width: 500, height: 56 };
    const r = checkHandBandOcclusion(toolbar, handBand);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
    expect(r.message).toContain('%');
  });

  it('flags the pre-fix rail, which buried the whole band', () => {
    const rail = { top: 263, left: 0, width: 852, height: 130 };
    expect(checkHandBandOcclusion(rail, handBand).severity).toBe('error');
  });

  it('passes a 44px corner control, which costs the player one card', () => {
    const fab = { top: 341, left: 8, width: 44, height: 44 };
    // It DOES overlap vertically - but across 5% of the width, so the cost is
    // one partly-hidden card, not the whole hand.
    expect(handBandOcclusionPct(fab, handBand)).toBeGreaterThan(0);
    expect(checkHandBandOcclusion(fab, handBand).ok).toBe(true);
  });

  it('separates a full-width bar from a corner control at equal height', () => {
    const bar = { top: 341, left: 0, width: 852, height: 44 };
    const fab = { top: 341, left: 8, width: 44, height: 44 };
    expect(handBandOcclusionPct(bar, handBand)).toBe(handBandOcclusionPct(fab, handBand));
    expect(handBandCoveragePct(bar, handBand))
      .toBeGreaterThan(handBandCoveragePct(fab, handBand) * 10);
    expect(checkHandBandOcclusion(bar, handBand).severity).toBe('error');
  });

  it('measures overlap vertically, ignoring horizontal position', () => {
    // Moving a bar left does not stop it covering the hand, which fans across
    // the full width - this is exactly the under-fix that shipped first.
    const left = { top: 329, left: 0, width: 200, height: 56 };
    const right = { top: 329, left: 650, width: 200, height: 56 };
    expect(handBandOcclusionPct(left, handBand)).toBe(handBandOcclusionPct(right, handBand));
  });

  it('reports 0 for a degenerate band', () => {
    expect(handBandOcclusionPct({ top: 0, left: 0, width: 10, height: 10 },
      { top: 0, left: 0, width: 0, height: 0 })).toBe(0);
  });
});
