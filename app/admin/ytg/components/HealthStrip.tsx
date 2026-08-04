import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";

// Freshness uses MIN(last_synced_at), not MAX: syncShopifyProducts logs
// batch errors and continues, so after a partial failure MAX lies while
// MIN shows the oldest un-refreshed row.
function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function HealthStrip() {
  const supabase = getSupabaseAdmin();

  const [freshness, productCount, totalMappings, confirmedMappings, needsReview, unmatched] =
    await Promise.all([
      supabase
        .from("shopify_products")
        .select("last_synced_at")
        .not("last_synced_at", "is", null)
        .order("last_synced_at", { ascending: true })
        .limit(1),
      supabase.from("shopify_products").select("*", { count: "exact", head: true }),
      supabase.from("card_price_mappings").select("*", { count: "exact", head: true }),
      supabase
        .from("card_price_mappings")
        .select("*", { count: "exact", head: true })
        .in("status", ["auto_matched", "manual"]),
      supabase
        .from("card_price_mappings")
        .select("*", { count: "exact", head: true })
        .eq("status", "needs_review"),
      supabase
        .from("card_price_mappings")
        .select("*", { count: "exact", head: true })
        .eq("status", "unmatched"),
    ]);

  const oldestSync: string | null = freshness.data?.[0]?.last_synced_at ?? null;
  const total = totalMappings.count ?? 0;
  const confirmed = confirmedMappings.count ?? 0;
  const matchedPct = total > 0 ? Math.round((confirmed / total) * 1000) / 10 : 0;

  // Each stat links to the tab that acts on it.
  const stats = [
    { label: "Synced", value: timeAgo(oldestSync), href: "/admin/ytg/matching" },
    { label: "Products", value: (productCount.count ?? 0).toLocaleString(), href: "/admin/ytg/products" },
    { label: "Matched", value: `${matchedPct}%`, href: "/admin/ytg/matching" },
    { label: "Needs review", value: (needsReview.count ?? 0).toLocaleString(), href: "/admin/ytg/matching" },
    { label: "Unmatched", value: (unmatched.count ?? 0).toLocaleString(), href: "/admin/ytg/matching" },
  ];

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {stats.map((s) => (
        <Link
          key={s.label}
          href={s.href}
          className="rounded-md bg-card px-3 py-1.5 transition-colors hover:bg-muted"
        >
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
            {s.label}
          </span>
          <span className="text-sm font-semibold">{s.value}</span>
        </Link>
      ))}
    </div>
  );
}
