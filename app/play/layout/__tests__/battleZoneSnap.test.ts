import { describe, it, expect } from 'vitest';
import {
  getCharacterSnapPosition,
  getEnhancementSnapPosition,
} from '../battleZoneSnap';

const zoneRect = { x: 50, y: 300, width: 1000, height: 200, label: 'Field of Battle' };
const cardWidth = 98;
const cardHeight = 137;

describe('getCharacterSnapPosition', () => {
  it('centers the first character horizontally on the player side (bottom half)', () => {
    const pos = getCharacterSnapPosition('player', 0, zoneRect, cardWidth, cardHeight);
    const expectedX = zoneRect.x + zoneRect.width / 2 - cardWidth / 2;
    expect(pos.x).toBeCloseTo(expectedX, 0);
    expect(pos.y).toBeGreaterThan(zoneRect.y + zoneRect.height / 2 - 10);
  });

  it('centers the first character on the opponent side (top half)', () => {
    const pos = getCharacterSnapPosition('opponent', 0, zoneRect, cardWidth, cardHeight);
    expect(pos.y).toBeLessThan(zoneRect.y + zoneRect.height / 2);
  });

  it('offsets banded characters to the right', () => {
    const first = getCharacterSnapPosition('player', 0, zoneRect, cardWidth, cardHeight);
    const second = getCharacterSnapPosition('player', 1, zoneRect, cardWidth, cardHeight);
    expect(second.x).toBeGreaterThan(first.x);
  });
});

describe('getEnhancementSnapPosition', () => {
  it('places the first enhancement to the left of the character', () => {
    const charPos = getCharacterSnapPosition('player', 0, zoneRect, cardWidth, cardHeight);
    const enhPos = getEnhancementSnapPosition('player', 0, 0, zoneRect, cardWidth, cardHeight);
    expect(enhPos.x).toBeLessThan(charPos.x);
    expect(enhPos.y).toBeCloseTo(charPos.y, 0);
  });

  it('stacks enhancements with 60% card width overlap', () => {
    const enh0 = getEnhancementSnapPosition('player', 0, 0, zoneRect, cardWidth, cardHeight);
    const enh1 = getEnhancementSnapPosition('player', 0, 1, zoneRect, cardWidth, cardHeight);
    const step = cardWidth * 0.4;
    expect(enh0.x - enh1.x).toBeCloseTo(step, 0);
  });
});
