import { notFound } from "next/navigation";
import { requireCatalogEditor } from "@/app/admin/permissions/lib/auth";
import { listCatalogState } from "./actions";
import CatalogClient from "./CatalogClient";

export const metadata = { title: "Catalog" };
export const dynamic = "force-dynamic";

export default async function CatalogAdminPage() {
  const ctx = await requireCatalogEditor();
  if (!ctx) notFound(); // invisible to everyone else — portal precedent (superuser or manage_catalog)
  const initial = await listCatalogState();
  return <CatalogClient initial={initial} />;
}
