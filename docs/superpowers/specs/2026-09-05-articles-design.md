# Articles — markdown posts with granted "poster" access

**Date:** 2026-09-05
**Status:** Approved design, pre-implementation
**Context:** landofredemption.com (WordPress on SiteGround) is being shut down.
Its blog is *active*: 211 posts in 2024, 108 in 2025, 63 so far in 2026, by
about ten authors. Before the WordPress site can be frozen, those authors need
somewhere to publish. This feature is that somewhere. Importing the 1,298
existing WordPress posts is a **separate follow-up** (§11); this spec only
leaves room for it.

## 1. Purpose & scope

A posts feature inside the tracker, public at `/articles`. Selected users
("posters") are granted a new `publish_posts` admin permission through the
existing superuser portal. Posters write in **markdown** in a textarea with a
toolbar and a live preview, upload images and audio to Vercel Blob, embed
YouTube by pasting a URL, and publish directly. No review step.

Locked decisions (owner-approved 2026-09-05):

- **Route:** `/articles`, nav label "Articles".
- **Editor:** markdown textarea + toolbar + preview. Not WYSIWYG. Storage is
  plain markdown so any tool can read it later.
- **Publishing:** posters publish directly. Drafts exist; scheduling does not.
- **Grouping:** free-text `tags` with typeahead from existing tags. No
  category table. (WordPress "categories" were mostly per-author series names
  such as "Redemption With Jayden"; a tag covers that.)
- **No comments.** WordPress comments fell to 3 in 2026.
- **Ownership:** a poster edits only their own posts. The superuser edits any.
- **Media:** images ≤ 15 MB, audio ≤ 200 MB, uploaded browser → Blob directly.
- **Old posts:** out of scope here; `posts.source_url` is the hook for them.

## 2. Current state (what this builds on)

