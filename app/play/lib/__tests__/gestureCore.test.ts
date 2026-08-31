import { describe, it, expect } from 'vitest';
import { classifyGesture, pinchMetrics, pinchZoomDelta } from '../gestureCore';

describe('classifyGesture', () => {
  it('is none with no pointers', () => {
    expect(classifyGesture([])).toBe('none');
  });

  it('is pan with one pointer', () => {
    expect(classifyGesture([{ id: 1, x: 0, y: 0 }])).toBe('pan');
  });

  it('is pinch with two pointers', () => {
    expect(classifyGesture([{ id: 1, x: 0, y: 0 }, { id: 2, x: 10, y: 10 }])).toBe('pinch');
  });

  it('is pinch with more than two pointers', () => {
    expect(classifyGesture([
      { id: 1, x: 0, y: 0 }, { id: 2, x: 10, y: 10 }, { id: 3, x: 20, y: 20 },
    ])).toBe('pinch');
  });
});

describe('pinchMetrics', () => {
  it('computes distance and midpoint', () => {
    const m = pinchMetrics({ id: 1, x: 0, y: 0 }, { id: 2, x: 6, y: 8 });
    expect(m.distance).toBe(10);
    expect(m.midX).toBe(3);
    expect(m.midY).toBe(4);
  });
});

describe('pinchZoomDelta', () => {
  it('is 1 when the distance is unchanged', () => {
    expect(pinchZoomDelta(100, 100)).toBe(1);
  });

  it('is >1 when fingers spread', () => {
    expect(pinchZoomDelta(100, 200)).toBe(2);
  });

  it('is <1 when fingers pinch together', () => {
    expect(pinchZoomDelta(200, 100)).toBe(0.5);
  });

  it('guards against a zero start distance', () => {
    expect(pinchZoomDelta(0, 100)).toBe(1);
  });
});
