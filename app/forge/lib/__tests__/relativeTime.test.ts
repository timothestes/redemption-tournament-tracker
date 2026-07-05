import { describe, it, expect } from "vitest";
import { timeAgo } from "../relativeTime";

const NOW = Date.parse("2026-07-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe("timeAgo", () => {
  it("returns 'just now' under a minute", () => {
    expect(timeAgo(ago(30 * S), NOW)).toBe("just now");
  });
  it("formats minutes", () => {
    expect(timeAgo(ago(5 * M), NOW)).toBe("5m ago");
  });
  it("formats hours", () => {
    expect(timeAgo(ago(3 * H), NOW)).toBe("3h ago");
  });
  it("returns 'yesterday' at ~one day", () => {
    expect(timeAgo(ago(D + H), NOW)).toBe("yesterday");
  });
  it("formats days under a week", () => {
    expect(timeAgo(ago(3 * D), NOW)).toBe("3d ago");
  });
  it("formats weeks", () => {
    expect(timeAgo(ago(14 * D), NOW)).toBe("2w ago");
  });
  it("formats months", () => {
    expect(timeAgo(ago(60 * D), NOW)).toBe("2mo ago");
  });
  it("formats years", () => {
    expect(timeAgo(ago(400 * D), NOW)).toBe("1y ago");
  });
  it("treats a future timestamp as 'just now'", () => {
    expect(timeAgo(new Date(NOW + 5 * M).toISOString(), NOW)).toBe("just now");
  });
});
