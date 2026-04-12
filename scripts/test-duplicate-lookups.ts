/**
 * Comprehensive test suite for duplicate card lookups.
 * Validates group resolution, sibling navigation, disambiguation, and edge cases.
 *
 * Usage: npx tsx scripts/test-duplicate-lookups.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(__dirname, "..", ".env.local") });

const CARD_DATA_URL =
  "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt";

// --- Replicate logic from lib/duplicateCards.ts ---

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/['']/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/,\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSetSuffix(name: string): string {
  let s = name.replace(/\s*\[[^\]]+\]\s*$/, "");
  const m = s.match(/\s+\(([A-Za-z0-9][A-Za-z0-9 .''\-]*)\)\s*$/);
  if (m && m[1].length <= 30) s = s.slice(0, m.index).trim();
  return s;
}

function extractSetFromName(name: string): string | null {
  const b = name.match(/\[([^\]]+)\]\s*$/);
  if (b) return b[1].trim();
  const p = name.match(/\(([^)]+)\)\s*$/);
  if (p) return p[1].trim();
  return null;
}

function generateKeys(name: string): string[] {
  const keys = [name, normalize(name)];
  const base = stripSetSuffix(name);
  if (base !== name) keys.push(base, normalize(base));
  if (base.includes(" / ")) {
    base.split(" / ").map((p) => p.trim()).forEach((p) => keys.push(p, normalize(p)));
  }
  return keys;
}

function addToMulti(map: Map<string, any[]>, key: string, val: any) {
  const e = map.get(key);
  if (e) { if (!e.includes(val)) e.push(val); } else map.set(key, [val]);
}

// --- Replicate logic from DuplicateCards.tsx (component card index) ---

function normForMatch(s: string): string {
  return s.toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'']/g, "'")
    .replace(/,\s+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function stripSuffix(name: string): string {
  let s = name.replace(/\s*\[[^\]]+\]\s*$/, "");
  const m = s.match(/\s+\(([A-Za-z0-9][A-Za-z0-9 .''\-]*)\)\s*$/);
  if (m && m[1].length <= 30) s = s.slice(0, m.index).trim();
  return s;
}

interface Member { cardName: string; ordirSets: string; }
interface Group { canonicalName: string; members: Member[]; }

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // --- Load DB ---
  const { data } = await supabase
    .from("duplicate_card_group_members")
    .select("card_name, ordir_sets, matched, group:duplicate_card_groups!inner(id, canonical_name)")
    .order("id", { ascending: true });

  const byExact = new Map<string, Group[]>();
  const byNorm = new Map<string, Group[]>();
  const groupsById = new Map<number, Group>();
  const allMemberNorms = new Map<string, string>();

  for (const row of data as any[]) {
    const gid = row.group.id;
    if (!groupsById.has(gid))
      groupsById.set(gid, { canonicalName: row.group.canonical_name, members: [] });
    groupsById.get(gid)!.members.push({ cardName: row.card_name, ordirSets: row.ordir_sets || "" });
  }
  for (const group of groupsById.values()) {
    addToMulti(byExact, group.canonicalName, group);
    addToMulti(byNorm, normalize(group.canonicalName), group);
    for (const m of group.members) {
      addToMulti(byExact, m.cardName, group);
      addToMulti(byNorm, normalize(m.cardName), group);
      allMemberNorms.set(normalize(m.cardName), group.canonicalName);
    }
  }

  function disambiguate(cardName: string, candidates: Group[]): Group {
    if (candidates.length === 1) return candidates[0];
    const inputSet = extractSetFromName(cardName);
    if (!inputSet) return candidates.find((g) => !/\(\d+\)$/.test(g.canonicalName)) || candidates[0];
    const baseNorm = normalize(stripSetSuffix(cardName));
    for (const group of candidates) {
      const member = group.members.find((m) => normalize(m.cardName) === baseNorm);
      if (!member) continue;
      if (member.ordirSets.split(",").map((s) => s.trim().toLowerCase()).some((s) => s === inputSet.toLowerCase()))
        return group;
    }
    return candidates.find((g) => !/\(\d+\)$/.test(g.canonicalName)) || candidates[0];
  }

  function findGroup(cardName: string): Group | null {
    const keys = generateKeys(cardName);
    for (const key of keys) { const c = byExact.get(key); if (c) return disambiguate(cardName, c); }
    for (const key of keys) { const c = byNorm.get(normalize(key)); if (c) return disambiguate(cardName, c); }
    return null;
  }

  function getSiblings(cardName: string) {
    const group = findGroup(cardName);
    if (!group) return { group: null, siblings: [] as Member[] };
    const selfKeys = new Set(generateKeys(cardName).map(normalize));
    const sibs = group.members.filter((m) => !selfKeys.has(normalize(m.cardName)));
    return { group, siblings: sibs };
  }

  // --- Load carddata ---
  console.log("Fetching carddata.txt...");
  const res = await fetch(CARD_DATA_URL);
  const text = await res.text();
  const lines = text.split("\n").slice(1).filter((l) => l.trim());
  const cardNames = [...new Set(lines.map((l) => l.split("\t")[0]?.trim()).filter(Boolean))];
  console.log(`Loaded ${cardNames.length} unique card names\n`);

  // --- Build component-style card index ---
  const cardIndex = new Map<string, string[]>();
  function addIdx(key: string, name: string) {
    const e = cardIndex.get(key);
    if (e) e.push(name); else cardIndex.set(key, [name]);
  }
  for (const c of cardNames) {
    addIdx(normForMatch(c), c);
    const base = normForMatch(stripSuffix(c));
    if (base !== normForMatch(c)) addIdx(base, c);
    const stripped = stripSuffix(c);
    if (stripped.includes("/")) {
      stripped.split(/\s*\/\s*/).forEach((p) => { if (p.length > 1) addIdx(normForMatch(p), c); });
    }
  }

  let totalPass = 0;
  let totalFail = 0;
  function assert(name: string, ok: boolean, detail?: string) {
    if (ok) { totalPass++; }
    else { totalFail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
  }

  // ======================================================================
  // TEST 1: Every carddata card that should match a group DOES match
  // ======================================================================
  console.log("TEST 1: Group resolution for all carddata.txt names");
  let shouldMatch = 0, matched = 0;
  for (const name of cardNames) {
    const keys = generateKeys(name);
    if (!keys.some((k) => allMemberNorms.has(normalize(k)))) continue;
    shouldMatch++;
    const group = findGroup(name);
    assert(`findGroup("${name}")`, !!group, "expected match but got null");
    if (group) matched++;
  }
  console.log(`  ${matched}/${shouldMatch} matched\n`);

  // ======================================================================
  // TEST 2: Reverse lookup — every DB member navigable in carddata
  // ======================================================================
  console.log("TEST 2: DB member → carddata navigability");
  let navTotal = 0, navFound = 0;
  const navMissing: string[] = [];
  for (const group of groupsById.values()) {
    for (const m of group.members) {
      navTotal++;
      const found = cardIndex.get(normForMatch(m.cardName));
      if (found && found.length > 0) {
        navFound++;
      } else {
        navMissing.push(`"${m.cardName}" (${group.canonicalName})`);
      }
    }
  }
  // Known non-navigable: Abram (standalone), Isaiah Prince of Prophets (errata), Saul (standalone)
  // These are expected because carddata stores them as slash-names or doesn't have them
  const knownMissing = ["Abram", "Isaiah, Prince of Prophets", "Saul"];
  for (const m of navMissing) {
    const isKnown = knownMissing.some((k) => m.startsWith(`"${k}"`));
    assert(`navigable: ${m}`, isKnown, "unexpected: not found in carddata");
  }
  console.log(`  ${navFound}/${navTotal} navigable (${navMissing.length} not found, ${knownMissing.length} expected)\n`);

  // ======================================================================
  // TEST 3: Disambiguation — same name, different people
  // ======================================================================
  console.log("TEST 3: Disambiguation (same name → correct group)");
  const disambigTests: [string, string][] = [
    // Simeon — 2 people
    ["Simeon (Pr)", "Simeon"],
    ["Simeon (Wa)", "Simeon"],
    ["Simeon (Di)", "Simeon"],
    ["Simeon, the Devout", "Simeon"],
    ["Simeon (FF)", "Simeon (2)"],
    ["Simeon, the Vengeful", "Simeon (2)"],
    // Salome — 2 people
    ["Salome (RA)", "Salome"],
    ["Salome the Sorrowful", "Salome"],
    ["Salome, Spice Bringer", "Salome"],
    ["Salome (B)", "Salome (2)"],
    ["Salome (Or)", "Salome (2)"],
    ["Salome (TP)", "Salome (2)"],
    ["Herodias' Daughter", "Salome (2)"],
    // James — 3 groups
    ["James (I)", "James Son of Zebedee"],
    ["James Son of Zebedee (Ap)", "James Son of Zebedee"],
    ["James, the Fisherman", "James Son of Zebedee"],
    ["James Son of Alphaeus (Ap)", "James Son of Alphaeus"],
    ["James, the Younger", "James Son of Alphaeus"],
    ["James, Leader in Jerusalem", "James"],
    // Eleazar — 2 people
    ["Eleazar (Wa)", "Eleazar"],
    ["Eleazar, the Ahohite", "Eleazar"],
    ["Eleazar, the Potentate (LC)", "Eleazar, the Potentate"],
    ["Eleazar, the Vassal (LC)", "Eleazar, the Potentate"],
    // Jacob — 2 groups
    ["Jacob (D)", "Jacob"],
    ["Jacob (Israel)", "Jacob"],
    ["Jacob, Disgruntled Subject (LC)", "Jacob, Disgruntled Subject"],
    ["Jacob, Relegated Servant (LC)", "Jacob, Disgruntled Subject"],
    // John — 2 groups
    ["John (H)", "John"],
    ["John, the Apocalyptist", "John"],
    ["John the Baptist (Pr)", "John the Baptist"],
    ["John the Forerunner", "John the Baptist"],
    // Joseph — 3 groups
    ["Joseph (Pa)", "Joseph"],
    ["Joseph, the Dreamer", "Joseph"],
    ["Joseph of Arimathea (TP)", "Joseph of Arimathea"],
    ["Joseph the Courageous", "Joseph of Arimathea"],
    ["Joseph the Carpenter (Ap)", "Joseph the Carpenter"],
    ["Joseph, the Betrothed", "Joseph the Carpenter"],
    // Joshua — 2 groups
    ["Joshua (P-Settlers)", "Joshua"],
    ["Joshua, Son of Nun", "Joshua"],
    ["Joshua the High Priest (Pi)", "Joshua the High Priest"],
    ["Jeshua, the Restorer", "Joshua the High Priest"],
    // Phinehas — 2 people
    ["Phinehas, Son of Eleazar (Pi)", "Phinehas"],
    ["Phinehas, the Zealous", "Phinehas"],
    ["Phinehas, son of Eli (Pi)", "Phinehas, son of Eli"],
    ["Phinehas, the Useless", "Phinehas, son of Eli"],
    // Zadok — 2 people
    ["Zadok (Pi)", "Zadok"],
    ["Zadok, Ark Carrier", "Zadok"],
    ["Zadok, the Consummate (LC)", "Zadok, the Consummate"],
    ["Zadok, the Unassuming (LC)", "Zadok, the Consummate"],
    // King Ahaziah vs Ahaziah
    ["King Ahaziah (Ki)", "King Ahaziah"],
    ["Ahaziah (Pr)", "Ahaziah"],
    ["Ahaziah, the Wicked", "King Ahaziah"],
  ];
  for (const [input, expected] of disambigTests) {
    const group = findGroup(input);
    const actual = group?.canonicalName || "NO MATCH";
    assert(
      `${input} → ${expected}`,
      normalize(actual) === normalize(expected),
      `got "${actual}"`
    );
  }
  console.log("");

  // ======================================================================
  // TEST 4: Mary disambiguation — 4 different Marys + 1 unique
  // ======================================================================
  console.log("TEST 4: Mary disambiguation (4 groups + 1 unique)");
  const maryTests: [string, string | null][] = [
    // Mary, mother of Jesus (group: Mary)
    ["Mary (B)", "Mary"],
    ["Mary (D)", "Mary"],
    ["Mary (Promo)", "Mary"],
    ["Mary, Faithful Servant / Mary, Mother of Christ (LoC)", "Mary"],
    ["Mary, Holy Virgin / Mary, Willing Servant (GoC)", "Mary"],
    // Mary Magdalene (group: Mary Magdalene)
    ["Mary Magdalene (Di)", "Mary Magdalene"],
    ["Mary Magdalene (Wo)", "Mary Magdalene"],
    ["Mary, the Restored / Mary Magdalene (GoC)", "Mary Magdalene"],
    // Mary of Bethany (group: Mary of Bethany)
    ["Mary of Bethany", "Mary of Bethany"],
    ["Mary of Bethany / Mary, the Attentive (GoC)", "Mary of Bethany"],
    // Mary Mother of James (group: Mary the Mother of James)
    ["Mary the Mother of James", "Mary the Mother of James"],
    ["Mary, Mother of James / Mary, the Caregiver (GoC)", "Mary the Mother of James"],
    // NOT a duplicate
    ["Mary Mother of Mark", null],
  ];
  for (const [input, expected] of maryTests) {
    const group = findGroup(input);
    const actual = group?.canonicalName || null;
    const ok = expected === null ? actual === null : actual !== null && normalize(actual) === normalize(expected);
    assert(`${input} → ${expected || "NO MATCH"}`, ok, `got "${actual || "NO MATCH"}"`);
  }
  console.log("");

  // ======================================================================
  // TEST 5: David — all 17 carddata variants
  // ======================================================================
  console.log("TEST 5: David — all carddata.txt variants");
  const davidTests: string[] = [
    "David (Green) (Ki)", "David (Green) (Wa)", "David (Red) (Ki)", "David (Red) (Wa)",
    "David (Roots)", "David the Psalmist", "David the Shepherd",
    "David the Unifier [2025 - Seasonal]", "David, Giant Slayer [Fundraiser]",
    "David, Giant Slayer [K]", "David, God's King",
    "David, Heart After God / David, the Contrite (LoC Plus)",
    "David, Heart After God / David, the Contrite (LoC)",
    "David, Outcasts\u2019 Refuge / David, the Anointed (LoC)",
    "David, the Psalmist (CoW AB)", "David, the Shepherd (CoW AB)", "King David",
  ];
  for (const name of davidTests) {
    const group = findGroup(name);
    assert(`${name}`, group?.canonicalName === "David", `got "${group?.canonicalName || "NO MATCH"}"`);
  }
  console.log("");

  // ======================================================================
  // TEST 6: Cards that should NOT match any group
  // ======================================================================
  console.log("TEST 6: Non-duplicate cards (should NOT match)");
  const noMatchTests = [
    "Abel (CoW)", "Abel (CoW AB)", "Lightning Strike", "Son of God",
    "Mary Mother of Mark", "Angel at the Tomb", "Joseph, Heir of David",
    "Lost Soul [Ephesians 5:14]", "New Jerusalem",
  ];
  for (const name of noMatchTests) {
    const group = findGroup(name);
    assert(`${name} → NO MATCH`, group === null, `got "${group?.canonicalName}"`);
  }
  console.log("");

  // ======================================================================
  // TEST 7: AB cards — correct group resolution
  // ======================================================================
  console.log("TEST 7: AB (Alternate Border) cards");
  const abCards = cardNames.filter((n) => n.includes(" AB)"));
  // Known: Moses' Parents appears in 2 groups (one for Amram, one for Jochebed).
  // Either group is correct for deck building — it's a data modeling edge case.
  const abKnownAmbiguous = ["Moses' Parents (CoW AB)"];
  let abShouldMatch = 0, abMatched = 0;
  for (const name of abCards) {
    const keys = generateKeys(name);
    if (!keys.some((k) => allMemberNorms.has(normalize(k)))) continue;
    abShouldMatch++;
    const group = findGroup(name);
    if (group) {
      const expectedCanonical = allMemberNorms.get(normalize(stripSetSuffix(name)));
      const isCorrect = expectedCanonical && normalize(group.canonicalName) === normalize(expectedCanonical);
      const isKnownAmbiguous = abKnownAmbiguous.includes(name);
      if (isCorrect || isKnownAmbiguous) {
        abMatched++;
      } else {
        assert(`AB: ${name}`, false, `got "${group.canonicalName}", expected "${expectedCanonical}"`);
      }
    } else {
      assert(`AB: ${name}`, false, "expected match but got null");
    }
  }
  console.log(`  ${abMatched}/${abShouldMatch} AB cards correctly matched (1 known ambiguous)\n`);

  // ======================================================================
  // TEST 8: Sibling self-exclusion for slash-name cards
  // ======================================================================
  console.log("TEST 8: Slash-name self-exclusion");
  const slashTests: [string, number][] = [
    // 2-member group, card has both names → 0 siblings
    ["Mary, the Restored / Mary Magdalene (GoC)", 0],
    ["Mary of Bethany / Mary, the Attentive (GoC)", 0],
    // Multi-member group, card has 2 of N names → N-2 siblings
    ["David, Heart After God / David, the Contrite (LoC)", 10],
    ["Mary, Holy Virgin / Mary, Willing Servant (GoC)", 4],
    ["Father Abraham / Faithful Abraham (LoC)", 3],
  ];
  for (const [name, expectedCount] of slashTests) {
    const { siblings } = getSiblings(name);
    assert(
      `${name} → ${expectedCount} siblings`,
      siblings.length === expectedCount,
      `got ${siblings.length}`
    );
  }
  console.log("");

  // ======================================================================
  // TEST 9: Component card index — slash names without spaces
  // ======================================================================
  console.log("TEST 9: Component index handles slash-no-space names");
  const slashNoSpace: [string, string][] = [
    ["Abram", "Abram/Abraham"],
    ["Abraham", "Abram/Abraham"],
    ["Saul", "Saul/Paul"],
    ["Paul", "Saul/Paul"],
  ];
  for (const [lookup, expectedCard] of slashNoSpace) {
    const found = cardIndex.get(normForMatch(lookup));
    const hasExpected = found?.some((f) => f === expectedCard) || false;
    assert(`index("${lookup}") contains "${expectedCard}"`, hasExpected, `found: ${found?.join(", ") || "nothing"}`);
  }
  console.log("");

  // ======================================================================
  // SUMMARY
  // ======================================================================
  console.log("=".repeat(60));
  console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed`);
  if (totalFail === 0) {
    console.log("\n✓ All tests passed!");
  } else {
    console.log("\n✗ Some tests failed");
    process.exit(1);
  }
}

main().catch(console.error);
