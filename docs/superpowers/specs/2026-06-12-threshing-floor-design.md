# The Threshing Floor — Secret Hosted Episode Outline Page

**Date:** 2026-06-12
**Status:** Approved design (revised after two-agent review)

## Overview

Host the podcast episode-outline builder ("The Threshing Floor", currently a standalone
3,100-line HTML file: `TF Outline VersionB Toggle.html`) as a secret page at
`redemptionccg.app/threshingfloor`. Access is gated by a new `threshing_floor` admin
permission. Drafts persist in Postgres instead of downloaded JSON files. The page's
fragile HTML-scraping auto-fill features are replaced with real same-origin JSON
endpoints.

The HTML file is kept intact and patched surgically — no React rewrite. It is its own
complete document with its own styling; it does not use the app's layout or design
system, and that is intentional.

## Goals

- Serve the outline tool at `/threshingfloor`, invisible to anyone without permission
  (404, noindex, never linked from the UI).
- New `threshing_floor` permission using the existing `admin_users.permissions TEXT[]`
  system; granted to users **jhendrix6426** (`809bf436-d74d-41d2-be17-e37b03cd2328`)
  and **BaboonyTim** (`6d30f6e3-838e-4f11-9416-95996da6e5b9`).
- Shared draft pool: anyone with the permission sees and can edit all drafts; one draft
  per episode number; last write wins, with an optimistic-concurrency guard so
  overwrites are deliberate, not silent.
- Replace regex-scraping of site HTML with proper endpoints for: tournament listings
  (upcoming + Nationals), spoilers, and deck-of-the-week lookup.
- Delete the dropped `TF Outline VersionB Toggle.html` from the repo root once ported.

## Non-Goals

- No React/component rewrite of the outline UI.
- No changes to the page's visual design, fonts, or embedded images.
- No draft version history.
- No public discoverability — no nav links, no sitemap entry.

## Architecture

### File layout

```
app/threshingfloor/
  outline.html              # the page, moved from repo root, patched
  route.ts                  # GET / — auth check + serve HTML
  api/
    drafts/route.ts            # GET list (+ ?before=), PUT upsert handled per-episode below
    drafts/[episode]/route.ts  # GET one draft, PUT upsert, DELETE
    data/route.ts              # GET tournaments / spoilers / deck JSON for auto-fill
supabase/migrations/
  044_threshing_floor.sql   # permission grants + drafts table + RLS
```

### Page serving (`app/threshingfloor/route.ts`)

- Route handler (not a page component) reads `outline.html` from disk and returns it
  as `text/html`.
- Before serving: create server Supabase client and require the `threshing_floor`
  permission via `hasPermission()` (`utils/adminUtils.ts:33`, which wraps the
  `check_admin_role` + `get_my_admin_permissions` RPCs). Same pattern as the existing
  route-handler precedent `app/api/spoilers/upload/route.ts`.
- Unauthorized or unauthenticated → bare `404 Not Found` response. (Note: this is not
  byte-identical to Next's rendered not-found page; the security boundary is the
  permission check + RLS, not the 404 body.)
- Authorized responses only carry: `X-Robots-Tag: noindex, nofollow` and
  `Cache-Control: private, no-store`.
- **Vercel bundling:** loose files read with `fs` are not automatically included in the
  function bundle, and no existing route in this repo reads from disk
  (`next.config.js` has no `outputFileTracingIncludes`). Add
  `outputFileTracingIncludes` for this route, and verify on a preview deploy, not just
  `npm run dev`.

### Permission (`044_threshing_floor.sql`)

- Document the new `threshing_floor` permission value in the migration comment header,
  consistent with `016_add_permissions_and_rharbold_admin.sql`.
- `array_append` the permission to the two `admin_users` rows by user id, guarded with
  `WHERE NOT permissions @> '{threshing_floor}'` for idempotency, wrapped in a
  `DO $$` block that **asserts both rows were updated or already had the permission** —
  a missing row fails the migration loudly instead of silently no-opping.
