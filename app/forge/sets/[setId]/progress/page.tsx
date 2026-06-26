import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet, listSetCards, listSetElders, listSetGrants } from "@/app/forge/lib/sets";
import PlaytesterGrants from "./PlaytesterGrants";
import { listSetApprovedArt } from "@/app/forge/lib/setArtwork";
import { computeProgress } from "@/app/forge/lib/progress";
import ProgressDashboard from "./ProgressDashboard";

export const dynamic = "force-dynamic";

export default async function SetProgressPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound();
  const cards = await listSetCards(setId);
  const model = computeProgress(cards.map((c) => ({ snapshot: c.snapshot, status: c.status })), set.targetCounts);
  const canEdit = ctx.role === "elder" || ctx.role === "superadmin";
  // Server-side boolean only — the art list carries blob keys and must not reach the client.
  const hasApprovedArt = (await listSetApprovedArt(setId)).length > 0;

  const elders = await listSetElders(setId);
  let addable: { userId: string; displayName: string | null }[] = [];
  if (canEdit) {
    const { data: members } = await ctx.supabase.from("playtest_members").select("user_id, display_name, role").in("role", ["elder", "superadmin"]);
    const onSet = new Set(elders.map((e) => e.userId));
    addable = (members ?? []).filter((m: any) => !onSet.has(m.user_id)).map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null }));
  }

  let grants: Awaited<ReturnType<typeof listSetGrants>> = [];
  let grantablePlaytesters: { userId: string; displayName: string | null }[] = [];
  if (canEdit) {
    grants = await listSetGrants(setId);
    const { data: pts } = await ctx.supabase
      .from("playtest_members")
      .select("user_id, display_name, role")
      .eq("role", "playtester");
    const granted = new Set(grants.map((g) => g.userId));
    grantablePlaytesters = (pts ?? [])
      .filter((m: any) => !granted.has(m.user_id))
      .map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null }));
  }

  return (
    <>
      <ProgressDashboard setId={setId} model={model} targets={set.targetCounts} elders={elders} addable={addable} canEdit={canEdit} hasApprovedArt={hasApprovedArt} />
      {canEdit && <PlaytesterGrants setId={setId} grants={grants} grantable={grantablePlaytesters} />}
    </>
  );
}
