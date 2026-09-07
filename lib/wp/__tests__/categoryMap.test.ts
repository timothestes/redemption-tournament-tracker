import { describe, expect, it } from "vitest";
import { CATEGORY_BY_SLUG, CATEGORY_BY_TERM_ID } from "../categoryMap";

describe("categoryMap", () => {
  it("holds all 51 WordPress categories", () => {
    expect(Object.keys(CATEGORY_BY_SLUG)).toHaveLength(51);
    expect(Object.keys(CATEGORY_BY_TERM_ID)).toHaveLength(51);
  });
  it("maps the known Online Play category (WP term 766)", () => {
    expect(CATEGORY_BY_SLUG["online-play"]).toBe("Online Play");
    expect(CATEGORY_BY_TERM_ID["766"]).toBe("Online Play");
  });
});
