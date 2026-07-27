import { describe, it, expect } from "vitest";
import { cropBackgroundStyle } from "../cropPreview";

describe("cropBackgroundStyle", () => {
  it("scales the background so the subrect fills the container", () => {
    const s = cropBackgroundStyle({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 });
    expect(s.backgroundSize).toBe(`${100 / 0.5}% ${100 / 0.4}%`);
    // position denominators are (1 - span): 0.25/0.5 = 50%, 0.1/0.6 ≈ 16.67%
    expect(s.backgroundPosition).toBe(`${(0.25 / 0.5) * 100}% ${(0.1 / 0.6) * 100}%`);
  });

  it("pins position to 0 when the crop spans the full axis (no room to pan)", () => {
    const s = cropBackgroundStyle({ x: 0, y: 0.2, width: 1, height: 0.6 });
    expect(s.backgroundPosition.startsWith("0%")).toBe(true);
  });
});
