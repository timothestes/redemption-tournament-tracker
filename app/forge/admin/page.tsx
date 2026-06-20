import { notFound } from "next/navigation";
import { requireElder } from "@/app/forge/lib/auth";
import { listMembers, listInvites } from "@/app/forge/lib/members";
import AdminConsole from "./AdminConsole";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeAdminPage() {
  const ctx = await requireElder();
  if (!ctx) notFound();
  const [members, invites] = await Promise.all([listMembers(), listInvites()]);
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Forge Members
      </h1>
      <AdminConsole callerRole={ctx.role} members={members} invites={invites} />
    </main>
  );
}
