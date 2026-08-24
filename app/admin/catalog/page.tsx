import { notFound } from "next/navigation";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { listCatalogState } from "./actions";
import CatalogClient from "./CatalogClient";

export const metadata = { title: "Catalog" };
export const dynamic = "force-dynamic";

export default async function CatalogAdminPage() {
  const ctx = await requireSuperuser();
  if (!ctx) notFound(); // invisible to everyone else — portal precedent
  const initial = await listCatalogState();
  return <CatalogClient initial={initial} />;
}
