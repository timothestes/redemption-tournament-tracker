/**
 * Import the landofredemption.com WordPress export into public.posts.
 * Spec: docs/superpowers/specs/2026-09-06-wxr-import-design.md
 *
 * Usage: npx tsx scripts/import-wxr.ts [--wxr PATH] [--backup PATH] [--dry-run] [--media-only]
 *          [--limit N] [--only slug,slug] [--skip-media] [--update] [--as-draft] [--concurrency 8]
 *
 * --dry-run     no network: writes scripts/output/wxr/{posts,report.json,report.md,media-manifest.json}
 * --media-only  mirror media for the selected posts to Blob, then stop
 * --update      overwrite rows that already exist (matched on source_url); never changes slug/status
 * Everything else is LIVE against production Supabase + Blob.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { assemblePost, finalSlugs, loadAuthorMap, type AuthorMapEntry, type ImportRow } from "./lib/wxr/assemble";
import { ensureArchiveUser, existingSourceUrls, listAllUsers, resolveAuthors, serviceClient, writePost } from "./lib/wxr/db";
import { mirrorMedia, planMedia, type Manifest } from "./lib/wxr/media";
import { readWxr, type WxrPost } from "./lib/wxr/parse";
import { preprocess } from "./lib/wxr/preprocess";
import { frontMatter, writeReport, type PostReport, type Report } from "./lib/wxr/report";
import { htmlToMarkdown, measureMarkdown, type MarkdownStats } from "./lib/wxr/toMarkdown";
import { collectSiteFiles, rewriteUrls, siteFilePath } from "./lib/wxr/urls";

const OUT_DIR = "scripts/output/wxr";
const AUTHOR_MAP = "scripts/data/wxr-authors.json";

const { values } = parseArgs({
  options: {
    wxr: { type: "string", default: "tmp/landofredemption.WordPress.2026-09-05.xml" },
    backup: { type: "string", default: "tmp/public_html" },
    "dry-run": { type: "boolean", default: false },
    "media-only": { type: "boolean", default: false },
    limit: { type: "string" },
    only: { type: "string" },
    "skip-media": { type: "boolean", default: false },
    update: { type: "boolean", default: false },
    "as-draft": { type: "boolean", default: false },
    concurrency: { type: "string", default: "8" },
  },
});

const dryRun = values["dry-run"]!;
const mediaOnly = values["media-only"]!;
const status: ImportRow["status"] = values["as-draft"] ? "draft" : "published";
const onlySlugs = (values.only ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const mode = [dryRun ? "dry-run" : mediaOnly ? "media-only" : "live", values.update ? "--update" : "", values["as-draft"] ? "--as-draft" : ""]
  .filter(Boolean)
  .join(" ");

function positiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag}: expected a positive integer, got ${JSON.stringify(raw)}`);
  return n;
}

const log = (s: string) => console.log(s);
const emptyStats = (): PostReport["stats"] => ({
  images: 0, links: 0, embeds: 0, residualHtml: [], residualMarkers: [], externalImageHosts: [],
  droppedBlocks: {}, unknownRefs: [], removedIframes: [], missingMedia: [],
});

/** The N newest published posts, by GMT date and then local date. */
function newest(posts: WxrPost[], n: number): WxrPost[] {
  return [...posts]
    .sort((a, b) => (b.dateGmt.localeCompare(a.dateGmt) || b.date.localeCompare(a.date)))
    .slice(0, n);
}

function selectPosts(posts: WxrPost[], limit: number | null): WxrPost[] {
  if (onlySlugs.length) {
    const wanted = new Set(onlySlugs);
    const picked = posts.filter((p) => wanted.has(p.slug));
    const missing = onlySlugs.filter((s) => !picked.some((p) => p.slug === s));
    if (missing.length) throw new Error(`--only: no published post with slug ${missing.join(", ")}`);
    return picked;
  }
  return limit === null ? posts : newest(posts, limit);
}

/** Every post's author must be in the map, so a re-export with a new author cannot fall through. */
function authorsByLogin(map: AuthorMapEntry[], posts: WxrPost[]): Map<string, AuthorMapEntry> {
  const byLogin = new Map(map.map((e) => [e.login, e]));
  const missing = [...new Set(posts.map((p) => p.creator))].filter((login) => !byLogin.has(login));
  if (missing.length) throw new Error(`${AUTHOR_MAP}: no entry for dc:creator ${missing.join(", ")}`);
  return byLogin;
}

