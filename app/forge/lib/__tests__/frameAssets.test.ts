import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { BRIGADES, CARD_TYPES, type DesignCard } from "../designCard";
import {
  BRIGADE_HEX, BRIGADE_SLUG, SYNTHESIZED_WASHES, washPaths, iconBox, classIcons,
  gradientRows, isPreviewApproximate, specialWash,
} from "../frameAssets";
import { RECTS, CANVAS, GRADIENT_ROWS, BRIGADE_BOX_HEX } from "../frameGeometry";

const kit = (p: string) => path.join(__dirname, "../../../../public", p);

describe("kit completeness", () => {
  it("every brigade has a box color and a wash file", () => {
    for (const b of BRIGADES) {
      expect(BRIGADE_HEX[b]).toMatch(/^#[0-9a-f]{6}$/);
      expect(existsSync(kit(washPaths({ brigades: [b] })[0]))).toBe(true);
    }
  });
  it("every special type has a wash file", () => {
    const cases: DesignCard[] = [
      { cardType: ["LostSoul"] }, { cardType: ["Artifact"] },
      { cardType: ["Dominant"], alignment: "Good" }, { cardType: ["Dominant"], alignment: "Evil" },
      { cardType: ["Fortress"], alignment: "Good" }, { cardType: ["Fortress"], alignment: "Evil" },
    ];
    for (const c of cases) expect(existsSync(kit(washPaths(c)[0]))).toBe(true);
  });
  it("every card type resolves to an icon or a badge that exists", () => {
    for (const t of CARD_TYPES) {
      const box = iconBox({ cardType: [t], brigades: ["Blue"], alignment: "Good" }, "left");
      expect(box).not.toBeNull();
      expect(box!.icon || box!.badge).toBeTruthy();
      if (box!.icon) expect(existsSync(kit(box!.icon))).toBe(true);
      if (box!.badge) expect(existsSync(kit(box!.badge))).toBe(true);
    }
  });
  it("geometry is in the 750x1050 canvas and every rect fits", () => {
    expect(CANVAS).toEqual({ w: 750, h: 1050 });
    for (const r of Object.values(RECTS)) {
      expect(r.x).toBeGreaterThanOrEqual(-40);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(790);
      expect(r.y + r.h).toBeLessThanOrEqual(1050);
    }
    expect(RECTS.art.y).toBeGreaterThan(RECTS.leftBox.y);
    expect(RECTS.textBox.y).toBeGreaterThan(RECTS.art.y + RECTS.art.h - 1);
  });
  it("synthesized washes are the ones the template lacks", () => {
    expect([...SYNTHESIZED_WASHES].sort()).toEqual(["red", "teal"]);
    expect(BRIGADE_BOX_HEX.red).not.toBe(BRIGADE_BOX_HEX.crimson);
  });
});

describe("washPaths", () => {
  it("is empty without a brigade or special type", () => {
    expect(washPaths({})).toEqual([]);
    expect(washPaths({ cardType: ["Hero"] })).toEqual([]);
  });
  it("uses one wash per brigade, up to two", () => {
    expect(washPaths({ brigades: ["Red"] })).toEqual(["/forge/frames/washes/red.webp"]);
    expect(washPaths({ brigades: ["GoodGold", "Red", "Blue"] })).toEqual([
      "/forge/frames/washes/gold.webp", "/forge/frames/washes/red.webp",
    ]);
  });
  it("special types override brigades and follow alignment", () => {
    expect(specialWash({ cardType: ["Hero", "Dominant"], alignment: "Evil" })).toBe("evil-dom");
    expect(washPaths({ cardType: ["Fortress"], brigades: ["Blue"] })).toEqual(["/forge/frames/washes/good-fort.webp"]);
    expect(washPaths({ cardType: ["LostSoul"] })).toEqual(["/forge/frames/washes/lost-soul.webp"]);
  });
  it("both golds share the gold wash", () => {
    expect(BRIGADE_SLUG.GoodGold).toBe("gold");
    expect(BRIGADE_SLUG.EvilGold).toBe("gold");
  });
});

describe("iconBox", () => {
  it("is absent until a type is chosen", () => {
    expect(iconBox({ brigades: ["Blue"] }, "left")).toBeNull();
  });
  it("Hero: cross, stats, brigade fill; white brigade takes dark stat text", () => {
    const blue = iconBox({ cardType: ["Hero"], brigades: ["Blue"] }, "left")!;
    expect(blue.icon).toBe("/forge/frames/icons/cross.png");
    expect(blue.withStats).toBe(true);
    expect(blue.badge).toBeNull();
    expect(blue.fill).toBe(BRIGADE_HEX.Blue);
    expect(blue.darkText).toBe(false);
    const white = iconBox({ cardType: ["Hero"], brigades: ["White"] }, "left")!;
    expect(white.fill).toBe("#ffffff");
    expect(white.darkText).toBe(true);
  });
  it("Evil Character is the dragon, Evil Enhancement the skull (as printed)", () => {
    expect(iconBox({ cardType: ["EvilCharacter"], brigades: ["Crimson"] }, "left")!.icon).toBe("/forge/frames/icons/dragon.png");
    expect(iconBox({ cardType: ["EE"], brigades: ["Crimson"] }, "left")!.icon).toBe("/forge/frames/icons/skull.png");
  });
  it("stats-bearing types get the small icon variant where the template has one", () => {
    expect(iconBox({ cardType: ["EvilCharacter", "EE"], brigades: ["Black"] }, "left")!.icon).toBe("/forge/frames/icons/dragon.png");
    expect(iconBox({ cardType: ["EE", "EvilCharacter"], brigades: ["Black"] }, "left")!.icon).toBe("/forge/frames/icons/skull-small.png");
    expect(iconBox({ cardType: ["Curse"], brigades: ["Black"] }, "left")!.icon).toBe("/forge/frames/icons/skull.png");
  });
  it("badges: artifact chalice, lamb/reaper dominants, nebula fortress and lost soul", () => {
    expect(iconBox({ cardType: ["Artifact"] }, "left")!.badge).toBe("/forge/frames/badges/artifact.webp");
    expect(iconBox({ cardType: ["Dominant"], alignment: "Good" }, "left")!.badge).toBe("/forge/frames/badges/lamb.webp");
    expect(iconBox({ cardType: ["Dominant"], alignment: "Evil" }, "left")!.badge).toBe("/forge/frames/badges/reaper.webp");
    const fort = iconBox({ cardType: ["Fortress"], alignment: "Evil" }, "left")!;
    expect(fort.badge).toBe("/forge/frames/badges/evil-dom.webp");
    expect(fort.icon).toBe("/forge/frames/icons/fortress.png");
    expect(iconBox({ cardType: ["LostSoul"] }, "left")!.badge).toBe("/forge/frames/badges/good-dom.webp");
  });
  it("three or more brigades use the multi foil; two brigades add a right box", () => {
    const multi = iconBox({ cardType: ["Hero"], brigades: ["Blue", "Red", "GoodGold"], alignment: "Good" }, "left")!;
    expect(multi.badge).toBe("/forge/frames/badges/multi-good.webp");
    expect(iconBox({ cardType: ["Hero"], brigades: ["Blue", "Red", "GoodGold"] }, "right")).toBeNull();
    const right = iconBox({ cardType: ["Hero"], brigades: ["Blue", "Red"] }, "right")!;
    expect(right.fill).toBe(BRIGADE_HEX.Red);
    expect(right.withStats).toBe(false);
    expect(right.icon).toBe("/forge/frames/icons/cross.png");
    expect(iconBox({ cardType: ["Hero"], brigades: ["Blue"] }, "right")).toBeNull();
  });
  it("special types never get a right box even with two brigades", () => {
    expect(iconBox({ cardType: ["Fortress"], brigades: ["Blue", "Red"] }, "right")).toBeNull();
  });
});

describe("classIcons / gradientRows / approximate", () => {
  it("stacks warrior/weapon then territory, at most two", () => {
    expect(classIcons({ class: ["Warrior", "Weapon"], icons: ["Territory"] })).toEqual([
      "/forge/frames/icons/warrior.png", "/forge/frames/icons/weapon.png",
    ]);
    expect(classIcons({ icons: ["Territory"] })).toEqual(["/forge/frames/icons/territory.png"]);
    expect(classIcons({})).toEqual([]);
  });
  it("picks the gradient row variant from the verse length", () => {
    expect(gradientRows({})).toBe(2);
    expect(gradientRows({ scripture: "Short verse." })).toBe(2);
    expect(gradientRows({ scripture: "x".repeat(120) })).toBe(3);
    expect(gradientRows({ scripture: "x".repeat(200) })).toBe(5);
    expect(gradientRows({ scripture: "x".repeat(600) })).toBe(5);
    for (const r of [2, 3, 4, 5] as const) expect(GRADIENT_ROWS[r].light).toBeLessThan(GRADIENT_ROWS[r].dark);
  });
  it("flags three brigades, Classic legality and synthesized washes", () => {
    expect(isPreviewApproximate({ brigades: ["Blue"] })).toBe(false);
    expect(isPreviewApproximate({ brigades: ["Blue", "Red", "Green"] })).toBe(true);
    expect(isPreviewApproximate({ legality: "Classic" })).toBe(true);
    expect(isPreviewApproximate({ brigades: ["Teal"] })).toBe(true);
  });
});
