# WordPress (WXR) Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the 1,298 published landofredemption.com posts into `public.posts` with original bylines, dates, categories as tags, and media mirrored to Vercel Blob, so they render through the existing `/articles` feature.

**Architecture:** A one-off CLI (`scripts/import-wxr.ts`) over a pure conversion library (`scripts/lib/wxr/`): parse the WXR → preprocess WordPress HTML (reusable blocks, shortcodes, wpautop for classic posts) → rewrite site URLs to the Blob mirror and internal links → turndown to markdown with custom rules for WordPress blocks → assemble `posts` rows → mirror media → insert via the service role. A small schema change (migration 096) adds `author_name` (byline override) and a unique constraint on `source_url` (idempotency key), and the public byline reads `author_name` first.

**Tech Stack:** TypeScript run with `tsx`, `fast-xml-parser` 5, `turndown` 7 + `turndown-plugin-gfm`, `he`, `@vercel/blob`, `@supabase/supabase-js` (service role + `auth.admin`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-wxr-import-design.md` — the authority; every section number below (§n) refers to it.

## Global Constraints

- Work only inside the worktree `/Users/timestes/projects/rtt-wxr-import` (branch `feat/wxr-import`), always with absolute paths. Never touch `/Users/timestes/projects/redemption-tournament-tracker` except to READ the export at `/Users/timestes/projects/redemption-tournament-tracker/tmp/landofredemption.WordPress.2026-09-05.xml` and the backup at `/Users/timestes/projects/redemption-tournament-tracker/tmp/public_html/`.
- **Never run `scripts/import-wxr.ts` without `--dry-run`, and never with `--media-only`.** Both other modes write to production Supabase and Vercel Blob. Only the controller runs live.
- Never run `next build` (a dev server may be running elsewhere). Type gate: `npx tsc --noEmit` — exactly 7 pre-existing errors (3 in `__tests__/forge-anon-leak.test.ts`, 4 in `app/forge/lib/__tests__/playDecksAuthorize.test.ts`) are expected; anything else is yours. Note `tsconfig.json` excludes `scripts/`, so script code is only checked by its tests.
- Tests: `npx vitest run <path>` for the files you touch; the articles subset is `npx vitest run app/articles app/admin/posts`.
- `git add` only the files you changed (never `-A`, `.`, `-a`). Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Markdown produced by the converter must be pure markdown: the renderer (`app/articles/components/ArticleBody.tsx`) escapes raw HTML (no rehype-raw). A bare YouTube URL on its own paragraph becomes the embed; a link to an audio file becomes a player.
- Slug rule: `SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/`, `MAX_SLUG = 80` (from `app/articles/lib/markdown.ts`). Tags go through `normalizeTags` from `app/admin/posts/lib/validate.ts` (`MAX_TAGS = 10`, `MAX_TAG_LEN = 40`). Title 1–200 chars, excerpt ≤ 500.
- `@/` resolves to the repo root (tsconfig paths, vitest alias, tsx honours tsconfig paths).
- The four libraries are already installed in the worktree (`package.json`/`package-lock.json` are modified and uncommitted); Task 2 commits them.
- Do not edit `.env.local`.

---

### Task 1: Migration 096 and the byline

**Files:**
- Create: `supabase/migrations/096_posts_import_columns.sql`
- Modify: `app/articles/lib/queries.ts`, `app/articles/components/PostCard.tsx`, `app/articles/[slug]/page.tsx`, `app/articles/lib/rss.ts`, `app/articles/lib/__tests__/rss.test.ts`
- Test: `app/articles/lib/__tests__/byline.test.ts`

**Interfaces:**
- Produces: `PublicPost.author_name: string | null`; `postByline(post: Pick<PublicPost, "author_name" | "author">): string` exported from `app/articles/lib/queries.ts`.

- [ ] **Step 1: Write the migration** (§4)

```sql
-- 096_posts_import_columns.sql
-- WordPress import support. Spec: docs/superpowers/specs/2026-09-06-wxr-import-design.md §4
alter table public.posts
  add column author_name text
    check (author_name is null or char_length(author_name) between 1 and 80);
comment on column public.posts.author_name is
  'Byline override, set by the WordPress import; the editor never writes it.';

-- PostgREST upsert (on_conflict=source_url) needs a real unique index on the
-- column; a partial index would not be inferred. NULLs are distinct, so posts
-- created in the editor (source_url null) are unaffected.
alter table public.posts add constraint posts_source_url_key unique (source_url);
```

Do NOT apply it; the controller applies it to production.

- [ ] **Step 2: Write the failing byline test**

`app/articles/lib/__tests__/byline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { postByline } from "../queries";

describe("postByline", () => {
  it("prefers author_name over the profile username", () => {
    expect(postByline({ author_name: "Tyler Stevens", author: { username: "tstevens" } })).toBe("Tyler Stevens");
  });
  it("falls back to the username", () => {
    expect(postByline({ author_name: null, author: { username: "TimE" } })).toBe("TimE");
  });
  it("falls back to the site name when both are missing", () => {
    expect(postByline({ author_name: null, author: { username: null } })).toBe("Land of Redemption");
    expect(postByline({ author_name: null, author: null })).toBe("Land of Redemption");
  });
});
```

- [ ] **Step 3: Run it to see it fail** — `npx vitest run app/articles/lib/__tests__/byline.test.ts` → FAIL (`postByline` is not exported).

- [ ] **Step 4: Implement** in `app/articles/lib/queries.ts`: add `author_name: string | null;` to `PublicPost` (after `author_id`), add `author_name` to the `COLUMNS` string (after `author_id`), and add:

```ts
/** Byline: the import's author_name, else the owner's username, else the site name. */
export function postByline(post: Pick<PublicPost, "author_name" | "author">): string {
  return post.author_name ?? post.author?.username ?? "Land of Redemption";
}
```

Then replace the three byline expressions:
- `PostCard.tsx`: `{post.author?.username ?? "Land of Redemption"} · {formatPostDate(post.published_at)}` → `{postByline(post)} · {formatPostDate(post.published_at)}` (import `postByline` next to `postExcerpt`).
- `app/articles/[slug]/page.tsx`: `authors: post.author?.username ? [post.author.username] : undefined` → `authors: [postByline(post)]`, and `by {post.author?.username ?? "Land of Redemption"}` → `by {postByline(post)}`.
- `rss.ts`: `escapeXml(p.author?.username ?? "Land of Redemption")` → `escapeXml(postByline(p))`.

Update the fixture object(s) in `rss.test.ts` to include `author_name: null` (the type now requires it) and add one assertion: a post with `author_name: "Jayden"` yields `<dc:creator>Jayden</dc:creator>`.

- [ ] **Step 5: Verify** — `npx vitest run app/articles app/admin/posts` → all pass; `npx tsc --noEmit` → only the 7 known errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/096_posts_import_columns.sql app/articles/lib/queries.ts app/articles/components/PostCard.tsx "app/articles/[slug]/page.tsx" app/articles/lib/rss.ts app/articles/lib/__tests__/rss.test.ts app/articles/lib/__tests__/byline.test.ts
git commit -m "feat(articles): author_name byline override and unique source_url for the import"
```

---

### Task 2: Dependencies, gitignore, and the WXR parser

**Files:**
- Modify: `package.json`, `package-lock.json` (already changed on disk), `.gitignore`
- Create: `scripts/lib/wxr/parse.ts`, `scripts/lib/wxr/__tests__/fixtures/mini.xml`
- Test: `scripts/lib/wxr/__tests__/parse.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WxrAuthor { login: string; email: string; displayName: string }
export interface WxrPost {
  wpId: string; title: string; link: string; slug: string; creator: string;
  content: string; excerpt: string; dateGmt: string; date: string; modifiedGmt: string;
  categories: string[];          // display names, entity-decoded
  thumbnailId: string | null;    // postmeta _thumbnail_id
}
export interface WxrExport {
  authors: WxrAuthor[];
  posts: WxrPost[];                    // post_type=post AND status=publish only
  attachments: Map<string, string>;    // wp:post_id → wp:attachment_url
  blocks: Map<string, string>;         // wp_block post_id → content:encoded
}
export function parseWxr(xml: string): WxrExport;
export function readWxr(path: string): WxrExport;
```

- [ ] **Step 1: gitignore** — append to `.gitignore`:

```
# WordPress import artifacts (scripts/import-wxr.ts)
scripts/output/wxr/
```

- [ ] **Step 2: Fixture** `scripts/lib/wxr/__tests__/fixtures/mini.xml` (WXR 1.2 shape; keep the namespaces exactly):

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
	xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
	xmlns:content="http://purl.org/rss/1.0/modules/content/"
	xmlns:wfw="http://wellformedweb.org/CommentAPI/"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:wp="http://wordpress.org/export/1.2/"
>
<channel>
	<title>Land of Redemption</title>
	<wp:wxr_version>1.2</wp:wxr_version>
	<wp:author><wp:author_id>1</wp:author_id><wp:author_login><![CDATA[admin]]></wp:author_login><wp:author_email><![CDATA[Gabe@LandOfRedemption.com]]></wp:author_email><wp:author_display_name><![CDATA[Gabe]]></wp:author_display_name></wp:author>
	<wp:author><wp:author_id>7</wp:author_id><wp:author_login><![CDATA[TimE]]></wp:author_login><wp:author_email><![CDATA[timothestes@gmail.com]]></wp:author_email><wp:author_display_name><![CDATA[BaboonyTim]]></wp:author_display_name></wp:author>
	<item>
		<title>YTG Q&amp;A | 2016</title>
		<link>https://landofredemption.com/ytg-qa-2016/</link>
		<dc:creator><![CDATA[admin]]></dc:creator>
		<content:encoded><![CDATA[<p>Hi &amp; bye</p>]]></content:encoded>
		<excerpt:encoded><![CDATA[<p>Short &amp; sweet</p>]]></excerpt:encoded>
		<wp:post_id>2016</wp:post_id>
		<wp:post_date><![CDATA[2016-05-01 10:00:00]]></wp:post_date>
		<wp:post_date_gmt><![CDATA[2016-05-01 17:00:00]]></wp:post_date_gmt>
		<wp:post_modified_gmt><![CDATA[2016-05-02 01:02:03]]></wp:post_modified_gmt>
		<wp:post_name><![CDATA[ytg-qa-2016]]></wp:post_name>
		<wp:status><![CDATA[publish]]></wp:status>
		<wp:post_type><![CDATA[post]]></wp:post_type>
		<category domain="category" nicename="fun-funny"><![CDATA[Fun &amp; funny]]></category>
		<category domain="category" nicename="news"><![CDATA[News]]></category>
		<category domain="post_tag" nicename="t1"><![CDATA[t1]]></category>
		<wp:postmeta><wp:meta_key><![CDATA[_thumbnail_id]]></wp:meta_key><wp:meta_value><![CDATA[55]]></wp:meta_value></wp:postmeta>
	</item>
	<item>
		<title>Classic post</title>
		<link>https://landofredemption.com/classic-post/</link>
		<dc:creator><![CDATA[TimE]]></dc:creator>
		<content:encoded><![CDATA[Line one
Line two

Para two]]></content:encoded>
		<excerpt:encoded><![CDATA[]]></excerpt:encoded>
		<wp:post_id>2017</wp:post_id>
		<wp:post_date><![CDATA[2017-01-01 00:00:00]]></wp:post_date>
		<wp:post_date_gmt><![CDATA[0000-00-00 00:00:00]]></wp:post_date_gmt>
		<wp:post_modified_gmt><![CDATA[2017-01-01 00:00:00]]></wp:post_modified_gmt>
		<wp:post_name><![CDATA[classic-post]]></wp:post_name>
		<wp:status><![CDATA[publish]]></wp:status>
		<wp:post_type><![CDATA[post]]></wp:post_type>
		<category domain="category" nicename="news"><![CDATA[News]]></category>
	</item>
	<item>
		<title>A draft</title>
		<link>https://landofredemption.com/?p=3</link>
		<dc:creator><![CDATA[TimE]]></dc:creator>
		<content:encoded><![CDATA[draft]]></content:encoded>
		<wp:post_id>3</wp:post_id>
		<wp:post_name><![CDATA[a-draft]]></wp:post_name>
		<wp:status><![CDATA[draft]]></wp:status>
		<wp:post_type><![CDATA[post]]></wp:post_type>
	</item>
	<item>
		<title>About</title>
		<link>https://landofredemption.com/about/</link>
		<dc:creator><![CDATA[admin]]></dc:creator>
		<content:encoded><![CDATA[page]]></content:encoded>
		<wp:post_id>4</wp:post_id>
		<wp:post_name><![CDATA[about]]></wp:post_name>
		<wp:status><![CDATA[publish]]></wp:status>
		<wp:post_type><![CDATA[page]]></wp:post_type>
	</item>
	<item>
		<title>cover</title>
		<wp:post_id>55</wp:post_id>
		<wp:status><![CDATA[inherit]]></wp:status>
		<wp:post_type><![CDATA[attachment]]></wp:post_type>
		<wp:attachment_url><![CDATA[https://landofredemption.com/wp-content/uploads/2016/05/cover.jpg]]></wp:attachment_url>
	</item>
	<item>
		<title>SPONSORS!</title>
		<wp:post_id>14682</wp:post_id>
		<content:encoded><![CDATA[<!-- wp:paragraph -->
<p><strong><em>Please <a href="https://landofredemption.com/?page_id=11455">visit our sponsors</a>!</em></strong></p>
<!-- /wp:paragraph -->]]></content:encoded>
		<wp:status><![CDATA[publish]]></wp:status>
		<wp:post_type><![CDATA[wp_block]]></wp:post_type>
	</item>
</channel>
</rss>
```

- [ ] **Step 3: Failing tests** `scripts/lib/wxr/__tests__/parse.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWxr } from "../parse";

const xml = readFileSync(join(__dirname, "fixtures/mini.xml"), "utf8");

describe("parseWxr", () => {
  const out = parseWxr(xml);
  it("reads authors with lower-cased emails", () => {
    expect(out.authors).toEqual([
      { login: "admin", email: "gabe@landofredemption.com", displayName: "Gabe" },
      { login: "TimE", email: "timothestes@gmail.com", displayName: "BaboonyTim" },
    ]);
  });
  it("keeps only published posts (no drafts, pages, attachments, blocks)", () => {
    expect(out.posts.map((p) => p.slug)).toEqual(["ytg-qa-2016", "classic-post"]);
  });
  it("decodes the title and category names, keeps CDATA content raw", () => {
    const p = out.posts[0];
    expect(p.title).toBe("YTG Q&A | 2016");
    expect(p.categories).toEqual(["Fun & funny", "News"]);
    expect(p.content).toBe("<p>Hi &amp; bye</p>");
    expect(p.excerpt).toBe("<p>Short &amp; sweet</p>");
  });
  it("carries ids, dates, creator, link and thumbnail", () => {
    const p = out.posts[0];
    expect(p).toMatchObject({ wpId: "2016", creator: "admin", link: "https://landofredemption.com/ytg-qa-2016/", dateGmt: "2016-05-01 17:00:00", date: "2016-05-01 10:00:00", modifiedGmt: "2016-05-02 01:02:03", thumbnailId: "55" });
    expect(out.posts[1].thumbnailId).toBeNull();
    expect(out.posts[1].excerpt).toBe("");
  });
  it("maps attachments and reusable blocks by id", () => {
    expect(out.attachments.get("55")).toBe("https://landofredemption.com/wp-content/uploads/2016/05/cover.jpg");
    expect(out.blocks.get("14682")).toContain("visit our sponsors");
  });
  it("rejects a non-WXR document", () => {
    expect(() => parseWxr("<html></html>")).toThrow(/WXR/);
  });
});
```

- [ ] **Step 4: Run** → FAIL (module missing).

- [ ] **Step 5: Implement** `scripts/lib/wxr/parse.ts`:

```ts
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import he from "he";

export interface WxrAuthor { login: string; email: string; displayName: string }
export interface WxrPost {
  wpId: string; title: string; link: string; slug: string; creator: string;
  content: string; excerpt: string; dateGmt: string; date: string; modifiedGmt: string;
  categories: string[]; thumbnailId: string | null;
}
export interface WxrExport {
  authors: WxrAuthor[]; posts: WxrPost[];
  attachments: Map<string, string>; blocks: Map<string, string>;
}

type Node = Record<string, unknown>;
// fast-xml-parser gives a string for text-only elements and { "#text", "@_attr" } when attributes exist.
const text = (v: unknown): string =>
  v == null ? "" : typeof v === "object" ? text((v as Node)["#text"]) : String(v);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T]);
