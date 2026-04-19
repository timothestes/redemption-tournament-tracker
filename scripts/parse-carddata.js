#!/usr/bin/env node

/**
 * Parse scripts/data/carddata.txt and generate lib/cards/generated/cardData.ts
 *
 * Usage:
 *   node scripts/parse-carddata.js
 *   OR
 *   make update-cards
 */

const fs = require('fs');
const path = require('path');

const txtPath = path.join(__dirname, 'data/carddata.txt');
const outputPath = path.join(__dirname, '../lib/cards/generated/cardData.ts');

const raw = fs.readFileSync(txtPath, 'utf-8');
const lines = raw.split('\n');

// Skip header row, drop empty lines
const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);

const cards = [];

for (const line of dataLines) {
  const cols = line.split('\t');

  const name = (cols[0] || '').trim();
  if (!name) continue;

  cards.push({
    name,
    set: (cols[1] || '').trim(),
    imgFile: (cols[2] || '').trim().replace(/\.jpe?g$/i, ''),
    officialSet: (cols[3] || '').trim(),
    type: (cols[4] || '').trim(),
    brigade: (cols[5] || '').trim(),
    strength: (cols[6] || '').trim(),
    toughness: (cols[7] || '').trim(),
    class: (cols[8] || '').trim(),
    identifier: (cols[9] || '').trim(),
    specialAbility: (cols[10] || '').trim(),
    rarity: (cols[11] || '').trim(),
    reference: (cols[12] || '').trim(),
    // Column 13 intentionally skipped — matches legacy deckcheck parser
    alignment: (cols[14] || '').trim(),
    legality: (cols[15] || '').trim(),
  });
}

if (cards.length < 5000) {
  console.error(
    `❌ Only ${cards.length} cards parsed — expected >= 5000. Aborting to avoid writing a truncated artifact.`
  );
  process.exit(1);
}

// Build the four lookup maps (last-wins on collision, matching legacy deckcheck behavior)
const byKey = new Map();
const byNameSet = new Map();
const byName = new Map();
const byNameLower = new Map();

for (const card of cards) {
  byKey.set(`${card.name}|${card.set}|${card.imgFile}`, card);
  byNameSet.set(`${card.name}|${card.set}`, card);
  byName.set(card.name, card);
  byNameLower.set(card.name.toLowerCase(), card);
}

// Diff summary against previous generated module, if present
function loadPreviousCards() {
  if (!fs.existsSync(outputPath)) return null;
  const prev = fs.readFileSync(outputPath, 'utf-8');
  const match = prev.match(/export const CARDS: readonly CardData\[\] = (\[[\s\S]*?\n\]);\n/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

const previous = loadPreviousCards();
if (previous) {
  const keyOf = (c) => `${c.name}|${c.set}|${c.imgFile}`;
  const prevByKey = new Map(previous.map((c) => [keyOf(c), c]));
  const currByKey = new Map(cards.map((c) => [keyOf(c), c]));

  let added = 0;
  let removed = 0;
  let modified = 0;

  for (const [k, c] of currByKey) {
    if (!prevByKey.has(k)) {
      added++;
    } else {
      const p = prevByKey.get(k);
      if (JSON.stringify(p) !== JSON.stringify(c)) modified++;
    }
  }
  for (const k of prevByKey.keys()) {
    if (!currByKey.has(k)) removed++;
  }

  console.log(`➕ ${added} cards added`);
  console.log(`➖ ${removed} cards removed`);
  console.log(`🔄 ${modified} cards modified`);
}

// Serialize
const cardsJson = JSON.stringify(cards, null, 2);
const byKeyJson = JSON.stringify(Array.from(byKey.entries()), null, 2);
const byNameSetJson = JSON.stringify(Array.from(byNameSet.entries()), null, 2);
const byNameJson = JSON.stringify(Array.from(byName.entries()), null, 2);
const byNameLowerJson = JSON.stringify(Array.from(byNameLower.entries()), null, 2);

const tsContent = `/**
 * Redemption CCG card data.
 * Auto-generated from scripts/data/carddata.txt.
 * Source: https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt
 *
 * To regenerate this file, run: make update-cards
 *
 * DO NOT EDIT BY HAND.
 */

export interface CardData {
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
}

export const CARDS: readonly CardData[] = ${cardsJson};

export const CARD_BY_KEY: ReadonlyMap<string, CardData> = new Map(${byKeyJson});

export const CARD_BY_NAME_SET: ReadonlyMap<string, CardData> = new Map(${byNameSetJson});

export const CARD_BY_NAME: ReadonlyMap<string, CardData> = new Map(${byNameJson});

export const CARD_BY_NAME_LOWER: ReadonlyMap<string, CardData> = new Map(${byNameLowerJson});
`;

fs.writeFileSync(outputPath, tsContent);
console.log(`✅ Generated ${path.relative(process.cwd(), outputPath)} with ${cards.length} cards`);
