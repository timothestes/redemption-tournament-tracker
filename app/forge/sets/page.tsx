import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listSets } from "@/app/forge/lib/sets";
import SetsIndex from "./SetsIndex";

export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const sets = await listSets();
  return <SetsIndex sets={sets} canCreate={ctx.role === "elder" || ctx.role === "superadmin"} />;
}