interface Prepared {
  post: WxrPost;
  finalSlug: string;
  author: AuthorMapEntry;
  html: string;
  featuredFile: string | null;
  siteFiles: string[];
  report: PostReport;
}

async function main() {
  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!blobBase) throw new Error("Missing NEXT_PUBLIC_BLOB_BASE_URL");

  const concurrency = positiveInt(values.concurrency!, "--concurrency");
  const limit = values.limit === undefined ? null : positiveInt(values.limit, "--limit");
  const { posts, attachments, blocks } = readWxr(values.wxr!);
  const slugMap = finalSlugs(posts); // over ALL posts, so links to unselected posts still map
  const authorMap = loadAuthorMap(AUTHOR_MAP);
  const byLogin = authorsByLogin(authorMap, posts);
  const selected = selectPosts(posts, limit);
  log(`${posts.length} published posts in the export, ${selected.length} selected (${mode})`);

  // Runs that write rows resolve authors up front: assemblePost needs the real author_id.
  // --media-only never touches Supabase, so it cannot create the archive account either.
  const sb = dryRun || mediaOnly ? null : serviceClient(process.env);
  let resolved = new Map<string, string>();
  let existing = new Set<string>();
  if (sb) {
    const users = await listAllUsers(sb);
    const archiveId = await ensureArchiveUser(sb, users);
    resolved = resolveAuthors(authorMap, users, archiveId);
    existing = await existingSourceUrls(sb);
    log(`authors resolved: ${resolved.size} logins, ${existing.size} posts already imported`);
  }

  // 1) preprocess + discover the media each post references.
  const prepared: Prepared[] = [];
  const failures: PostReport[] = [];
  for (const post of selected) {
    const author = byLogin.get(post.creator)!;
    const base: PostReport = {
      slug: slugMap.get(post.slug)!, originalSlug: post.slug, title: post.title,
      login: post.creator, wpId: post.wpId, classic: false, stats: emptyStats(),
    };
    try {
      const { html, classic, dropped, unknownRefs } = preprocess(post.content, blocks);
      const featuredUrl = post.thumbnailId ? attachments.get(post.thumbnailId) ?? null : null;
      base.classic = classic;
      base.stats.droppedBlocks = dropped;
      base.stats.unknownRefs = unknownRefs;
      prepared.push({
        post, finalSlug: base.slug, author, html,
        featuredFile: featuredUrl ? siteFilePath(featuredUrl) : null,
        siteFiles: collectSiteFiles(html, featuredUrl),
        report: base,
      });
    } catch (e) {
      base.error = (e as Error).message;
      failures.push(base);
    }
  }

  // 2) plan (and, live, mirror) the media.
  const allFiles = [...new Set(prepared.flatMap((p) => p.siteFiles))];
  const manifest: Manifest = planMedia(allFiles, values.backup!, blobBase);
  const count = (s: string) => Object.values(manifest).filter((e) => e.status === s).length;
  const planned = count("planned");
  const missingMedia = count("missing");
  log(`media: ${allFiles.length} files referenced, ${planned} present in the backup, ${missingMedia} missing`);
  const mirrored = !dryRun && !values["skip-media"];
  if (mirrored) await mirrorMedia(manifest, { backupDir: values.backup!, concurrency, log });
  // Anything still "planned" after a mirror pass is an upload that failed (mirrorMedia logged it).
  const mediaFailed = mirrored ? count("planned") : 0;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "media-manifest.json"), JSON.stringify(manifest, null, 2));

  if (mediaOnly) {
    log(`media-only: ${count("uploaded")} uploaded, ${count("exists")} already in the store, ${count("missing")} missing, ${mediaFailed} failed | manifest: ${join(OUT_DIR, "media-manifest.json")}`);
    return;
  }

  // 3) rewrite → markdown → row, one markdown file per post.
  const mirror = (sitePath: string) => {
    const e = manifest[sitePath];
    return e && e.status !== "missing" ? e.url : null;
  };
  mkdirSync(join(OUT_DIR, "posts"), { recursive: true });
  const rows: { row: ImportRow; report: PostReport }[] = [];
  let converted = 0;
  for (const p of prepared) {
    try {
      const html = rewriteUrls(p.html, { mirror, slugMap });
      const { markdown, removedIframes } = htmlToMarkdown(html);
      const stats: MarkdownStats = measureMarkdown(markdown, blobBase);
      const row = assemblePost(p.post, {
        finalSlug: p.finalSlug,
        authorId: sb ? resolved.get(p.author.login) ?? null : null,
        authorName: p.author.name || p.author.login,
        bodyMd: markdown,
        coverUrl: p.featuredFile ? mirror(p.featuredFile) : null,
        status,
      });
      Object.assign(p.report.stats, stats, {
        removedIframes,
        missingMedia: p.siteFiles.filter((f) => manifest[f]?.status === "missing"),
      });
      writeFileSync(join(OUT_DIR, "posts", `${row.slug}.md`), frontMatter(row) + row.body_md + "\n");
      rows.push({ row, report: p.report });
      if (++converted % 100 === 0) log(`converted ${converted}/${prepared.length}`);
    } catch (e) {
      p.report.error = (e as Error).message;
      failures.push(p.report);
    }
  }

  // 4) write the rows.
  const db = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
  if (sb) {
    for (const { row, report } of rows) {
      const exists = existing.has(row.source_url);
      if (exists && !values.update) { db.skipped++; continue; }
      const res = (await writePost(sb, row, exists ? "update" : "insert")) as { id?: string; error?: string };
      if (res.error) { db.failed++; report.error = `db: ${res.error}`; }
      else if (exists) db.updated++;
      else db.inserted++;
      const done = db.inserted + db.updated + db.failed;
      if (done % 100 === 0) log(`written ${done}/${rows.length}`);
    }
  }

  // 5) report.
  const postReports = [...rows.map((r) => r.report), ...failures];
  const postsWith = (f: (s: PostReport["stats"]) => boolean) => postReports.filter((p) => f(p.stats)).length;
  const postCounts = new Map<string, number>();
  for (const p of prepared) postCounts.set(p.author.login, (postCounts.get(p.author.login) ?? 0) + 1);
  const report: Report = {
    generatedAt: new Date().toISOString(),
    mode,
    totals: {
      posts_selected: selected.length,
      posts_converted: rows.length,
      posts_failed: failures.length + db.failed,
      media_referenced: allFiles.length,
      media_planned: planned,
      media_missing: missingMedia,
      media_uploaded: count("uploaded"),
      media_exists: count("exists"),
      media_failed: mediaFailed,
      db_inserted: db.inserted,
      db_updated: db.updated,
      db_skipped: db.skipped,
      db_failed: db.failed,
      posts_with_residual_html: postsWith((s) => s.residualHtml.length > 0),
      posts_with_residual_markers: postsWith((s) => s.residualMarkers.length > 0),
      posts_with_unknown_refs: postsWith((s) => s.unknownRefs.length > 0),
      posts_with_dropped_blocks: postsWith((s) => Object.keys(s.droppedBlocks).length > 0),
      posts_with_removed_iframes: postsWith((s) => s.removedIframes.length > 0),
      posts_with_missing_media: postsWith((s) => s.missingMedia.length > 0),
      posts_with_external_images: postsWith((s) => s.externalImageHosts.length > 0),
    },
    authors: authorMap
      .filter((a) => postCounts.has(a.login))
      .map((a) => ({
        login: a.login, name: a.name, posts: postCounts.get(a.login)!, email: a.email,
        resolved: a.email ? (sb ? resolved.get(a.login) ?? "?" : a.email) : "ARCHIVE",
      }))
      .sort((a, b) => b.posts - a.posts || a.login.localeCompare(b.login)),
    slugChanges: [...slugMap].filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to })),
    posts: postReports,
  };
  report.totals.slug_changes = report.slugChanges.length;
  writeReport(OUT_DIR, report);

  const failed = failures.length + db.failed;
  const dbLine = sb ? ` | db: ${db.inserted} inserted, ${db.updated} updated, ${db.skipped} skipped, ${db.failed} failed` : "";
  log(`posts: ${selected.length} selected, ${rows.length} converted, ${failed} failed | media: ${planned} planned, ${missingMedia} missing${dbLine} | report: ${join(OUT_DIR, "report.md")}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