- **Permissions.** `app/admin/permissions/lib/permissions.ts` is the
  permission catalog and MIRRORS the SQL allowlist in
  `super_set_admin_permissions` (latest definition: migration 094 on the open
  PR #355 `feat/catalog-permission`, which adds `manage_catalog`). Server
  gating: `requirePermission()` in `utils/adminUtils.ts` (requires an
  `admin_users` row AND the key). Client gating: `useIsAdmin()` →
  `permissions[]` from `AdminProvider`.
- **RLS pattern.** Since migration 062, `authenticated` has NO SELECT on
  `admin_users`; policies must gate on the SECURITY DEFINER helpers
  `public.get_my_admin_permissions()` / `public.is_superuser()` and never on
  an inline `EXISTS (select 1 from admin_users …)` subquery (093 fixed four
  tables that did).
- **Closest existing feature: spoilers.** `app/spoilers/page.tsx` +
  `[id]/page.tsx` (public, `generateMetadata` with Open Graph image),
  `app/spoilers/actions.ts` (public loaders), `app/admin/spoilers/actions.ts`
  (mutations gated by `requirePermission("manage_spoilers")`, `revalidatePath`
  after writes), `app/api/spoilers/upload/route.ts` (server-side `put()` to
  the public Blob store with `BLOB_READ_WRITE_TOKEN`).
- **Markdown.** `react-markdown` ^10 is already a dependency (deck
  descriptions render `<ReactMarkdown>` inside `prose prose-sm
  dark:prose-invert`). `@tailwindcss/typography` is installed. `remark-gfm` is
  NOT installed yet.
- **Images.** `next.config.js` `remotePatterns` already allows
  `*.public.blob.vercel-storage.com`.
- **Profiles.** `public.profiles(id, username)` is publicly readable and a row
  is created for every new auth user by the `handle_new_user` trigger (007).
- **Nav.** `components/top-nav.tsx` (884 lines) renders a shared `navLinks`
  array for desktop and mobile, and an Admin dropdown whose entries are gated
  per permission key, duplicated for desktop (~line 232) and mobile (~line
  605).
- **Tests.** Vitest (`**/__tests__/**/*.test.ts`, `**/*.test.ts`), Playwright
  (`npm run test:e2e`). `__tests__/superuser-anon-leak.test.ts` is the model
  for an RLS leak test.

## 3. Data model

Migration `095_posts.sql` (numbering follows 094 from PR #355; if 094 is
renumbered before merge, renumber this one to stay after it).

```sql
create table public.posts (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  title           text not null,
  excerpt         text,                       -- optional; renderer falls back (§6.3)
  body_md         text not null default '',
  cover_image_url text,
  tags            text[] not null default '{}',
  status          text not null default 'draft'
                  check (status in ('draft','published')),
  author_id       uuid not null references public.profiles(id) on delete restrict,
  published_at    timestamptz,                -- set on FIRST publish, never changed
  source_url      text,                       -- reserved: original WordPress URL for imported posts
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index posts_published_idx on public.posts (status, published_at desc);
create index posts_tags_idx on public.posts using gin (tags);
```

- `author_id` references `profiles`, not `auth.users`, so PostgREST can embed
  the byline: `select("*, author:profiles(username)")`. Because a handful of
  very early users may predate the 007 trigger, the migration backfills
  `insert into public.profiles (id) select id from auth.users on conflict do
  nothing` before creating the table.
- `slug`: lowercase ASCII, words joined by `-`, max 80 chars, derived from the
  title on create; editable while `draft`; **immutable once published** (the
  server action rejects slug changes on published rows). Uniqueness: on
  collision append `-2`, `-3`, … server-side.
- `published_at` is set the first time status flips to `published` and is
  never cleared; unpublishing sets `status='draft'` only, so re-publishing
  keeps the original date. (This is also what a future import needs: a
  settable `published_at`.) There is no NOT NULL constraint, so the column
  stays nullable in the `PublicPost` type and the public loaders order by it
  with `nullsFirst: false`.
- `updated_at`: no trigger (the schema has none to copy); every update
  statement in the server actions sets `updated_at = now()` explicitly.

## 4. Permission & RLS

**New permission key `publish_posts`** (label "Posts"), added in three places
that must stay in sync:

1. `ADMIN_PERMISSIONS` in `app/admin/permissions/lib/permissions.ts`.
2. The SQL allowlist: 095 redefines `super_set_admin_permissions` **verbatim
   from 094** (so `manage_catalog` is not reverted) plus `publish_posts`.
3. The Admin dropdown in `components/top-nav.tsx`, desktop and mobile.

Posters therefore live in `admin_users` with (typically) only this one key,
which is exactly how the portal grants it today. `check_admin_role()` is true
for them, so the Admin menu appears and shows just "Posts".

**Policies on `posts`** (RLS enabled; `anon` and `authenticated` get the
default table grants):

| Op | Who | Rule |
|---|---|---|
| select | anon, authenticated | `status = 'published'` |
| select | authenticated | `author_id = auth.uid()` (own drafts) OR `public.is_superuser()` |
| insert | authenticated | `author_id = auth.uid()` AND (`'publish_posts' = any(public.get_my_admin_permissions())` OR `public.is_superuser()`) |
| update | authenticated | using/with check: (`author_id = auth.uid()` AND has `publish_posts`) OR `public.is_superuser()` |
| delete | authenticated | same as update |

Revoking `publish_posts` from a user leaves their published posts visible
(they are content, not a session) but removes their ability to edit them.

Server actions additionally call `requirePermission("publish_posts")` before
every mutation (belt and braces, and a clearer error than an RLS failure).

## 5. Public surface

### 5.1 `/articles` (index)

- Published posts, newest `published_at` first, 20 per page, `?page=N`.
- Optional `?tag=<tag>` filter (`.contains("tags", [tag])`), with the active
  tag shown as a dismissible chip.
- Each entry: cover thumbnail (or a neutral placeholder block when absent),
  title, byline (`profiles.username`), date, tags, excerpt.
- Server component + `export const revalidate = 3600`; mutations call
  `revalidatePath("/articles")`. **Public loaders use a cookie-less anon
  client** (§5.4) so the route is genuinely static/ISR; a cookie-bound
  client would opt the whole route into per-request rendering.
- Mobile-first list (single column); two-column card grid from `md`.

### 5.2 `/articles/[slug]` (post)

- `generateMetadata`: title, description = excerpt (or fallback), Open Graph
  `type: "article"` with `cover_image_url` when present, `publishedTime`,
  `authors`. Twitter `summary_large_image` when there is a cover.
- Body: `<ArticleBody markdown={post.body_md} />` (§6) inside
  `prose dark:prose-invert max-w-none` scoped by a wrapper class so the
  typography plugin's link/heading colours can be tuned without touching the
  deck description renderer.
- Header: title (Cinzel display per the design system), byline, date, tags
  (each a link to `/articles?tag=…`).
- `<EditLink postId authorId />`: a small client component that reads the
  session with `getUserSafe` and `useIsAdmin()`; renders "Edit" when the
  viewer is the author or the superuser. It is client-side because the page
  itself is ISR-cached and cannot vary per viewer.
- `notFound()` for unknown slugs **and for drafts, for everyone**. The page
  reads through the anon client (§5.4), which can only see published rows, so
  a draft is a 404 by construction. There is no draft URL: the author's
  preview is the editor's preview pane, which uses the identical renderer.
- `export const revalidate = 3600`; `revalidatePath("/articles/<slug>")` on
  every write to that post.

### 5.4 Cookie-less reads: `utils/supabase/anon.ts`

Public pages, `generateMetadata`, and the feed must not touch request cookies,
or Next renders them per request. Lift the `anonClient()` helper from
`lib/api/cache.ts` (plain `@supabase/supabase-js` client on the anon key,
`persistSession: false`) into `utils/supabase/anon.ts`, have `cache.ts` import
it from there, and build the public loaders in `app/articles/lib/queries.ts`
on it: `loadPublishedPosts({ page, tag })`, `loadPostBySlug(slug)`,
`loadFeedPosts()`, `listPublishedTags()`. RLS does the filtering; the loaders
add `.eq("status", "published")` anyway so intent is visible in the code.
`unstable_cache` is stale-while-revalidate on tag revalidation, so the first
public read after a write can still serve a cached copy for a second or two
while the fresh copy rebuilds in the background; the e2e suite asserts
eventual consistency rather than an immediate update.

### 5.3 `/articles/feed.xml`

- Route handler returning RSS 2.0 for the 30 latest published posts:
  `title`, `link`, `guid`, `pubDate`, `dc:creator`, `description` = excerpt.
  Absolute URLs from
  `NEXT_PUBLIC_SITE_URL` (fallback `https://redemptionccg.app`, same as
  `utils/email.ts`). `Content-Type: application/rss+xml; charset=utf-8`,
  `Cache-Control: s-maxage=3600`. Hand-built XML with an escaping helper; no
  feed library.
- `<link rel="alternate" type="application/rss+xml">` in the `/articles`
  page metadata.

## 6. Markdown: conventions, rendering, editor

### 6.1 Conventions (what the toolbar writes, what the renderer expects)

| Thing | Markdown written | Rendered as |
|---|---|---|
| Image | `![alt](https://…blob…/posts/<id>/x.webp)` | `<img loading="lazy" decoding="async" class="…">` (plain `img`, no `next/image`: dimensions are unknown and remote hosts vary) |
| YouTube | a paragraph containing **only** the URL, e.g. `https://youtu.be/abc123` | responsive 16:9 `<iframe src="https://www.youtube-nocookie.com/embed/abc123">` |
| Audio | `[Episode 12](https://…blob…/posts/<id>/ep12.mp3)` | `<audio controls preload="none" src>` followed by the original link |
| Everything else | GitHub-flavored markdown | react-markdown defaults |

YouTube ID parsing accepts `youtube.com/watch?v=`, `youtu.be/`,
`youtube.com/shorts/`, `youtube.com/embed/`, with or without `www.`, and
ignores extra query params. Audio detection is by extension on the URL path:
`mp3`, `m4a`, `ogg`, `wav`.

### 6.2 Renderer: `app/articles/components/ArticleBody.tsx`

- `react-markdown` + `remark-gfm` (new dependency). **No `rehype-raw`**:
  raw HTML in the markdown is escaped, which is the whole XSS story. The
  default `urlTransform` already drops `javascript:` URLs.
- Custom components:
  - `p`: if the paragraph's only child is a link (autolinked by GFM or
    explicit) whose href parses as a YouTube URL, return the embed **instead
    of** a `<p>` (an iframe inside `<p>` is invalid HTML and triggers
    hydration warnings). Otherwise a normal paragraph.
  - `a`: audio extension → player + link; otherwise `<a>` with
    `rel="noopener noreferrer"` and `target="_blank"` for external hosts.
  - `img`: as above.
