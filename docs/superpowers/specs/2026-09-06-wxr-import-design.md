# WordPress (WXR) Import into Articles — Design

**Date:** 2026-09-06 · **Status:** approved in chat by Tim (2026-09-06) · **Builds on:** `docs/superpowers/specs/2026-09-05-articles-design.md` (the `/articles` feature, PR #356) and the LoR shutdown plan (Track 2 = authors keep publishing in the tracker; Track 1 = static archive of the old site).

## 1. Goal

Import every published landofredemption.com post into `public.posts` so it renders through the existing `/articles` feature with its original byline, date, categories (as tags) and media, served from Vercel Blob. Afterwards `select source_url, slug from posts where source_url is not null` is the old→new URL map that Track 1's redirects are built from.

## 2. Non-goals

WordPress pages (34), draft posts (3), comments (1,144), BuddyPress, WordPress tags (1,155 distinct, noise), redirects themselves, rescuing images hosted on third-party hosts (Google Docs, a dead theme demo), an admin UI for the import. Nothing in the poster editor changes.

## 3. Inputs and facts

| Input | Location | Notes |
|---|---|---|
| WXR export (WXR 1.2, 40 MB) | `tmp/landofredemption.WordPress.2026-09-05.xml` in the main checkout (gitignored) | CLI flag `--wxr`, default that relative path |
| Site backup | `tmp/public_html/` (23 GB, complete rsync of the server) | CLI flag `--backup`, default that relative path; media originals under `wp-content/uploads/`, podcast mp3s under `podcasts/` |

Facts established by analysis of the export on 2026-09-06 (the numbers the design decisions rest on):

| Fact | Value |
|---|---|
| Items: published posts / draft posts / pages / attachments / reusable blocks | 1,298 / 3 / 34 / 6,891 / 5 |
| Post dates (GMT) | 2015-03-25 → 2026-09-03 |
| Permalink structure | `/%postname%/` → every post's `<link>` is `https://landofredemption.com/<post_name>/` |
| Slugs failing `^[a-z0-9]+(-[a-z0-9]+)*$` / longer than 80 chars / colliding after truncation | 0 / 11 / 1 pair |
| Longest title | 132 chars (limit 200) |
| Authors (logins) / with a tracker account by exact email | 84 / 9 |
| Categories per post (max) / distinct category names | 6 / 51 |
| Gutenberg posts / classic posts (bare-newline paragraphs, 16 contain `<p>`) | 832 / 466 |
| Posts with `<!--more-->` | 994 |
| YouTube: `wp-block-embed` wrappers / `[youtube]` shortcodes / `<iframe>` | 636 / 38 / 3 |
| `wp:file` blocks (Lackey `.txt`/`.dek`, PDFs) / `getwid/accordion-item` / `wp:block` refs (262 of them the “SPONSORS!” block) | 530 / 371 / 265 |
| `wp:audio` with src / podcast mp3 links (`/podcasts/*.mp3`) / `[caption]` shortcodes / tables | 7 / 23 / 4 / 6 |
| Site media referenced by posts (src, href, featured): files / size / size-variants (`-WxH`) / missing from backup | 5,983 / 2.94 GB / 373 / 10 |
| Posts with a featured image / with an explicit excerpt | 1,275 / 13 |
| Posts linking to other landofredemption.com URLs | 942 |
| Third-party image hosts (left as-is) | googleusercontent (68 refs), classic.armadon-theme.com (231 refs in 11 posts, dead demo gallery), discord (3) |

## 4. Schema change — migration `096_posts_import_columns.sql`

```sql
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

RLS is unchanged: `author_name` is part of the public byline and rides on the existing policies. `updatePostAction` patches an explicit column list and `validatePatch` ignores unknown fields, so the editor cannot clear `author_name`.

## 5. Byline

`PublicPost` gains `author_name: string | null` (added to `COLUMNS`). One helper in `app/articles/lib/queries.ts`:

```ts
export function postByline(post: Pick<PublicPost, "author_name" | "author">): string {
  return post.author_name ?? post.author?.username ?? "Land of Redemption";
}
```

used by `PostCard`, `app/articles/[slug]/page.tsx` (visible byline and `openGraph.authors`) and `rss.ts` (`<dc:creator>`). Every imported post has `author_name` set to the WordPress display name, even when the post is owned by a real account, so readers keep seeing “Jayden”, “Tyler Stevens”, “BaboonyTim” as before. Clearing `author_name` on a row makes the byline fall back to the owner's username.

## 6. Field mapping

| `posts` column | Source |
|---|---|
| `id` | generated |
| `slug` | `wp:post_name`, adjusted per §8 |
| `title` | `<title>`, HTML entities decoded (`he`), whitespace collapsed, trimmed. A post whose title is empty after that (one known: wpId 12819, lorem-ipsum spam) is skipped, counted under `skippedEmptyTitle`, and listed in the report; it does not fail the run |
| `excerpt` | `excerpt:encoded` when non-blank after entity decode and tag strip, cut to 500 chars; else `null` (the renderer derives one from the body) |
| `body_md` | §10 |
| `cover_image_url` | URL of the attachment whose `wp:post_id` equals postmeta `_thumbnail_id`, rewritten per §9; `null` when the attachment is unknown or missing from the backup |
| `tags` | the post's `<category domain="category">` display names (CDATA text), entity-decoded, passed through `normalizeTags` from `app/admin/posts/lib/validate.ts` (dedupe, ≤ 40 chars each, ≤ 10) |
| `status` | `published` (`draft` with `--as-draft`) |
| `author_id` | §7 |
| `author_name` | `wp:author_display_name` of the author whose `wp:author_login` equals the post's `dc:creator`; the login itself if the author list lacks it |
| `published_at`, `created_at` | `wp:post_date_gmt` parsed as UTC; if it is `0000-00-00 00:00:00`, `wp:post_date` parsed as UTC |
| `updated_at` | `wp:post_modified_gmt` parsed as UTC, never earlier than `created_at` |
| `source_url` | `<link>` exactly as exported (`https://landofredemption.com/<post_name>/`) |

## 7. Authors and ownership

- **Map file** `scripts/data/wxr-authors.json` (checked in), one entry per `wp:author` in the export: `{ "login": string, "name": string, "email": string | null }`. `email` set → the post belongs to the tracker account whose auth email matches case-insensitively. `email` null → the archive account. The script fails fast when a post's `dc:creator` has no entry, so a re-export with a new author cannot fall through silently.
- **Entries with an email** (everything else is `null`):

  | login | name | email → tracker user |
  |---|---|---|
  | TimE | BaboonyTim | baboonytim@gmail.com (BaboonyTim) |
  | JaydenA | Jayden | jayden.alstad@gmail.com (TheJaylor) |
  | RobM | RobM | robmulye@gmail.com (robm) |
  | jhendrix | John Hendrix | jhendrix6426@gmail.com |
  | CtheTree | Chad | cchessbball@comcast.net |
  | kurthake | Kurt Hake | kurthake@hotmail.com |
  | Jason | Jason Ricci | jason.b.ricci@gmail.com (CactusKnee) |
  | thejambi | Zach | thejambi@gmail.com |
  | Chazmaniandevil | Charles L | cjbaseball25@gmail.com |
  | Reth | Reth | rene.thol@gmx.de |
  | Seth | Seth Morlan | landofredemption@gmail.com |

- **Archive account**: email `landofredemption@landofredemption.com`, profile username `Land of Redemption`. `ensureArchiveUser()` scans `auth.admin.listUsers` (all pages, `perPage: 1000`) for the email; creates it with `auth.admin.createUser({ email, email_confirm: true, user_metadata: { wxr_archive: true } })` when absent; sets `profiles.username` when null. It is the only account the script ever creates. Nobody logs in as it; the superuser edits its posts.
- **Resolution** happens once per live run and yields `login → author_id`. A mapped email with no tracker account is fatal and names the email. Dry runs do no network calls and show mapped authors as their email.

## 8. Slugs

- Keep `wp:post_name`. The script validates every slug against `SLUG_RE` and fails on a mismatch (none today).
- Longer than 80 chars (11 posts): cut to 80, then back to the last hyphen if the cut split a word, then strip trailing hyphens.
- Collisions among the final slugs (1 known pair): the second and later get `-2`, `-3`, … with the base trimmed so the result fits 80 chars.
- A slug that already exists in the DB for a row with a different `source_url` (an editor-created post) surfaces as that row's insert error in the report; the run continues.

## 9. Media mirror and URL rewriting

- **Site file** = any URL in a post's `src` or `href` attributes, or its featured image, whose host is `landofredemption.com` or `www.landofredemption.com` (http or https) and whose path starts with `/wp-content/uploads/` or `/podcasts/`. Query strings and trailing whitespace are stripped; the path is percent-decoded to locate the local file `<backup>/<path>`.
- **Blob pathname** = `wp/<site path without the leading slash>`, e.g. `wp/wp-content/uploads/2024/04/agur-1.png`, `wp/podcasts/CoW-Primer-with-John.mp3`. Public URL = `${NEXT_PUBLIC_BLOB_BASE_URL}/${pathname}`, deterministic because uploads use `addRandomSuffix: false`. Same store as poster uploads (`BLOB_READ_WRITE_TOKEN`). Track 1 later mirrors the rest of `public_html` under the same prefix with the same rule.
- **Which file**: the exact URL the post references (a `-1024x545` variant stays a variant) so page weight stays what WordPress served.
- **Upload**: `put(pathname, body, { access: "public", addRandomSuffix: false, contentType, cacheControlMaxAge: 31536000 })`; skip when `head(pathname)` succeeds (by pathname, never by a locally computed URL — an encoding mismatch would otherwise make every re-run fail); the manifest `url` is whatever the store returns from `head`/`put`, so it is the same on every run; concurrency 8 (minimum 1); 3 retries with backoff for `put` and for non-404 `head` failures. Content type by extension: jpg/jpeg `image/jpeg`, png `image/png`, webp `image/webp`, gif `image/gif`, mp3 `audio/mpeg`, m4a `audio/mp4`, mp4 `video/mp4`, pdf `application/pdf`, txt/dek `text/plain`, xlsx `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, htm/html `text/html`, else `application/octet-stream`.
- **Missing locally** (9–10 known): URL left unchanged, listed under `missingMedia` in the report. A site path that cannot be percent-decoded, or that resolves outside the backup directory, is treated as missing too. In a live run only entries whose status is `exists` or `uploaded` are rewritten; a `planned` entry (failed upload) keeps its original URL rather than publishing a dead Blob link.
- **Manifest** `scripts/output/wxr/media-manifest.json`: `{ [sitePath]: { pathname, url, bytes, status: "planned" | "exists" | "uploaded" | "missing" } }`.
- **Rewrites applied to the HTML before conversion**, in this order:
  1. Site file URL → mirror URL (files present in the backup only).
  2. Internal post link `https?://(www.)?landofredemption.com/<post_name>/` (optional `#fragment`) where `<post_name>` is an imported post's original slug → `/articles/<final slug>` plus the fragment.
  3. `https?://(www.)?landofredemption.com/?page_id=11455` → `https://landofredemption.com/our-sponsors/`.
  4. Everything else unchanged (pages, external hosts).

## 10. Conversion pipeline (HTML → Markdown)

The renderer is `ArticleBody` (react-markdown + remark-gfm, no rehype-raw): raw HTML is escaped, so output must be pure markdown. Per post:

### 10.1 Preprocess (string → HTML string)

1. **Reusable blocks**: `<!-- wp:block {"ref":N} /-->` → the content of `wp_block` item N, recursively; unknown ref → removed and reported.
2. **`wp:grimlock/section {...} /-->`** → `<p><a href="URL">TEXT</a></p>` where URL = `button_link` prefixed with `https://` when it has no scheme, TEXT = `title` + (` — ` + `subtitle` if non-empty) + (` — ` + `button_text` if non-empty). No `button_link` → `<p><strong>title</strong></p>`.
3. **Dropped blocks** (opening through closing comment, or the self-closing form): `wp:spacer`, `wp:wpdevart-countdown/countdown`, `wp:rss`, self-closing `<!-- wp:audio /-->`. Counted per type in the report.
4. **Shortcodes**: `[youtube]URL[/youtube]` and `[embed]URL[/embed]` → `<p><a href="URL">URL</a></p>`; `[caption …]<img …> text[/caption]` → `<figure><img …><figcaption>text</figcaption></figure>`. Any other `[…]` text is left alone (card-set markers like `[2022]`).
5. **Markers**: remove `<!--more-->` (with or without the `wp:more` wrapper) and every remaining `<!-- wp:… -->` / `<!-- /wp:… -->` comment.
6. **Classic posts** (original content has no `<!-- wp:` marker) get a wpautop port: CRLF → LF; `<pre>` blocks protected; blank lines inserted around block-level tags (`p div ul ol li h1-h6 blockquote table figure pre hr section article iframe object dl address`); split on 2+ newlines; each non-empty chunk that does not start with a block-level tag is wrapped in `<p>…</p>`; single newlines inside a `<p>` become `<br />`. Gutenberg posts skip this step.

### 10.2 Turndown

`new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*", strongDelimiter: "**", hr: "---" })` with the `gfm` plugin from `turndown-plugin-gfm`, `remove(["script", "style"])`, and these rules (custom rules take precedence over built-ins):

| Rule | Matches | Emits |
|---|---|---|
| embedWrapper | `figure.wp-block-embed` / `div.wp-block-embed__wrapper` | the trimmed URL text as its own paragraph (remark-gfm autolinks it; `ArticleBody` turns a sole-link paragraph into the YouTube embed) |
| youtubeIframe | `iframe[src]` containing `youtube.com/embed/ID` or `youtube-nocookie.com/embed/ID` | paragraph `https://www.youtube.com/watch?v=ID`; other iframes → removed and reported |
| pdfObject | `object[type="application/pdf"]` | removed (the sibling file link stays) |
| figure | `figure` whose first image is `img[src]` | `![alt](src)`; if an `a[href]` wraps the img and href ≠ src, `[![alt](src)](href)`; a `figcaption` adds `\n*caption*`; gallery figures (`figure.wp-block-gallery`) emit one image per item separated by blank lines |
| fileBlock | `div.wp-block-file` | `[text](href)` from its first `a` that is not `.wp-block-file__button` |
| audio | `audio[src]` (incl. inside `figure.wp-block-audio`) | `[basename](src)` on its own paragraph, plus `*figcaption*` when present (`ArticleBody` renders audio links as a player) |
| accordionTitle | `.wp-block-getwid-accordion__header-title` | `### title`; `.wp-block-getwid-accordion__icon` removed; other accordion wrappers unwrapped |
| button | `div.wp-block-button` | `[text](href)` paragraph |
| h1 | `h1` | `## ` heading (the page renders the title as h1) |
| img without src | `img:not([src])` | removed |

Defaults cover `a` (including the `wp-live-preview` card links), `p`, `br` (`  \n`), lists, blockquote, `pre > code` (fenced), tables (gfm), `hr`, `strong`/`em`, and unwrapping `div`/`span`.

### 10.3 Post-pass (string → string)

Collapse 3+ newlines to 2; trim; leave turndown's escaping as-is. Then measure for the report: residual HTML tags (`<[a-zA-Z][^>]*>` outside fenced code), residual `<!-- wp:` / `[youtube` / `[caption` markers, image and link counts, external image hosts.

## 11. Report and dry-run output

`scripts/output/wxr/` (gitignored):

- `posts/<slug>.md` — the markdown with a front-matter header (title, author, author_name, published_at, tags, cover_image_url, source_url) for eyeballing; written on every run.
- `report.json` — per post `{ slug, originalSlug, title, login, wpId, stats: { images, links, embeds, files, droppedBlocks: {type: n}, residualHtml: string[], residualMarkers: string[], externalImageHosts: string[], missingMedia: string[] }, error? }`, plus `authors` (login, name, posts, email, resolved id or `ARCHIVE`), `slugChanges`, `totals`.
- `report.md` — the totals, the authors table, slug changes, and every post with residual HTML/markers, dropped blocks, or errors.
- `media-manifest.json` — §9.

## 12. CLI

```
npx tsx scripts/import-wxr.ts [--wxr PATH] [--backup PATH] [--dry-run] [--media-only]
    [--limit N] [--only slug,slug] [--skip-media] [--update] [--as-draft] [--concurrency 8]
```

- **Live default**: resolve authors (fatal on an unresolved mapped email; creates only the archive account), mirror media for the selected posts, insert posts whose `source_url` is absent; existing rows are skipped and counted. A referenced file whose upload failed (entry still `planned`) keeps its original URL and is listed under `unmirroredMedia` for that post.
- `--update`: upsert the selected rows on `source_url`, overwriting title, excerpt, body_md, cover_image_url, tags, author_id, author_name, published_at, updated_at. Never changes `slug` or `status` of an existing row.
- `--dry-run`: no network; writes the markdown, report and a `planned` manifest.
- `--media-only`: mirror media for the selected posts, write the manifest, and stop (no markdown, no report); it never opens a Supabase client (so it cannot create the archive account).
- `--skip-media`: valid only with `--dry-run`. A live run always runs the mirror step — `head` by pathname first, so a second pass is a verification pass — and rewrites only `exists`/`uploaded` entries.
- `--limit N`: the N most recent published posts (the current front page first). `--only`: by original `post_name`.
- Per-post failures are recorded and the run continues; exit code 1 if any post failed (skipped empty-title posts are not failures). Authors are resolved before conversion (rows need the real `author_id`).
- Env (`.env.local` via dotenv, as in `scripts/backfill-deck-legality.ts`): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BLOB_READ_WRITE_TOKEN`, `NEXT_PUBLIC_BLOB_BASE_URL`.

## 13. Quality gates and rollout

1. Unit tests (vitest) for parse, preprocess (incl. wpautop), toMarkdown, urls, assemble, media helpers, and the byline.
2. Full-corpus dry run: zero residual markers; every residual HTML tag reviewed; every site media URL either planned or in `missingMedia`.
3. Render check: `scripts/wxr-render-sample.ts --slugs a,b,c` renders the dry-run markdown through the real `ArticleBody` (`react-dom/server`) into `scripts/output/wxr/render/<slug>.html` with a minimal stylesheet; reviewed in a browser for images, embeds, links, headings and deck-list line breaks across a classic post, a Gutenberg image post, an accordion deck post, a podcast post, a table post and a long-slug post.
4. Live: apply 096, `--media-only` for everything, then `--limit 20`, check `/articles` and a handful of posts on production, then the full run.
5. PR carries the migration, byline change, script, tests, spec, plan and a `CLAUDE.md` Key References row. The byline change deploys on merge; the import may run before or after (the deployed `COLUMNS` list only reads `author_name` once the byline code ships).

## 14. Cache

Public pages are cached under the `articles` tag and the script cannot revalidate. Imported rows appear at the next hourly revalidation or on the next publish/unpublish from the editor.

## 15. File layout

- `supabase/migrations/096_posts_import_columns.sql`
- `app/articles/lib/queries.ts` (`author_name`, `postByline`), `app/articles/components/PostCard.tsx`, `app/articles/[slug]/page.tsx`, `app/articles/lib/rss.ts`
- `scripts/import-wxr.ts`, `scripts/wxr-render-sample.ts`
- `scripts/lib/wxr/parse.ts`, `preprocess.ts`, `wpautop.ts`, `toMarkdown.ts`, `urls.ts`, `assemble.ts`, `media.ts`, `db.ts`, `report.ts`, with `scripts/lib/wxr/__tests__/*.test.ts` and `scripts/lib/wxr/__tests__/fixtures/`
- `scripts/data/wxr-authors.json`
- devDependencies: `turndown@^7.2.4`, `turndown-plugin-gfm@^1.0.2`, `fast-xml-parser@^5.11.1`, `he@^1.2.0`, `@types/turndown`, `@types/he`
- `.gitignore`: `scripts/output/wxr/`
- `CLAUDE.md` Key References row: “WordPress import”.
