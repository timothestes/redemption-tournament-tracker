import { randomBytes } from "crypto";

// Crockford base32: no I, L, O, U. Codes are hand-typed from whiteboards.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ALIASES: Record<string, string> = { I: "1", L: "1", O: "0" };
export const JOIN_CODE_LENGTH = 6;

export function generateJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

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
