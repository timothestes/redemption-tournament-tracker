import { describe, it, expect } from 'vitest';
import { calculateScale, virtualToScreen, screenToVirtual, VIRTUAL_WIDTH, VIRTUAL_HEIGHT, MIN_VIRTUAL_WIDTH, MAX_VIRTUAL_WIDTH } from '../virtualCanvas';

describe('calculateScale', () => {
  it('returns scale 1.0 and virtualWidth 1920 for standard 16:9', () => {
    const result = calculateScale(1920, 1080);
    expect(result.scale).toBe(1);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(result.virtualWidth).toBe(1920);
  });

  it('scales down for smaller 16:9 container, no letterbox', () => {
    const result = calculateScale(960, 540);
    expect(result.scale).toBe(0.5);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(result.virtualWidth).toBe(1920);
  });

  it('adapts virtual width for ultrawide (21:9) with no letterbox', () => {
    // 2560x1080 is exactly 21:9 — within the supported range
    const result = calculateScale(2560, 1080);
    expect(result.scale).toBe(1);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(result.virtualWidth).toBe(MAX_VIRTUAL_WIDTH);
  });

  it('letterboxes only beyond max supported aspect ratio', () => {
    // 3440x1080 is ~3.19:1, beyond MAX_VIRTUAL_WIDTH/1080 (~2.37:1)
    const result = calculateScale(3440, 1080);
    expect(result.virtualWidth).toBe(MAX_VIRTUAL_WIDTH);
    expect(result.scale).toBe(1); // height-limited
    expect(result.offsetX).toBeCloseTo((3440 - MAX_VIRTUAL_WIDTH) / 2);
    expect(result.offsetY).toBe(0);
  });

  it('adapts virtual width for narrow/square container', () => {
    // 1440x1080 is 4:3 — exactly MIN_VIRTUAL_WIDTH
    const result = calculateScale(1440, 1080);
    expect(result.scale).toBe(1);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(result.virtualWidth).toBe(MIN_VIRTUAL_WIDTH);
  });

  it('letterboxes only below min supported aspect ratio', () => {
    // 1080x1080 is 1:1, below MIN_VIRTUAL_WIDTH/1080 (~1.33:1)
    const result = calculateScale(1080, 1080);
    expect(result.virtualWidth).toBe(MIN_VIRTUAL_WIDTH);
    // Width is limiting: scale = 1080 / 1440
    expect(result.scale).toBeCloseTo(1080 / MIN_VIRTUAL_WIDTH);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBeGreaterThan(0); // vertical letterbox
  });

  it('returns zero scale for zero dimensions', () => {
    const result = calculateScale(0, 0);
    expect(result.scale).toBe(0);
    expect(result.virtualWidth).toBe(VIRTUAL_WIDTH);
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
