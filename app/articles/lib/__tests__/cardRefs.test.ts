import { describe, it, expect } from "vitest";
import { resolveCardRef, resolveCardRefs } from "../cardRefs";
import { findCard } from "@/lib/cards/lookup";
import { CARD_ALIASES, aliasTarget } from "@/lib/cards/aliases";
import { cardNameKey } from "@/lib/cards/nameKey";
import { extractCardMentions, parseMention } from "../markdown";

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

describe("aliases", () => {
  // Curated in /admin/catalog and baked into the overlay, so this walks whatever
  // is committed rather than pinning one alias the curator may later retire.
  it("resolves every committed alias to the printing it names", () => {
    for (const entry of CARD_ALIASES) {
      const target = aliasTarget(entry.alias)!;
      expect(resolveCardRef(entry.alias), `alias "${entry.alias}"`).toEqual({
        name: target.name,
        imgFile: target.imgFile,
      });
    }
  });

  it("carries an alias through resolveCardRefs under the key the renderer looks up", () => {
    const entry = CARD_ALIASES[0];
    if (!entry) return;
    expect(resolveCardRefs([entry.alias])[cardNameKey(entry.alias)]?.name).toBe(aliasTarget(entry.alias)!.name);
  });

  it("leaves an unknown mention unresolved", () => {
    expect(resolveCardRef("Nnot A Real Card Or Alias")).toBeUndefined();
  });
});

describe("aliases + the `[[target|label]]` form", () => {
  // parseMention splits on the first "|", so an alias containing one could
  // never be reached — which is why both validators forbid it. The target half
  // is what resolves, so an alias works there like any other name.
  it("resolves an alias used as the target of a labelled mention", () => {
    for (const entry of CARD_ALIASES) {
      const { target, label } = parseMention(`${entry.alias}|as written`);
      expect(label).toBe("as written");
      expect(resolveCardRef(target)?.name).toBe(aliasTarget(entry.alias)!.name);
    }
  });

  it("is reachable through the mention pipeline an article actually runs", () => {
    for (const entry of CARD_ALIASES) {
      const names = extractCardMentions(`Play [[${entry.alias}]] early.`);
      expect(names).toEqual([entry.alias]);
      expect(resolveCardRefs(names)[cardNameKey(entry.alias)]?.imgFile).toBe(aliasTarget(entry.alias)!.imgFile);
    }
  });
});
