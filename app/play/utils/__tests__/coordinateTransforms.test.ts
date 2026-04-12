import { describe, it, expect } from 'vitest';
import {
  toScreenPos,
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