- Pure helpers in `app/articles/lib/markdown.ts`: `youtubeId(url)`,
  `isAudioUrl(url)`, `excerptFromMarkdown(md, 200)` (strips markdown syntax,
  collapses whitespace, cuts at a word boundary, adds an ellipsis),
  `slugify(title)`. All unit-tested.
- The same `ArticleBody` component is used by the editor preview (client) and
  the public page (server). One renderer, no drift.

### 6.3 Excerpt

`posts.excerpt` if set, else `excerptFromMarkdown(body_md)`. Used by the index
cards, `generateMetadata`, and the feed.

### 6.4 Editor: `app/admin/posts/components/PostEditor.tsx` (`"use client"`)

Fields: title, slug (auto-filled from title until the user edits it; read-only
once published), tags (chip input with typeahead from `listTagsAction()`),
cover image (upload button + preview + remove), excerpt (textarea, optional,
shows the fallback as placeholder), body.

Body = `<textarea>` + toolbar + preview:

- Toolbar buttons (each ≥ 44 px on touch): Bold, Italic, Heading, Quote,
  Bulleted list, Link, Image, YouTube, Audio. Formatting buttons wrap or
  insert at the selection. Link and YouTube prompt for a URL (YouTube inserts
  the URL as its own paragraph). Image and Audio open a file picker, upload
  (§7), then insert the markdown at the cursor with an "Uploading…"
  placeholder that is replaced on completion or removed on failure.
