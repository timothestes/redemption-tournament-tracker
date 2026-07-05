import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "@/app/forge/lib/auth";
import { listSets } from "@/app/forge/lib/sets";

export const dynamic = "force-dynamic";

export default async function ForgePlayPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  // RLS returns only sets the caller may see — for a playtester, exactly their granted sets.
  const sets = await listSets();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>Playtest</h1>
      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/forge/play/games" className="rounded-lg border p-4 hover:bg-muted/50">
          <div className="font-medium">Find a game</div>
          <div className="text-sm text-muted-foreground">Host or join a private playtest game.</div>
        </Link>
        <Link href="/forge/play/decks" className="rounded-lg border p-4 hover:bg-muted/50">
          <div className="font-medium">Decks</div>
          <div className="text-sm text-muted-foreground">Build playtest decks and browse what the Forge has shared.</div>
        </Link>
      </section>
      <h2 className="mt-8 text-sm font-medium">Sets shared with you</h2>
      {sets.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No sets have been shared with you yet.</p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {sets.map((s) => (
            <li key={s.id}>
              <Link href={`/forge/play/${s.id}`} className="block rounded-lg border p-4 hover:bg-muted/50">
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-muted-foreground">{s.total} card{s.total === 1 ? "" : "s"}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
