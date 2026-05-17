"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { generateKey } from "@/lib/api/auth";

const MAX_ACTIVE_KEYS = 5;

export type CreateApiKeyResult =
  | { ok: true; fullKey: string; name: string; prefix: string }
  | { ok: false; error: string };

export async function createApiKeyAction(name: string): Promise<CreateApiKeyResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };
  if (trimmed.length > 64) return { ok: false, error: "Name must be 64 characters or fewer." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { count } = await supabase
    .from("api_keys")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
    return { ok: false, error: "Maximum of 5 active API keys. Revoke one to create another." };
  }

  const { full, prefix, hash } = generateKey();
  const { error } = await supabase.from("api_keys").insert({
    user_id: user.id,
    name: trimmed,
    key_prefix: prefix,
    key_hash: hash,
  });
  if (error) return { ok: false, error: "Failed to create key." };

  revalidatePath("/account/api-keys");
  return { ok: true, fullKey: full, name: trimmed, prefix };
}

export async function revokeApiKeyAction(keyId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .is("revoked_at", null);
  if (error) return { ok: false, error: "Failed to revoke key." };

  revalidatePath("/account/api-keys");
  return { ok: true };
}