- Preview: `<ArticleBody>` fed by the textarea value. Desktop (`lg+`): editor
  and preview side by side. Below `lg`: a Write / Preview toggle, preview
  hidden by default.
- Actions: **Save draft**, **Publish** (drafts) / **Update** (published),
  **Unpublish** (published), **Delete** (confirm dialog). Save/Publish are
  disabled while an upload is in flight. Unsaved-changes guard on navigation
  (`beforeunload`).
- Errors from server actions surface inline (toast + field message), never
  silently.

### 6.5 `/admin/posts` (list) and routing

- `app/admin/posts/page.tsx`: server component gated by
  `hasPermission("publish_posts")`; renders 404 for everyone else (same
  posture as the other admin pages). Lists the caller's posts (superuser: all
  posts, with author column), split Drafts / Published, newest first, with
  "New post".
- `app/admin/posts/new/page.tsx` renders the editor with no id. Nothing is
  written on page load. The draft row is created by `createDraftAction({
  title })` on the **first Save or the first upload, whichever comes first**
  (uploads need the post id for the Blob prefix), and the editor then
  `router.replace`s to `/admin/posts/<id>` without losing state.
- `app/admin/posts/[id]/page.tsx` loads the post (RLS restricts to
  author/superuser) and renders `<PostEditor>`.

### 6.6 Server actions (`app/admin/posts/actions.ts`, `"use server"`)

`createDraftAction`, `updatePostAction` (title, slug, tags, cover, excerpt,
body), `publishPostAction`, `unpublishPostAction`, `deletePostAction`,
`listMyPostsAction`, `listTagsAction`. Every mutation: `requirePermission`,
validate (title non-empty on publish; slug pattern; tags trimmed, deduped,
lowercased, ≤ 10, each ≤ 40 chars), write, then `revalidatePath` for
`/articles`, `/articles/<slug>` (old and new slug if it changed while draft),
and `/articles/feed.xml`. Return `{ success, error?, post? }` and callers
branch on `success === false` (tsconfig is `strict: false`; truthiness
narrowing on unions is unreliable).

Public reads are **not** server actions; they are the plain functions in
`app/articles/lib/queries.ts` (§5.4). `listTagsAction` for the editor's
typeahead is the one read that goes through the cookie-bound client, because
it should include tags from the caller's own drafts.

`deletePostAction` also best-effort deletes the post's Blob prefix
(`list({ prefix: "posts/<id>/" })` then `del`) and logs, never fails, on
Blob errors.

## 7. Uploads

Browser → Blob directly, using `@vercel/blob/client`'s `upload()` against a
token route, so audio files never pass through a function body:

- Route `app/api/posts/upload/route.ts` (POST) implements `handleUpload`.
  `onBeforeGenerateToken` runs `hasPermission("publish_posts")` via the
  request-scoped Supabase server client (route handlers see the auth
  cookies), verifies the `pathname` starts with `posts/<postId>/` for a post
  the caller owns (or superuser), and returns
  `allowedContentTypes` (images: jpeg/png/webp/gif; audio: mpeg/mp4/m4a/ogg/wav),
  `maximumSizeInBytes` (15 MB for images, 200 MB for audio, chosen from the
  `clientPayload` kind), `addRandomSuffix: true`.
  `onUploadCompleted` is a no-op that logs; it is not relied upon (it cannot
  reach `localhost` in dev, and the client already receives the final URL).
- Token: `BLOB_READ_WRITE_TOKEN`, the public store the spoilers use. Not the
  private Forge store.
- Client helper `app/admin/posts/lib/uploadMedia.ts`: `uploadPostMedia(postId,
  file, kind)` → `{ url }`; validates type/size client-side first for a fast
  error.
- Cover images use the same path with `kind: "image"`.

## 8. Nav & wiring checklist

