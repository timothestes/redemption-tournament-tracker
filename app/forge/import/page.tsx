import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listSets } from "@/app/forge/lib/sets";
import ImportWizard from "./ImportWizard";

export const metadata = { title: "Import a set — The Forge" };

export default async function ForgeImportPage() {
  const ctx = await requireForge();
  if (!ctx) notFound(); // non-members must not learn this exists
  if (ctx.role === "playtester") redirect("/forge/play");
  const sets = await listSets();
  return <ImportWizard sets={sets} />;
}
