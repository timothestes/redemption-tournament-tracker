import { describe, expect, it } from "vitest";
import { resolveLegacyWpParams } from "../legacyParams";

const lookup = async (id: number) => (id === 3582 ? "using-dominants" : null);

describe("resolveLegacyWpParams", () => {
  it("ignores requests without legacy params", async () => {
    expect(await resolveLegacyWpParams({}, lookup)).toEqual({ kind: "none" });
  });
  it("redirects ?p= to the article", async () => {
    expect(await resolveLegacyWpParams({ p: "3582" }, lookup)).toEqual({
      kind: "redirect", to: "/articles/using-dominants",
    });
  });
  it("treats ?page_id= identically", async () => {
    expect(await resolveLegacyWpParams({ page_id: "3582" }, lookup)).toEqual({
      kind: "redirect", to: "/articles/using-dominants",
    });
  });
  it("404s unknown and garbage ids", async () => {
    expect(await resolveLegacyWpParams({ p: "999999" }, lookup)).toEqual({ kind: "not-found" });
    expect(await resolveLegacyWpParams({ p: "abc" }, lookup)).toEqual({ kind: "not-found" });
    expect(await resolveLegacyWpParams({ p: "-1" }, lookup)).toEqual({ kind: "not-found" });
  });
  it("redirects ?cat= via the category map and 404s unknown terms", async () => {
    expect(await resolveLegacyWpParams({ cat: "766" }, lookup)).toEqual({
      kind: "redirect", to: "/articles?tag=Online%20Play",
    });
    expect(await resolveLegacyWpParams({ cat: "424242" }, lookup)).toEqual({ kind: "not-found" });
  });
  it("404s repeated ?cat= (Next.js delivers an array at runtime)", async () => {
    expect(
      await resolveLegacyWpParams({ cat: ["1", "2"] as unknown as string }, lookup),
    ).toEqual({ kind: "not-found" });
  });
  it("404s repeated ?p= (Next.js delivers an array at runtime)", async () => {
    expect(
      await resolveLegacyWpParams({ p: ["3582"] as unknown as string }, lookup),
    ).toEqual({ kind: "not-found" });
  });
});
