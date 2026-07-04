import { notFound } from "next/navigation";
import { requireElder } from "@/app/forge/lib/auth";
import { getMissiveDirectory, listRecentMissives } from "@/app/forge/lib/missives";
import MissiveComposer from "./MissiveComposer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeMissivesPage() {
  const ctx = await requireElder();
  if (!ctx) notFound();
  const [{ members, sets }, recent] = await Promise.all([getMissiveDirectory(), listRecentMissives()]);
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Missives
      </h1>
      <MissiveComposer members={members} sets={sets} recent={recent} callerId={ctx.user.id} />
    </main>
  );
}
