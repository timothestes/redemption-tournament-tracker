#!/usr/bin/env node

/**
 * Parse paragons.csv and generate TypeScript data file
 * 
 * Usage:
 *   node scripts/parse-paragons.js
 *   OR
 *   make update-paragons
 * 
 * This will:
 * 1. Read paragons.csv
 * 2. Parse all Paragon data
 * 3. Generate paragons.ts with type-safe data
 */

const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '../app/decklist/card-search/data/paragons.csv');
const outputPath = path.join(__dirname, '../app/decklist/card-search/data/paragons.ts');

const csvContent = fs.readFileSync(csvPath, 'utf-8');
const lines = csvContent.split('\n');

// Skip header row
const headers = lines[0].split(',');
const paragons = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line || line.startsWith(',')) continue; // Skip empty or summary rows
  
  // Parse CSV line (handling quoted fields)
  const fields = [];
  let current = '';
  let inQuotes = false;
  
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  
  const name = fields[0]?.trim();
  if (!name) continue;
  
  const goodBrigade = fields[4]?.trim();
  const evilBrigade = fields[6]?.trim();
  const primaryGood = parseInt(fields[8]) || 0;
  const otherGood = parseInt(fields[9]) || 0;
  const neutral = parseInt(fields[10]) || 0;
  const primaryEvil = parseInt(fields[11]) || 0;
  const otherEvil = parseInt(fields[12]) || 0;
  const totalCards = parseInt(fields[13]) || 50;
  const paragonTitle = fields[14]?.trim();
  const ability = fields[15]?.trim();
  const reference = fields[16]?.trim();
  const verse = fields[17]?.trim();
  
  if (!goodBrigade || !evilBrigade) continue;
  
  paragons.push({
    name,
    goodBrigade,
    evilBrigade,
    primaryGood,
    otherGood,
    neutral,
    primaryEvil,
    otherEvil,
    totalCards,
    paragonTitle,
    ability,
    reference,
    verse
  });
}

// Generate TypeScript file
const tsContent = `/**
 * Paragon data structure and constraints
 * Auto-generated from paragons.csv
 * Source: https://docs.google.com/spreadsheets/d/1lgEI7rJRDuhOT1QXz_xSxJA1H0VREzEmDzXwHKJrcM8/edit?gid=1332236618
 * 
 * To regenerate this file, run: node scripts/parse-paragons.js
 */

export interface ParagonData {
  name: string;
  goodBrigade: string;
  evilBrigade: string;
  /** Number of cards required from primary good brigade */
  primaryGood: number;
  /** Number of cards required from other good brigades */
  otherGood: number;
  /** Number of neutral cards allowed */
  neutral: number;
  /** Number of cards required from primary evil brigade */
  primaryEvil: number;
  /** Number of cards required from other evil brigades */
  otherEvil: number;
  /** Total deck size (always 50 for Paragon format) */
  totalCards: number;
  /** Paragon title */
  paragonTitle: string;
  /** Paragon ability text */
  ability: string;
  /** Biblical reference */
  reference: string;
  /** Bible verse text */
  verse: string;
}

export const PARAGONS: ParagonData[] = ${JSON.stringify(paragons, null, 2)};

/**
 * Get Paragon by name
 */
export function getParagonByName(name: string): ParagonData | undefined {
  return PARAGONS.find(p => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get all Paragon names for dropdown
 */
export function getParagonNames(): string[] {
  return PARAGONS.map(p => p.name);
}

/**
 * Get Paragon image path
 */
export function getParagonImagePath(name: string): string {
  return \`/paragons/\${name.toLowerCase()}.png\`;
}
`;

fs.writeFileSync(outputPath, tsContent);
console.log(`✅ Generated ${outputPath} with ${paragons.length} Paragons`);
paragons.forEach(p => console.log(`  - ${p.name} (${p.goodBrigade}/${p.evilBrigade})`));
