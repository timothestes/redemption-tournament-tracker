// Validates the card-aliases overlay (the `aliases` key of
// scripts/data/card-overrides.json) against the merged catalog rows and returns
// the list to bake into lib/cards/generated/cardAliases.json.
//
// Like the overrides overlay this is DB-shaped data, not trusted input: a bad
// row is a hard error rather than a silent drop, so a bad pull can never ship a
// dead alias. Runs LAST in parse-carddata.js, against the fully patched rows —
// an override that renames nothing but retypes a card still moves its stem.
//
// The alias rules here are the twin of app/admin/catalog/lib/aliasShared.ts;
// a drift-guard test feeds one case table through both.

const { cardNameKey, cardNameStem } = require('./cardText');

// `|` is what parseMention splits a mention on, and `[`/`]` close it early —
// an alias containing either could never be reached. Same line the backfill
// linker draws in its UNMENTIONABLE regex.
const ALIAS_MIN_LENGTH = 2; // CardPicker will not search below this
const ALIAS_MAX_LENGTH = 40;
const ALIAS_FORBIDDEN_RE = /[[\]|]/;

function hasControlChar(text) {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Why this alias is unusable, or null when its shape is fine. */
function aliasShapeError(alias) {
  if (ALIAS_FORBIDDEN_RE.test(alias) || hasControlChar(alias)) {
    return 'An alias cannot contain brackets, a pipe, or line breaks';
  }
  const trimmed = alias.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'An alias needs some text';
  if (trimmed.length < ALIAS_MIN_LENGTH) return 'An alias needs at least two characters — the card picker cannot search one';
  if (trimmed.length > ALIAS_MAX_LENGTH) return `An alias can be at most ${ALIAS_MAX_LENGTH} characters`;
  return null;
}

/**
 * Every key a `[[mention]]` already resolves on its own — printed names and the
 * name stems cardRefs falls back to. An alias landing on one of these would be
 * dead on arrival, because real cards are matched first.
 */
function takenKeys(cards) {
  const keys = new Set();
  for (const c of cards) {
    keys.add(cardNameKey(c.name));
    keys.add(cardNameKey(cardNameStem(c.name, c.type)));
  }
  return keys;
}

function applyCardAliases(cards, overlay) {
  const errors = [];
  const warnings = [];
  const rows = Array.isArray(overlay && overlay.aliases) ? overlay.aliases : [];
  if (rows.length === 0) return { aliases: [], errors, warnings };

  // name|set → row, duplicates poisoned: the catalog tolerates last-wins
  // collisions, so pointing an alias at a shadowed row is not safe.
  const DUP = Symbol('dup');
  const byKey = new Map();
  for (const c of cards) {
    const k = `${c.name}|${c.set}`;
    byKey.set(k, byKey.has(k) ? DUP : c);
  }
  const taken = takenKeys(cards);

  const seen = new Map();
  const out = [];
  for (const row of rows) {
    const { alias, name, set } = row || {};
    if (typeof alias !== 'string' || typeof name !== 'string' || typeof set !== 'string') {
      errors.push(`malformed alias row: ${JSON.stringify(row)} — alias, name and set must all be strings`);
      continue;
    }
    const shape = aliasShapeError(alias);
    if (shape) {
      errors.push(`invalid alias ${JSON.stringify(alias)}: ${shape}`);
      continue;
    }
    const trimmed = alias.replace(/\s+/g, ' ').trim();
    const key = cardNameKey(trimmed);
    const held = seen.get(key);
    if (held) {
      errors.push(
        `duplicate alias ${JSON.stringify(trimmed)}: already claimed by "${held.name}|${held.set}" — ` +
          `delete one of them in /admin/catalog, then re-run make pull-card-overrides`
      );
      continue;
    }
    if (taken.has(key)) {
      errors.push(
        `alias ${JSON.stringify(trimmed)} would shadow a real card name or name stem — a mention matches ` +
          `the catalog first, so this alias could never resolve; pick another`
      );
      continue;
    }
    const target = byKey.get(`${name}|${set}`);
    if (!target) {
      errors.push(
        `orphan alias ${JSON.stringify(trimmed)}: no catalog card matches "${name}|${set}" — the catalog ` +
          `changed underneath it; fix or delete the alias in /admin/catalog, then re-run make pull-card-overrides`
      );
      continue;
    }
    if (target === DUP) {
      errors.push(`ambiguous alias ${JSON.stringify(trimmed)}: "${name}|${set}" matches more than one catalog row`);
      continue;
    }
    const entry = { alias: trimmed, name, set };
    seen.set(key, entry);
    out.push({ key, entry });
  }

  out.sort((a, b) => a.key.localeCompare(b.key));
  return { aliases: out.map((o) => o.entry), errors, warnings };
}

module.exports = { applyCardAliases, aliasShapeError, ALIAS_MIN_LENGTH, ALIAS_MAX_LENGTH, ALIAS_FORBIDDEN_RE };
