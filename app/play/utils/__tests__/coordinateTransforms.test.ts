import { describe, it, expect } from 'vitest';
import {
  toScreenPos,
  toDbPos,
  cardCenter,
  adjustAnchorForRotationChange,
} from '../coordinateTransforms';

// Shared test zone: x=100, y=200, width=400, height=300
const ZONE = { x: 100, y: 200, width: 400, height: 300, label: 'territory' };

// ── toScreenPos ─────────────────────────────────────────────────────────────

describe('toScreenPos', () => {
  it('my card at (0,0) → zone top-left', () => {
    const result = toScreenPos(0, 0, ZONE, 'my');
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('my card at (1,1) → zone bottom-right', () => {
    const result = toScreenPos(1, 1, ZONE, 'my');
    expect(result).toEqual({ x: 500, y: 500 });
  });

  it('my card at (0.5,0.5) → zone center', () => {
    const result = toScreenPos(0.5, 0.5, ZONE, 'my');
    expect(result).toEqual({ x: 300, y: 350 });
  });

  it('opponent (0,0) → mirrored to zone bottom-right', () => {
    const result = toScreenPos(0, 0, ZONE, 'opponent');
    // normX = 1-0=1, normY = 1-0=1 → x=1*400+100=500, y=1*300+200=500
    expect(result).toEqual({ x: 500, y: 500 });
  });

  it('opponent (1,1) → mirrored to zone top-left', () => {
    const result = toScreenPos(1, 1, ZONE, 'opponent');
    // normX = 1-1=0, normY = 1-1=0 → x=0*400+100=100, y=0*300+200=200
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('opponent (0.3, 0.5) has same screen pos as my (0.7, 0.5)', () => {
    const opp = toScreenPos(0.3, 0.5, ZONE, 'opponent');
    const my = toScreenPos(0.7, 0.5, ZONE, 'my');
    expect(opp).toEqual(my);
  });
});

// ── toDbPos ─────────────────────────────────────────────────────────────────

describe('toDbPos', () => {
  it('my card at zone top-left screen pos → DB (0,0)', () => {
    const result = toDbPos(100, 200, ZONE, 'my');
    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  it('my card at zone bottom-right screen pos → DB (1,1)', () => {
    const result = toDbPos(500, 500, ZONE, 'my');
    expect(result.x).toBeCloseTo(1, 10);
    expect(result.y).toBeCloseTo(1, 10);
  });

  it('my card at zone center → DB (0.5, 0.5)', () => {
    const result = toDbPos(300, 350, ZONE, 'my');
    expect(result.x).toBeCloseTo(0.5, 10);
    expect(result.y).toBeCloseTo(0.5, 10);
  });

  it('opponent screen top-left (zone top-left) → DB (1,1)', () => {
    // screenX=100, screenY=200 → rawX=0, rawY=0 → mirrored: (1,1)
    const result = toDbPos(100, 200, ZONE, 'opponent');
    expect(result.x).toBeCloseTo(1, 10);
    expect(result.y).toBeCloseTo(1, 10);
  });

  it('opponent screen bottom-right (zone bottom-right) → DB (0,0)', () => {
    // screenX=500, screenY=500 → rawX=1, rawY=1 → mirrored: (0,0)
    const result = toDbPos(500, 500, ZONE, 'opponent');
    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  it('clamping: card partially outside right/bottom stays in bounds', () => {
    // screenX=600 is 100px past right edge; card 60×80 → maxX = (400-60)/400 = 0.85
    const result = toDbPos(600, 600, ZONE, 'my', { cardWidth: 60, cardHeight: 80 });
    const expectedMaxX = Math.max(0, 1 - 60 / 400); // 0.85
    const expectedMaxY = Math.max(0, 1 - 80 / 300); // ~0.7333
    expect(result.x).toBeCloseTo(expectedMaxX, 10);
    expect(result.y).toBeCloseTo(expectedMaxY, 10);
  });

  it('clamping at origin: screen pos before zone left/top → (0,0)', () => {
    const result = toDbPos(0, 0, ZONE, 'my', { cardWidth: 60, cardHeight: 80 });
    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  it('no clamping: raw normalization even beyond bounds', () => {
    // screenX=600 → rawX = (600-100)/400 = 1.25 → no clamp → stays 1.25
    const result = toDbPos(600, 200, ZONE, 'my');
    expect(result.x).toBeCloseTo(1.25, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  it('zero-width zone: no division by zero (uses fallback 1)', () => {
    const zeroZone = { x: 100, y: 200, width: 0, height: 0, label: 'zero' };
    // Should not throw; rawX = (150-100)/1 = 50, rawY = (250-200)/1 = 50
    expect(() => toDbPos(150, 250, zeroZone, 'my')).not.toThrow();
    const result = toDbPos(150, 250, zeroZone, 'my');
    expect(isFinite(result.x)).toBe(true);
    expect(isFinite(result.y)).toBe(true);
  });
});

// ── Round-trip ───────────────────────────────────────────────────────────────

describe('round-trip: toDbPos(toScreenPos(db, zone, owner), zone, owner) ≈ db', () => {
  const cases: [number, number][] = [
    [0, 0],
    [1, 1],
    [0.5, 0.5],
    [0.3, 0.7],
    [0.1, 0.9],
  ];

  for (const owner of ['my', 'opponent'] as const) {
    for (const [dbX, dbY] of cases) {
      it(`owner=${owner} db=(${dbX},${dbY})`, () => {
        const screen = toScreenPos(dbX, dbY, ZONE, owner);
        const back = toDbPos(screen.x, screen.y, ZONE, owner);
        expect(back.x).toBeCloseTo(dbX, 10);
        expect(back.y).toBeCloseTo(dbY, 10);
      });
    }
  }
});

// ── cardCenter ───────────────────────────────────────────────────────────────

describe('cardCenter', () => {
  it('rotation=0 → anchor + half dimensions', () => {
    const result = cardCenter(100, 200, 60, 80, 0);
    expect(result).toEqual({ x: 130, y: 240 });
  });

  it('rotation=180 → anchor - half dimensions', () => {
    const result = cardCenter(100, 200, 60, 80, 180);
    expect(result).toEqual({ x: 70, y: 160 });
  });

  it('rotation=-180 → anchor - half dimensions', () => {
    const result = cardCenter(100, 200, 60, 80, -180);
    expect(result).toEqual({ x: 70, y: 160 });
  });

  it('rotation=90 → not rotated (threshold is >90)', () => {
    // abs(90) is NOT > 90, so treated as normal
    const result = cardCenter(100, 200, 60, 80, 90);
    expect(result).toEqual({ x: 130, y: 240 });
  });

  it('rotation=91 → rotated', () => {
    // abs(91) > 90 → rotated
    const result = cardCenter(100, 200, 60, 80, 91);
    expect(result).toEqual({ x: 70, y: 160 });
  });
});

// ── adjustAnchorForRotationChange ────────────────────────────────────────────

describe('adjustAnchorForRotationChange', () => {
  it('no change when both contexts are the same (both not rotated)', () => {
    const result = adjustAnchorForRotationChange(100, 200, 60, 80, false, false);
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('no change when both contexts are the same (both rotated)', () => {
    const result = adjustAnchorForRotationChange(100, 200, 60, 80, true, true);
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('subtracts card dimensions when going from rotated (180) to normal (0)', () => {
    const result = adjustAnchorForRotationChange(100, 200, 60, 80, true, false);
    expect(result).toEqual({ x: 40, y: 120 });
  });

  it('adds card dimensions when going from normal (0) to rotated (180)', () => {
    const result = adjustAnchorForRotationChange(100, 200, 60, 80, false, true);
    expect(result).toEqual({ x: 160, y: 280 });
  });

  it('round-trip: 0→180→0 returns original position', () => {
    const original = { x: 100, y: 200 };
    const step1 = adjustAnchorForRotationChange(original.x, original.y, 60, 80, false, true);
    const step2 = adjustAnchorForRotationChange(step1.x, step1.y, 60, 80, true, false);
    expect(step2).toEqual(original);
  });
});