const clean = (s: string) => he.decode(s).replace(/\s+/g, " ").trim();

export function parseWxr(xml: string): WxrExport {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false, // keep "2016" a string
    trimValues: false,    // content whitespace is meaningful for classic posts
    isArray: (name) => ["item", "category", "wp:postmeta", "wp:author"].includes(name),
  });
  const doc = parser.parse(xml) as Node;
  const channel = (doc.rss as Node | undefined)?.channel;
  if (!channel || typeof channel !== "object") throw new Error("Not a WXR document: rss/channel missing");
  const ch = channel as Node;

  const authors: WxrAuthor[] = list<Node>(ch["wp:author"]).map((a) => ({
    login: text(a["wp:author_login"]).trim(),
    email: text(a["wp:author_email"]).trim().toLowerCase(),
    displayName: clean(text(a["wp:author_display_name"])),
  }));

  const posts: WxrPost[] = [];
  const attachments = new Map<string, string>();
  const blocks = new Map<string, string>();
  for (const it of list<Node>(ch.item)) {
    const type = text(it["wp:post_type"]).trim();
    const status = text(it["wp:status"]).trim();
    const wpId = text(it["wp:post_id"]).trim();
    if (type === "attachment") {
      const url = text(it["wp:attachment_url"]).trim();
      if (url) attachments.set(wpId, url);
      continue;
    }
    if (type === "wp_block") { blocks.set(wpId, text(it["content:encoded"])); continue; }
    if (type !== "post" || status !== "publish") continue;

    let thumbnailId: string | null = null;
    for (const m of list<Node>(it["wp:postmeta"])) {
      if (text(m["wp:meta_key"]).trim() === "_thumbnail_id") thumbnailId = text(m["wp:meta_value"]).trim() || null;
    }
    const categories = list<Node>(it.category)
      .filter((c) => c["@_domain"] === "category")
      .map((c) => clean(text(c)))
      .filter(Boolean);
    posts.push({
      wpId,
      title: clean(text(it.title)),
      link: text(it.link).trim(),
      slug: text(it["wp:post_name"]).trim(),
      creator: text(it["dc:creator"]).trim(),
      content: text(it["content:encoded"]),
      excerpt: text(it["excerpt:encoded"]),
      dateGmt: text(it["wp:post_date_gmt"]).trim(),
      date: text(it["wp:post_date"]).trim(),
      modifiedGmt: text(it["wp:post_modified_gmt"]).trim(),
      categories,
      thumbnailId,
    });
  }
  return { authors, posts, attachments, blocks };
}

export function readWxr(path: string): WxrExport {
  return parseWxr(readFileSync(path, "utf8"));
}
```

- [ ] **Step 6: Run** `npx vitest run scripts/lib/wxr` → PASS. Also sanity-check against the real export from the worktree (read-only):

```bash
npx tsx -e 'import { readWxr } from "./scripts/lib/wxr/parse"; const e = readWxr("/Users/timestes/projects/redemption-tournament-tracker/tmp/landofredemption.WordPress.2026-09-05.xml"); console.log(e.authors.length, e.posts.length, e.attachments.size, e.blocks.size)'
```
Expected: `85 1298 6891 5` (85 author records; 84 of them have published posts).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore scripts/lib/wxr/parse.ts scripts/lib/wxr/__tests__/parse.test.ts scripts/lib/wxr/__tests__/fixtures/mini.xml
git commit -m "feat(wxr): WXR parser and import dependencies"
```

---

### Task 3: wpautop and the HTML preprocess pass

**Files:**
- Create: `scripts/lib/wxr/wpautop.ts`, `scripts/lib/wxr/preprocess.ts`
- Test: `scripts/lib/wxr/__tests__/wpautop.test.ts`, `scripts/lib/wxr/__tests__/preprocess.test.ts`

**Interfaces:**
- Produces: `wpautop(text: string): string`; `preprocess(raw: string, blocks: Map<string, string>): PreprocessResult` with `interface PreprocessResult { html: string; classic: boolean; dropped: Record<string, number>; unknownRefs: string[] }`.

- [ ] **Step 1: Failing wpautop tests**

```ts
import { describe, expect, it } from "vitest";
import { wpautop } from "../wpautop";

describe("wpautop", () => {
  it("wraps bare paragraphs and turns single newlines into <br />", () => {
    expect(wpautop("Line one\nLine two\n\nPara two")).toBe("<p>Line one<br />\nLine two</p>\n\n<p>Para two</p>");
  });
  it("leaves block-level chunks alone and splits around them", () => {
    expect(wpautop("<h3>Heroes</h3>\n<a href=\"x\">Levi</a>\n<a href=\"y\">Ehud</a>")).toBe(
      '<h3>Heroes</h3>\n\n<p><a href="x">Levi</a><br />\n<a href="y">Ehud</a></p>',
    );
  });
  it("keeps existing <p> and <pre> content untouched", () => {
    expect(wpautop("<p>Already</p>\n\n<pre>a\nb</pre>")).toBe("<p>Already</p>\n\n<pre>a\nb</pre>");
  });
  it("normalises CRLF and drops empty chunks", () => {
    expect(wpautop("a\r\n\r\n\r\nb")).toBe("<p>a</p>\n\n<p>b</p>");
    expect(wpautop("   ")).toBe("");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `scripts/lib/wxr/wpautop.ts` (a port of the parts of WordPress's `wpautop` that classic posts here rely on; spec §10.1 step 6). The `<pre>` placeholder uses a NUL-delimited token written with the `\u0000` escape so it cannot collide with content:

```ts
const BLOCK =
  "p|div|ul|ol|li|h[1-6]|blockquote|table|thead|tbody|tfoot|tr|td|th|figure|figcaption|pre|hr|section|article|iframe|object|dl|dt|dd|address|form|fieldset";
