# LoR Domain Cutover (Track 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the code side of the landofredemption.com → Vercel cutover: legacy-URL redirect surface, WP-page import, site identity metadata, real home page, brand assets, sitemap, and a verification harness.

**Architecture:** Hybrid redirects — DB lookups for per-row data (`posts.source_url` already shipped; new `posts.wp_post_id` for `?p=`/`?page_id=`), generated static maps for fixed data (51 WP categories), `next.config.js` rules for fixed paths. 23 WP pages are imported as articles so the existing `app/[wpSlug]` route redirects them for free. The DNS/ops runbook is spec §7 and is NOT part of this plan.

**Tech Stack:** Next.js 15 App Router, Supabase (service role for scripts), vitest, sharp, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-09-06-lor-domain-cutover-design.md` (same branch — read it first; it is the binding authority).

## Global Constraints

- Worktree: ALL work in `/Users/timestes/projects/rtt-lor-cutover` (branch `feat/lor-domain-cutover`), absolute paths only. Another agent may own the main checkout — never touch it.
- **NEVER run `npm install` / `npm ci` here.** `node_modules` is (after Task 0) a symlink into the main checkout; installing would corrupt the sibling's packages.
- Live-write commands (`import-wxr.ts` without `--dry-run`, `backfill-wp-post-ids.ts` without `--dry-run`, the migration) hit **production** Supabase + Blob. Run them exactly as written, dry-run first where a dry-run step exists.
- Migrations 001–096 are applied to prod; this plan adds `100_posts_wp_post_id.sql`. Apply once, via Supabase MCP `apply_migration` (name `posts_wp_post_id`).
- The WXR export and site backup live in the MAIN checkout's gitignored tmp:
  `WXR=/Users/timestes/projects/redemption-tournament-tracker/tmp/landofredemption.WordPress.2026-09-05.xml`
  `BACKUP=/Users/timestes/projects/redemption-tournament-tracker/tmp/public_html`
- `npm run build` is broken on main (`remark-gfm` declared but absent from node_modules — pre-existing). Do not run builds. Type gate = `npx tsc --noEmit` shows **no new errors** vs the main-checkout baseline (8 pre-existing: forge tests + remark-gfm). Route smoke = `npm run dev -- -p 3103` + curl.
- Tests: `npx vitest run <file>` per task (targeted, not the whole suite).
- Git: stage only your own files by exact path (never `-A`/`.`). Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- UI copy/styling: no green accents at rest (green = hover/active only), no `focus:ring-*` on controls, Tailwind tokens (`bg-card`, `text-muted-foreground`, …).
- Do not edit `app/[wpSlug]/page.tsx` or the shipped redirect rules — they are live and correct.

---

### Task 0: Workspace setup (no commit)

**Files:** none (environment only)

- [ ] **Step 1: Symlink node_modules and copy env**

```bash
cd /Users/timestes/projects/rtt-lor-cutover
ln -s /Users/timestes/projects/redemption-tournament-tracker/node_modules node_modules
cp /Users/timestes/projects/redemption-tournament-tracker/.env.local .env.local
```

- [ ] **Step 2: Verify**

Run: `ls node_modules/next/package.json && grep -c NEXT_PUBLIC_SUPABASE_URL .env.local`
Expected: the path prints and count is ≥1. Run `npx vitest run app/articles/lib/__tests__/rss.test.ts` — PASS (proves the toolchain works).

---

### Task 1: Generated WP category map

**Files:**
- Create: `scripts/generate-wp-redirects.ts`
- Create: `lib/wp/categoryMap.ts` (generated, committed)
- Test: `lib/wp/__tests__/categoryMap.test.ts`

**Interfaces:**
- Produces: `CATEGORY_BY_SLUG: Record<string, string>` (WP category nicename → tag name as stored on posts) and `CATEGORY_BY_TERM_ID: Record<string, string>` (WP term id → same), from `@/lib/wp/categoryMap`. Consumed by Task 5 (`CATEGORY_BY_TERM_ID` in the resolver) and Task 6 (`CATEGORY_BY_SLUG` in the category route).

- [ ] **Step 1: Write the failing test** (`lib/wp/__tests__/categoryMap.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { CATEGORY_BY_SLUG, CATEGORY_BY_TERM_ID } from "../categoryMap";

