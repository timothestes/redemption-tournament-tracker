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
const jsonPath = path.join(__dirname, '../lib/cards/generated/cardData.json');

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

// Diff summary against previous generated data, if present
function loadPreviousCards() {
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
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

// The card array lives in a .json file so TypeScript never has to type-check a
// multi-megabyte inline literal (which OOMs the build). The lookup maps are
// rebuilt at runtime from CARDS in lib/cards/lookup.ts — no need to serialize them.
fs.writeFileSync(jsonPath, JSON.stringify(cards, null, 2));

const tsContent = `/**
 * Redemption CCG card data.
 * Auto-generated from scripts/data/carddata.txt.
 * Source: https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt
 *
 * To regenerate this file, run: make update-cards
 *
 * DO NOT EDIT BY HAND.
 *
 * The card data itself lives in ./cardData.json; this module only types it.
 * Keeping the array out of the .ts source avoids type-checking a giant literal.
 */

import cardData from './cardData.json';

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

export const CARDS: readonly CardData[] = cardData as readonly CardData[];
`;

fs.writeFileSync(outputPath, tsContent);
console.log(
  `✅ Generated ${path.relative(process.cwd(), jsonPath)} + ${path.relative(
    process.cwd(),
    outputPath
  )} with ${cards.length} cards`
);
