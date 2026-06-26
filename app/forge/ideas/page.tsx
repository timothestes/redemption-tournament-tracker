import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listForgeCards } from "@/app/forge/lib/cards";
import IdeasLibrary from "./IdeasLibrary";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const cards = await listForgeCards();
  return <IdeasLibrary cards={cards} canCreate={ctx.role === "elder" || ctx.role === "superadmin"} />;
}
