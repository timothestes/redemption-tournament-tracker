import { notFound } from "next/navigation";
import { requireForge } from "./lib/auth";

export const dynamic = "force-dynamic";

export default async function ForgeDeskPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        The Forge
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {ctx.user.email ?? ctx.user.id} · role:{" "}
        <span className="font-medium">{ctx.role}</span>
      </p>
    </main>
  );
}
