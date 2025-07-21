// cardHelpers.ts
// Helper functions for card parsing and filtering

import { GOOD_BRIGADES, EVIL_BRIGADES } from "./constants";

export function sanitizeImgFile(f: string) {
  return f.replace(/\.jpe?g$/i, "");
}

export function isNativityReference(ref: string): boolean {
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
    if (r.startsWith("Matthew 2:")) {
      return true;
    }
    return r === "Matthew 2" || r === "Luke 1" || r === "Luke 2";
  } catch {
    return false;
  }
}

export function handleSimpleBrigades(brigade) {
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

export function replaceBrigades(brigades, target, replacement) {
  return brigades.map(b => b === target ? replacement : b);
}

export function replaceMultiBrigades(brigadesList) {
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

export function handleGoldBrigade(cardName, alignment, brigadesList) {
  const goldReplacement = {
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

export function normalizeBrigadeField(brigade, alignment, cardName) {
  if (!brigade) return [];
  let brigadesList = handleSimpleBrigades(brigade);
  const multiCount = brigadesList.filter(b => b === "Multi").length;
  if (multiCount > 0) {
    if (multiCount === 2) {
      brigadesList = brigadesList.filter(b => b !== "Multi");
      brigadesList.push("Good Multi", "Evil Multi");
    } else {
      const multiReplacements = {
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
