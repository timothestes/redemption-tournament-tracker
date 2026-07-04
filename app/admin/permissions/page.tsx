import { notFound } from "next/navigation";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { listMembers } from "@/app/forge/lib/members";
import { listAdmins } from "./actions";
import PermissionsPortal, { type ForgeMemberRow } from "./PermissionsPortal";

export const metadata = { title: "Permissions" };
export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  const ctx = await requireSuperuser();
  if (!ctx) notFound();

  const [admins, forgeMembers] = await Promise.all([listAdmins(), listMembers()]);

  return (
    <PermissionsPortal
      initialAdmins={admins}
      forgeMembers={forgeMembers as ForgeMemberRow[]}
      selfId={ctx.user.id}
    />
  );
}