describe("categoryMap", () => {
  it("holds all 51 WordPress categories", () => {
    expect(Object.keys(CATEGORY_BY_SLUG)).toHaveLength(51);
    expect(Object.keys(CATEGORY_BY_TERM_ID)).toHaveLength(51);
  });
  it("maps the known Online Play category (WP term 766)", () => {
    expect(CATEGORY_BY_SLUG["online-play"]).toBe("Online Play");
    expect(CATEGORY_BY_TERM_ID["766"]).toBe("Online Play");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/wp/__tests__/categoryMap.test.ts` — FAIL (cannot resolve `../categoryMap`).

- [ ] **Step 3: Write the generator** (`scripts/generate-wp-redirects.ts`)

```ts
/**
 * Generates lib/wp/categoryMap.ts from the WordPress WXR export (spec §1).
 * Dev-only; the output is committed so runtime never needs the export.
 * Usage: npx tsx scripts/generate-wp-redirects.ts --wxr <path>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { XMLParser } from "fast-xml-parser";
import he from "he";

const { values } = parseArgs({ options: { wxr: { type: "string" } } });
if (!values.wxr) throw new Error("--wxr <path to WXR export> is required");

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (name) => name === "wp:category",
});
type Node = Record<string, unknown>;
const text = (v: unknown): string =>
  v == null ? "" : typeof v === "object" ? text((v as Node)["#text"]) : String(v);

const channel = parser.parse(readFileSync(values.wxr, "utf8")).rss.channel as Node;
const cats = ((channel["wp:category"] as Node[]) ?? [])
  .map((c) => ({
    termId: text(c["wp:term_id"]).trim(),
    slug: text(c["wp:category_nicename"]).trim(),
    name: he.decode(text(c["wp:cat_name"])).replace(/\s+/g, " ").trim(),
  }))
  .filter((c) => c.termId && c.slug && c.name)
  .sort((a, b) => a.slug.localeCompare(b.slug));

const record = (entries: [string, string][]) =>
  "{\n" + entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n") + "\n}";

writeFileSync(
  "lib/wp/categoryMap.ts",
  `// GENERATED by scripts/generate-wp-redirects.ts from the WordPress WXR export — do not edit by hand.
// WP category nicename (URL slug) → the tag name the import stored on posts.
export const CATEGORY_BY_SLUG: Record<string, string> = ${record(cats.map((c) => [c.slug, c.name]))};

// WP term id (the ?cat= query value) → the same tag name.
export const CATEGORY_BY_TERM_ID: Record<string, string> = ${record(
    [...cats].sort((a, b) => Number(a.termId) - Number(b.termId)).map((c) => [c.termId, c.name]),
  )};
`,
);
console.log(`wrote lib/wp/categoryMap.ts with ${cats.length} categories`);
```

- [ ] **Step 4: Generate and make the test pass**

Run: `npx tsx scripts/generate-wp-redirects.ts --wxr /Users/timestes/projects/redemption-tournament-tracker/tmp/landofredemption.WordPress.2026-09-05.xml`
Expected: "wrote lib/wp/categoryMap.ts with 51 categories".
Run: `npx vitest run lib/wp/__tests__/categoryMap.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-wp-redirects.ts lib/wp/categoryMap.ts lib/wp/__tests__/categoryMap.test.ts
git commit -m "feat(redirects): generated WP category map (slug + term id -> tag name)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `parseWxr` postType option

**Files:**
- Modify: `scripts/lib/wxr/parse.ts` (the `parseWxr` / `readWxr` exports)
- Test: `scripts/lib/wxr/__tests__/parse-pages.test.ts` (new file; do not touch existing tests)

**Interfaces:**
- Produces: `parseWxr(xml, opts?: { postType?: "post" | "page" })` and `readWxr(path, opts?)` — default `"post"` keeps every existing caller byte-identical. Consumed by Task 3 (backfill) and Task 4 (importer).

- [ ] **Step 1: Write the failing test** (`scripts/lib/wxr/__tests__/parse-pages.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { parseWxr } from "../parse";

const WXR = `<?xml version="1.0"?>
<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <item>
    <title>A Post</title><link>https://example.com/a-post/</link>
    <wp:post_id>10</wp:post_id><wp:post_name><![CDATA[a-post]]></wp:post_name>
    <wp:post_type><![CDATA[post]]></wp:post_type><wp:status><![CDATA[publish]]></wp:status>
    <dc:creator><![CDATA[tim]]></dc:creator><content:encoded><![CDATA[<p>post body</p>]]></content:encoded>
    <excerpt:encoded><![CDATA[]]></excerpt:encoded>
    <wp:post_date_gmt>2020-01-01 00:00:00</wp:post_date_gmt><wp:post_date>2020-01-01 00:00:00</wp:post_date>
    <wp:post_modified_gmt>2020-01-01 00:00:00</wp:post_modified_gmt>
  </item>
  <item>
    <title>A Page</title><link>https://example.com/a-page/</link>
    <wp:post_id>20</wp:post_id><wp:post_name><![CDATA[a-page]]></wp:post_name>
    <wp:post_type><![CDATA[page]]></wp:post_type><wp:status><![CDATA[publish]]></wp:status>
    <dc:creator><![CDATA[tim]]></dc:creator><content:encoded><![CDATA[<p>page body</p>]]></content:encoded>
    <excerpt:encoded><![CDATA[]]></excerpt:encoded>
    <wp:post_date_gmt>2021-01-01 00:00:00</wp:post_date_gmt><wp:post_date>2021-01-01 00:00:00</wp:post_date>
    <wp:post_modified_gmt>2021-01-01 00:00:00</wp:post_modified_gmt>
  </item>
</channel></rss>`;

describe("parseWxr postType", () => {
  it("defaults to posts only", () => {
    const out = parseWxr(WXR);
    expect(out.posts.map((p) => p.slug)).toEqual(["a-post"]);
  });
  it("selects pages when asked", () => {
    const out = parseWxr(WXR, { postType: "page" });
    expect(out.posts.map((p) => p.slug)).toEqual(["a-page"]);
    expect(out.posts[0].wpId).toBe("20");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run scripts/lib/wxr/__tests__/parse-pages.test.ts` — the second case FAILS (opts ignored, returns the post).

- [ ] **Step 3: Implement**

In `scripts/lib/wxr/parse.ts`:
- `export function parseWxr(xml: string, opts: { postType?: "post" | "page" } = {}): WxrExport` — add `const postType = opts.postType ?? "post";` at the top.
- Change the filter line `if (type !== "post" || status !== "publish") continue;` to `if (type !== postType || status !== "publish") continue;`
- `export function readWxr(path: string, opts: { postType?: "post" | "page" } = {}): WxrExport { return parseWxr(readFileSync(path, "utf8"), opts); }`
No other changes.

- [ ] **Step 4: Run tests to verify they pass (and nothing broke)**

Run: `npx vitest run scripts/lib/wxr` — ALL PASS (existing wxr tests included).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/wxr/parse.ts scripts/lib/wxr/__tests__/parse-pages.test.ts
git commit -m "feat(wxr): parseWxr/readWxr postType option (post | page)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration 097 + wp_post_id backfill

**Files:**
- Create: `supabase/migrations/100_posts_wp_post_id.sql`
- Create: `scripts/backfill-wp-post-ids.ts`

**Interfaces:**
- Consumes: `readWxr(path, { postType })` from Task 2; `serviceClient` from `scripts/lib/wxr/db.ts` (existing).
- Produces: `posts.wp_post_id integer unique` populated for every row whose `source_url` matches a WXR item link. Consumed by Task 4 (page rows get stamped on its backfill re-run) and Task 5 (the `?p=` lookup).

- [ ] **Step 1: Write the migration** (`supabase/migrations/100_posts_wp_post_id.sql`)

```sql
-- WordPress post/page id, for legacy short-link redirects (/?p=<id>, /?page_id=<id>).
-- Backfilled from the WXR export by scripts/backfill-wp-post-ids.ts; the app only reads it.
alter table public.posts add column wp_post_id integer unique;
```

- [ ] **Step 2: Apply it to prod**

Via Supabase MCP `apply_migration` (name `posts_wp_post_id`) if MCP tools are available to you; otherwise `source .env.local && psql "$POSTGRES_URL_NON_POOLING" -f supabase/migrations/100_posts_wp_post_id.sql`. Verify: `execute_sql` → `select column_name from information_schema.columns where table_name='posts' and column_name='wp_post_id';` returns one row.

- [ ] **Step 3: Write the backfill script** (`scripts/backfill-wp-post-ids.ts`)

```ts
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

  const db = serviceClient();
  const { data: rows, error } = await db.from("posts").select("id, source_url, wp_post_id").limit(5000);
  if (error) throw error;

  let stamped = 0, already = 0, unmatched = 0;
  for (const row of rows ?? []) {
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
```

(If `serviceClient` in `scripts/lib/wxr/db.ts` has a different signature — e.g. takes args or is named differently — adapt the two call sites to it; do not modify db.ts.)

- [ ] **Step 4: Dry-run, then live**

Run: `npx tsx scripts/backfill-wp-post-ids.ts --dry-run --wxr /Users/timestes/projects/redemption-tournament-tracker/tmp/landofredemption.WordPress.2026-09-05.xml`
Expected: `stamped` ≈ 1286, `unmatched` small (posts whose source_url isn't a WXR link — should be 0). If `unmatched` > 15, STOP and report — the matching assumption is wrong.
Then run without `--dry-run`. Then re-run: expected `already` ≈ 1286, `stamped` 0 (idempotency proof).
Verify the ranking short link: Supabase MCP `execute_sql` → `select slug from posts where wp_post_id = 3582;` returns one row.

- [ ] **Step 5: tsc gate and commit**

Run: `npx tsc --noEmit 2>&1 | tail -5` — same 8 pre-existing errors, nothing new.

```bash
git add supabase/migrations/100_posts_wp_post_id.sql scripts/backfill-wp-post-ids.ts
git commit -m "feat(redirects): posts.wp_post_id (migration 097) + WXR backfill script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Import 23 WP pages as articles (`--pages` mode)

**Files:**
- Modify: `scripts/import-wxr.ts` (CLI options + the one `readWxr(` call site)
- Modify: `app/decklist/generate/DeckSourcePicker.tsx:239`
- Modify: `app/register/page.tsx:223`

**Interfaces:**
- Consumes: `readWxr(path, { postType })` (Task 2); backfill script (Task 3).
- Produces: 23 new `posts` rows with `source_url` + (after backfill re-run) `wp_post_id` — which makes `app/[wpSlug]` and `?page_id=` redirects work for them with no further code.

- [ ] **Step 1: Add the `--pages` flag**

In `scripts/import-wxr.ts`:
- `parseArgs` options: add `pages: { type: "boolean", default: false }`.
- `Options` interface: add `pages: boolean;` and set it in `parseOptions()` (`const pages = values.pages === true;`).
- Validation in `parseOptions()`: `if (pages && onlySlugs.length === 0) throw new CliError("--pages requires --only <slug,...> — pages are imported by explicit allowlist (spec §2 Group B)");`
- Find the single `readWxr(` call in the main flow and pass `{ postType: opts.pages ? "page" : "post" }`.
- Update the `USAGE` string and header comment to mention `--pages`.
No other importer changes — pages have no `category`-domain terms (tags come out empty) and rarely a `_thumbnail_id` (cover null); both are already handled paths.

- [ ] **Step 2: Existing tests still pass**

Run: `npx vitest run scripts/lib/wxr` — ALL PASS.

- [ ] **Step 3: Dry-run the pages import**

```bash
npx tsx scripts/import-wxr.ts --dry-run --pages \
  --wxr /Users/timestes/projects/redemption-tournament-tracker/tmp/landofredemption.WordPress.2026-09-05.xml \
  --backup /Users/timestes/projects/redemption-tournament-tracker/tmp/public_html \
  --only about-us,about-redemption,formats,hello-im-new,retailers,set-releases,nationals-2024-data,installing-lackey-with-redemption-plugin,israels-inheritance-draft-breakdown,israels-inheritance-israels-rebellion-with-roots-draft-breakdown,terms-of-service,privacy-policy,zachthejambis-card-viewer,2015-national-tournament-t1-2p-1st-place-deck,2015-national-tournament-t1-2p-2nd-place-deck,2015-national-tournament-t1-2p-3rd-place-deck,2015-national-tournament-t1-2p-4th-place-deck,2015-national-tournament-t1-2p-7th-place-deck,2015-national-tournament-t2-2p-1st-place-deck,2015-national-tournament-t2-2p-2nd-place-deck,2015-national-tournament-t2-mp-1st-place-deck,2015-national-tournament-t2-mp-2nd-place-deck,2015-national-tournament-t2-mp-3rd-place-deck
```

Read `scripts/output/wxr/report.md`. Expected: 23 planned. Check `zachthejambis-card-viewer` specifically — if its converted body is an empty embed shell (no real prose), REMOVE it from `--only` for the live run and note it in your report (spec §2 allows dropping it to Group C).

- [ ] **Step 4: Live import + backfill re-run** (LIVE against prod)

Re-run the Step 3 command without `--dry-run` (adjusted `--only` if the card viewer was dropped). Expected: 23 (or 22) inserted, 0 failed.
Then: `npx tsx scripts/backfill-wp-post-ids.ts --wxr /Users/timestes/projects/redemption-tournament-tracker/tmp/landofredemption.WordPress.2026-09-05.xml` — `stamped` equals the pages just imported.
Verify via Supabase MCP `execute_sql`: `select count(*) from posts where wp_post_id is not null;` ≈ 1286 + pages; and `select slug from posts where wp_post_id = 13724;` returns `formats`.

- [ ] **Step 5: Repoint the two hardcoded in-app links**

- `app/decklist/generate/DeckSourcePicker.tsx:239`: `href="https://landofredemption.com/installing-lackey-with-redemption-plugin/"` → `href="/articles/installing-lackey-with-redemption-plugin"` (keep the surrounding element as-is).
- `app/register/page.tsx:223`: `href="https://landofredemption.com/2026-redemption-national-tournament-wilmore-ky/"` → `href="/articles/2026-redemption-national-tournament-wilmore-ky"` — but FIRST verify `select slug from posts where slug = '2026-redemption-national-tournament-wilmore-ky';` returns a row (it is an imported 2026 post). If the slug differs, use the slug from `select slug from posts where source_url = 'https://landofredemption.com/2026-redemption-national-tournament-wilmore-ky/';`.

- [ ] **Step 6: Commit**

```bash
git add scripts/import-wxr.ts app/decklist/generate/DeckSourcePicker.tsx app/register/page.tsx
git commit -m "feat(wxr): --pages import mode; import WP pages as articles; repoint in-app LoR links

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Legacy query-param resolver on the root page

**Files:**
- Create: `lib/wp/legacyParams.ts`
- Modify: `app/page.tsx`
- Test: `lib/wp/__tests__/legacyParams.test.ts`

**Interfaces:**
- Consumes: `CATEGORY_BY_TERM_ID` (Task 1); `posts.wp_post_id` (Tasks 3–4).
- Produces: `resolveLegacyWpParams(params, lookupSlugByWpId)` from `@/lib/wp/legacyParams` returning `{ kind: "none" } | { kind: "not-found" } | { kind: "redirect"; to: string }`. Task 8 (home page) keeps this wiring verbatim.

- [ ] **Step 1: Write the failing tests** (`lib/wp/__tests__/legacyParams.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { resolveLegacyWpParams } from "../legacyParams";

const lookup = async (id: number) => (id === 3582 ? "using-dominants" : null);

describe("resolveLegacyWpParams", () => {
  it("ignores requests without legacy params", async () => {
    expect(await resolveLegacyWpParams({}, lookup)).toEqual({ kind: "none" });
  });
  it("redirects ?p= to the article", async () => {
    expect(await resolveLegacyWpParams({ p: "3582" }, lookup)).toEqual({
      kind: "redirect", to: "/articles/using-dominants",
    });
  });
  it("treats ?page_id= identically", async () => {
    expect(await resolveLegacyWpParams({ page_id: "3582" }, lookup)).toEqual({
      kind: "redirect", to: "/articles/using-dominants",
    });
  });
  it("404s unknown and garbage ids", async () => {
    expect(await resolveLegacyWpParams({ p: "999999" }, lookup)).toEqual({ kind: "not-found" });
    expect(await resolveLegacyWpParams({ p: "abc" }, lookup)).toEqual({ kind: "not-found" });
    expect(await resolveLegacyWpParams({ p: "-1" }, lookup)).toEqual({ kind: "not-found" });
  });
  it("redirects ?cat= via the category map and 404s unknown terms", async () => {
    expect(await resolveLegacyWpParams({ cat: "766" }, lookup)).toEqual({
      kind: "redirect", to: "/articles?tag=Online%20Play",
    });
    expect(await resolveLegacyWpParams({ cat: "424242" }, lookup)).toEqual({ kind: "not-found" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/wp/__tests__/legacyParams.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement** (`lib/wp/legacyParams.ts`)

```ts
import { CATEGORY_BY_TERM_ID } from "./categoryMap";

export type LegacyWpResolution =
  | { kind: "none" }
  | { kind: "not-found" }
  | { kind: "redirect"; to: string };

/**
 * Resolves WordPress query-style URLs that only ever existed on the site root:
 * /?p=<id> and /?page_id=<id> short links (via posts.wp_post_id) and /?cat=<id>
 * category links (via the generated term-id map). A present-but-unresolvable
 * param is a 404, never a fall-through to the home page (soft-404 rule, spec §1).
 */
export async function resolveLegacyWpParams(
  params: { p?: string; page_id?: string; cat?: string },
  lookupSlugByWpId: (id: number) => Promise<string | null>,
): Promise<LegacyWpResolution> {
  const rawId = params.p ?? params.page_id;
  if (rawId !== undefined) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id < 1) return { kind: "not-found" };
    const slug = await lookupSlugByWpId(id);
    return slug ? { kind: "redirect", to: `/articles/${slug}` } : { kind: "not-found" };
  }
  if (params.cat !== undefined) {
    const name = CATEGORY_BY_TERM_ID[params.cat.trim()];
    return name
      ? { kind: "redirect", to: `/articles?tag=${encodeURIComponent(name)}` }
      : { kind: "not-found" };
  }
  return { kind: "none" };
}
```

- [ ] **Step 4: Tests pass**

Run: `npx vitest run lib/wp/__tests__/legacyParams.test.ts` — PASS.

- [ ] **Step 5: Wire into `app/page.tsx`**

Extend the `searchParams` type with `p?: string; page_id?: string; cat?: string`, and insert AFTER the existing `code`/`error` blocks, BEFORE the final `redirect("/decklist/community")`:

```tsx
  const legacy = await resolveLegacyWpParams(searchParams, async (id) => {
    const { data } = await createAnonClient()
      .from("posts").select("slug").eq("wp_post_id", id).maybeSingle();
    return data?.slug ?? null;
  });
  if (legacy.kind === "not-found") notFound();
  if (legacy.kind === "redirect") permanentRedirect(legacy.to);
```

with imports `import { notFound, permanentRedirect, redirect } from "next/navigation";`, `import { createAnonClient } from "@/utils/supabase/anon";`, `import { resolveLegacyWpParams } from "@/lib/wp/legacyParams";`. The `?code=`/`?error=` blocks stay byte-identical and stay first.

- [ ] **Step 6: Dev-server smoke**

Run `npm run dev -- -p 3103` in the background, then:
`curl -sI "http://localhost:3103/?p=3582" | grep -iE '^(HTTP|location)'` → 308 to an `/articles/...` slug.
`curl -sI "http://localhost:3103/?cat=766"` → 308 to `/articles?tag=Online%20Play`.
`curl -s -o /dev/null -w '%{http_code}' "http://localhost:3103/?p=999999"` → 404.
`curl -sI "http://localhost:3103/"` → 307 to `/decklist/community` (unchanged). Kill the dev server.

- [ ] **Step 7: Commit**

```bash
git add lib/wp/legacyParams.ts lib/wp/__tests__/legacyParams.test.ts app/page.tsx
git commit -m "feat(redirects): resolve WP ?p=/?page_id=/?cat= short links on the root

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Category route + static redirect rules

**Files:**
- Create: `app/category/[slug]/page.tsx`
- Modify: `next.config.js` (redirects array + stale header comment)

**Interfaces:**
- Consumes: `CATEGORY_BY_SLUG` (Task 1).

- [ ] **Step 1: Category route** (`app/category/[slug]/page.tsx`)

```tsx
import { notFound, permanentRedirect } from "next/navigation";
import { CATEGORY_BY_SLUG } from "@/lib/wp/categoryMap";

/**
 * Old WordPress category archives (/category/<slug>/). Categories were imported
 * as article tags, so each maps to the tag-filtered article list. Unknown slugs
 * 404 (spec §1). Tag/author archives get no route at all — deliberate 404s.
 */
export default async function LegacyCategoryRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const name = CATEGORY_BY_SLUG[slug.toLowerCase()];
  if (!name) notFound();
  permanentRedirect(`/articles?tag=${encodeURIComponent(name)}`);
}
```

- [ ] **Step 2: Static rules in `next.config.js`**

Append inside the existing `redirects()` array, after the `/rankings/` entry (matching the shipped both-slash-variant style):

```js
      // Remaining WordPress pages with a fixed tracker home (Track 1 spec §2 Group A).
      { source: '/deck-lists', destination: '/decklist/community', permanent: true },
      { source: '/deck-lists/', destination: '/decklist/community', permanent: true },
      { source: '/resources-old', destination: '/resources', permanent: true },
      { source: '/resources-old/', destination: '/resources', permanent: true },
      { source: '/home-2', destination: '/', permanent: true },
      { source: '/home-2/', destination: '/', permanent: true },
      // WordPress feed + sitemap surfaces (spec §1).
      { source: '/comments/feed', destination: '/articles/feed.xml', permanent: true },
      { source: '/comments/feed/', destination: '/articles/feed.xml', permanent: true },
      { source: '/category/:slug/feed', destination: '/articles/feed.xml', permanent: true },
      { source: '/category/:slug/feed/', destination: '/articles/feed.xml', permanent: true },
      { source: '/wp-sitemap.xml', destination: '/sitemap.xml', permanent: true },
      { source: '/wp-sitemap-:rest', destination: '/sitemap.xml', permanent: true },
      { source: '/sitemap_index.xml', destination: '/sitemap.xml', permanent: true },
```

- [ ] **Step 3: Fix the stale header comment**

Replace the comment block at the top of `next.config.js` (the one claiming "redemptionccg.app staying canonical") with:

```js
// landofredemption.com is becoming this app's canonical domain (Track 1 spec:
// docs/superpowers/specs/2026-09-06-lor-domain-cutover-design.md); redemptionccg.app
// 308s to it at the Vercel domain level, preserving path + query, so these rules
// only need to run once, on the canonical host.
```

- [ ] **Step 4: Dev-server smoke** (restart dev on 3103; config changes need a restart)

`curl -sI http://localhost:3103/category/online-play | grep -iE '^(HTTP|location)'` → 308 to `/articles?tag=Online%20Play`.
`curl -s -o /dev/null -w '%{http_code}' http://localhost:3103/category/not-a-category` → 404.
`curl -sI http://localhost:3103/deck-lists | grep location` → `/decklist/community`.
`curl -sI http://localhost:3103/wp-sitemap-posts-post-1.xml | grep location` → `/sitemap.xml`.
`curl -sI http://localhost:3103/category/podcast/feed | grep location` → `/articles/feed.xml`.
`curl -s -o /dev/null -w '%{http_code}' http://localhost:3103/tag/anything` → 404.
Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/category/[slug]/page.tsx next.config.js
git commit -m "feat(redirects): WP category archives, page rules, feed + sitemap redirects

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Site identity metadata + canonicals + Article JSON-LD

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/articles/[slug]/page.tsx`
- Modify (canonical additions only): `app/articles/page.tsx`, `app/rulings/page.tsx`, `app/resources/page.tsx`, `app/sponsors/page.tsx`, `app/spoilers/page.tsx`, `app/tournaments/page.tsx`, `app/decklist/community/page.tsx`

**Interfaces:**
- Produces: the `%s | Land of Redemption` title template every later page (incl. Task 8's home) relies on.

- [ ] **Step 1: `app/layout.tsx` metadata**

Replace the `metadata` export (keep `defaultUrl` as the fallback):

```ts
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || defaultUrl;

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments",
    template: "%s | Land of Redemption",
  },
  description:
    "Deck builder, tournament tracker, articles, and rulings for the Redemption collectible card game.",
};
```

- [ ] **Step 2: Article page metadata + JSON-LD** (`app/articles/[slug]/page.tsx`)

In `generateMetadata`: not-found title → `"Article not found"`; `title: post.title` (the template appends the site name — drop the hand-appended `- RedemptionCCG App`); `openGraph.siteName: "Land of Redemption"`; add `alternates: { canonical: \`/articles/${slug}\` }`.
In the page component, add inside the rendered article wrapper (top):

```tsx
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: post.title,
            datePublished: post.published_at ?? undefined,
            author: { "@type": "Person", name: postByline(post) },
            ...(post.cover_image_url ? { image: [post.cover_image_url] } : {}),
          }),
        }}
      />
```

(`postByline` is already imported/available in this file's module scope — check, and import from `../lib/queries` if not.)

- [ ] **Step 3: Canonicals on the indexed surfaces**

For each of the seven listed `page.tsx` files: if it exports `metadata`, merge `alternates: { canonical: "<route path>" }` in; if it exports `generateMetadata`, add the field to its return; if it has neither, add `export const metadata = { alternates: { canonical: "<route path>" } };`. Canonical paths: `/articles`, `/rulings`, `/resources`, `/sponsors`, `/spoilers`, `/tournaments`, `/decklist/community`. (Relative paths — `metadataBase` absolutizes them.) If one of the files doesn't exist at that exact path, find the page component that serves the route (`ls app/<segment>`) and put it there.

- [ ] **Step 4: Title sweep**

Run: `grep -rn "RedemptionCCG App" app --include="*.tsx" --include="*.ts"`. For hits inside **metadata objects only** (titles, siteName): remove the suffix / rename to Land of Redemption per the pattern above. Leave UI copy (visible text, emails, nav) untouched.

- [ ] **Step 5: Verify**

`npx tsc --noEmit` — no new errors. Dev server: `curl -s http://localhost:3103/articles/<slug from Task 3 Step 4's wp_post_id=3582 query> | grep -o '<title>[^<]*</title>'` → `... | Land of Redemption`; `grep -c 'application/ld+json'` on the same HTML → ≥1; `curl -s http://localhost:3103/rulings | grep -o 'rel="canonical"[^>]*'` shows the canonical link. Kill the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx "app/articles/[slug]/page.tsx" app/articles/page.tsx app/rulings/page.tsx app/resources/page.tsx app/sponsors/page.tsx app/spoilers/page.tsx app/tournaments/page.tsx app/decklist/community/page.tsx
git commit -m "feat(seo): Land of Redemption site identity, canonicals, Article JSON-LD

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Adjust the `git add` list to the files actually touched in Steps 3–4.)

---

### Task 8: Home page + brand wordmark

**Files:**
- Create: `public/brand/lor-wordmark.webp` (copied asset)
- Modify: `app/page.tsx` (replace the final redirect with a rendered page; everything added in Task 5 stays)

**Interfaces:**
- Consumes: `resolveLegacyWpParams` wiring (Task 5, kept verbatim), `loadPublishedPosts` + `PostCard` from `app/articles`, title template (Task 7).

- [ ] **Step 1: Check in the wordmark**

```bash
mkdir -p /Users/timestes/projects/rtt-lor-cutover/public/brand
cp /Users/timestes/projects/redemption-tournament-tracker/tmp/lor-icon.webp /Users/timestes/projects/rtt-lor-cutover/public/brand/lor-wordmark.webp
```

(900×244 webp, white wordmark + red R-slash on transparency — dark backgrounds only.)

- [ ] **Step 2: Rewrite `app/page.tsx`**

Keep the `?code=`/`?error=` blocks and the Task 5 legacy-param block exactly as they are; replace only the trailing `redirect("/decklist/community")` and add the render. Target shape:

```tsx
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { createAnonClient } from "@/utils/supabase/anon";
import { resolveLegacyWpParams } from "@/lib/wp/legacyParams";
import { loadPublishedPosts } from "@/app/articles/lib/queries";
import PostCard from "@/app/articles/components/PostCard";

export const metadata: Metadata = {
  title: { absolute: "Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments" },
  alternates: { canonical: "/" },
};

const LINKS = [
  { href: "/decklist", title: "Deck Builder", desc: "Build, validate, and share Redemption decks." },
  { href: "/tournaments", title: "Tournaments", desc: "Events, standings, and live pairings." },
  { href: "/play", title: "Play Online", desc: "Play Redemption in your browser." },
  { href: "/rulings", title: "Rulings", desc: "Search official card rulings." },
  { href: "/resources", title: "Resources", desc: "Rulebooks, guides, and player documents." },
] as const;

export default async function Home(props: {
  searchParams: Promise<{
    code?: string; error?: string; error_description?: string;
    p?: string; page_id?: string; cat?: string;
  }>;
}) {
  const searchParams = await props.searchParams;

  // (existing ?code= and ?error= blocks — unchanged)

  // (Task 5 legacy WP param block — unchanged)

  const { posts } = await loadPublishedPosts({ page: 1 });
  const latest = posts.slice(0, 5);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8">
      <section className="rounded-xl bg-zinc-950 px-6 py-10 sm:px-10">
        <h1 className="sr-only">
          Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments
        </h1>
        <img
          src="/brand/lor-wordmark.webp"
          alt=""
          aria-hidden
          width={450}
          height={122}
          className="h-auto w-full max-w-md"
        />
        <p className="mt-6 max-w-2xl text-zinc-300">
          Strategy, deck building, and tournaments for Redemption — the collectible card
          game of biblical battles. Build and share decks, register for events, read
          player articles, and play online.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-lg border bg-card p-4 transition-colors hover:border-primary"
          >
            <div className="font-semibold">{l.title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{l.desc}</p>
          </Link>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Latest articles</h2>
          <Link href="/articles" className="text-sm text-muted-foreground hover:text-foreground">
            All articles →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {latest.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

Match `PostCard`'s grid classes to how `app/articles/page.tsx` lays them out if they differ. No green at rest; `hover:border-primary` is the only accent.

- [ ] **Step 3: Verify**

`npx tsc --noEmit` — no new errors. Dev server on 3103:
`curl -s http://localhost:3103/ | grep -c 'lor-wordmark\|Latest articles'` → ≥2; `curl -sI "http://localhost:3103/?p=3582" | grep location` still 308s (params still win); `curl -sI "http://localhost:3103/?code=x" | grep location` → `/auth/callback...`. Take a look: `mcp playwright` or a screenshot is NOT required; the controller reviews the diff. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add public/brand/lor-wordmark.webp app/page.tsx
git commit -m "feat(home): real landing page — LoR wordmark hero, latest articles, section links

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: OG image + app icon

**Files:**
- Create: `scripts/generate-brand-assets.ts`
- Create: `app/opengraph-image.png`, `app/opengraph-image.alt.txt`
- Overwrite: `app/icon.png`

- [ ] **Step 1: Write the generator** (`scripts/generate-brand-assets.ts`)

```ts
/**
 * One-off: renders the default OG card and the app icon from the LoR wordmark
 * (public/brand/lor-wordmark.webp). Outputs are committed; re-run only if the
 * wordmark changes. Usage: npx tsx scripts/generate-brand-assets.ts
 */
import sharp from "sharp";

const WORDMARK = "public/brand/lor-wordmark.webp";
const BG = { r: 19, g: 19, b: 22, alpha: 1 }; // #131316 — near-black, matches dark theme

async function og() {
  const mark = await sharp(WORDMARK).resize({ width: 760 }).png().toBuffer();
  const m = await sharp(mark).metadata();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: BG } })
    .composite([{
      input: mark,
      left: Math.round((1200 - (m.width ?? 760)) / 2),
      top: Math.round((630 - (m.height ?? 206)) / 2),
    }])
    .png()
    .toFile("app/opengraph-image.png");
}

async function icon() {
  // Bounding box of the red slash mark (the only red pixels in the image); the
  // white R sits inside that rect, so extracting the rect keeps both.
  const { data, info } = await sharp(WORDMARK).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a > 128 && r > 150 && r > 2 * g && r > 2 * b) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) throw new Error("no red mark found in wordmark");
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const mark = await sharp(WORDMARK).extract({ left: minX, top: minY, width: w, height: h }).png().toBuffer();
  const size = Math.round(Math.max(w, h) * 1.35);
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: mark, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) }])
    .resize(512, 512)
    .png()
    .toFile("app/icon.png");
}

og().then(icon).then(() => console.log("wrote app/opengraph-image.png + app/icon.png"));
```

- [ ] **Step 2: Run it and eyeball the outputs**

Run: `npx tsx scripts/generate-brand-assets.ts`. Then Read both PNGs (they render as images): the OG card must show the full wordmark centered on near-black; the icon must show the red slash + white R, not clipped, on the dark tile. If the icon crop looks wrong, adjust the padding factor (1.35) or report — do not ship a bad icon; leaving `app/icon.png` unchanged (revert it) is the fallback.

- [ ] **Step 3: Alt text**

Write `app/opengraph-image.alt.txt` containing exactly: `Land of Redemption`

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-brand-assets.ts app/opengraph-image.png app/opengraph-image.alt.txt app/icon.png
git commit -m "feat(brand): default OG card + LoR app icon generated from the wordmark

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Articles in the sitemap + robots

**Files:**
- Modify: `app/sitemap.ts`
- Modify: `public/robots.txt`

- [ ] **Step 1: `app/sitemap.ts`**

Change the base-URL chain to prefer the explicit site URL:

```ts
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
```

Add to `staticRoutes`: `{ url: \`${baseUrl}/articles\`, changeFrequency: "daily", priority: 0.8 }`.
After the spoiler query, add:

```ts
  // Dynamic routes: published articles (the imported WordPress archive + new posts)
  const { data: posts } = await supabase
    .from("posts")
    .select("slug, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(5000);

  const articleRoutes: MetadataRoute.Sitemap = (posts ?? []).map((post) => ({
    url: `${baseUrl}/articles/${post.slug}`,
    lastModified: post.published_at ?? undefined,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
```

and include `...articleRoutes` in the returned array.

- [ ] **Step 2: `public/robots.txt`**

Append at the end:

```
Sitemap: https://landofredemption.com/sitemap.xml
```

- [ ] **Step 3: Verify**

Dev server: `curl -s http://localhost:3103/sitemap.xml | grep -c '/articles/'` → ≥1200. `npx tsc --noEmit` — no new errors. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/sitemap.ts public/robots.txt
git commit -m "feat(seo): published articles in the sitemap; robots Sitemap line

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: URL inventory + verification harness

**Files:**
- Create: `scripts/capture-lor-inventory.ts`
- Create: `scripts/data/lor-url-inventory.json` (captured, committed)
- Create: `scripts/verify-lor-redirects.ts`

**Interfaces:**
- Produces: `scripts/verify-lor-redirects.ts --base <url>` — exit 0 = every legacy URL behaves per spec. Re-run post-cutover against `https://landofredemption.com` (runbook step 7).

- [ ] **Step 1: Capture script** (`scripts/capture-lor-inventory.ts`)

```ts
/**
 * Captures every URL WordPress advertises (wp-sitemap.xml sub-sitemaps) into
 * scripts/data/lor-url-inventory.json with the outcome the tracker must produce
 * (spec §1–2, §8). Run while the WordPress site is still up; output is committed.
 * Usage: npx tsx scripts/capture-lor-inventory.ts
 */
import { writeFileSync } from "node:fs";

type Entry = { url: string; expect: 200 | 404 };
const ORIGIN = "https://landofredemption.com";
// Group C pages + drafts: no tracker home, deliberate 404s (spec §2).
const GONE_PAGES = new Set(["activity", "access-restricted"]);

const locs = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

function classify(url: string): Entry {
  const path = new URL(url).pathname;
  // tags + authors were never imported; /type/ is WP's post_format archive — also no home
  if (path.startsWith("/tag/") || path.startsWith("/author/") || path.startsWith("/type/")) return { url, expect: 404 };
  const slug = path.replaceAll("/", "");
  if (GONE_PAGES.has(slug)) return { url, expect: 404 };
  return { url, expect: 200 };
}

const EXTRA: Entry[] = [
  { url: `${ORIGIN}/?p=3582`, expect: 200 },        // the ranking short link
  { url: `${ORIGIN}/?p=999999`, expect: 404 },
  { url: `${ORIGIN}/?page_id=13724`, expect: 200 }, // formats (imported page)
  { url: `${ORIGIN}/?cat=766`, expect: 200 },       // Online Play
  { url: `${ORIGIN}/?cat=424242`, expect: 404 },
  { url: `${ORIGIN}/feed/`, expect: 200 },
  { url: `${ORIGIN}/comments/feed/`, expect: 200 },
  { url: `${ORIGIN}/category/podcast/feed/`, expect: 200 },
  { url: `${ORIGIN}/wp-sitemap.xml`, expect: 200 },
  { url: `${ORIGIN}/our-sponsors/`, expect: 200 },
  { url: `${ORIGIN}/deck-lists/`, expect: 200 },
  { url: `${ORIGIN}/home-2/`, expect: 200 },
];

async function main() {
  const index = await (await fetch(`${ORIGIN}/wp-sitemap.xml`)).text();
  const subs = locs(index);
  if (subs.length === 0) throw new Error("wp-sitemap.xml returned no sub-sitemaps — is WordPress still up?");
  const entries: Entry[] = [...EXTRA];
  for (const sub of subs) {
    const xml = await (await fetch(sub)).text();
    for (const url of locs(xml)) entries.push(classify(url));
  }
  const dedup = [...new Map(entries.map((e) => [e.url, e])).values()];
  writeFileSync("scripts/data/lor-url-inventory.json", JSON.stringify(dedup, null, 1) + "\n");
  const n404 = dedup.filter((e) => e.expect === 404).length;
  console.log(`captured ${dedup.length} URLs (${n404} expected 404) from ${subs.length} sub-sitemaps`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the capture** (network: the live WP site)

Run: `npx tsx scripts/capture-lor-inventory.ts`
Expected: ~2,500–2,700 URLs (≈1,298 posts + ~34 pages + 51 categories + 1,182 tags + users), tags+authors as the 404s. Spot-check the JSON: the home URL `https://landofredemption.com/` (from the pages sub-sitemap) must be `expect: 200`.

- [ ] **Step 3: Verify script** (`scripts/verify-lor-redirects.ts`)

```ts
/**
 * Replays the captured WordPress URL inventory against a tracker host and asserts
 * each URL's final status (following ≤5 redirect hops) matches the expectation.
 * Usage: npx tsx scripts/verify-lor-redirects.ts --base http://localhost:3103
 *        npx tsx scripts/verify-lor-redirects.ts --base https://landofredemption.com
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

type Entry = { url: string; expect: 200 | 404 };
const { values } = parseArgs({ options: { base: { type: "string" }, concurrency: { type: "string", default: "10" } } });
if (!values.base) throw new Error("--base <url> is required");
const base = values.base.replace(/\/$/, "");

async function finalStatus(url: string): Promise<number> {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(current, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res.status;
      current = new URL(loc, current).toString();
      continue;
    }
    return res.status;
  }
  return 599; // redirect loop / too many hops
}

async function main() {
  const entries: Entry[] = JSON.parse(readFileSync("scripts/data/lor-url-inventory.json", "utf8"));
  const failures: { url: string; expect: number; got: number }[] = [];
  let done = 0;
  const queue = [...entries];
  const workers = Array.from({ length: Number(values.concurrency) }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const mapped = e.url.replace(/^https?:\/\/landofredemption\.com/, base);
      const got = await finalStatus(mapped);
      if (got !== e.expect) failures.push({ url: mapped, expect: e.expect, got });
      if (++done % 250 === 0) console.log(`${done}/${entries.length}...`);
    }
  });
  await Promise.all(workers);
  if (failures.length) {
    console.error(`\n${failures.length} FAILURES:`);
    for (const f of failures.slice(0, 60)) console.error(` expect ${f.expect} got ${f.got}  ${f.url}`);
    if (failures.length > 60) console.error(` ...and ${failures.length - 60} more`);
    process.exit(1);
  }
  console.log(`all ${entries.length} URLs behave as expected against ${base}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run against the local dev server** (prod data, all branch code)

Start `npm run dev -- -p 3103`, wait for ready, then:
`npx tsx scripts/verify-lor-redirects.ts --base http://localhost:3103`
Known deltas, not bugs: the 11 armadon-theme spam posts (deleted from the tracker on 2026-09-06) and the empty-title spam post wpId 12819 are still in WordPress's sitemap but were never/no-longer imported — their URLs correctly 404. For each such failure confirm `select count(*) from posts where source_url = '<url>'` is 0, then edit that inventory entry to `"expect": 404` and add `"note": "spam, not imported"`. Beyond those ~12, expected: 0 failures (dev compile latency may make the first requests slow — that's fine). If a class of URLs fails (e.g. all `/category/...`), fix the responsible task's code, don't edit expectations. Individual stragglers (a WP URL shape we never mapped) are findings: list them in your report with a proposed disposition rather than silently reclassifying. Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add scripts/capture-lor-inventory.ts scripts/data/lor-url-inventory.json scripts/verify-lor-redirects.ts
git commit -m "feat(redirects): WP URL inventory capture + redirect verification harness

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Final gates

**Files:** none new.

- [ ] **Step 1: Full targeted test pass**

Run: `npx vitest run lib/wp scripts/lib/wxr app/articles` — ALL PASS.

- [ ] **Step 2: Type baseline**

Run `npx tsc --noEmit 2>&1 | sort > /private/tmp/claude-501/-Users-timestes-projects-redemption-tournament-tracker/9ea9dd44-ebc6-4d17-a10d-c1142aa1fabe/scratchpad/branch-tsc.txt` here and the same in `/Users/timestes/projects/redemption-tournament-tracker` (read-only) to `.../main-tsc.txt`; `diff` them. Expected: identical (the 8 pre-existing errors only).

- [ ] **Step 3: Whole-flow smoke on 3103**

One dev-server session: `/` renders the home page; `/?p=3582`, `/category/online-play`, `/deck-lists`, `/wp-sitemap.xml`, `/installing-lackey-with-redemption-plugin` all 308 to the right places; `/tag/x`, `/activity`, `/?p=999999` 404; `/sitemap.xml` contains `/articles/`; an article page carries JSON-LD + canonical. Kill the server.

- [ ] **Step 4: Push** (no PR yet — the controller/Tim decides when)

```bash
git push -u origin feat/lor-domain-cutover
```
