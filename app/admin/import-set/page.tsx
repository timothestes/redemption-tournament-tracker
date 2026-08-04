import { redirect } from "next/navigation";

// The importer moved into the YTG Store shell (/admin/ytg/import). This
// server redirect covers old bookmarks; top-nav links /admin/ytg directly.
export default function LegacyImportSetPage() {
  redirect("/admin/ytg/import");
}
