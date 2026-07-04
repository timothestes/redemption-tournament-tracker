import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const adminAvailable = !!URL && !!SERVICE;
export const admin = adminAvailable
  ? createClient(URL, SERVICE, { auth: { persistSession: false } })
  : null;

export interface SeededForgeMember {
  userId: string; email: string; password: string; role: "elder" | "playtester";
}

export async function seedForgeMember(role: "elder" | "playtester"): Promise<SeededForgeMember> {
  if (!admin) throw new Error("forge e2e seed requires SUPABASE_SERVICE_ROLE_KEY");
  const email = `forge-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
  const password = "Testpass12345";
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error || !data?.user) throw new Error(`createUser failed: ${error?.message}`);
  const { error: mErr } = await admin.from("playtest_members").insert({
    user_id: data.user.id,
    role,
    display_name: `E2E ${role}`,
    nda_agreed_at: new Date().toISOString(),
  });
  if (mErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(`playtest_members insert failed: ${mErr.message}`);
  }
  return { userId: data.user.id, email, password, role };
}

// Deletes everything the member created during the test, then the member + user.
// Order matters: versions → cards → set memberships/grants → sets → audit → member → user.
export async function cleanupForgeMember(seed: SeededForgeMember) {
  if (!admin) return;
  const { data: cards } = await admin.from("forge_cards").select("id").eq("owner_id", seed.userId);
  const cardIds = (cards ?? []).map((c: { id: string }) => c.id);
  if (cardIds.length) {
    await admin.from("card_comments").delete().in("card_id", cardIds);
    await admin.from("card_proposals").delete().in("card_id", cardIds);
    // published_version_id/approved_version_id FK-block card_versions deletes — clear first
    await admin.from("forge_cards").update({ published_version_id: null, approved_version_id: null }).in("id", cardIds);
    await admin.from("card_versions").delete().in("card_id", cardIds);
    await admin.from("forge_cards").delete().in("id", cardIds);
  }
  const { data: ownSets } = await admin.from("forge_sets").select("id").eq("created_by", seed.userId);
  const setIds = (ownSets ?? []).map((s: { id: string }) => s.id);
  if (setIds.length) {
    await admin.from("forge_set_elders").delete().in("set_id", setIds);
    await admin.from("forge_set_grants").delete().in("set_id", setIds);
    await admin.from("forge_sets").delete().in("id", setIds);
  }
  await admin.from("forge_set_elders").delete().eq("user_id", seed.userId);
  await admin.from("forge_set_grants").delete().eq("user_id", seed.userId);
  await admin.from("forge_audit").delete().eq("actor", seed.userId);
  await admin.from("playtest_members").delete().eq("user_id", seed.userId);
  // The live profiles FK to auth.users is NO ACTION (signup trigger auto-creates
  // the row), so it must go first or deleteUser 500s and users accumulate.
  await admin.from("profiles").delete().eq("id", seed.userId);
  try { await admin.auth.admin.deleteUser(seed.userId); } catch { /* best-effort */ }
}
