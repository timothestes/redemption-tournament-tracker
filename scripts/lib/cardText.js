// JS twins of the card-name helpers the app uses, for the codegen scripts —
// which cannot import TypeScript. Ported from lib/cards/nameKey.ts and the
// cardNameStem half of lib/cards/cardIdentity.ts; a drift-guard test runs both
// implementations over the whole catalog and pins them together.
//
// The curly quotes are spelled as escapes so the pairing survives any tool that
// normalizes non-ASCII source: ‘’ are ' ' and “” are " ".

/** Loose-match key for a card name as a person would type it. */
function cardNameKey(name) {
  return name
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
}

const TRAILING_GROUP = /\s*(\([^()]*\)|\[[^\[\]]*\])\s*$/;
const TRAILING_NICKNAME = /\s*"[^"]*"\s*$/;

/** The card's name with printing decoration removed. */
function cardNameStem(name, type) {
  let stem = name.trim();
  // Repeat: "Son of God [Tomb] [2022 - Seasonal]" carries two.
  for (;;) {
    const match = TRAILING_GROUP.exec(stem);
    if (!match) break;
    const next = stem.slice(0, match.index).trim();
    // Never strip a name away to nothing.
    if (!next) break;
    stem = next;
  }
  // On a Lost Soul the quoted nickname IS the card's identity, so it stays.
  if (!(type || '').toLowerCase().includes('lost soul')) {
    const withoutNickname = stem.replace(TRAILING_NICKNAME, '').trim();
    if (withoutNickname) stem = withoutNickname;
  }
  return stem.replace(/\s+/g, ' ');
}

module.exports = { cardNameKey, cardNameStem };
