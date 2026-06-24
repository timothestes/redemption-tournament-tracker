import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import NotesEditor from "./NotesEditor";

export const dynamic = "force-dynamic";

export default async function SetNotesPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound();
  const canEdit = ctx.role === "elder" || ctx.role === "superadmin";
  return <NotesEditor setId={setId} initial={set.notes ?? ""} canEdit={canEdit} />;
}
