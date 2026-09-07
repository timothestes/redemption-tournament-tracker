/**
 * One-off, idempotent: stamp posts.wp_post_id from the WXR export (wp:post_id),
 * matched on posts.source_url === the WXR item <link>. Covers posts AND imported
 * WP pages (re-run after any pages import). LIVE against prod unless --dry-run.
 * Usage: npx tsx scripts/backfill-wp-post-ids.ts --wxr <path> [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { parseArgs } from "node:util";
import { readWxr } from "./lib/wxr/parse";
import { serviceClient } from "./lib/wxr/db";

async function main() {
  const { values } = parseArgs({
    options: { wxr: { type: "string" }, "dry-run": { type: "boolean", default: false } },
  });
  if (!values.wxr) throw new Error("--wxr <path to WXR export> is required");
  const dryRun = values["dry-run"] === true;

  const byUrl = new Map<string, number>();
  for (const postType of ["post", "page"] as const) {
    for (const p of readWxr(values.wxr, { postType }).posts) {
      const id = Number(p.wpId);
      if (Number.isInteger(id) && id > 0 && p.link) byUrl.set(p.link, id);
    }
  }

  const db = serviceClient(process.env);
  // PostgREST caps a single select at 1000 rows regardless of .limit(); page with .range() (as
  // db.ts's existingSourceUrls does) so all ~1286 posts are considered, not just the first 1000.
  const rows: { id: string; source_url: string | null; wp_post_id: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("posts").select("id, source_url, wp_post_id").order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  let stamped = 0, already = 0, unmatched = 0;
  for (const row of rows) {
    const id = row.source_url ? byUrl.get(row.source_url) : undefined;
    if (id === undefined) { unmatched++; continue; }
    if (row.wp_post_id === id) { already++; continue; }
    if (!dryRun) {
      const { error: e } = await db.from("posts").update({ wp_post_id: id }).eq("id", row.id);
      if (e) throw new Error(`${row.source_url}: ${e.message}`);
    }
    stamped++;
  }
  console.log(JSON.stringify({ dryRun, stamped, already, unmatched, wxrItems: byUrl.size }));
}
main().catch((e) => { console.error(e); process.exit(1); });
