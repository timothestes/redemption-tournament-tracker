# The Threshing Floor — Live View Mode (Public Published Outlines)

**Date:** 2026-06-12
**Status:** Proposed design (awaiting review)
**Builds on:** `2026-06-12-threshing-floor-design.md` (the private editor + drafts table)

## Overview

Let an outline author "Publish" a finished episode outline and get a permanent,
login-free, read-only URL to share (podcast description, Discord, socials). Listeners
open it without an account; it shows the same content as the PDF export but as an
interactive webpage, including the click-to-enlarge spoiler images a PDF can't do.

**Public URL:** `redemptionccg.app/threshingfloor/episodes/<episodeNumber>`
(two independent agents converged on this path: the podcast *is* named The Threshing
Floor, so the name is branding not a leak; `/episodes/` is self-describing and scales
to future artifacts.)

The published page is a **frozen snapshot** taken at publish time. The author keeps
editing the draft afterward without changing the public page until they Publish again,
which updates that one episode's page in place (no version history). Pages are
**noindex / link-only** — they work for anyone with the link but stay out of search.

## Why this is a modest lift

The draft data is **already stored server-side** (`threshing_floor_drafts`, built in the
prior project) — so this is not "build a public viewer from scratch," it's "give the
existing editor's saved data a public read-only view." Two pieces of the viewer already
exist inside `outline.html`:

- A complete **print mode** (`@media print`: hides toolbar/toggles/controls, shows 24
  plain-text "-print" mirror elements) — i.e. the file already knows how to render a
  control-free, document-style version of itself.
- A complete **spoiler enlarge modal** (`#spoiler-modal-overlay`, `closeSpoilerModal`,
  click a `.spoiler-card-img-wrap`) — the exact interactive feature requested.

So the design **reuses the one HTML file** in a "view mode" rather than re-implementing
~13 bespoke sections in React. One renderer, one source of truth, zero drift: when the
editor evolves, the public view evolves with it.

## Goals

- A "Publish" action in the private editor that snapshots the current outline to a
  public slot, returns the shareable URL, and reports published state on load.
- An "Unpublish" action that takes a page back down (→ 404).
- A public, anonymous, noindex route `/threshingfloor/episodes/<episode>` that renders
  the published snapshot read-only, with working spoiler/agur image enlarge.
- Frozen content: the view renders stored values only — it does NOT re-fetch live
  `/tournaments` or `/spoilers`.
- Re-publishing updates the same URL in place; publishing episode 101 never touches 100.

## Non-Goals

- No version history / draft previews of unpublished content.
- No React rebuild of the outline renderer.
- No public write path of any kind.
- No SEO/Open Graph push (link-only by decision).
- No editing from the public page.

## Architecture

### Storage (migration `046_threshing_floor_published.sql`)

Extend the existing row rather than add a table:

```sql
ALTER TABLE public.threshing_floor_drafts
  ADD COLUMN published_data jsonb,
  ADD COLUMN published_at timestamptz;
```

- `published_data` = frozen copy of `data` at publish time. NULL = not published.
- The draft (`data`) and the snapshot (`published_data`) are cleanly separated in one
  row, matching the author's "two slots per episode" instinct.

**Public read path — SECURITY DEFINER function (no anon RLS on the table):**

```sql
CREATE OR REPLACE FUNCTION public.get_published_outline(ep text)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT published_data
  FROM public.threshing_floor_drafts
  WHERE episode_number = ep AND published_at IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_published_outline(text) TO anon, authenticated;
```

This returns **only** `published_data`, and only when published — anonymous callers can
never reach the editable `data` or any unpublished episode. The table's existing RLS
(threshing_floor permission for all ops) is unchanged; no anon row access is granted.

### Publish API (authenticated — `app/threshingfloor/api/drafts/[episode]/publish/route.ts`)

Gated by `requireThreshingFloor()` (404 otherwise), same as the rest of the editor API.

