import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import SetTabs from "./SetTabs";
import SetRealtime from "./SetRealtime";

export const dynamic = "force-dynamic";

export default async function SetLayout({ children, params }: { children: React.ReactNode; params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound(); // RLS hides sets the caller can't see → 404
  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4">
        <ForgeBreadcrumbs items={[
          { label: "The Forge", href: "/forge" },
          { label: "Sets", href: "/forge/sets" },
          { label: set.name },
        ]} />
        <h1 className="text-lg font-semibold">{set.name}</h1>
        <SetTabs setId={setId} />
      </div>
      <SetRealtime setId={setId} />
      {children}
    </div>
  );
}
