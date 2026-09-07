"use server";

import { randomBytes } from "crypto";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { hashToken } from "@/app/forge/lib/token";
import { sendEmail, wrapEmailInTemplate } from "@/utils/email";
import { createClient } from "@/utils/supabase/server";

export type PosterInviteRow = {
  id: string;
  email: string | null;
  invited_by: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

// Local copy, not a cross-feature import — app/forge/lib/members.ts has its
// own identical helper for the same reason.
function siteUrl(): string {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return base.replace(/\/$/, "");
}

export async function mintPosterInvite(
  email?: string | null,
  expiresInDays = 7
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await requireSuperuser();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const raw = randomBytes(32).toString("base64url");
  const days = expiresInDays > 0 ? expiresInDays : 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const cleanEmail = email && email.trim() ? email.trim() : null;

  const { error } = await ctx.supabase.rpc("mint_poster_invite", {
    p_token_hash: hashToken(raw),
    p_email: cleanEmail,
    p_expires_at: expiresAt,
  });
  if (error) return { ok: false, error: "Could not mint invite" };

  const url = `${siteUrl()}/invite/poster/${raw}`;
  if (cleanEmail) {
    const body = `
      <h1 style="font-size:22px;margin:0 0 12px 0;">You're invited to post on Land of Redemption</h1>
      <p>You've been invited to write articles at <a href="${siteUrl()}/articles">/articles</a>.</p>
      <p style="margin:24px 0;"><a href="${url}"
         style="background:#10b981;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">Accept invite</a></p>
      <p style="color:#71717a;font-size:13px;">This link expires in ${days} day(s) and can be used once. If you didn't expect this, ignore it.</p>`;
    await sendEmail({ to: cleanEmail, subject: "You're invited to post", html: wrapEmailInTemplate(body) });
  }
  return { ok: true, url };
}

export async function listPosterInvites(): Promise<PosterInviteRow[]> {
  const ctx = await requireSuperuser();
  if (!ctx) return [];
  const { data } = await ctx.supabase.rpc("list_poster_invites");
  return (data as PosterInviteRow[] | null) ?? [];
}

export async function redeemPosterInvite(token: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_poster_invite", { p_token_hash: hashToken(token) });
  if (error) return { ok: false };
  return { ok: data === true };
}