- `navLinks` in `components/top-nav.tsx`: add `{ href: "/articles", label:
  "Articles", icon: HiNewspaper }` (from `react-icons/hi`, the set the nav
  already uses) so both desktop and mobile pick it up. Confirm it is not
  caught by the "rendered separately" exclusions for Play/Spoilers.
- Admin dropdown (desktop AND mobile blocks): `permissions.includes(
  'publish_posts')` → link to `/admin/posts` labelled "Posts".
- `ADMIN_PERMISSIONS` + migration 095 allowlist (§4).
- `package.json`: add `remark-gfm`.
- `docs/mobile-backlog.md` is untouched; `CLAUDE.md` Key References gets one
  row pointing at this spec.

## 9. Design notes (see `prompt_context/design_system.md`)

- Article title in Cinzel display; body in Geist with the typography plugin's
  1.6-ish line height. Data labels (date, tags) in `label-sm` uppercase
  tracking, `on-surface-variant` colour.
- No 1px section borders: index cards sit on a raised surface tier; the
  editor/preview split uses background shifts.
- Green is reserved for hover/active/CTA (Publish is the primary CTA).
- No focus rings via `focus:ring-*` on form controls.
- Reading width: `max-w-3xl` like the spoilers page; images `max-w-full`.

## 10. Testing

- **Unit (vitest):** `app/articles/lib/__tests__/markdown.test.ts` for
  `youtubeId` (all four URL shapes, extra params, non-YouTube → null),
  `isAudioUrl`, `excerptFromMarkdown` (strips headings/links/images/emphasis,
  word boundary, ellipsis, short input unchanged), `slugify` (unicode,
  punctuation, length cap, collision suffix helper).
- **Renderer (vitest + react):** `ArticleBody` renders a YouTube-only
  paragraph as an iframe and not inside a `<p>`; an audio link as `<audio>`;
  raw `<script>` in markdown appears as text.
- **RLS leak (vitest, live DB, same harness as
  `__tests__/superuser-anon-leak.test.ts`):** `__tests__/posts-anon-leak.test.ts`
  — a draft is invisible to anon and to a second authenticated user; a
  published post is visible to anon; a user without `publish_posts` cannot
  insert; a poster cannot update another poster's post. Opt-in like its
  siblings (`describe.runIf(process.env.FORGE_LEAK_TEST === "1" && …)`, client
  built per test, not in the describe body) and added to the `test:security`
  script in `package.json`. It needs two throwaway authenticated users; create
  them with the service role inside the test and delete them in `afterAll`.
- **E2E (Playwright):** grant `publish_posts` to a test user via the
  `super_set_admin_permissions` RPC (service role), create a post, upload an
  image, publish, assert the public page renders the image and the byline,
  assert `/articles/feed.xml` contains the slug, unpublish, assert 404.
- **Type gate:** `npx tsc --noEmit` (never `next build` while the dev server
  runs; see memory on the shared `.next`).

## 11. Out of scope (explicit)

- Importing WordPress posts (WXR is in `tmp/`; would populate `source_url`,
  `published_at`, `author_id` mapping, and convert HTML → markdown).
- Comments, scheduling, revisions/history, co-authors, per-post byline
  override, a media library UI, search, an "Articles" block on the home page,
  a cover image in the feed, serving `/articles` under landofredemption.com
  (that is the archive project's rewrite, later).

## 12. Hazards for implementers

- **Worktree only.** `git worktree add ../rtt-articles -b feat/articles
  origin/main` (already created for this spec). Never touch the main
  checkout. `.env.local` is gitignored — copy it from the main checkout and
  diff the key sets.
- **Migration number.** 094 belongs to PR #355 (unmerged at spec time). 095
  must redefine `super_set_admin_permissions` from 094's body, not 087's.
  Apply to prod only with the PR merge, after 094 is live.
- **No inline `admin_users` subqueries in policies** (093).
- **`strict: false`**: branch on `=== false`, not truthiness, when narrowing
  `{ success, error }` unions.
- **Server client never in `"use client"` files.** The editor and the
  `EditLink` use `utils/supabase/client.ts`; actions and pages use
  `utils/supabase/server.ts`.
- **Konva/touch lessons don't apply here**, but the touch-target rule does:
  every toolbar button ≥ 44 px, and the mobile Write/Preview toggle must be
  reachable with the keyboard open.
- **`handleUpload` needs the raw request body**; do not read it before
  passing `request` in. Local dev: `onUploadCompleted` will warn that it
  cannot reach `localhost`; that is expected.
