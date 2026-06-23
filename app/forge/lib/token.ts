import { createHash } from "crypto";

/** sha256 hex of a raw invite token. Only the hash is ever stored. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
