"use server";

import { revalidatePath } from "next/cache";
import { requireElder, type ForgeRole } from "@/app/forge/lib/auth";
import { sendEmail } from "@/utils/email";
import { missiveBodyHtml, wrapForgeMissive } from "@/app/forge/lib/missiveTemplate";

export type MissiveMember = {
  userId: string;
  displayName: string | null;
  role: ForgeRole;
  email: string;
  setIds: string[];
};

const MAX_RECIPIENTS = 100; // Resend free tier: 100/day
const SEND_DELAY_MS = 600; // Resend default rate limit: 2 req/s
const FORGE_FROM = process.env.FORGE_FROM_EMAIL || "The Forge <noreply@landofredemption.com>";

type DirectoryRow = {
  user_id: string;
  display_name: string | null;
  role: ForgeRole;
  email: string;
  set_ids: string[] | null;
};

function mapMember(row: DirectoryRow): MissiveMember {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
    email: row.email,
    setIds: row.set_ids ?? [],
  };
}

export async function getMissiveDirectory(): Promise<{
  members: MissiveMember[];
  sets: { id: string; name: string }[];
}> {
  const ctx = await requireElder();
  if (!ctx) return { members: [], sets: [] };

  const { data: rows } = await ctx.supabase.rpc("forge_member_directory");
  const { data: sets } = await ctx.supabase.from("forge_sets").select("id, name").order("name");

  return {
    members: ((rows ?? []) as DirectoryRow[]).map(mapMember),
    sets: sets ?? [],
  };
}

export async function sendMissive(input: {
  subject: string;
  body: string;
  recipientIds: string[];
}): Promise<{ ok: boolean; sent: number; failed: number; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, sent: 0, failed: 0, error: "Not authorized" };

  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject.length < 1 || subject.length > 150) {
    return { ok: false, sent: 0, failed: 0, error: "Subject must be 1-150 characters" };
  }
  if (body.length < 1 || body.length > 20000) {
    return { ok: false, sent: 0, failed: 0, error: "Body must be 1-20000 characters" };
  }
  if (input.recipientIds.length < 1) {
    return { ok: false, sent: 0, failed: 0, error: "Select at least one recipient" };
  }
  if (input.recipientIds.length > MAX_RECIPIENTS) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      error: `Too many recipients — split the send into groups of ${MAX_RECIPIENTS} or fewer`,
    };
  }

  const { data: rows } = await ctx.supabase.rpc("forge_member_directory");
  const directory = ((rows ?? []) as DirectoryRow[]).map(mapMember);

  const sender = directory.find((m) => m.userId === ctx.user.id);
  if (!sender || !sender.displayName) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      error: "Set your Forge display name before sending a missive.",
    };
  }

  const directoryById = new Map(directory.map((m) => [m.userId, m]));
  const seen = new Set<string>();
  const recipients: MissiveMember[] = [];
  for (const id of input.recipientIds) {
    const member = directoryById.get(id);
    if (!member || !member.email || seen.has(member.userId)) continue;
    seen.add(member.userId);
    recipients.push(member);
  }

  if (recipients.length === 0) {
    return { ok: false, sent: 0, failed: 0, error: "No valid recipients" };
  }

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const html = wrapForgeMissive({
      bodyHtml: missiveBodyHtml(body, recipient.displayName ?? "Forge member"),
      senderName: sender.displayName,
      senderEmail: ctx.user.email ?? "",
    });
    const result = await sendEmail({
      to: recipient.email,
      subject: "[Forge] " + subject,
      html,
      from: FORGE_FROM,
      replyTo: ctx.user.email ?? undefined,
    });
    if (result.success) sent++;
    else failed++;

    if (i < recipients.length - 1) {
      await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    }
  }

  await ctx.supabase.rpc("forge_log_missive", {
    p_subject: subject,
    p_body_text: body,
    p_recipient_ids: recipients.map((r) => r.userId),
  });
  revalidatePath("/forge/missives");

  return { ok: failed === 0, sent, failed, error: failed > 0 ? "Some sends failed" : undefined };
}

export async function sendMissiveTest(input: {
  subject: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject.length < 1 || subject.length > 150) {
    return { ok: false, error: "Subject must be 1-150 characters" };
  }
  if (body.length < 1 || body.length > 20000) {
    return { ok: false, error: "Body must be 1-20000 characters" };
  }

  const { data: rows } = await ctx.supabase.rpc("forge_member_directory");
  const directory = ((rows ?? []) as DirectoryRow[]).map(mapMember);

  const sender = directory.find((m) => m.userId === ctx.user.id);
  if (!sender || !sender.displayName) {
    return { ok: false, error: "Set your Forge display name before sending a missive." };
  }

  const html = wrapForgeMissive({
    bodyHtml: missiveBodyHtml(body, sender.displayName),
    senderName: sender.displayName,
    senderEmail: ctx.user.email ?? "",
  });
  const result = await sendEmail({
    to: ctx.user.email ?? "",
    subject: "[TEST] [Forge] " + subject,
    html,
    from: FORGE_FROM,
    replyTo: ctx.user.email ?? undefined,
  });

  if (result.success === false) {
    return { ok: false, error: "Test send failed" };
  }
  return { ok: true };
}

export async function listRecentMissives(): Promise<
  { id: string; sender: string; subject: string; recipientCount: number; sentAt: string }[]
> {
  const ctx = await requireElder();
  if (!ctx) return [];

  const { data } = await ctx.supabase
    .from("forge_missives")
    .select("id, sender, subject, recipient_count, sent_at")
    .order("sent_at", { ascending: false })
    .limit(20);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    sender: row.sender,
    subject: row.subject,
    recipientCount: row.recipient_count,
    sentAt: row.sent_at,
  }));
}