const OPEN = new RegExp(`(<(?:${BLOCK})\\b[^>]*>)`, "gi");
const CLOSE = new RegExp(`(</(?:${BLOCK})>)`, "gi");
const STARTS_BLOCK = new RegExp(`^<\\/?(?:${BLOCK})\\b`, "i");
const TOKEN = "\u0000PRE";

/** Classic-editor content is stored without <p>; WordPress adds them at render time. */
export function wpautop(input: string): string {
  if (!input.trim()) return "";
  const pres: string[] = [];
  const s = input
    .replace(/\r\n?/g, "\n")
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, (m) => {
      pres.push(m);
      return `${TOKEN}${pres.length - 1}\u0000`;
    })
    .replace(OPEN, "\n\n$1")
    .replace(CLOSE, "$1\n\n");
  const chunks = s.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  const out = chunks.map((c) => {
    if (STARTS_BLOCK.test(c) || c.startsWith(TOKEN) || c.startsWith("<!--")) return c;
    return `<p>${c.replace(/\n/g, "<br />\n")}</p>`;
  });
  return out.join("\n\n").replace(/\u0000PRE(\d+)\u0000/g, (_m, i) => pres[Number(i)]);
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Failing preprocess tests**

```ts
import { describe, expect, it } from "vitest";
import { preprocess } from "../preprocess";

const blocks = new Map<string, string>([
  ["14682", '<!-- wp:paragraph -->\n<p><strong>Sponsors</strong></p>\n<!-- /wp:paragraph -->'],
  ["9", '<!-- wp:block {"ref":14682} /-->'],
]);

describe("preprocess", () => {
  it("inlines reusable blocks recursively and reports unknown refs", () => {
    const r = preprocess('<!-- wp:block {"ref":9} /--><!-- wp:block {"ref":404} /-->', blocks);
    expect(r.html).toBe("\n<p><strong>Sponsors</strong></p>\n");
    expect(r.unknownRefs).toEqual(["404"]);
    expect(r.classic).toBe(false);
  });
  it("turns a grimlock section into a link paragraph", () => {
    const r = preprocess(
      '<!-- wp:grimlock/section {"thumbnail":15169,"title":"Episode 81","subtitle":"","text":"","button_text":"Listen Here","button_link":"thethreshingfloor.podbean.com/e/ep-81/"} /-->',
      blocks,
    );
    expect(r.html).toBe('<p><a href="https://thethreshingfloor.podbean.com/e/ep-81/">Episode 81 — Listen Here</a></p>');
    expect(preprocess('<!-- wp:grimlock/section {"title":"Solo"} /-->', blocks).html).toBe("<p><strong>Solo</strong></p>");
  });
  it("drops spacer, countdown, rss and empty audio blocks and counts them", () => {
    const r = preprocess(
      '<!-- wp:spacer {"height":"40px"} -->\n<div style="height:40px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer --><!-- wp:audio /--><!-- wp:rss {"feedURL":"x"} /--><!-- wp:paragraph --><p>Keep</p><!-- /wp:paragraph -->',
      blocks,
    );
    expect(r.html).toBe("<p>Keep</p>");
    expect(r.dropped).toEqual({ spacer: 1, "audio(empty)": 1, rss: 1 });
  });
  it("expands youtube, embed and caption shortcodes", () => {
    const r = preprocess(
      '[youtube]https://www.youtube.com/watch?v=65hEWhb2S8E[/youtube]\n\n[caption id="attachment_5479" align="aligncenter" width="600"]<img class="size-full" src="https://landofredemption.com/wp-content/uploads/2016/08/PG.jpg" alt="Alt" width="600" height="429" /> Members at Nationals[/caption]\n\nSet list [2022] stays',
      blocks,
    );
    expect(r.classic).toBe(true);
    expect(r.html).toBe(
      '<p><a href="https://www.youtube.com/watch?v=65hEWhb2S8E">https://www.youtube.com/watch?v=65hEWhb2S8E</a></p>\n\n<figure><img class="size-full" src="https://landofredemption.com/wp-content/uploads/2016/08/PG.jpg" alt="Alt" width="600" height="429" /><figcaption>Members at Nationals</figcaption></figure>\n\n<p>Set list [2022] stays</p>',
    );
  });
  it("removes more-markers and every remaining block comment, then wpautops classic content", () => {
    const r = preprocess("Intro\n\n<!--more-->\n\n<strong>Heroes</strong>\nLevi", blocks);
    expect(r.html).toBe("<p>Intro</p>\n\n<p><strong>Heroes</strong><br />\nLevi</p>");
    const g = preprocess("<!-- wp:more -->\n<!--more-->\n<!-- /wp:more -->\n<!-- wp:paragraph -->\n<p>G</p>\n<!-- /wp:paragraph -->", blocks);
    expect(g.classic).toBe(false);
    expect(g.html.trim()).toBe("<p>G</p>");
  });
});
```

- [ ] **Step 6: Run** → FAIL.

- [ ] **Step 7: Implement** `scripts/lib/wxr/preprocess.ts` (spec §10.1):

```ts
import { wpautop } from "./wpautop";

export interface PreprocessResult { html: string; classic: boolean; dropped: Record<string, number>; unknownRefs: string[] }

const DROP_BLOCKS = ["spacer", "wpdevart-countdown/countdown", "rss"];
const esc = (s: string) => s.replace(/[/\-.]/g, "\\$&");

export function preprocess(raw: string, blocks: Map<string, string>): PreprocessResult {
  const classic = !/<!-- wp:/.test(raw);
  const dropped: Record<string, number> = {};
  const unknownRefs: string[] = [];
  const bump = (k: string) => { dropped[k] = (dropped[k] ?? 0) + 1; };

  // 1) reusable blocks
  const inline = (s: string, depth: number): string =>
    s.replace(/<!-- wp:block \{"ref":(\d+)\} \/-->/g, (_m, ref: string) => {
      const body = blocks.get(ref);
      if (body == null) { unknownRefs.push(ref); return ""; }
      return depth < 5 ? inline(body, depth + 1) : "";
    });
  let html = inline(raw, 0);

  // 2) grimlock sections
  html = html.replace(/<!-- wp:grimlock\/section (\{[\s\S]*?\}) \/-->/g, (_m, json: string) => {
    let a: Record<string, unknown> = {};
    try { a = JSON.parse(json); } catch { bump("grimlock/section(bad-json)"); return ""; }
    const str = (k: string) => String(a[k] ?? "").trim();
    const title = str("title");
    const link = str("button_link");
    if (!link) return title ? `<p><strong>${title}</strong></p>` : "";
    const href = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    const label = [title, str("subtitle"), str("button_text")].filter(Boolean).join(" — ");
    return `<p><a href="${href}">${label}</a></p>`;
  });

  // 3) dropped blocks
  for (const name of DROP_BLOCKS) {
    html = html.replace(new RegExp(`<!-- wp:${esc(name)}(?: \\{[^\\n]*?\\})? \\/-->\\n?`, "g"), () => { bump(name); return ""; });
    html = html.replace(new RegExp(`<!-- wp:${esc(name)}(?: \\{[^\\n]*?\\})? -->[\\s\\S]*?<!-- \\/wp:${esc(name)} -->\\n?`, "g"), () => { bump(name); return ""; });
  }
  html = html.replace(/<!-- wp:audio \/-->\n?/g, () => { bump("audio(empty)"); return ""; });

  // 4) shortcodes
  html = html.replace(/\[(youtube|embed)\]\s*(https?:\/\/\S+?)\s*\[\/\1\]/g, (_m, _t, url: string) => `<p><a href="${url}">${url}</a></p>`);
  html = html.replace(/\[caption\b[^\]]*\]([\s\S]*?)\[\/caption\]/g, (_m, inner: string) => {
    const img = inner.match(/<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>|<img\b[^>]*>/i)?.[0] ?? "";
    const cap = inner.replace(img, "").replace(/<[^>]+>/g, "").trim();
    return `<figure>${img}${cap ? `<figcaption>${cap}</figcaption>` : ""}</figure>`;
  });

  // 5) markers
  html = html.replace(/<!--more-->/g, "").replace(/<!-- \/?wp:[^>]*-->/g, "");

  // 6) classic content
  if (classic) html = wpautop(html);
  return { html, classic, dropped, unknownRefs };
}
```

Adjust whitespace handling until the tests' exact strings pass (the expectations above are the contract; e.g. the "drops" test expects no leftover newlines between removed blocks and `<p>Keep</p>`; the "inlines" test keeps the inner newlines of the block body).

