import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "./lib/auth";
import { listSets } from "./lib/sets";
import { STATUS_LABEL } from "./lib/lifecycleCopy";

export const dynamic = "force-dynamic";

const MIX_ORDER = ["draft", "playtesting", "approved"] as const;

export default async function ForgeHomePage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const isPlaytester = ctx.role === "playtester";
  const sets = await listSets();

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>The Forge</h1>

      {isPlaytester ? (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Your sets</h2>
            {sets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sets shared with you yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sets.map((s) => (
                  <li key={s.id}>
                    <Link href={`/forge/play/${s.id}`} className="flex items-center justify-between p-3 hover:bg-muted/50">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-sm text-muted-foreground">{s.total} cards</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <Link href="/forge/play/decks" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Build a deck</div>
              <div className="text-sm text-muted-foreground">Mix the cards shared with you and the full pool.</div>
            </Link>
            <div className="rounded-lg border border-dashed p-4 opacity-60" aria-disabled="true">
              <div className="font-medium">Find a game</div>
              <div className="text-sm text-muted-foreground">Coming soon.</div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="flex flex-wrap gap-3">
            <Link href="/forge/ideas" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">New idea</div>
              <div className="text-sm text-muted-foreground">Sketch a card in your private ideas.</div>
            </Link>
            <Link href="/forge/import" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Import a set</div>
              <div className="text-sm text-muted-foreground">Bring in a LackeyCCG plugin zip.</div>
            </Link>
            <Link href="/forge/sets" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">New set</div>
              <div className="text-sm text-muted-foreground">Gather cards toward print.</div>
            </Link>
            {ctx.role === "superadmin" && (
              <Link href="/forge/admin" className="rounded-lg border p-4 hover:bg-muted/50">
                <div className="font-medium">Admin</div>
                <div className="text-sm text-muted-foreground">Invites & roles.</div>
              </Link>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Your sets</h2>
            {sets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sets yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sets.map((s) => {
                  const mix = MIX_ORDER
                    .filter((k) => (s.statusCounts[k] ?? 0) > 0)
                    .map((k) => `${s.statusCounts[k]} ${STATUS_LABEL[k].toLowerCase()}`)
                    .join(" · ");
                  return (
                    <li key={s.id}>
                      <Link href={`/forge/sets/${s.id}/cards`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted/50">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-right text-sm text-muted-foreground">
                          {s.total}{s.targetTotal ? ` / ${s.targetTotal}` : ""} cards
                          {mix ? <span className="block text-xs">{mix}</span> : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Signed in as {ctx.user.email ?? ctx.user.id} · {ctx.role}
      </p>
    </main>
  );
}
