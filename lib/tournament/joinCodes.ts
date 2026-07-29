import { randomBytes } from "crypto";
import { JOIN_CODE_LENGTH, normalizeJoinCode } from "./joinCodeShared";

// Crockford base32: no I, L, O, U. Codes are hand-typed from whiteboards.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export { JOIN_CODE_LENGTH, normalizeJoinCode };

export function generateJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}