- [ ] **Step 8: Run** `npx vitest run scripts/lib/wxr` → PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/wxr/wpautop.ts scripts/lib/wxr/preprocess.ts scripts/lib/wxr/__tests__/wpautop.test.ts scripts/lib/wxr/__tests__/preprocess.test.ts
git commit -m "feat(wxr): wpautop port and WordPress HTML preprocess pass"
```

---

### Task 4: HTML → Markdown with WordPress block rules

**Files:**
- Create: `scripts/lib/wxr/toMarkdown.ts`
- Test: `scripts/lib/wxr/__tests__/toMarkdown.test.ts`

**Interfaces:**
- Produces: `htmlToMarkdown(html: string): { markdown: string; removedIframes: string[] }`; `measureMarkdown(md: string, mirrorBase: string): MarkdownStats` with `interface MarkdownStats { images: number; links: number; embeds: number; residualHtml: string[]; residualMarkers: string[]; externalImageHosts: string[] }`.

**Turndown fact (verified):** `addRule` puts the rule at the FRONT of the rule list, so the rule added LAST wins when two match the same element. Add the general `figure` rule first and the specific figure rules (gallery, audio figure, embed wrapper) after it. Turndown decodes HTML entities itself, escapes markdown punctuation in text (`\[Job 30:26\]`), and never passes text nodes to rule filters.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { htmlToMarkdown, measureMarkdown } from "../toMarkdown";

const md = (html: string) => htmlToMarkdown(html).markdown;

describe("htmlToMarkdown", () => {
  it("emits an embed wrapper as a bare URL paragraph", () => {
    expect(md('<p>Before</p><figure class="wp-block-embed is-type-video"><div class="wp-block-embed__wrapper">\nhttps://youtu.be/nt36jZqco2Y\n</div></figure><p>After</p>')).toBe(
      "Before\n\nhttps://youtu.be/nt36jZqco2Y\n\nAfter",
    );
  });
  it("turns a YouTube iframe into a watch URL and reports other iframes", () => {
    const r = htmlToMarkdown('<iframe width="560" src="https://www.youtube.com/embed/XqBkP-TcfeU" allowfullscreen></iframe><iframe src="https://example.com/x"></iframe>');
    expect(r.markdown).toBe("https://www.youtube.com/watch?v=XqBkP-TcfeU");
    expect(r.removedIframes).toEqual(["https://example.com/x"]);
  });
  it("renders an image figure with link and caption", () => {
    expect(md('<figure class="wp-block-image size-large"><a href="https://x/full.png"><img src="https://x/v-1024.png" alt=""/></a><figcaption>Cap &amp; tion</figcaption></figure>')).toBe(
      "[![](https://x/v-1024.png)](https://x/full.png)\n*Cap & tion*",
    );
    expect(md('<figure><img src="https://x/a.jpg" alt="Alt"/></figure>')).toBe("![Alt](https://x/a.jpg)");
    expect(md('<figure><a href="https://x/a.jpg"><img src="https://x/a.jpg" alt=""/></a></figure>')).toBe("![](https://x/a.jpg)");
  });
  it("renders a gallery as one image per line", () => {
    expect(md('<figure class="wp-block-gallery"><ul><li class="blocks-gallery-item"><figure><img src="https://x/1.jpg" alt=""/></figure></li><li><figure><img src="https://x/2.jpg" alt="two"/></figure></li></ul></figure>')).toBe(
      "![](https://x/1.jpg)\n\n![two](https://x/2.jpg)",
    );
  });
  it("renders a file block as one link and drops the PDF object and download button", () => {
    expect(md('<div class="wp-block-file"><object class="wp-block-file__embed" data="https://x/a.pdf" type="application/pdf"></object><a id="wp-block-file--media-1" href="https://x/a.pdf">Winners</a><a href="https://x/a.pdf" class="wp-block-file__button" download>Download</a></div>')).toBe(
      "[Winners](https://x/a.pdf)",
    );
  });
  it("renders audio as a link paragraph with its caption", () => {
    expect(md('<figure class="wp-block-audio"><audio controls src="https://x/2022-10-20-vsJohnE.mp3"></audio><figcaption>Audio version.</figcaption></figure>')).toBe(
      "[2022-10-20-vsJohnE.mp3](https://x/2022-10-20-vsJohnE.mp3)\n*Audio version.*",
    );
    expect(md('<p><audio src="https://x/a.mp3"></audio></p>')).toBe("[a.mp3](https://x/a.mp3)");
  });
  it("turns accordion items into headings and drops the icons", () => {
    expect(md('<div class="wp-block-getwid-accordion"><div class="wp-block-getwid-accordion__header-wrapper"><span class="wp-block-getwid-accordion__header"><a href="#"><span class="wp-block-getwid-accordion__header-title">Agur: Nativity</span><span class="wp-block-getwid-accordion__icon is-active"><i class="fas fa-plus"></i></span></a></span></div><div class="wp-block-getwid-accordion__content-wrapper"><div class="wp-block-getwid-accordion__content"><p>Body</p></div></div></div>')).toBe(
      "### Agur: Nativity\n\nBody",
    );
  });
  it("renders buttons as links, demotes h1, drops src-less images, keeps code and tables", () => {
    expect(md('<div class="wp-block-buttons"><div class="wp-block-button"><a class="wp-block-button__link" href="https://r/register">Pre-register</a></div></div>')).toBe("[Pre-register](https://r/register)");
    expect(md("<h1>Top</h1><h2>Sub</h2>")).toBe("## Top\n\n## Sub");
    expect(md('<p>a <img alt="x"/> b</p>')).toMatch(/^a\s+b$/);
    expect(md('<pre class="wp-block-code"><code>1 Chariot\n2 Fire &#91;x]</code></pre>')).toBe("```\n1 Chariot\n2 Fire [x]\n```");
    expect(md("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>")).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
  it("keeps line breaks in deck lists and collapses blank runs", () => {
    expect(md('<p><a class="wp-live-preview" href="https://x/l.jpg">Levi</a><br />\n<a href="https://x/e.jpg">Ehud</a></p>\n\n\n\n<p>End</p>')).toMatch(
      /^\[Levi\]\(https:\/\/x\/l\.jpg\)  \n ?\[Ehud\]\(https:\/\/x\/e\.jpg\)\n\nEnd$/,
    );
  });
});

describe("measureMarkdown", () => {
  it("counts images, links and embeds and lists residual html and external hosts", () => {
    const s = measureMarkdown(
      "![a](https://blob.test/wp/a.jpg) ![b](https://lh7.googleusercontent.com/x) [l](https://x)\n\nhttps://youtu.be/abc\n\n<div>left</div>\n\n```\n<not counted>\n```",
      "https://blob.test",
    );
    expect(s).toEqual({ images: 2, links: 1, embeds: 1, residualHtml: ["<div>"], residualMarkers: [], externalImageHosts: ["lh7.googleusercontent.com"] });
  });
  it("flags leftover WordPress markers", () => {
    expect(measureMarkdown("<!-- wp:paragraph --> [youtube]x[/youtube]", "https://b").residualMarkers).toEqual(["<!-- wp:", "[youtube]"]);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `scripts/lib/wxr/toMarkdown.ts` (spec §10.2–10.3):

```ts
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export interface MarkdownResult { markdown: string; removedIframes: string[] }
export interface MarkdownStats {
  images: number; links: number; embeds: number;
  residualHtml: string[]; residualMarkers: string[]; externalImageHosts: string[];
}

const YT = /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,})/;
const has = (n: HTMLElement, cls: string) => !!n.classList && n.classList.contains(cls);
const attr = (n: Element, name: string) => n.getAttribute(name) ?? "";
const fileName = (url: string) => decodeURIComponent(url.split("?")[0].split("/").pop() || url);
const block = (s: string) => `\n\n${s}\n\n`;
const image = (img: Element) => `![${attr(img, "alt")}](${attr(img, "src")})`;

function figureMarkdown(el: HTMLElement): string {
  const img = el.querySelector("img[src]");
  if (!img) return "";
  const a = img.parentElement && img.parentElement.nodeName === "A" ? attr(img.parentElement, "href") : "";
  const cap = el.querySelector("figcaption")?.textContent?.trim();
  const core = a && a !== attr(img, "src") ? `[${image(img)}](${a})` : image(img);
  return block(cap ? `${core}\n*${cap}*` : core);
}

export function htmlToMarkdown(html: string): MarkdownResult {
  const removedIframes: string[] = [];
  const td = new TurndownService({
    headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-",
    emDelimiter: "*", strongDelimiter: "**", hr: "---",
  });
  td.use(gfm);
  td.remove(["script", "style"]);

  // General rules first; later addRule calls take precedence (see Turndown fact above).
  td.addRule("hashLink", { filter: (n) => n.nodeName === "A" && attr(n, "href") === "#", replacement: (c) => c });
  td.addRule("imgNoSrc", { filter: (n) => n.nodeName === "IMG" && !attr(n, "src"), replacement: () => "" });
  td.addRule("h1", { filter: "h1", replacement: (c) => block(`## ${c.trim()}`) });
  td.addRule("pdfObject", { filter: "object", replacement: () => "" });
  td.addRule("iframe", {
    filter: "iframe",
    replacement: (_c, n) => {
      const src = attr(n, "src");
      const m = src.match(YT);
      if (m) return block(`https://www.youtube.com/watch?v=${m[1]}`);
      removedIframes.push(src);
      return "";
    },
  });
  td.addRule("button", {
    filter: (n) => n.nodeName === "DIV" && has(n, "wp-block-button"),
    replacement: (_c, n) => { const a = n.querySelector("a[href]"); return a ? block(`[${a.textContent!.trim()}](${attr(a, "href")})`) : ""; },
  });
  td.addRule("fileBlock", {
    filter: (n) => n.nodeName === "DIV" && has(n, "wp-block-file"),
    replacement: (_c, n) => {
      const a = Array.from(n.querySelectorAll("a[href]")).find((x) => !x.classList.contains("wp-block-file__button"));
      return a ? block(`[${a.textContent!.trim() || fileName(attr(a, "href"))}](${attr(a, "href")})`) : "";
    },
  });
  td.addRule("accordionIcon", { filter: (n) => has(n, "wp-block-getwid-accordion__icon"), replacement: () => "" });
  td.addRule("accordionTitle", { filter: (n) => has(n, "wp-block-getwid-accordion__header-title"), replacement: (c) => block(`### ${c.trim()}`) });
  td.addRule("audio", {
    filter: (n) => n.nodeName === "AUDIO" && !!attr(n, "src"),
    replacement: (_c, n) => block(`[${fileName(attr(n, "src"))}](${attr(n, "src")})`),
  });
  td.addRule("figure", { filter: (n) => n.nodeName === "FIGURE" && !!n.querySelector("img[src]"), replacement: (_c, n) => figureMarkdown(n) });
  td.addRule("gallery", {
    filter: (n) => n.nodeName === "FIGURE" && has(n, "wp-block-gallery"),
    replacement: (_c, n) => block(Array.from(n.querySelectorAll("img[src]")).map(image).join("\n\n")),
  });
  td.addRule("audioFigure", {
    filter: (n) => n.nodeName === "FIGURE" && !!n.querySelector("audio[src]"),
    replacement: (_c, n) => {
      const src = attr(n.querySelector("audio[src]")!, "src");
      const cap = n.querySelector("figcaption")?.textContent?.trim();
      return block(`[${fileName(src)}](${src})${cap ? `\n*${cap}*` : ""}`);
    },
  });
  td.addRule("embedWrapper", {
    filter: (n) => (n.nodeName === "FIGURE" && has(n, "wp-block-embed")) || (n.nodeName === "DIV" && has(n, "wp-block-embed__wrapper")),
    replacement: (_c, n) => { const url = n.textContent!.trim(); return url ? block(url) : ""; },
  });

  const markdown = td.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
  return { markdown, removedIframes };
}

export function measureMarkdown(md: string, mirrorBase: string): MarkdownStats {
  const noCode = md.replace(/```[\s\S]*?```/g, "");
  const images = [...noCode.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
  const links = (noCode.match(/(?<!!)\[[^\]]*\]\([^)\s]+/g) ?? []).length;
  const embeds = (noCode.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/\S+$/gm) ?? []).length;
  const residualHtml = [...new Set(noCode.match(/<[a-zA-Z][^>]*>/g) ?? [])];
  const residualMarkers = [...new Set(noCode.match(/<!-- \/?wp:|\[youtube\]|\[caption\b|\[embed\]/g) ?? [])];
  const externalImageHosts = [...new Set(images.filter((u) => /^https?:/i.test(u) && !u.startsWith(mirrorBase)).map((u) => new URL(u).host))];
  return { images: images.length, links, embeds, residualHtml, residualMarkers, externalImageHosts };
}
```

- [ ] **Step 4: Run** → PASS (tune whitespace in the replacements until the exact strings match; keep the rule order).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/wxr/toMarkdown.ts scripts/lib/wxr/__tests__/toMarkdown.test.ts
git commit -m "feat(wxr): turndown rules for WordPress blocks and markdown measurement"
```

---

### Task 5: Site file discovery and URL rewriting

**Files:**
- Create: `scripts/lib/wxr/urls.ts`
- Test: `scripts/lib/wxr/__tests__/urls.test.ts`

**Interfaces:**
- Produces:

