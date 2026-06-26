import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "./lib/auth";

export const dynamic = "force-dynamic";

export default async function ForgeDeskPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>The Forge</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {ctx.user.email ?? ctx.user.id} · role: <span className="font-medium">{ctx.role}</span>
      </p>
      <nav className="mt-6 grid gap-3 sm:grid-cols-2">
        {ctx.role === "playtester" ? (
          <>
            <Link href="/forge/play" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Your sets</div>
              <div className="text-sm text-muted-foreground">Browse the cards shared with you.</div>
            </Link>
            <Link href="/forge/play/decks" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Build a deck</div>
              <div className="text-sm text-muted-foreground">Mix the cards shared with you and the full pool.</div>
            </Link>
            <div className="rounded-lg border border-dashed p-4 opacity-60" aria-disabled="true">
              <div className="font-medium">Find a game</div>
              <div className="text-sm text-muted-foreground">Coming soon.</div>
            </div>
          </>
        ) : (
          <>
            <Link href="/forge/ideas" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Ideas</div>
              <div className="text-sm text-muted-foreground">Your private sketchbook.</div>
            </Link>
            <Link href="/forge/sets" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Sets</div>
              <div className="text-sm text-muted-foreground">Collective work, lifecycle & progress.</div>
            </Link>
            {ctx.role === "superadmin" && (
              <Link href="/forge/admin" className="rounded-lg border p-4 hover:bg-muted/50">
                <div className="font-medium">Admin</div>
                <div className="text-sm text-muted-foreground">Invites & roles.</div>
              </Link>
            )}
          </>
        )}
      </nav>
    </main>
  );
}
