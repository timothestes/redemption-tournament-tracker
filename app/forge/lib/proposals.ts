"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type ProposalStatus = "open" | "accepted" | "denied" | "superseded";

export type ProposalRow = {
  id: string;
  cardId: string;
  baseVersionId: string | null;
  summary: string | null;
  status: ProposalStatus;
  proposedSnapshot: DesignCard;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
};

export type ProposalDiffData = { proposal: ProposalRow; current: DesignCard };

const COLS =
  "id, card_id, base_version_id, summary, status, proposed_snapshot, created_by, created_at, closed_at";

function toProposal(row: any): ProposalRow {
  return {
    id: row.id,
    cardId: row.card_id,
    baseVersionId: row.base_version_id ?? null,
    summary: row.summary ?? null,
    status: row.status,
    proposedSnapshot: (row.proposed_snapshot ?? {}) as DesignCard,
    createdBy: row.created_by,
    createdAt: row.created_at,
    closedAt: row.closed_at ?? null,
  };
}

export async function createProposal(
  cardId: string,
  snapshot: DesignCard,
  summary: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (!summary.trim()) return { ok: false, error: "A summary is required" };
  const { data, error } = await ctx.supabase.rpc("forge_create_proposal", {
    p_card_id: cardId,
    p_snapshot: snapshot,
    p_summary: summary,
  });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create proposal" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true, id: data };
}

export async function acceptProposal(
  proposalId: string,
  cardId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_accept_proposal", {
    p_proposal_id: proposalId,
  });
  if (error) return { ok: false, error: "Could not accept proposal" };
  if (data === null) return { ok: false, error: "This proposal is out of date — please re-propose." };
  // Lifecycle change ripples to set/card/queue views.
  revalidatePath("/forge", "layout");
  return { ok: true };
}

export async function denyProposal(
  proposalId: string,
  cardId: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (!reason.trim()) return { ok: false, error: "A reason is required" };
  const { error } = await ctx.supabase.rpc("forge_deny_proposal", {
    p_proposal_id: proposalId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: "Could not deny proposal" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function listProposals(cardId: string): Promise<ProposalRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_proposals")
    .select(COLS)
    .eq("card_id", cardId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(toProposal);
}

export async function getOpenProposalDiffs(cardId: string): Promise<ProposalDiffData[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data: rows } = await ctx.supabase
    .from("card_proposals")
    .select(COLS)
    .eq("card_id", cardId)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  const proposals = (rows ?? []).map(toProposal);
  const baseIds = proposals
    .map((p) => p.baseVersionId)
    .filter((x): x is string => !!x);
  const baseMap = new Map<string, DesignCard>();
  if (baseIds.length) {
    const { data: vers } = await ctx.supabase
      .from("card_versions")
      .select("id, data")
      .in("id", baseIds);
    for (const v of vers ?? []) baseMap.set(v.id, (v.data ?? {}) as DesignCard);
  }
  return proposals.map((p) => ({
    proposal: p,
    current: p.baseVersionId ? baseMap.get(p.baseVersionId) ?? {} : {},
  }));
}
