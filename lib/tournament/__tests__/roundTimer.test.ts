import { describe, it, expect } from "vitest";
import {
  getRemainingSeconds,
  formatRemaining,
  getUrgency,
  derivePanelState,
} from "../roundTimer";

const T0 = "2026-05-29T12:00:00.000Z";
const t0ms = new Date(T0).getTime();

describe("getRemainingSeconds", () => {
  it("returns full duration when startTime is null", () => {
    expect(getRemainingSeconds(null, 45, t0ms)).toBe(45 * 60);
  });
  it("counts down from start", () => {
    expect(getRemainingSeconds(T0, 45, t0ms + 10 * 60 * 1000)).toBe(35 * 60);
  });
  it("clamps to zero at and past the end", () => {
    expect(getRemainingSeconds(T0, 45, t0ms + 45 * 60 * 1000)).toBe(0);
    expect(getRemainingSeconds(T0, 45, t0ms + 60 * 60 * 1000)).toBe(0);
  });
});

describe("formatRemaining", () => {
  it("formats mm:ss under an hour", () => {
    expect(formatRemaining(35 * 60 + 5)).toBe("35:05");
    expect(formatRemaining(0)).toBe("00:00");
  });
  it("formats h:mm:ss at/over an hour", () => {
    expect(formatRemaining(60 * 60 + 2 * 60 + 3)).toBe("1:02:03");
  });
});

describe("getUrgency", () => {
  it("expired at zero", () => {
    expect(getUrgency(0, 45)).toEqual({ isExpired: true, isWarning: false, isUrgent: false });
  });
  it("warning within last 10%", () => {
    expect(getUrgency(200, 45)).toEqual({ isExpired: false, isWarning: true, isUrgent: false });
  });
  it("urgent within last 25% but above 10%", () => {
    expect(getUrgency(600, 45)).toEqual({ isExpired: false, isWarning: false, isUrgent: true });
  });
  it("calm above 25%", () => {
    expect(getUrgency(2000, 45)).toEqual({ isExpired: false, isWarning: false, isUrgent: false });
  });
});

describe("derivePanelState", () => {
  it("not-started when round missing", () => {
    expect(derivePanelState(null)).toBe("not-started");
  });
  it("not-started when started_at is null", () => {
    expect(derivePanelState({ started_at: null, is_completed: false })).toBe("not-started");
  });
  it("between-rounds when completed", () => {
    expect(derivePanelState({ started_at: T0, is_completed: true })).toBe("between-rounds");
  });
  it("running when started and not completed", () => {
    expect(derivePanelState({ started_at: T0, is_completed: false })).toBe("running");
  });
});
