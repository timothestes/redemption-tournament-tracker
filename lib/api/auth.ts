import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const KEY_PREFIX = "rtt_";
const RANDOM_LEN = 43; // base64url(32 bytes) = 43 chars (no padding)
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export type ParsedKey = { prefix: string; full: string };
export type VerifiedKey = {
  id: string;
  user_id: string;
  key_prefix: string;
};

export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme !== "Bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

export function parseKey(key: string): ParsedKey | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const random = key.slice(KEY_PREFIX.length);
  if (random.length !== RANDOM_LEN) return null;
  if (!BASE64URL_RE.test(random)) return null;
  return { prefix: random.slice(0, 8), full: key };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateKey(): { full: string; prefix: string; hash: string } {
  const random = randomBytes(32).toString("base64url"); // 43 chars
  const full = KEY_PREFIX + random;
  return { full, prefix: random.slice(0, 8), hash: hashKey(full) };
}

// Constant-time hex-hash compare; the DB equality lookup is the primary check.
export function safeHashEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase admin env vars missing");
  return createServiceClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function verifyApiKey(presentedKey: string): Promise<VerifiedKey | null> {
  const parsed = parseKey(presentedKey);
  if (!parsed) return null;
  const hash = hashKey(parsed.full);

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, user_id, key_prefix")
    .eq("key_hash", hash)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as VerifiedKey;
}

export function touchLastUsedAt(keyId: string): void {
  after(async () => {
    try {
      const supabase = adminClient();
      await supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", keyId);
    } catch {
      // best-effort; never block or surface
    }
  });
}
