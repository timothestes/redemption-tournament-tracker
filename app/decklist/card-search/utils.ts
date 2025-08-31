import { GOOD_BRIGADES, EVIL_BRIGADES } from "./constants";

// Card data structure
export interface Card {
  dataLine: string;
  name: string;
  set: string;
  imgFile: string;
  officialSet: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  class: string;
  identifier: string;
  specialAbility: string;
  rarity: string;
  reference: string;
  alignment: string;
  legality: string;
  testament: string;
  isGospel: boolean;
}

// sanitize imgFile to avoid duplicate extensions
export const sanitizeImgFile = (f: string) => f.replace(/\.jpe?g$/i, "");

// Rarity categorization helper
export const categorizeRarity = (rarity: string, officialSet: string): string => {
  const r = rarity.toLowerCase();
  const os = officialSet.toLowerCase();
  if (r === 'common' || r === 'deck' || r === 'starter' || r === 'fixed') return 'Common';
  if (r === 'promo' || r === 'seasonal' || r === 'national' || os === 'promo') return 'Promo';
  if (r === 'uncommon' || r === 'rare' || r === 'legacy rare') return 'Rare';
  if (r === 'ultra rare' || r === 'ultra-rare') return 'Ultra Rare';
  return 'Common'; // default fallback
};

// Nativity filter helper
export const isNativityReference = (ref: string): boolean => {
  const r = ref.trim();
  try {
    if (r.startsWith("Matthew 1:")) {
      const versePart = r.split("Matthew 1:")[1];
      if (versePart.includes("-")) {
        const [start, end] = versePart.split("-").map(v => parseInt(v, 10));
        return start >= 18 && end <= 25;
      }
      const verse = parseInt(versePart, 10);
      return verse >= 18 && verse <= 25;
    }
    if (r.startsWith("Luke 1:") || r.startsWith("Luke 2:")) {
      const chapter = parseInt(r.split(" ")[1].split(":")[0], 10);
      return chapter === 1 || chapter === 2;
    }
    // Include Matthew chapter 2 verses
    if (r.startsWith("Matthew 2:")) {
      return true;
    }
    // Handle full chapter references
    return r === "Matthew 2" || r === "Luke 1" || r === "Luke 2";
  } catch {
    return false;
  }
};

// Define how each icon filter should be applied
export const iconPredicates: Record<string, (c: Card) => boolean> = {
  Artifact: (c) => c.type === "Artifact",
  Covenant: (c) => c.type === "Covenant",
  Curse: (c) => c.type === "Curse",
  "Good Dominant": (c) => c.type.includes("Dominant") && (c.alignment.includes("Good") || c.alignment.includes("Neutral")),
  "Evil Dominant": (c) => c.type.includes("Dominant") && (c.alignment.includes("Evil") || c.alignment.includes("Neutral")),
  "Good Fortress": (c) => c.type.includes("Fortress") && c.alignment.includes("Good"),
  "Evil Fortress": (c) => c.type.includes("Fortress") && c.alignment.includes("Evil"),
  // other icons use existing category filters
  GE: (c) => c.type.includes("GE"),
  "Evil Character": (c) => c.type.includes("Evil Character"),
  Hero: (c) => c.type.includes("Hero"),
  Site: (c) => c.type === "Site",
  EE: (c) => c.type.includes("EE"),
  "Territory-Class": (c) => c.class.includes("Territory"),
  "Warrior-Class": (c) => c.class.includes("Warrior"),
  "Weapon-Class": (c) => c.class.includes("Weapon"),
  // Enhancements by alignment
  "Good Enhancement": (c) => c.type === "Enhancement" && c.alignment.includes("Good"),
  "Evil Enhancement": (c) => c.type === "Enhancement" && c.alignment.includes("Evil"),
  "Lost Soul": (c) => c.type.includes("Lost Soul"),
  "City": (c) => c.type.includes("City"),
  "Good Multi": (c) => {
    const brigades = c.brigade.split("/");
    return GOOD_BRIGADES.every(b => brigades.includes(b));
  },
  "Evil Multi": (c) => {
    const brigades = c.brigade.split("/");
    return EVIL_BRIGADES.every(b => brigades.includes(b));
  },
};

// Brigade normalization helpers
export function handleSimpleBrigades(brigade: string) {
  if (!brigade) return [];
  if (brigade.includes("and")) {
    return brigade.split("and")[0].trim().split("/");
  }
  if (brigade.includes("(")) {
    const [mainBrigade, subBrigades] = brigade.split(" (");
    return mainBrigade.trim().split("/").concat(subBrigades.replace(")", "").split("/"));
  }
  if (brigade.includes("/")) {
    return brigade.split("/");
  }
  return [brigade];
}

export function replaceBrigades(brigades: string[], target: string, replacement: string) {
  return brigades.map(b => b === target ? replacement : b);
}

export function replaceMultiBrigades(brigadesList: string[]) {
  let result = [...brigadesList];
  if (result.includes("Good Multi")) {
    result = result.filter(b => b !== "Good Multi");
    result = result.concat(GOOD_BRIGADES);
  }
  if (result.includes("Evil Multi")) {
    result = result.filter(b => b !== "Evil Multi");
    result = result.concat(EVIL_BRIGADES);
  }
  return result;
}

export function handleGoldBrigade(cardName: string, alignment: string, brigadesList: string[]) {
  const goldReplacement: Record<string, string> = {
    "Good": "Good Gold",
    "Evil": "Evil Gold",
    "Neutral": (
      brigadesList[0] === "Gold" || ["First Bowl of Wrath (RoJ)", "Banks of the Nile/Pharaoh's Court"].includes(cardName)
        ? "Good Gold"
        : "Evil Gold"
    ),
    undefined: "Good Gold",
    null: "Good Gold",
  };
  return replaceBrigades(brigadesList, "Gold", goldReplacement[alignment]);
}

export function normalizeBrigadeField(brigade: string, alignment: string, cardName: string) {
  if (!brigade) return [];
  let brigadesList = handleSimpleBrigades(brigade);
  const multiCount = brigadesList.filter(b => b === "Multi").length;
  if (multiCount > 0) {
    // If two 'Multi', expand to both Good Multi and Evil Multi
    if (multiCount === 2) {
      brigadesList = brigadesList.filter(b => b !== "Multi");
      brigadesList.push("Good Multi", "Evil Multi");
    } else {
      const multiReplacements: Record<string, string> = {
        "Good": "Good Multi",
        "Evil": "Evil Multi",
        "Neutral": "Good Multi",
      };
      brigadesList = replaceBrigades(
        brigadesList,
        "Multi",
        multiReplacements[cardName] || multiReplacements[alignment]
      );
    }
  }
  if (brigadesList.includes("Gold")) {
    brigadesList = handleGoldBrigade(cardName, alignment, brigadesList);
  }
  brigadesList = replaceMultiBrigades(brigadesList);
  const allowedBrigades = new Set([...GOOD_BRIGADES, ...EVIL_BRIGADES]);
  for (const brigade of brigadesList) {
    if (!allowedBrigades.has(brigade)) {
      throw new Error(`Card ${cardName} has an invalid brigade: ${brigade}.`);
    }
  }
  return brigadesList.sort();
}
