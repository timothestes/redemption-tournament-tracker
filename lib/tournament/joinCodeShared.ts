// Crockford base32 alphabet + normalization only — split out of joinCodes.ts
// so client components can import normalization logic without pulling in
// node's `crypto` (used only by generateJoinCode, which stays server-only).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ALIASES: Record<string, string> = { I: "1", L: "1", O: "0" };
export const JOIN_CODE_LENGTH = 6;

/** Uppercase, strip separators, map Crockford aliases. Null if not exactly 6 valid chars. */
export function normalizeJoinCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .split("")
    .map((ch) => ALIASES[ch] ?? ch)
    .join("");
  if (cleaned.length !== JOIN_CODE_LENGTH) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}
