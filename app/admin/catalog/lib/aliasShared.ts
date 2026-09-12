// Client-safe alias rules for the catalog editor. The scripts-side twin lives
// in scripts/lib/applyCardAliases.js — a drift-guard test pins them together.

export const ALIAS_MIN_LENGTH = 2; // CardPicker will not search below this
export const ALIAS_MAX_LENGTH = 40;

/**
 * Why these characters are out: `[` and `]` would close the `[[mention]]`
 * early, and `|` is what parseMention splits a mention on — `[[LA|FS]]` reads
 * as target "LA", label "FS", so an alias containing one could never be
 * reached. (It is also the name|set separator every catalog key is built from.)
 * The backfill linker draws the same line in its UNMENTIONABLE regex.
 */
export const ALIAS_FORBIDDEN_RE = /[[\]|]/;

/**
 * Control characters — line breaks included — are not expressible in the
 * tab-separated catalog the aliases live beside. Tested by code point rather
 * than a character class so no literal control byte ends up in this source.
 */
export function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Why this alias is unusable, or null when its shape is fine. */
export function aliasShapeError(alias: string): string | null {
  if (ALIAS_FORBIDDEN_RE.test(alias) || hasControlChar(alias)) {
    return "An alias cannot contain brackets, a pipe, or line breaks";
  }
  const trimmed = normalizeAlias(alias);
  if (!trimmed) return "An alias needs some text";
  if (trimmed.length < ALIAS_MIN_LENGTH) return "An alias needs at least two characters — the card picker cannot search one";
  if (trimmed.length > ALIAS_MAX_LENGTH) return `An alias can be at most ${ALIAS_MAX_LENGTH} characters`;
  return null;
}

/** The alias as it is stored: collapsed whitespace, the curator's casing kept. */
export function normalizeAlias(alias: string): string {
  return alias.replace(/\s+/g, " ").trim();
}
