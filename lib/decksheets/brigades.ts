/**
 * FROZEN port of redemption-tournament-api/src/utilities/brigades.py.
 *
 * This is a function-for-function, order-for-order transcription of the Python
 * source (113 lines). Do NOT "fix" divergences from
 * app/decklist/card-search/cardHelpers.ts's normalizeBrigadeField — that
 * divergence is the entire reason this frozen copy exists. Do NOT import or
 * reuse that function here.
 *
 * If brigades.py changes, re-port by hand and regenerate the fixture via
 * lib/decksheets/__tests__/fixtures/generate_fixtures.py.
 */
import { DeckCheckError } from "./errors";

// Copied verbatim from redemption-tournament-api/src/utilities/vars.py:5-24
export const GOOD_BRIGADES: string[] = [
  "Good Gold",
  "Red",
  "Silver",
  "Teal",
  "White",
  "Green",
  "Purple",
  "Blue",
  "Clay",
];

export const EVIL_BRIGADES: string[] = [
  "Brown",
  "Evil Gold",
  "Crimson",
  "Black",
  "Gray",
  "Orange",
  "Pale Green",
];

function handleComplexBrigades(cardName: string, brigade: string): string[] {
  const complexBrigades: Record<string, string[]> = {
    "Delivered": ["Green", "Teal", "Evil Gold", "Pale Green"],
    "Eternal Judgment": ["Green", "White", "Brown", "Crimson"],
    "Scapegoat (PoC)": ["Teal", "Green", "Crimson"],
    "Zion": ["Purple"],
    "Ashkelon": ["Good Gold"],
    "Raamses": ["White"],
    "Babel (FoM)": ["Blue"],
    "Sodom & Gomorrah": ["Silver"],
    "City of Enoch": ["Blue"],
    "Hebron": ["Red"],
    "Damascus (LoC)": ["Red"],
    "Damascus (Promo)": ["Red"],
    "Bethlehem (Promo)": ["White"],
    "Samaria": ["Green"],
    "Nineveh": ["Green"],
    "City of Refuge": ["Teal"],
    "Jerusalem (GoC)": ["Purple", "Good Gold", "White"],
    "Sychar (GoC)": ["Good Gold", "Purple"],
    "Fire Foxes": ["Good Gold", "Crimson", "Black"],
    "Bethlehem (LoC)": ["Good Gold", "White"],
    "New Jerusalem (Bride of Christ) (RoJ AB)": GOOD_BRIGADES,
    "Doubt (LoC Plus)": [],
    "Doubt (LoC)": [],
    "Angel of God [2023 - National]": [],
    "City of Refuge (PoC)": ["Teal"],
    "Fullness of Time": [],
    "Melchizedek (CoW AB)": ["Purple", "Teal"],
    "Philistine Outpost": [],
    "Philosophy": [...GOOD_BRIGADES, ...EVIL_BRIGADES],
    "Unified Language": [...GOOD_BRIGADES, ...EVIL_BRIGADES],
    "Saul/Paul": ["Gray", ...GOOD_BRIGADES],
    "Coat of Many Colors (FoM)": ["Brown", ...GOOD_BRIGADES],
  };
  if (cardName in complexBrigades) {
    return complexBrigades[cardName];
  }
  return handleSimpleBrigades(brigade);
}

function handleSimpleBrigades(brigade: string): string[] {
  if (brigade.includes("and")) {
    return brigade.split("and")[0].trim().split("/");
  }
  if (brigade.includes("(")) {
    const [mainBrigade, subBrigadesRaw] = brigade.split(" (");
    const subBrigades = subBrigadesRaw.replace(/\)+$/, "").split("/");
    return [...mainBrigade.trim().split("/"), ...subBrigades];
  }
  if (brigade.includes("/")) {
    return brigade.split("/");
  }
  return [brigade];
}

function replaceBrigades(brigades: string[], target: string, replacement: string): string[] {
  return brigades.map((b) => (b === target ? replacement : b));
}

function replaceMultiBrigades(brigadesList: string[]): string[] {
  let result = brigadesList;
  if (result.includes("Good Multi")) {
    result = result.filter((b) => b !== "Good Multi");
    result = [...result, ...GOOD_BRIGADES];
  }
  if (result.includes("Evil Multi")) {
    result = result.filter((b) => b !== "Evil Multi");
    result = [...result, ...EVIL_BRIGADES];
  }
  return result;
}

function handleGoldBrigade(
  cardName: string,
  alignment: string | null | undefined,
  brigadesList: string[]
): string[] {
  const goldReplacement: Record<string, string> = {
    Good: "Good Gold",
    Evil: "Evil Gold",
    Neutral:
      brigadesList[0] === "Gold" ||
      ["First Bowl of Wrath (RoJ)", "Banks of the Nile/Pharaoh's Court"].includes(cardName)
        ? "Good Gold"
        : "Evil Gold",
  };
  // Python's dict also has a `None` key -> "Good Gold", for a Python-`None` alignment;
  // `gold_replacement.get(alignment)` returns that when alignment IS None. Ported here as
  // `alignment == null` (covers both `null` and `undefined`, since JS has both while Python
  // has only `None`). Any other alignment string NOT in {"Good","Evil","Neutral"} still has
  // no matching key, yielding `undefined`, which fails the final validation — same as Python's
  // `None` result in that case.
  const replacement = alignment == null ? "Good Gold" : goldReplacement[alignment];
  return replaceBrigades(brigadesList, "Gold", replacement as string);
}

export function normalizeBrigadesFrozen(
  brigade: string,
  alignment: string | null | undefined,
  cardName: string
): string[] {
  if (!brigade) {
    return [];
  }

  let brigadesList = handleComplexBrigades(cardName, brigade);
  if (brigadesList.includes("Multi")) {
    const multiReplacements: Record<string, string> = {
      Good: "Good Multi",
      Evil: "Evil Multi",
      Neutral: "Good Multi",
    };
    // multi_replacements has no `None` key in Python, so a None/absent alignment falls
    // through to `undefined` here exactly as `.get(None)` falls through to `None` there.
    const replacement =
      cardName in multiReplacements
        ? multiReplacements[cardName]
        : typeof alignment === "string" && alignment in multiReplacements
          ? multiReplacements[alignment]
          : undefined;
    brigadesList = replaceBrigades(brigadesList, "Multi", replacement as string);
  }
  if (brigadesList.includes("Gold")) {
    brigadesList = handleGoldBrigade(cardName, alignment, brigadesList);
  }

  brigadesList = replaceMultiBrigades(brigadesList);
  const allowedBrigades = new Set([...GOOD_BRIGADES, ...EVIL_BRIGADES]);
  for (const b of brigadesList) {
    if (!allowedBrigades.has(b)) {
      throw new DeckCheckError(`Card ${cardName} has an invalid brigade: ${b}.`);
    }
  }

  return [...brigadesList].sort();
}
