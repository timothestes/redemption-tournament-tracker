import { describe, it, expect } from "vitest";
import { resolveCardRef, resolveCardRefs } from "../cardRefs";
import { findCard } from "@/lib/cards/lookup";

describe("resolveCardRef", () => {
  it("resolves a plain stem (no undecorated printing exists) to a legal printing with art", () => {
    const ref = resolveCardRef("Son of God");
    expect(ref).toBeDefined();
    expect(ref!.name.startsWith("Son of God")).toBe(true);
    expect(ref!.imgFile).toBeTruthy();
    expect(findCard(ref!.name)?.legality).toBe("Rotation");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveCardRef("  son  of god ")?.imgFile).toBe(resolveCardRef("Son of God")?.imgFile);
  });

  it("keeps a deliberately decorated printing", () => {
    const decorated = findCard("Son of God (J)")!;
    expect(resolveCardRef("Son of God (J)")).toEqual({ name: decorated.name, imgFile: decorated.imgFile });
  });

  it("accepts straight apostrophes for a curly-apostrophe name and vice versa", () => {
    const curly = findCard("Aaron’s Rod (L)") ? "Aaron’s Rod (L)" : null;
    const straight = findCard("Aaron's Rod (L)") ? "Aaron's Rod (L)" : null;
    const canonical = curly ?? straight;
    if (!canonical) return; // printing not in this index build
    const other = canonical.replace(/’/g, "'") === canonical ? canonical.replace(/'/g, "’") : canonical.replace(/’/g, "'");
    expect(resolveCardRef(other)?.imgFile).toBe(resolveCardRef(canonical)?.imgFile);
  });

  it("returns undefined for an unknown name", () => {
    expect(resolveCardRef("Definitely Not A Card")).toBeUndefined();
  });
});

describe("resolveCardRefs", () => {
  it("keys results by the loose name key and omits misses", () => {
    const refs = resolveCardRefs(["  Son of God ", "Definitely Not A Card"]);
    expect(Object.keys(refs)).toEqual(["son of god"]);
  });
});
