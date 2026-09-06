/**
 * Import the landofredemption.com WordPress export into public.posts.
 * Spec: docs/superpowers/specs/2026-09-06-wxr-import-design.md
 *
 * Usage: npx tsx scripts/import-wxr.ts [--wxr PATH] [--backup PATH] [--dry-run] [--media-only]
 *          [--limit N] [--only slug,slug] [--skip-media] [--update] [--as-draft] [--concurrency 8]
 *
 * --dry-run     no network: writes scripts/output/wxr/{posts,report.json,report.md,media-manifest.json}
 * --media-only  mirror media for the selected posts to Blob, then stop
 * --skip-media  dry-run only: plan the manifest without uploading. A live run always mirrors,
 *               because only a file the store confirms (exists/uploaded) may be rewritten into a post.
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
import { newest, usableStatuses } from "./lib/wxr/select";
import { htmlToMarkdown, measureMarkdown, type MarkdownStats } from "./lib/wxr/toMarkdown";
import { collectSiteFiles, rewriteUrls, siteFilePath } from "./lib/wxr/urls";

const OUT_DIR = "scripts/output/wxr";
const AUTHOR_MAP = "scripts/data/wxr-authors.json";
/** An error the operator caused (bad flag, missing env, unknown slug): print the message, not a stack. */
class CliError extends Error {}

const USAGE =
  "usage: npx tsx scripts/import-wxr.ts [--wxr PATH] [--backup PATH] [--dry-run] [--media-only]\n" +
  "         [--limit N] [--only slug,slug] [--skip-media] [--update] [--as-draft] [--concurrency 8]";

interface Options {
  wxr: string; backup: string; dryRun: boolean; mediaOnly: boolean; skipMedia: boolean;
  update: boolean; status: ImportRow["status"]; limit: number | null; onlySlugs: string[];
  concurrency: number; mode: string;
}

function positiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new CliError(`${flag}: expected a positive integer, got ${JSON.stringify(raw)}`);
  return n;
}

/** Parses and validates argv. Throws a one-line message (never a stack) on bad input. */
function parseOptions(): Options {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
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
    }));
  } catch (e) {
    throw new CliError(`${(e as Error).message}\n${USAGE}`);
  }
  const dryRun = values["dry-run"] === true;
  const skipMedia = values["skip-media"] === true;
  // A live run rewrites only media the store confirms, so it must always run the mirror pass
  // (cheap when everything is already uploaded: one head() per file).
  if (skipMedia && !dryRun) {
    throw new CliError("--skip-media is only valid with --dry-run; live runs always verify the mirror (head by pathname) before rewriting");
  }
  const mediaOnly = values["media-only"] === true;
  const asDraft = values["as-draft"] === true;
  return {
    wxr: values.wxr as string,
    backup: values.backup as string,
    dryRun, mediaOnly, skipMedia,
    update: values.update === true,
    status: asDraft ? "draft" : "published",
    limit: values.limit === undefined ? null : positiveInt(values.limit as string, "--limit"),
    onlySlugs: ((values.only as string) ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    concurrency: positiveInt(values.concurrency as string, "--concurrency"),
    mode: [dryRun ? "dry-run" : mediaOnly ? "media-only" : "live", values.update ? "--update" : "", asDraft ? "--as-draft" : ""]
      .filter(Boolean).join(" "),
  };
}

const log = (s: string) => console.log(s);
const emptyStats = (): PostReport["stats"] => ({
  images: 0, links: 0, embeds: 0, residualHtml: [], residualMarkers: [], externalImageHosts: [],
  droppedBlocks: {}, unknownRefs: [], removedIframes: [], missingMedia: [], unmirroredMedia: [],
});

function selectPosts(posts: WxrPost[], opts: Options): WxrPost[] {
  if (opts.onlySlugs.length) {
    const wanted = new Set(opts.onlySlugs);
    const picked = posts.filter((p) => wanted.has(p.slug));
    const missing = opts.onlySlugs.filter((s) => !picked.some((p) => p.slug === s));
    if (missing.length) throw new CliError(`--only: no published post with slug ${missing.join(", ")}`);
    return picked;
  }
  return opts.limit === null ? posts : newest(posts, opts.limit);
}