- `POST` — body `{ data }`. Behaves as **save + snapshot in one step**: upserts `data`
  (so the published copy is exactly what's on screen, avoiding "published stale content"),
  then sets `published_data = data`, `published_at = now()`. Returns
  `{ episode_number, published_at, url }` where `url` is the public path.
  Reuses the 4 MB cap and episode normalization from the existing drafts route.
- `DELETE` — unpublish: `published_data = NULL`, `published_at = NULL`. Returns
  `{ success: true }`.

The existing `GET /threshingfloor/api/drafts/[episode]` and the list endpoint are
extended to also return `published_at` so the editor can show published state.

### Public viewer route (anonymous — `app/threshingfloor/episodes/[episode]/route.ts`)

A route handler (not a React page); the outline is a standalone branded document, so it
renders full-bleed with its own header and **no site TopNav** (a public share artifact,
like the PDF).

1. Normalize the `[episode]` segment with the existing `normalizeEpisode`.
2. `get_published_outline(episode)` via an anon Supabase client (cookie-free, like
   `lib/api/cache.ts`'s `anonClient`). NULL → bare `404`.
3. Read `app/threshingfloor/outline.html`, inject **before** the main `<script>`:
   `<script>window.__TF_VIEW__ = {"episode":"<ep>","data":<json>};</script>`
   — JSON serialized with `<`, `>`, `&`, ` / ` escaped to prevent any
   `</script>`/HTML breakout.
4. Serve `text/html` with `X-Robots-Tag: noindex, nofollow` and
   `Cache-Control: no-store` (so a re-publish is reflected immediately).

Vercel file tracing: add this route to `outputFileTracingIncludes` for `outline.html`
(same mechanism the editor route already uses).

### View mode inside `outline.html`

On init, if `window.__TF_VIEW__` is set, the page enters **view mode**:

- Adds a `view-mode` class to `<body>` and sets a `VIEW_MODE` guard the file checks.
- Populates the outline from `__TF_VIEW__.data` by **reusing the existing restore logic**
  (`applyDraft`), which already fills every field, rebuilds dynamic rows
  (mailbag/news/RTN/agur/spoiler cards), and applies section-toggle visibility.
- **Suppresses all network calls:** the restore path must not hit any
  `/threshingfloor/api/*` endpoint (they're auth-gated → would 404 for anon). Concretely,
  guard the `tog-rtn` auto-`fetchNationalsInfo()` and any `fetch*` so they no-op when
  `VIEW_MODE` is on. View mode renders stored values only.
- **Presentation:** reuse the structural intent of the existing `@media print` rules as a
  `body.view-mode` screen stylesheet — hide `.toolbar`, `.toggle-row`, section reorder
  controls, all add/remove/clear/fetch/carry-forward buttons, file inputs, and the draft
  picker; show the plain-text "-print" mirrors for bullet/meta fields; render remaining
  inputs/textareas as static, non-interactive text (no borders/affordances, readonly).
  Keep the screen's branded teal/dark look (not print's white).
- **Keep interactive:** the spoiler and agur (`.spoiler-card-img-wrap` / agur card)
  click-to-enlarge modals stay functional.
- The editor path (no `__TF_VIEW__`) is completely unchanged.

### Publish UX (editor toolbar)

- A **Publish** button next to Save/Load. On click: POST publish with the current
  `collectData()` payload; on success show the public URL with a **Copy link** affordance
  and an **Unpublish** button, in the existing status area / a small inline panel.
- On load / after save, if the episode is published, show "Published · <date>" with the
  link; otherwise "Not published."
- Reuses the styled confirmation dialog (`showConfirm`) for Unpublish.

## Security & privacy

- The public function exposes only `published_data` of published episodes — never the
  draft, never unpublished episodes. No anon RLS on the table.
- Injected snapshot JSON is HTML-escaped to prevent script/markup breakout. The view-mode
  renderer must populate fields via `.value`/`textContent`/`.src` (property), never
  `innerHTML` of stored text — the implementation plan includes an explicit audit of the
  reused restore code for any `innerHTML` sink fed by snapshot data (e.g. collectors/agur
  image blocks, spoiler notes).
- Publishing is the author's editorial act: "this is the public version." Internal notes
  not meant to be public are the author's responsibility to omit before publishing.
- `noindex, nofollow` + no sitemap entry + no nav link = shareable but not discoverable.

## Testing

- Migration: column add + function return; verify the function returns NULL for an
  unpublished or unknown episode and the snapshot for a published one; verify it cannot
  return draft `data`.
- Publish API: unauthorized → 404; POST snapshots current data and sets `published_at`;
  DELETE clears both; 4 MB cap honored.
- Public route: unknown/unpublished episode → 404; published → 200 HTML containing the
  injected snapshot and `noindex` header; injection escaping (a draft field containing
  `</script>` does not break the page).
- Manual/Playwright: publish an episode in the editor → open the public URL in a logged-
  out context → outline renders read-only, hidden sections stay hidden, spoiler images
  enlarge on click, no console errors / no failed API calls; unpublish → URL 404s.
- Full suite + tsc + production build green; anonymous sweep confirms editor and its API
  still 404 while the public episode route serves.

## Open question for the author (Jordan), post-build

Whether published pages should later get share/preview metadata (Open Graph) for nicer
Discord/social embeds — deferred for now per the link-only decision; trivial to add later.