```ts
export function siteFilePath(url: string): string | null;                 // "/wp-content/uploads/…" | "/podcasts/…" | null
export function blobPathname(sitePath: string): string;                    // "wp/wp-content/uploads/…" (percent-decoded)
export function mirrorUrl(base: string, pathname: string): string;         // base + "/" + each segment encodeURIComponent'd
export function collectSiteFiles(html: string, featured: string | null): string[];  // distinct site paths, document order
export interface RewriteOptions { mirror: (sitePath: string) => string | null; slugMap: Map<string, string> }
export function rewriteUrls(html: string, opts: RewriteOptions): string;
export const SPONSORS_PAGE_ID_RE: RegExp; // https?://(www.)?landofredemption.com/?page_id=11455
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { blobPathname, collectSiteFiles, mirrorUrl, rewriteUrls, siteFilePath } from "../urls";

describe("siteFilePath", () => {
  it("accepts uploads and podcasts on either host and scheme, stripping query and whitespace", () => {
    expect(siteFilePath("https://landofredemption.com/wp-content/uploads/2024/04/agur-1.png?x=1")).toBe("/wp-content/uploads/2024/04/agur-1.png");
    expect(siteFilePath("http://www.landofredemption.com/podcasts/CoW-Primer-with-John.mp3 ")).toBe("/podcasts/CoW-Primer-with-John.mp3");
    expect(siteFilePath("https://landofredemption.com/wp-content/uploads/2015/04/Shamgar_pv.jpg%20")).toBe("/wp-content/uploads/2015/04/Shamgar_pv.jpg");
  });
  it("rejects pages, other hosts and other paths", () => {
    expect(siteFilePath("https://landofredemption.com/about/")).toBeNull();
    expect(siteFilePath("https://redemptionccg.app/wp-content/uploads/x.png")).toBeNull();
    expect(siteFilePath("https://landofredemption.com/wp-content/themes/x.css")).toBeNull();
  });
});

describe("blobPathname / mirrorUrl", () => {
  it("mirrors the site path under wp/ and builds an encoded URL", () => {
    expect(blobPathname("/wp-content/uploads/2016/08/PG%20at%20Nats.jpg")).toBe("wp/wp-content/uploads/2016/08/PG at Nats.jpg");
    expect(mirrorUrl("https://blob.test", "wp/wp-content/uploads/2016/08/PG at Nats.jpg")).toBe("https://blob.test/wp/wp-content/uploads/2016/08/PG%20at%20Nats.jpg");
  });
});

describe("collectSiteFiles", () => {
  it("finds src/href site files in document order, dedupes, and adds the featured image", () => {
    const html = '<a href="https://landofredemption.com/wp-content/uploads/a.jpg"><img src="https://landofredemption.com/wp-content/uploads/a-1024x545.jpg"></a><img src=\'https://landofredemption.com/wp-content/uploads/a.jpg\'><a href="https://example.com/x.jpg">x</a>';
    expect(collectSiteFiles(html, "https://landofredemption.com/wp-content/uploads/cover.png")).toEqual([
      "/wp-content/uploads/a.jpg", "/wp-content/uploads/a-1024x545.jpg", "/wp-content/uploads/cover.png",
    ]);
  });
});

describe("rewriteUrls", () => {
  const mirror = (p: string) => (p.endsWith("missing.jpg") ? null : `https://blob.test/wp${p}`);
  const slugMap = new Map([["old-post", "old-post"], ["a-very-long-original-slug", "a-very-long"]]);
  it("rewrites mirrored site files and leaves missing ones", () => {
    expect(rewriteUrls('<img src="https://landofredemption.com/wp-content/uploads/a.jpg"><img src="https://landofredemption.com/wp-content/uploads/missing.jpg">', { mirror, slugMap })).toBe(
      '<img src="https://blob.test/wp/wp-content/uploads/a.jpg"><img src="https://landofredemption.com/wp-content/uploads/missing.jpg">',
    );
  });
  it("rewrites internal post links to /articles with the final slug and fragment", () => {
    expect(rewriteUrls('<a href="https://www.landofredemption.com/old-post/">a</a><a href="http://landofredemption.com/a-very-long-original-slug#top">b</a><a href="https://landofredemption.com/about/">c</a><a href="https://landofredemption.com/old-post/feed/">d</a>', { mirror, slugMap })).toBe(
      '<a href="/articles/old-post">a</a><a href="/articles/a-very-long#top">b</a><a href="https://landofredemption.com/about/">c</a><a href="https://landofredemption.com/old-post/feed/">d</a>',
    );
  });
  it("rewrites the sponsors page_id link to its permalink", () => {
    expect(rewriteUrls('<a href="https://landofredemption.com/?page_id=11455">s</a>', { mirror, slugMap })).toBe('<a href="https://landofredemption.com/our-sponsors/">s</a>');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `scripts/lib/wxr/urls.ts` (spec §9):

```ts
const SITE = "https?:\\/\\/(?:www\\.)?landofredemption\\.com";
const FILE_RE = new RegExp(`^${SITE}(\\/(?:wp-content\\/uploads|podcasts)\\/[^?#]+)`, "i");
const POST_RE = new RegExp(`^${SITE}\\/([a-z0-9-]+)\\/?(#.*)?$`, "i");
export const SPONSORS_PAGE_ID_RE = new RegExp(`^${SITE}\\/\\?page_id=11455$`, "i");
const SPONSORS_URL = "https://landofredemption.com/our-sponsors/";
const ATTR_RE = /\b(src|href)=("|')([^"']*)\2/g;

export function siteFilePath(url: string): string | null {
  const m = url.trim().match(FILE_RE);
  if (!m) return null;
  return m[1].replace(/(?:\s|%20)+$/i, "");
}
export const blobPathname = (sitePath: string) => `wp${decodeURIComponent(sitePath)}`;
export const mirrorUrl = (base: string, pathname: string) =>
  `${base.replace(/\/$/, "")}/${pathname.split("/").map(encodeURIComponent).join("/")}`;

export function collectSiteFiles(html: string, featured: string | null): string[] {
  const out: string[] = [];
  const add = (u: string | null) => { const p = u && siteFilePath(u); if (p && !out.includes(p)) out.push(p); };
  for (const m of html.matchAll(ATTR_RE)) add(m[3]);
  add(featured);
  return out;
}

export interface RewriteOptions { mirror: (sitePath: string) => string | null; slugMap: Map<string, string> }

export function rewriteUrls(html: string, { mirror, slugMap }: RewriteOptions): string {
  return html.replace(ATTR_RE, (whole, name: string, q: string, value: string) => {
    const file = siteFilePath(value);
    if (file) { const u = mirror(file); return u ? `${name}=${q}${u}${q}` : whole; }
    if (SPONSORS_PAGE_ID_RE.test(value.trim())) return `${name}=${q}${SPONSORS_URL}${q}`;
    const post = value.trim().match(POST_RE);
    if (post && slugMap.has(post[1])) return `${name}=${q}/articles/${slugMap.get(post[1])}${post[2] ?? ""}${q}`;
    return whole;
  });
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/wxr/urls.ts scripts/lib/wxr/__tests__/urls.test.ts
git commit -m "feat(wxr): site file discovery, Blob mirror paths and URL rewriting"
```

---

### Task 6: Row assembly, slugs, dates, and the author map

**Files:**
- Create: `scripts/lib/wxr/assemble.ts`, `scripts/data/wxr-authors.json`
- Test: `scripts/lib/wxr/__tests__/assemble.test.ts`

**Interfaces:**
- Consumes: `WxrPost` (Task 2), `normalizeTags` from `@/app/admin/posts/lib/validate`, `SLUG_RE`/`MAX_SLUG` from `@/app/articles/lib/markdown`.
- Produces:

```ts
export interface AuthorMapEntry { login: string; name: string; email: string | null }
export function loadAuthorMap(path: string): AuthorMapEntry[];           // throws on bad shape / duplicate logins
export function truncateSlug(slug: string, max?: number): string;
export function finalSlugs(posts: { slug: string }[]): Map<string, string>; // original → final (validates SLUG_RE, throws listing offenders)
export function wpDateToIso(gmt: string, fallback: string): string;      // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS.000Z"
export interface ImportRow {
  slug: string; title: string; excerpt: string | null; body_md: string; cover_image_url: string | null;
  tags: string[]; status: "published" | "draft"; author_id: string | null; author_name: string;
  published_at: string; created_at: string; updated_at: string; source_url: string;
}
export function assemblePost(post: WxrPost, ctx: { finalSlug: string; authorId: string | null; authorName: string; bodyMd: string; coverUrl: string | null; status: "published" | "draft" }): ImportRow;
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { assemblePost, finalSlugs, truncateSlug, wpDateToIso, loadAuthorMap } from "../assemble";
import type { WxrPost } from "../parse";
import { join } from "node:path";

const base: WxrPost = {
  wpId: "1", title: "T", link: "https://landofredemption.com/t/", slug: "t", creator: "admin", content: "", excerpt: "",
  dateGmt: "2016-05-01 17:00:00", date: "2016-05-01 10:00:00", modifiedGmt: "2016-05-02 01:02:03", categories: ["News", "Fun & funny", "news"], thumbnailId: null,
};

describe("truncateSlug", () => {
  it("keeps short slugs, cuts long ones at a hyphen, strips trailing hyphens", () => {
    expect(truncateSlug("short-slug")).toBe("short-slug");
    const long = "building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic-demons-became-the-focus";
    expect(truncateSlug(long)).toBe("building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic");
    expect(truncateSlug("a".repeat(79) + "-bc")).toBe("a".repeat(79));
    expect(truncateSlug("x".repeat(80) + "-y")).toBe("x".repeat(80));
  });
});

describe("finalSlugs", () => {
  it("suffixes collisions after truncation and validates the pattern", () => {
    const long = (n: string) => `building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic-demons-became-the-focus-part-${n}`;
    const m = finalSlugs([{ slug: "ok" }, { slug: long("1") }, { slug: long("2") }]);
    expect(m.get("ok")).toBe("ok");
    expect(m.get(long("1"))).toBe("building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic");
    expect(m.get(long("2"))).toBe("building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic-2");
    expect(() => finalSlugs([{ slug: "Bad Slug" }])).toThrow(/Bad Slug/);
  });
});

describe("wpDateToIso", () => {
  it("parses GMT and falls back to the local date for the zero sentinel", () => {
    expect(wpDateToIso("2016-05-01 17:00:00", "2016-05-01 10:00:00")).toBe("2016-05-01T17:00:00.000Z");
    expect(wpDateToIso("0000-00-00 00:00:00", "2017-01-01 00:00:00")).toBe("2017-01-01T00:00:00.000Z");
    expect(() => wpDateToIso("nope", "nope")).toThrow();
  });
});

describe("assemblePost", () => {
  it("builds the row with normalized tags, decoded excerpt and ordered dates", () => {
    const row = assemblePost({ ...base, excerpt: "<p>Short &amp; sweet</p>" }, { finalSlug: "t", authorId: "u1", authorName: "Gabe", bodyMd: "Body", coverUrl: "https://b/c.jpg", status: "published" });
    expect(row).toEqual({
      slug: "t", title: "T", excerpt: "Short & sweet", body_md: "Body", cover_image_url: "https://b/c.jpg",
      tags: ["News", "Fun & funny"], status: "published", author_id: "u1", author_name: "Gabe",
      published_at: "2016-05-01T17:00:00.000Z", created_at: "2016-05-01T17:00:00.000Z", updated_at: "2016-05-02T01:02:03.000Z",
      source_url: "https://landofredemption.com/t/",
    });
  });
  it("nulls a blank excerpt, clamps updated_at to created_at, and rejects an empty title", () => {
    const row = assemblePost({ ...base, modifiedGmt: "2015-01-01 00:00:00" }, { finalSlug: "t", authorId: null, authorName: "Gabe", bodyMd: "", coverUrl: null, status: "draft" });
    expect(row.excerpt).toBeNull();
    expect(row.updated_at).toBe(row.created_at);
    expect(row.author_id).toBeNull();
    expect(() => assemblePost({ ...base, title: "  " }, { finalSlug: "t", authorId: null, authorName: "G", bodyMd: "", coverUrl: null, status: "draft" })).toThrow(/title/);
  });
});

describe("wxr-authors.json", () => {
  it("covers every export author, has unique logins, and carries the agreed emails", () => {
    const map = loadAuthorMap(join(__dirname, "../../../data/wxr-authors.json"));
    expect(map.length).toBeGreaterThanOrEqual(84);
    expect(new Set(map.map((m) => m.login)).size).toBe(map.length);
    const email = (login: string) => map.find((m) => m.login === login)?.email;
    expect(email("TimE")).toBe("baboonytim@gmail.com");
    expect(email("JaydenA")).toBe("jayden.alstad@gmail.com");
    expect(email("RobM")).toBe("robmulye@gmail.com");
    expect(email("jhendrix")).toBe("jhendrix6426@gmail.com");
    expect(email("CtheTree")).toBe("cchessbball@comcast.net");
    expect(email("kurthake")).toBe("kurthake@hotmail.com");
    expect(email("Jason")).toBe("jason.b.ricci@gmail.com");
    expect(email("thejambi")).toBe("thejambi@gmail.com");
    expect(email("Chazmaniandevil")).toBe("cjbaseball25@gmail.com");
    expect(email("Reth")).toBe("rene.thol@gmx.de");
    expect(email("Seth")).toBe("landofredemption@gmail.com");
    expect(email("admin")).toBeNull();
    expect(map.filter((m) => m.email).length).toBe(11);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `scripts/lib/wxr/assemble.ts` (spec §6–§8):

```ts
import { readFileSync } from "node:fs";
import he from "he";
import { normalizeTags } from "@/app/admin/posts/lib/validate";
import { MAX_SLUG, SLUG_RE } from "@/app/articles/lib/markdown";
import type { WxrPost } from "./parse";

export interface AuthorMapEntry { login: string; name: string; email: string | null }

export function loadAuthorMap(path: string): AuthorMapEntry[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${path}: expected an array`);
  const seen = new Set<string>();
  return raw.map((e, i) => {
    const x = e as Partial<AuthorMapEntry>;
    if (typeof x.login !== "string" || !x.login || typeof x.name !== "string" || !(x.email === null || typeof x.email === "string"))
      throw new Error(`${path}[${i}]: bad entry ${JSON.stringify(e)}`);
    if (seen.has(x.login)) throw new Error(`${path}: duplicate login ${x.login}`);
    seen.add(x.login);
    return { login: x.login, name: x.name, email: x.email ? x.email.trim().toLowerCase() : null };
  });
}

export function truncateSlug(slug: string, max = MAX_SLUG): string {
  if (slug.length <= max) return slug;
  let s = slug.slice(0, max);
  if (slug[max] !== "-") s = s.replace(/-[^-]*$/, ""); // the cut split a word
  return s.replace(/-+$/, "");
}

export function finalSlugs(posts: { slug: string }[]): Map<string, string> {
  const bad = posts.map((p) => p.slug).filter((s) => !SLUG_RE.test(s));
  if (bad.length) throw new Error(`slugs failing SLUG_RE: ${bad.join(", ")}`);
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const { slug } of posts) {
    let final = truncateSlug(slug);
    for (let n = 2; taken.has(final); n++) final = `${truncateSlug(slug, MAX_SLUG - `-${n}`.length)}-${n}`;
    taken.add(final);
    out.set(slug, final);
  }
  return out;
}

export function wpDateToIso(gmt: string, fallback: string): string {
  const pick = gmt.startsWith("0000-") ? fallback : gmt;
  const m = pick.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) throw new Error(`bad WordPress date: ${JSON.stringify(gmt)} / ${JSON.stringify(fallback)}`);
  return new Date(`${m[1]}T${m[2]}Z`).toISOString();
}

export interface ImportRow {
  slug: string; title: string; excerpt: string | null; body_md: string; cover_image_url: string | null;
  tags: string[]; status: "published" | "draft"; author_id: string | null; author_name: string;
  published_at: string; created_at: string; updated_at: string; source_url: string;
}

export function assemblePost(
  post: WxrPost,
  ctx: { finalSlug: string; authorId: string | null; authorName: string; bodyMd: string; coverUrl: string | null; status: "published" | "draft" },
): ImportRow {
  const title = post.title.trim();
  if (!title || title.length > 200) throw new Error(`post ${post.wpId}: title must be 1-200 chars`);
  const excerpt = he.decode(post.excerpt.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const created = wpDateToIso(post.dateGmt, post.date);
  let updated = post.modifiedGmt ? wpDateToIso(post.modifiedGmt, post.date) : created;
  if (updated < created) updated = created;
  return {
    slug: ctx.finalSlug, title, excerpt, body_md: ctx.bodyMd, cover_image_url: ctx.coverUrl,
    tags: normalizeTags(post.categories), status: ctx.status, author_id: ctx.authorId, author_name: ctx.authorName.slice(0, 80),
    published_at: created, created_at: created, updated_at: updated, source_url: post.link,
  };
}
```

- [ ] **Step 4: Generate `scripts/data/wxr-authors.json`** from the real export (read-only) with the eleven agreed emails and `null` for everyone else; entries sorted by login, 2-space indented:

```bash
npx tsx -e '
import { readWxr } from "./scripts/lib/wxr/parse";
import { writeFileSync } from "node:fs";
const EMAILS: Record<string, string> = {
  TimE: "baboonytim@gmail.com", JaydenA: "jayden.alstad@gmail.com", RobM: "robmulye@gmail.com",
  jhendrix: "jhendrix6426@gmail.com", CtheTree: "cchessbball@comcast.net", kurthake: "kurthake@hotmail.com",
  Jason: "jason.b.ricci@gmail.com", thejambi: "thejambi@gmail.com", Chazmaniandevil: "cjbaseball25@gmail.com",
  Reth: "rene.thol@gmx.de", Seth: "landofredemption@gmail.com",
};
const e = readWxr("/Users/timestes/projects/redemption-tournament-tracker/tmp/landofredemption.WordPress.2026-09-05.xml");
const rows = e.authors.map((a) => ({ login: a.login, name: a.displayName || a.login, email: EMAILS[a.login] ?? null }))
  .sort((a, b) => a.login.localeCompare(b.login));
for (const k of Object.keys(EMAILS)) if (!rows.some((r) => r.login === k)) throw new Error("missing login " + k);
writeFileSync("scripts/data/wxr-authors.json", JSON.stringify(rows, null, 2) + "\n");
console.log(rows.length, "authors,", rows.filter((r) => r.email).length, "mapped");
'
```
Expected: `85 authors, 11 mapped`. The file contains WordPress display names and the eleven emails only (no other emails).

- [ ] **Step 5: Run** `npx vitest run scripts/lib/wxr` → PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/wxr/assemble.ts scripts/lib/wxr/__tests__/assemble.test.ts scripts/data/wxr-authors.json
git commit -m "feat(wxr): row assembly, slug rules, dates, and the author map"
```

---

### Task 7: Media mirror and report writers

**Files:**
- Create: `scripts/lib/wxr/media.ts`, `scripts/lib/wxr/report.ts`
- Test: `scripts/lib/wxr/__tests__/media.test.ts`, `scripts/lib/wxr/__tests__/report.test.ts`

**Interfaces:**
- Consumes: `blobPathname`, `mirrorUrl` (Task 5); `MarkdownStats` (Task 4); `ImportRow` (Task 6).
- Produces:

```ts
// media.ts
export function contentTypeFor(pathname: string): string;
export interface ManifestEntry { pathname: string; url: string; bytes: number; status: "planned" | "exists" | "uploaded" | "missing" }
export type Manifest = Record<string, ManifestEntry>;   // keyed by site path
export function localPath(backupDir: string, sitePath: string): string;
export function planMedia(sitePaths: string[], backupDir: string, blobBase: string): Manifest;
export async function mirrorMedia(manifest: Manifest, opts: { backupDir: string; concurrency: number; log: (s: string) => void }): Promise<void>;
// report.ts
export interface PostReport { slug: string; originalSlug: string; title: string; login: string; wpId: string; classic: boolean;
  stats: MarkdownStats & { droppedBlocks: Record<string, number>; unknownRefs: string[]; removedIframes: string[]; missingMedia: string[] }; error?: string }
export interface Report { generatedAt: string; mode: string; totals: Record<string, number>;
  authors: { login: string; name: string; posts: number; email: string | null; resolved: string }[];
  slugChanges: { from: string; to: string }[]; posts: PostReport[] }
export function frontMatter(row: ImportRow): string;   // "---\n…\n---\n\n"
export function writeReport(dir: string, report: Report): void;   // report.json + report.md
```

- [ ] **Step 1: Failing tests**

`media.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentTypeFor, planMedia } from "../media";

describe("contentTypeFor", () => {
  it("maps known extensions and defaults to octet-stream", () => {
    expect(contentTypeFor("wp/a.JPG")).toBe("image/jpeg");
    expect(contentTypeFor("wp/a.png")).toBe("image/png");
    expect(contentTypeFor("wp/a.webp")).toBe("image/webp");
    expect(contentTypeFor("wp/a.mp3")).toBe("audio/mpeg");
    expect(contentTypeFor("wp/deck.dek")).toBe("text/plain");
    expect(contentTypeFor("wp/deck.txt")).toBe("text/plain");
    expect(contentTypeFor("wp/a.pdf")).toBe("application/pdf");
    expect(contentTypeFor("wp/a.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(contentTypeFor("wp/a.weird")).toBe("application/octet-stream");
  });
});

describe("planMedia", () => {
  it("uses the backup layout <backup>/<site path>, marks present files planned and absent ones missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "wxr-"));
    const nested = join(dir, "wp-content/uploads/2016");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "hello world.png"), Buffer.alloc(10));
    const m = planMedia(["/wp-content/uploads/2016/hello%20world.png", "/podcasts/none.mp3"], dir, "https://blob.test");
    expect(m["/wp-content/uploads/2016/hello%20world.png"]).toEqual({
      pathname: "wp/wp-content/uploads/2016/hello world.png",
      url: "https://blob.test/wp/wp-content/uploads/2016/hello%20world.png",
      bytes: 10, status: "planned",
    });
    expect(m["/podcasts/none.mp3"]).toEqual({ pathname: "wp/podcasts/none.mp3", url: "https://blob.test/wp/podcasts/none.mp3", bytes: 0, status: "missing" });
  });
});
```

`report.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frontMatter, writeReport, type Report } from "../report";

describe("frontMatter", () => {
  it("lists the row's metadata", () => {
    const fm = frontMatter({ slug: "t", title: "T: x", excerpt: null, body_md: "", cover_image_url: null, tags: ["News"], status: "published", author_id: null, author_name: "Gabe", published_at: "2016-05-01T17:00:00.000Z", created_at: "2016-05-01T17:00:00.000Z", updated_at: "2016-05-01T17:00:00.000Z", source_url: "https://landofredemption.com/t/" });
    expect(fm).toBe('---\ntitle: "T: x"\nauthor_name: "Gabe"\nauthor_id: null\npublished_at: 2016-05-01T17:00:00.000Z\ntags: ["News"]\ncover_image_url: null\nsource_url: https://landofredemption.com/t/\n---\n\n');
  });
});

describe("writeReport", () => {
  it("writes json and a markdown summary that names problem posts", () => {
    const dir = mkdtempSync(join(tmpdir(), "wxr-"));
    const report: Report = {
      generatedAt: "2026-09-06T00:00:00.000Z", mode: "dry-run", totals: { posts: 2, failed: 1 },
      authors: [{ login: "admin", name: "Gabe", posts: 2, email: null, resolved: "ARCHIVE" }],
      slugChanges: [{ from: "a-very-long-slug", to: "a-very" }],
      posts: [
        { slug: "ok", originalSlug: "ok", title: "Fine", login: "admin", wpId: "1", classic: false, stats: { images: 1, links: 0, embeds: 0, residualHtml: [], residualMarkers: [], externalImageHosts: [], droppedBlocks: {}, unknownRefs: [], removedIframes: [], missingMedia: [] } },
        { slug: "bad", originalSlug: "bad", title: "Broken", login: "admin", wpId: "2", classic: true, stats: { images: 0, links: 0, embeds: 0, residualHtml: ["<div>"], residualMarkers: [], externalImageHosts: [], droppedBlocks: { spacer: 2 }, unknownRefs: [], removedIframes: [], missingMedia: ["/wp-content/uploads/x.jpg"] }, error: "insert failed" },
      ],
    };
    writeReport(dir, report);
    expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).totals.posts).toBe(2);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    expect(md).toContain("| admin | Gabe | 2 |");
    expect(md).toContain("a-very-long-slug");
    expect(md).toContain("bad");
    expect(md).toContain("<div>");
    expect(md).toContain("insert failed");
    expect(md).not.toMatch(/\| ok \|/);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `scripts/lib/wxr/media.ts` (spec §9):

```ts
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { blobPathname, mirrorUrl } from "./urls";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", pdf: "application/pdf", txt: "text/plain", dek: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", htm: "text/html", html: "text/html",
};
export function contentTypeFor(pathname: string): string {
  const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

export interface ManifestEntry { pathname: string; url: string; bytes: number; status: "planned" | "exists" | "uploaded" | "missing" }
export type Manifest = Record<string, ManifestEntry>;

export const localPath = (backupDir: string, sitePath: string) => join(backupDir, decodeURIComponent(sitePath));

export function planMedia(sitePaths: string[], backupDir: string, blobBase: string): Manifest {
  const m: Manifest = {};
  for (const p of sitePaths) {
    const pathname = blobPathname(p);
    let bytes = 0, status: ManifestEntry["status"] = "missing";
    try { const st = statSync(localPath(backupDir, p)); if (st.isFile()) { bytes = st.size; status = "planned"; } } catch { /* missing */ }
    m[p] = { pathname, url: mirrorUrl(blobBase, pathname), bytes, status };
  }
  return m;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 500 * 2 ** i)); }
  }
  throw last;
}

/** Upload every `planned` entry that is not already in the store. Mutates the manifest. */
export async function mirrorMedia(manifest: Manifest, opts: { backupDir: string; concurrency: number; log: (s: string) => void }): Promise<void> {
  const queue = Object.entries(manifest).filter(([, e]) => e.status === "planned");
  const total = queue.length;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [sitePath, entry] = next;
      try {
        try { await head(entry.url); entry.status = "exists"; }
        catch (e) {
          if (!(e instanceof BlobNotFoundError)) throw e;
          const body = readFileSync(localPath(opts.backupDir, sitePath));
          const res = await withRetry(() => put(entry.pathname, body, { access: "public", addRandomSuffix: false, contentType: contentTypeFor(entry.pathname), cacheControlMaxAge: 31536000 }));
          entry.url = res.url; entry.status = "uploaded";
        }
      } catch (e) {
        opts.log(`media FAILED ${sitePath}: ${(e as Error).message}`);
      }
      if (++done % 100 === 0) opts.log(`media ${done}/${total}`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
}
```

A failed upload leaves the entry `planned` (the manifest is written to disk by the CLI, so the failure is visible and the next run retries it). The `head`-before-`put` check is what makes re-runs idempotent.

- [ ] **Step 4: Implement** `scripts/lib/wxr/report.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImportRow } from "./assemble";
import type { MarkdownStats } from "./toMarkdown";

export interface PostReport {
  slug: string; originalSlug: string; title: string; login: string; wpId: string; classic: boolean;
  stats: MarkdownStats & { droppedBlocks: Record<string, number>; unknownRefs: string[]; removedIframes: string[]; missingMedia: string[] };
  error?: string;
}
export interface Report {
  generatedAt: string; mode: string; totals: Record<string, number>;
  authors: { login: string; name: string; posts: number; email: string | null; resolved: string }[];
  slugChanges: { from: string; to: string }[];
  posts: PostReport[];
}

export function frontMatter(row: ImportRow): string {
  return [
    "---",
    `title: ${JSON.stringify(row.title)}`,
    `author_name: ${JSON.stringify(row.author_name)}`,
    `author_id: ${row.author_id ?? "null"}`,
    `published_at: ${row.published_at}`,
    `tags: ${JSON.stringify(row.tags)}`,
    `cover_image_url: ${row.cover_image_url ?? "null"}`,
    `source_url: ${row.source_url}`,
    "---",
    "", "",
  ].join("\n");
}

const problem = (p: PostReport) =>
  !!p.error || p.stats.residualHtml.length > 0 || p.stats.residualMarkers.length > 0 || p.stats.unknownRefs.length > 0 ||
  p.stats.removedIframes.length > 0 || p.stats.missingMedia.length > 0 || Object.keys(p.stats.droppedBlocks).length > 0;

export function writeReport(dir: string, report: Report): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
  const lines: string[] = [`# WXR import report (${report.mode}, ${report.generatedAt})`, ""];
  lines.push("## Totals", "", ...Object.entries(report.totals).map(([k, v]) => `- ${k}: ${v}`), "");
  lines.push("## Authors", "", "| login | name | posts | email | resolved |", "|---|---|---|---|---|");
  for (const a of report.authors) lines.push(`| ${a.login} | ${a.name} | ${a.posts} | ${a.email ?? ""} | ${a.resolved} |`);
  lines.push("", "## Slug changes", "", ...report.slugChanges.map((s) => `- ${s.from} → ${s.to}`), "");
  lines.push("## Posts needing a look", "", "| slug | issue |", "|---|---|");
  for (const p of report.posts.filter(problem)) {
    const issues: string[] = [];
    if (p.error) issues.push(`error: ${p.error}`);
    if (p.stats.residualHtml.length) issues.push(`html: ${p.stats.residualHtml.join(" ")}`);
    if (p.stats.residualMarkers.length) issues.push(`markers: ${p.stats.residualMarkers.join(" ")}`);
    if (p.stats.unknownRefs.length) issues.push(`unknown block refs: ${p.stats.unknownRefs.join(",")}`);
    if (p.stats.removedIframes.length) issues.push(`iframes removed: ${p.stats.removedIframes.join(" ")}`);
    if (p.stats.missingMedia.length) issues.push(`missing media: ${p.stats.missingMedia.join(" ")}`);
    for (const [k, v] of Object.entries(p.stats.droppedBlocks)) issues.push(`dropped ${k}×${v}`);
    lines.push(`| ${p.slug} | ${issues.join("; ").replace(/\|/g, "\\|")} |`);
  }
  writeFileSync(join(dir, "report.md"), lines.join("\n") + "\n");
}
```

- [ ] **Step 5: Run** `npx vitest run scripts/lib/wxr` → PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/wxr/media.ts scripts/lib/wxr/report.ts scripts/lib/wxr/__tests__/media.test.ts scripts/lib/wxr/__tests__/report.test.ts
git commit -m "feat(wxr): Blob media mirror and import report writers"
```

---

### Task 8: Database layer — author resolution, archive account, post writes

**Files:**
- Create: `scripts/lib/wxr/db.ts`
- Test: `scripts/lib/wxr/__tests__/db.test.ts` (pure helpers only; no network in tests)

**Interfaces:**
- Consumes: `AuthorMapEntry`, `ImportRow` (Task 6).
- Produces:

```ts
export const ARCHIVE_EMAIL = "landofredemption@landofredemption.com";
export const ARCHIVE_USERNAME = "Land of Redemption";
export function serviceClient(env: NodeJS.ProcessEnv): SupabaseClient;            // throws when NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing
export async function listAllUsers(sb: SupabaseClient): Promise<{ id: string; email: string }[]>;  // auth.admin.listUsers, all pages, perPage 1000, emails lower-cased
export async function ensureArchiveUser(sb: SupabaseClient, users: { id: string; email: string }[]): Promise<string>;  // returns id; creates when absent; sets profiles.username when null
export function resolveAuthors(map: AuthorMapEntry[], users: { id: string; email: string }[], archiveId: string): Map<string, string>;  // login → author_id; throws listing every mapped email without a user
export async function existingSourceUrls(sb: SupabaseClient): Promise<Set<string>>;
export async function writePost(sb: SupabaseClient, row: ImportRow, mode: "insert" | "update"): Promise<{ id: string } | { error: string }>;
```

- [ ] **Step 1: Failing tests** (`resolveAuthors` and `serviceClient` only):

```ts
import { describe, expect, it } from "vitest";
import { resolveAuthors, serviceClient } from "../db";

const users = [{ id: "u-tim", email: "baboonytim@gmail.com" }, { id: "u-rob", email: "robmulye@gmail.com" }];
const map = [
  { login: "TimE", name: "BaboonyTim", email: "baboonytim@gmail.com" },
  { login: "RobM", name: "RobM", email: "robmulye@gmail.com" },
  { login: "admin", name: "Gabe", email: null },
];

describe("resolveAuthors", () => {
  it("maps emails to ids and null emails to the archive", () => {
    const r = resolveAuthors(map, users, "u-archive");
    expect(r.get("TimE")).toBe("u-tim");
    expect(r.get("RobM")).toBe("u-rob");
    expect(r.get("admin")).toBe("u-archive");
  });
  it("throws naming every unresolved mapped email", () => {
    expect(() => resolveAuthors([...map, { login: "X", name: "X", email: "nobody@example.com" }, { login: "Y", name: "Y", email: "ghost@example.com" }], users, "a")).toThrow(/nobody@example.com.*ghost@example.com|ghost@example.com.*nobody@example.com/s);
  });
});

describe("serviceClient", () => {
  it("requires the url and service role key", () => {
    expect(() => serviceClient({})).toThrow(/SUPABASE/);
    expect(serviceClient({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `scripts/lib/wxr/db.ts` (spec §7, §12). Notes: `auth.admin.listUsers({ page, perPage: 1000 })` returns `{ data: { users, nextPage }, error }` — loop until `users.length < perPage`. `auth.admin.createUser({ email, email_confirm: true, user_metadata: { wxr_archive: true } })`. The `profiles` row is created by the `on_auth_user_created` trigger with a null username; set it with `.from("profiles").update({ username }).eq("id", id).is("username", null)`.

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthorMapEntry, ImportRow } from "./assemble";

export const ARCHIVE_EMAIL = "landofredemption@landofredemption.com";
export const ARCHIVE_USERNAME = "Land of Redemption";

export function serviceClient(env: NodeJS.ProcessEnv): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function listAllUsers(sb: SupabaseClient): Promise<{ id: string; email: string }[]> {
  const out: { id: string; email: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email) out.push({ id: u.id, email: u.email.toLowerCase() });
    if (data.users.length < 1000) return out;
  }
}

export async function ensureArchiveUser(sb: SupabaseClient, users: { id: string; email: string }[]): Promise<string> {
  let id = users.find((u) => u.email === ARCHIVE_EMAIL)?.id;
  if (!id) {
    const { data, error } = await sb.auth.admin.createUser({ email: ARCHIVE_EMAIL, email_confirm: true, user_metadata: { wxr_archive: true } });
    if (error || !data.user) throw new Error(`createUser(${ARCHIVE_EMAIL}): ${error?.message}`);
    id = data.user.id;
    users.push({ id, email: ARCHIVE_EMAIL });
  }
  const { error } = await sb.from("profiles").update({ username: ARCHIVE_USERNAME }).eq("id", id).is("username", null);
  if (error) throw new Error(`profiles.username: ${error.message}`);
  return id;
}

export function resolveAuthors(map: AuthorMapEntry[], users: { id: string; email: string }[], archiveId: string): Map<string, string> {
  const byEmail = new Map(users.map((u) => [u.email, u.id]));
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const a of map) {
    if (!a.email) { out.set(a.login, archiveId); continue; }
    const id = byEmail.get(a.email);
    if (id) out.set(a.login, id); else missing.push(a.email);
  }
  if (missing.length) throw new Error(`no tracker account for mapped author email(s): ${missing.join(", ")}`);
  return out;
}

export async function existingSourceUrls(sb: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("posts").select("source_url").not("source_url", "is", null).range(from, from + 999);
    if (error) throw new Error(`posts.source_url: ${error.message}`);
    for (const r of data) if (r.source_url) out.add(r.source_url);
    if (data.length < 1000) return out;
  }
}

/** insert: fails on an existing source_url (unique). update: everything but slug/status. */
export async function writePost(sb: SupabaseClient, row: ImportRow, mode: "insert" | "update"): Promise<{ id: string } | { error: string }> {
  if (!row.author_id) return { error: "author_id unresolved" };
  if (mode === "insert") {
    const { data, error } = await sb.from("posts").insert(row).select("id").single();
    return error ? { error: error.message } : { id: data.id };
  }
  const { slug: _s, status: _st, ...patch } = row;
  const { data, error } = await sb.from("posts").update(patch).eq("source_url", row.source_url).select("id").single();
  return error ? { error: error.message } : { id: data.id };
}
```

- [ ] **Step 4: Run** `npx vitest run scripts/lib/wxr` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/wxr/db.ts scripts/lib/wxr/__tests__/db.test.ts
git commit -m "feat(wxr): service-role db layer — author resolution, archive account, post writes"
```

---

### Task 9: The CLI, the render-sample script, docs, and the full dry run

**Files:**
- Create: `scripts/import-wxr.ts`, `scripts/wxr-render-sample.ts`
- Modify: `CLAUDE.md` (Key References row)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write** `scripts/import-wxr.ts` (spec §12). Flow: load env → parse args (`node:util` `parseArgs`) → `readWxr` → select posts (`--only` by original slug; `--limit N` = the N newest by `dateGmt` then `date`; default all) → `loadAuthorMap` + fail fast on a `creator` with no entry → `finalSlugs` over ALL published posts (so internal links to unselected posts still map) → `preprocess` each selected post and `collectSiteFiles` (from the preprocessed HTML plus the featured attachment URL) → `planMedia` → unless `--dry-run`/`--skip-media`: `mirrorMedia` → write `media-manifest.json` → if `--media-only` stop → for each post: `rewriteUrls` (mirror = manifest entry with status ≠ `missing` → its `url`, else null) → `htmlToMarkdown` → `measureMarkdown` → `assemblePost` (cover = featured attachment's mirror URL or null; author from the resolved map, or `null` in dry-run) → write `posts/<slug>.md` with `frontMatter` → collect `PostReport` → unless `--dry-run`: `serviceClient`, `listAllUsers`, `ensureArchiveUser`, `resolveAuthors`, `existingSourceUrls`, then `writePost` per row (skip existing unless `--update`; count `inserted`, `updated`, `skipped`, `failed`) → `writeReport` → print totals → exit 1 if any failed.

```ts
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
// … imports from ./lib/wxr/*
```

Print one line per 100 posts and a final summary like:

```
posts: 1298 selected, 1298 converted, 0 failed | media: 5983 planned, 10 missing | report: scripts/output/wxr/report.md
```

`--limit` and `--only` both select; `--only` wins when given. Output dir is `scripts/output/wxr/` relative to cwd (create it). In dry-run, `author_id` is `null` and `resolved` in the authors table is the email or `ARCHIVE`. `NEXT_PUBLIC_BLOB_BASE_URL` is required in every mode (it builds the mirror URLs).

- [ ] **Step 2: Write** `scripts/wxr-render-sample.ts`:

```ts
/**
 * Render dry-run markdown through the real ArticleBody for eyeballing.
 * Usage: npx tsx scripts/wxr-render-sample.ts --slugs a,b,c   (reads scripts/output/wxr/posts/<slug>.md)
 * Writes scripts/output/wxr/render/<slug>.html
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import ArticleBody from "@/app/articles/components/ArticleBody";

const { values } = parseArgs({ options: { slugs: { type: "string" } } });
const slugs = (values.slugs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!slugs.length) { console.error("--slugs a,b,c required"); process.exit(1); }
const dir = join("scripts/output/wxr");
mkdirSync(join(dir, "render"), { recursive: true });
const CSS = `body{max-width:760px;margin:2rem auto;font:16px/1.6 system-ui;padding:0 1rem}img{max-width:100%}iframe{width:100%;aspect-ratio:16/9}pre{overflow:auto;background:#f4f4f4;padding:1rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.25rem .5rem}`;
for (const slug of slugs) {
  const raw = readFileSync(join(dir, "posts", `${slug}.md`), "utf8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n\n/);
  const markdown = fm ? raw.slice(fm[0].length) : raw;
  const body = renderToStaticMarkup(createElement(ArticleBody, { markdown }));
  writeFileSync(join(dir, "render", `${slug}.html`), `<!doctype html><meta charset="utf-8"><title>${slug}</title><style>${CSS}</style><pre style="white-space:pre-wrap;font-size:12px">${(fm?.[1] ?? "").replace(/</g, "&lt;")}</pre>${body}`);
  console.log("rendered", join(dir, "render", `${slug}.html`));
}
```

If tsx cannot resolve `@/…` here, use the relative path `../app/articles/components/ArticleBody`.

- [ ] **Step 3: CLAUDE.md** — add a Key References row after the Goldfish/mobile rows:

`| WordPress import | \`docs/superpowers/specs/2026-09-06-wxr-import-design.md\` + \`scripts/import-wxr.ts\` (\`--dry-run\` is safe; everything else writes prod). Converter lib in \`scripts/lib/wxr/\`; author map \`scripts/data/wxr-authors.json\`. |`

- [ ] **Step 4: Full dry run** against the real export (read-only inputs; output stays gitignored):

```bash
cd /Users/timestes/projects/rtt-wxr-import && npx tsx scripts/import-wxr.ts --dry-run \
  --wxr /Users/timestes/projects/redemption-tournament-tracker/tmp/landofredemption.WordPress.2026-09-05.xml \
  --backup /Users/timestes/projects/redemption-tournament-tracker/tmp/public_html
```

Expected: 1298 selected / 1298 converted / 0 failed; media planned ≈ 5,983 with 10 missing; `report.md` shows 0 posts with residual markers or unknown block refs. Read `report.md`; if residual HTML tags appear in more than a handful of posts, fix the converter (new turndown rule or preprocess step) and re-run until the remaining residuals are genuinely inline text (report them in your report). Then render six posts and confirm the HTML files exist and contain `<img`, `youtube-nocookie` and `<audio` where expected:

```bash
npx tsx scripts/wxr-render-sample.ts --slugs is-ul-postes-just-creation-at-home,fun-fellowship-and-faith,lackey-grand-prix-week-2-decklists,the-return-of-redemption-metagaming,more-than-just-a-game,2-player-booster-draft-2019-nationals-2nd-place
```

- [ ] **Step 5: Verify** `npx vitest run scripts/lib/wxr app/articles` → PASS; `npx tsc --noEmit` → 7 known errors only.

- [ ] **Step 6: Commit**

```bash
git add scripts/import-wxr.ts scripts/wxr-render-sample.ts CLAUDE.md
git commit -m "feat(wxr): import CLI, render-sample script, and docs"
```

Include in your report: the summary line, the counts from `report.md` (posts needing a look, by issue type), the 10 missing media paths, and anything you changed in the converter during Step 4.

---

### Task 10: Controller checklist — review, live rollout, PR

**Controller only (production side effects; not for an implementer).**

- [ ] Open the six rendered HTML files in a browser; check images, embeds, audio, deck-list line breaks, headings, internal links. Dispatch fixes as scoped tasks if needed; re-run the dry run.
- [ ] Apply migration 096 to production (Supabase MCP `apply_migration`, name `096_posts_import_columns`); verify the `posts` columns show `author_name` and the constraint `posts_source_url_key` exists.
- [ ] `npx tsx scripts/import-wxr.ts --media-only --wxr … --backup …` (≈ 2.94 GB); confirm `media-manifest.json` has no `planned` left except failures; re-run to retry failures.
- [ ] `npx tsx scripts/import-wxr.ts --limit 20 --wxr … --backup …` (`--skip-media` is dry-run-only; the live mirror step re-verifies by `head`); confirm the archive user exists, 20 rows inserted, then check `/articles` and three posts on production (cache: up to an hour, or publish/unpublish any post from the editor).
- [ ] Full run: `npx tsx scripts/import-wxr.ts --wxr … --backup …`; expect `inserted 1277, skipped 20, skipped_empty_title 1, failed 0`.
- [ ] Push, open the PR (spec, plan, migration, byline, script, tests, CLAUDE.md), merge. Then remove the worktree.
