"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireElder, requireForgeSuperadmin, requireForge, type ForgeRole } from "@/app/forge/lib/auth";
import { hashToken } from "@/app/forge/lib/token";
import { sendEmail, wrapEmailInTemplate } from "@/utils/email";
import { createClient } from "@/utils/supabase/server";

function siteUrl(): string {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return base.replace(/\/$/, "");
}

export async function mintInvite(input: {
  role: ForgeRole;
  email?: string | null;
  expiresInDays?: number;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  // Elder gate first; an elder invite additionally needs superadmin.
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (input.role === "elder" && !(await requireForgeSuperadmin())) {
    return { ok: false, error: "Only a superadmin can invite an elder" };
  }
  if (input.role === "superadmin") return { ok: false, error: "Superadmin is not invitable" };

  const raw = randomBytes(32).toString("base64url");
  const days = input.expiresInDays && input.expiresInDays > 0 ? input.expiresInDays : 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await ctx.supabase.rpc("forge_mint_invite", {
    p_token_hash: hashToken(raw),
    p_role: input.role,
    p_set_ids: [],
    p_email: input.email ?? null,
    p_expires_at: expiresAt,
  });
  if (error) return { ok: false, error: "Could not mint invite" };

  const url = `${siteUrl()}/invite/${raw}`;
  const body = `
    <h1 style="font-size:22px;margin:0 0 12px 0;">You're invited to The Forge</h1>
    <p>You've been invited to join The Forge as a <strong>${input.role}</strong>.</p>
    <p style="margin:24px 0;"><a href="${url}"
       style="background:#10b981;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">Accept invite</a></p>
    <p style="color:#71717a;font-size:13px;">This link expires in ${days} day(s) and can be used once. If you didn't expect this, ignore it.</p>`;
  if (input.email) {
    await sendEmail({ to: input.email, subject: "Your Forge invite", html: wrapEmailInTemplate(body) });
  }
  return { ok: true, url };
}

export async function setProfile(input: {
  displayName: string;
  avatarUrl?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const name = input.displayName.trim();
  if (!name) return { ok: false, error: "Display name is required" };
  if (name.length > 60) return { ok: false, error: "Display name too long" };
  const { error } = await ctx.supabase.rpc("forge_set_profile", {
    p_display_name: name,
    p_avatar_url: input.avatarUrl ?? null,
  });
  if (error) return { ok: false, error: "Could not save profile" };
  return { ok: true };
}

export async function addMember(
  userId: string,
  role: ForgeRole
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_add_member", { p_user_id: userId, p_role: role });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/forge/admin");
  return { ok: true };
}

export async function removeMember(userId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_remove_member", { p_user_id: userId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/forge/admin");
  return { ok: true };
}

export async function changeRole(
  userId: string,
  newRole: ForgeRole
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_change_role", {
    p_user_id: userId,
    p_new_role: newRole,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/forge/admin");
  return { ok: true };
}

export async function listMembers() {
  const ctx = await requireElder();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("playtest_members")
    .select("user_id, role, display_name, created_at")
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function listInvites() {
  const ctx = await requireElder();
  if (!ctx) return [];
  const { data } = await ctx.supabase.rpc("forge_list_invites");
  return data ?? [];
}

export async function redeemInvite(
  rawToken: string,
  agreement: string
): Promise<{ ok: true; role: ForgeRole } | { ok: false }> {
  const agreed = agreement.trim().toLowerCase() === "i agree";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("forge_redeem_invite", {
    p_token_hash: hashToken(rawToken),
    p_nda_agreed: agreed,
  });
  if (error || (data !== "superadmin" && data !== "elder" && data !== "playtester")) {
    return { ok: false };
  }
  return { ok: true, role: data as ForgeRole };
}