/** Every post's author must be in the map, so a re-export with a new author cannot fall through. */
function authorsByLogin(map: AuthorMapEntry[], posts: WxrPost[]): Map<string, AuthorMapEntry> {
  const byLogin = new Map(map.map((e) => [e.login, e]));
  const missing = [...new Set(posts.map((p) => p.creator))].filter((login) => !byLogin.has(login));
  if (missing.length) throw new CliError(`${AUTHOR_MAP}: no entry for dc:creator ${missing.join(", ")}`);
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
  const opts = parseOptions();
  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!blobBase) throw new CliError("Missing NEXT_PUBLIC_BLOB_BASE_URL");
  // Every mode but a dry run mirrors to Blob; without the token every head/put fails one by one.
  if (!opts.dryRun && !process.env.BLOB_READ_WRITE_TOKEN) throw new CliError("Missing BLOB_READ_WRITE_TOKEN");

  const { posts, attachments, blocks } = readWxr(opts.wxr);
  const slugMap = finalSlugs(posts); // over ALL posts, so links to unselected posts still map
  const idMap = new Map(posts.map((p) => [p.wpId, slugMap.get(p.slug)!])); // for /?p=<id> short links
  const authorMap = loadAuthorMap(AUTHOR_MAP);
  const byLogin = authorsByLogin(authorMap, posts);
  const selected = selectPosts(posts, opts);
  log(`${posts.length} published posts in the export, ${selected.length} selected (${opts.mode})`);

  // Runs that write rows resolve authors up front: assemblePost needs the real author_id.
  // --media-only never touches Supabase, so it cannot create the archive account either.
  const sb = opts.dryRun || opts.mediaOnly ? null : serviceClient(process.env);
  let resolved = new Map<string, string>();
  let existing = new Set<string>();
  if (sb) {
    const users = await listAllUsers(sb);
    const archiveId = await ensureArchiveUser(sb, users);
    resolved = resolveAuthors(authorMap, users, archiveId);
    existing = await existingSourceUrls(sb);
    log(`authors resolved: ${resolved.size} logins, ${existing.size} posts already imported`);
  }

  // 1) preprocess + discover the media each post references. A post with no WordPress title
  // cannot satisfy posts.title's 1-200 char check, so it is skipped rather than failed (§6).
  const prepared: Prepared[] = [];
  const failures: PostReport[] = [];
  const skipped: Report["skipped"] = [];
  for (const post of selected) {
    const finalSlug = slugMap.get(post.slug)!;
    if (!post.title.trim()) {
      skipped.push({ slug: finalSlug, wpId: post.wpId, reason: "empty WordPress title" });
      continue;
    }
    const author = byLogin.get(post.creator)!;
    const base: PostReport = {
      slug: finalSlug, originalSlug: post.slug, title: post.title,
      login: post.creator, wpId: post.wpId, classic: false, stats: emptyStats(),
    };
    try {
      const { html, classic, dropped, unknownRefs } = preprocess(post.content, blocks);
      const featuredUrl = post.thumbnailId ? attachments.get(post.thumbnailId) ?? null : null;
      base.classic = classic;
      base.stats.droppedBlocks = dropped;
      base.stats.unknownRefs = unknownRefs;
      prepared.push({
        post, finalSlug, author, html,
        featuredFile: featuredUrl ? siteFilePath(featuredUrl) : null,
        siteFiles: collectSiteFiles(html, featuredUrl),
        report: base,
      });
    } catch (e) {
      base.error = (e as Error).message;
      failures.push(base);
    }
  }

  // 2) plan (and, outside a dry run, mirror) the media.
  const allFiles = [...new Set(prepared.flatMap((p) => p.siteFiles))];
  const manifest: Manifest = planMedia(allFiles, opts.backup, blobBase);
  const count = (s: string) => Object.values(manifest).filter((e) => e.status === s).length;
  const planned = count("planned");
  const missingMedia = count("missing");
  log(`media: ${allFiles.length} files referenced, ${planned} present in the backup, ${missingMedia} missing`);
  const mirrorRan = !opts.dryRun && !opts.skipMedia;
  if (mirrorRan) await mirrorMedia(manifest, { backupDir: opts.backup, concurrency: opts.concurrency, log });
  // After a mirror pass anything still "planned" is an upload that failed (mirrorMedia logged it).
  const unmirrored = mirrorRan ? count("planned") : 0;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "media-manifest.json"), JSON.stringify(manifest, null, 2));

  if (opts.mediaOnly) {
    log(`media-only: ${count("uploaded")} uploaded, ${count("exists")} already in the store, ${missingMedia} missing, ${unmirrored} failed | manifest: ${join(OUT_DIR, "media-manifest.json")}`);
    return;
  }

  // A mirror pass where not one file uploaded is a broken setup (bad or missing token), not
  // 5,983 unlucky files: writing rows now would publish a whole archive of original WordPress
  // URLs. Partial failures still proceed — they are reported per post.
  if (mirrorRan && planned > 0 && unmirrored === planned) {
    throw new CliError(`media mirror made no progress (${planned} planned, 0 uploaded/exists) — check BLOB_READ_WRITE_TOKEN; no rows written`);
  }

  // 3) rewrite → markdown → row, one markdown file per post.
  const usable = usableStatuses(opts.dryRun ? "dry-run" : "live");
  const mirror = (sitePath: string) => {
    const e = manifest[sitePath];
    return e && usable.has(e.status) ? e.url : null;
  };
  mkdirSync(join(OUT_DIR, "posts"), { recursive: true });
  const rows: { row: ImportRow; report: PostReport }[] = [];
  let converted = 0;
  for (const p of prepared) {
    try {
      const html = rewriteUrls(p.html, { mirror, slugMap, idMap });
      const { markdown, removedIframes } = htmlToMarkdown(html);
      const stats: MarkdownStats = measureMarkdown(markdown, blobBase);
      const row = assemblePost(p.post, {
        finalSlug: p.finalSlug,
        authorId: sb ? resolved.get(p.author.login) ?? null : null,
        authorName: p.author.name || p.author.login,
        bodyMd: markdown,
        coverUrl: p.featuredFile ? mirror(p.featuredFile) : null,
        status: opts.status,
      });
      Object.assign(p.report.stats, stats, {
        removedIframes,
        missingMedia: p.siteFiles.filter((f) => manifest[f]?.status === "missing"),
        unmirroredMedia: mirrorRan ? p.siteFiles.filter((f) => manifest[f]?.status === "planned") : [],
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
    let done = 0;
    for (const { row, report } of rows) {
      const exists = existing.has(row.source_url);
      if (exists && !opts.update) db.skipped++;
      else {
        const res = (await writePost(sb, row, exists ? "update" : "insert")) as { id?: string; error?: string };
        if (res.error) { db.failed++; report.error = `db: ${res.error}`; }
        else if (exists) db.updated++;
        else db.inserted++;
      }
      if (++done % 100 === 0) log(`written ${done}/${rows.length}`);
    }
  }

  // 5) report.
  const postReports = [...rows.map((r) => r.report), ...failures];
  const postsWith = (f: (s: PostReport["stats"]) => boolean) => postReports.filter((p) => f(p.stats)).length;
  const postCounts = new Map<string, number>();
  for (const p of selected) postCounts.set(p.creator, (postCounts.get(p.creator) ?? 0) + 1);
  const report: Report = {
    generatedAt: new Date().toISOString(),
    mode: opts.mode,
    totals: {
      posts_selected: selected.length,
      posts_converted: rows.length,
      posts_failed: failures.length + db.failed,
      skipped_empty_title: skipped.length,
      media_referenced: allFiles.length,
      media_planned: planned,
      media_missing: missingMedia,
      media_uploaded: count("uploaded"),
      media_exists: count("exists"),
      media_unmirrored: unmirrored,
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
      posts_with_unmirrored_media: postsWith((s) => s.unmirroredMedia.length > 0),
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
    skipped,
    posts: postReports,
  };
  report.totals.slug_changes = report.slugChanges.length;
  writeReport(OUT_DIR, report);

  const failed = failures.length + db.failed;
  const dbLine = sb ? ` | db: ${db.inserted} inserted, ${db.updated} updated, ${db.skipped} skipped, ${db.failed} failed` : "";
  log(`posts: ${selected.length} selected, ${rows.length} converted, ${failed} failed, ${skipped.length} skipped | media: ${planned} planned, ${missingMedia} missing${dbLine} | report: ${join(OUT_DIR, "report.md")}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  // Operator errors get their message; anything else is a bug, so show where it came from.
  if (e instanceof CliError) console.error(e.message);
  else console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