- Migration filename note: numeric `044_` prefix sorts before the existing
  `20260110_create_avatars_bucket.sql`; ordering is harmless here (no dependency).

### Drafts table

```sql
CREATE TABLE threshing_floor_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- `data` is the exact flat object the page's existing `collectData()` produces
  (input/textarea/checkbox ids → values, plus `agur-cards` array and
  `collectors-card-img` which may contain base64 images).
- `episode_number` is text, **normalized: trimmed, non-empty** (free text like "100",
  "100.5" allowed; the page defaults blank to `"draft"` as today).
- RLS enabled. All four operations (SELECT/INSERT/UPDATE/DELETE) require
  `'threshing_floor' = ANY(public.get_my_admin_permissions())` — the SECURITY DEFINER
  helper from migration 010. Do **not** use an inline subquery against `admin_users`:
  migration 009 documents that pattern failing due to circular RLS.

### Draft API (`app/threshingfloor/api/drafts/`)

All handlers perform the same `threshing_floor` permission check; failures return 404.
No CORS headers on any of these routes. Episode numbers travel as URL path segments:
the page must `encodeURIComponent()` them; handlers decode, trim, and reject empty or
`/`-containing values with 400.

- `GET /threshingfloor/api/drafts` — list: `[{ episode_number, updated_at }]`.
  Ordered by numeric episode number descending where the value is numeric, then
  `updated_at` desc for the rest. Empty table → `200 []`.
- `GET /threshingfloor/api/drafts?before=<episode>` — the "previous episode" draft:
  among rows whose `episode_number` matches `^\d+(\.\d+)?$`, return the full row with
  the highest numeric value strictly less than `before`. Non-numeric `before` → 400.
  No qualifying row → 404. (Powers "load previous rankings"; the page shows
  "Enter a numeric episode number first." / "No earlier episode draft found.")
- `GET /threshingfloor/api/drafts/[episode]` — full row for one episode; 404 if absent.
- `PUT /threshingfloor/api/drafts/[episode]` — upsert `{ data, lastSeenUpdatedAt? }`.
  Sets `updated_by` to the caller. **Concurrency guard:** if the row exists and
  `lastSeenUpdatedAt` is provided but doesn't match the row's `updated_at`, return 409;
  the page asks "Draft was changed by someone else since you loaded it — overwrite?"
  and retries without the guard on confirm.
  **Size cap: 4 MB** (Vercel rejects bodies over 4.5 MB at the platform edge, so a
  larger server-side cap is unreachable). The page also checks the serialized size in
  `saveData()` *before* sending and shows a friendly error in the save-status span,
  since an edge-rejected request never reaches our handler.
- `DELETE /threshingfloor/api/drafts/[episode]` — removes a draft (typo'd episode
  numbers shouldn't be immortal). The Load picker gets a small delete affordance with
  a `confirm()`.

### Data endpoint for auto-fill (`app/threshingfloor/api/data/route.ts`)

One handler, `?kind=` query param, same permission check:

- `kind=tournaments` — the full `TournamentListing` rows from the existing
  `loadUpcomingListings()` (`app/tournaments/actions.ts:23`), which already include
  `title`, `tournament_type`, `start_date`, `end_date`, `city`, `state`, `venue_name`,
  and `host_name` (the page's `addUpcomingPick()` uses `host_name`). Serves both
  `fetchUpcomingTournaments()` and `fetchNationalsInfo()`; the page filters
  client-side. The Nationals filter is patched from `=== 'National'` to a
  case-insensitive `/national/i` match — `tournament_type` is LLM-extracted free text
  and historical rows include variants like "Redemption National".
- `kind=spoilers` — `loadPublicSpoilersAction()` (`app/spoilers/actions.ts:16`); its
  fields (`card_name`, `set_name`, `set_number`, `image_url`, `spoil_date`) are exactly
  what the page's spoiler picker consumes.
- `kind=deck&id=<uuid>` — `loadPublicDeckDetail()` (`lib/api/cache.ts:290`). Response
  fields used: `name`, `username` (creator), `format` (mapped server- or client-side
  from `"Type 1"`/`"Type 2"` to the page's `T1`/`T2` options), `card_count`. The page
  parses the uuid from a pasted `redemptionccg.app/decklist/<uuid>` URL.
  **Known regressions, accepted:** color/alignment auto-fill is dropped (the payload
  has no brigade data) — `dotw-color` stays manual; the loader is cached with
  `revalidate: 3600`, so auto-fill can be up to an hour stale. Unlisted decks are
  served by design (link-access semantics, matching the public API); private decks
  return 404.

## HTML Patches

Surgical edits to `outline.html`; everything outside these functions and the toolbar
stays as-is (status-message strings inside them necessarily change, e.g. references to
`file.name`):

1. **`saveData()`** — serialize `collectData()`, check the 4 MB cap locally, PUT to
   the API keyed by `ep-num` (default `"draft"` if blank, matching current behavior),
   handle 409 with an overwrite confirm. Status line shows save result + time. A new
   "Download JSON" ghost button in the toolbar preserves the original file-download
   behavior as an escape hatch.
2. **`loadData()`** — fetch the episode list, present a picker (reuse the page's
   existing `<select>` + button pattern, e.g. like `upcoming-picker`) with a delete
   affordance, then **reset the form before restoring** (reuse `clearAll()`'s internals
   without its `confirm()`): the existing restore logic is append-only
   (`window.rtnDeadlineCount`, `agur-card-grid`, mailbag/news rebuilds), so loading a
   second draft in one session would otherwise merge the two and persist the corruption
   on next save. Track the loaded draft's `updated_at` for the PUT concurrency guard.
   Empty list → "No drafts saved yet."
3. **`loadPreviousRankings()` / `loadPreviousMetaRankings()`** — replace the file
   dialogs with a fetch of `/drafts?before=<current ep-num>`; same field-prefill
   behavior; status strings for non-numeric episode / no earlier draft per the API
   section.
4. **`fetchTournamentListings()`** — fetch `?kind=tournaments` JSON; delete the
   regex-on-HTML parsing. `fetchNationalsInfo()`'s filter becomes `/national/i`.
5. **`fetchRecentSpoilers()`** — fetch `?kind=spoilers` JSON; delete regex parsing.
6. **`fetchDeckInfo()`** — extract the deck uuid from the pasted URL, fetch
   `?kind=deck&id=`; fill name/creator/format/`card_count`; delete `parseDeckHtml()`
   and remove the "paste page source" fallback textarea (`dotw-paste`) and its
   instructions. (Old saved drafts containing a `dotw-paste` key are harmless — the
   restore loop ignores unknown ids.)

`localStorage` dark-mode persistence stays as-is.

## Error Handling

- All API routes: unauthenticated/unauthorized → 404; malformed input → 400 with a
  short message the page surfaces in its existing status spans; concurrency conflict
  → 409; oversized draft → client-side pre-check (server 413 as backstop).
- Page fetch helpers keep their current status-text error reporting style.

## Testing

- Unit-test the permission-check path used by the route handlers (authorized,
  authenticated-but-unauthorized, anonymous → 404).
- Unit-test the `?before=` numeric selection (mixed numeric/non-numeric rows,
  non-numeric param → 400, no match → 404) and episode-number validation.
- Manual verification (Playwright or browser): as a granted user — page loads, save a
  draft, reload, load it back (twice in a row — verifying the reset-before-restore),
  load-previous-rankings prefills, delete a draft; as a normal user — `/threshingfloor`
  and all API routes return 404.
- Verify migration idempotency (re-run grants safely) and loud failure on a missing
  user row.
- Preview deploy check: `outline.html` is served (file-tracing works on Vercel).

## Cleanup

- Delete `TF Outline VersionB Toggle.html` from the repo root in the same PR that adds
  `app/threshingfloor/outline.html`.
