import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";

export const dynamic = "force-dynamic";

export default async function SetLayout({ children, params }: { children: React.ReactNode; params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound(); // RLS hides sets the caller can't see → 404
  const tabs = [
    { href: `/forge/sets/${setId}/cards`, label: "Cards" },
    { href: `/forge/sets/${setId}/notes`, label: "Notes" },
    { href: `/forge/sets/${setId}/progress`, label: "Progress" },
    { href: `/forge/sets/${setId}/review`, label: "Review" },
  ];
  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4">
        <Link href="/forge/sets" className="text-xs text-muted-foreground hover:underline">← Sets</Link>
        <h1 className="text-lg font-semibold">{set.name}</h1>
        <nav className="mt-2 flex gap-3 text-sm">
          {tabs.map((t) => <Link key={t.href} href={t.href} className="text-muted-foreground hover:text-foreground hover:underline">{t.label}</Link>)}
        </nav>
      </div>
      {children}
    </div>
  );
}
