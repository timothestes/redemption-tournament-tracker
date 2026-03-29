import { describe, it, expect } from 'vitest';
import { calculateScale, virtualToScreen, screenToVirtual, VIRTUAL_WIDTH, VIRTUAL_HEIGHT } from '../virtualCanvas';

describe('calculateScale', () => {
  it('returns scale 1.0 when container matches virtual size', () => {
    const result = calculateScale(1920, 1080);
    expect(result.scale).toBe(1);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  it('scales down for smaller container, no letterbox on matching aspect ratio', () => {
    const result = calculateScale(960, 540);
    expect(result.scale).toBe(0.5);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  it('adds horizontal letterbox for ultrawide container', () => {
    const result = calculateScale(3440, 1440);
    expect(result.scale).toBeCloseTo(1440 / 1080);
    const scaledWidth = 1920 * result.scale;
    expect(result.offsetX).toBeCloseTo((3440 - scaledWidth) / 2);
    expect(result.offsetY).toBe(0);
  });

  it('adds vertical letterbox for tall/narrow container', () => {
    const result = calculateScale(1080, 1920);
    expect(result.scale).toBeCloseTo(1080 / 1920);
    const scaledHeight = 1080 * result.scale;
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBeCloseTo((1920 - scaledHeight) / 2);
  });
});

describe('virtualToScreen', () => {
  it('converts virtual origin to screen offset', () => {
    const result = virtualToScreen(0, 0, 0.5, 100, 50);
    expect(result.x).toBe(100);
    expect(result.y).toBe(50);
  });

  it('converts virtual center to scaled screen position', () => {
    const result = virtualToScreen(960, 540, 0.5, 100, 50);
    expect(result.x).toBe(960 * 0.5 + 100);
    expect(result.y).toBe(540 * 0.5 + 50);
  });
});

describe('screenToVirtual', () => {
  it('is the inverse of virtualToScreen', () => {
    const scale = 0.75;
    const offsetX = 120;
    const offsetY = 30;
    const vx = 500;
    const vy = 300;
    const screen = virtualToScreen(vx, vy, scale, offsetX, offsetY);
    const back = screenToVirtual(screen.x, screen.y, scale, offsetX, offsetY);
    expect(back.x).toBeCloseTo(vx);
    expect(back.y).toBeCloseTo(vy);
  });
});
