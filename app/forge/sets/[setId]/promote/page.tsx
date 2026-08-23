import { notFound } from "next/navigation";
import { requireForgeSuperadmin } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import { getReleaseState } from "@/app/forge/lib/promote";
import PromoteClient from "./PromoteClient";

export const dynamic = "force-dynamic";

// Promote a Forge set into the public card catalog (the "big red button").
// Superadmin-only: promoting publishes secret content irreversibly. Everyone
// else 404s — the area stays secret.
export default async function PromotePage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) notFound();
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound();
  const release = await getReleaseState(setId);

  return (
    <PromoteClient
      setId={setId}
      setName={set.name}
      setStatus={set.status}
      initialRelease={release}
    />
  );
}
