# The Threshing Floor — Secret Hosted Episode Outline Page

**Date:** 2026-06-12
**Status:** Approved design

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
  per episode number; last write wins.
- Replace regex-scraping of site HTML with proper endpoints for: tournament listings
  (upcoming + Nationals), spoilers, and deck-of-the-week lookup.
- Delete the dropped `TF Outline VersionB Toggle.html` from the repo root once ported.

## Non-Goals

- No React/component rewrite of the outline UI.
- No changes to the page's visual design, fonts, or embedded images.
- No draft version history or conflict resolution (last write wins).
- No public discoverability — no nav links, no sitemap entry.

## Architecture

### File layout

```
app/threshingfloor/
  outline.html              # the page, moved from repo root, patched
  route.ts                  # GET / — auth check + serve HTML
  api/
    drafts/route.ts         # GET list, PUT upsert
    drafts/[episode]/route.ts  # GET one draft
    data/route.ts           # GET tournaments / spoilers / deck JSON for auto-fill
supabase/migrations/
  044_threshing_floor.sql   # permission grants + drafts table + RLS
```

### Page serving (`app/threshingfloor/route.ts`)

- Route handler (not a page component) reads `outline.html` from disk and returns it
  as `text/html`.
- Before serving: create server Supabase client, call `get_my_admin_permissions()` RPC
  (existing pattern from `utils/adminUtils.ts` `hasPermission()`); require
  `threshing_floor` in the result.
- Unauthorized or unauthenticated → plain `404 Not Found` (route indistinguishable
  from nonexistent).
- Response headers: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: private, no-store`.
- **Vercel bundling:** loose files read with `fs` are not automatically included in the
  function bundle. Ensure `outline.html` is traced — via `outputFileTracingIncludes`
  in `next.config`, or by importing it as a raw string — and verify on a preview
  deploy, not just `npm run dev`.

### Permission (`044_threshing_floor.sql`)

- Document the new `threshing_floor` permission value in the migration comment header,
  consistent with `016_add_permissions_and_rharbold_admin.sql`.
- `array_append` the permission to the two existing `admin_users` rows (both users are
  already admins). Guard with `WHERE NOT permissions @> '{threshing_floor}'` so the
  migration is idempotent.

### Drafts table

```sql
CREATE TABLE threshing_floor_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- `data` is the exact flat object the page's existing `collectData()` produces
  (input/textarea/checkbox ids → values, plus `agur-cards` array and
  `collectors-card-img` which may contain base64 images).
- `episode_number` is text (matches the free-text `ep-num` input; e.g. "100", "100.5").
- RLS enabled. All four operations (SELECT/INSERT/UPDATE/DELETE) require the caller's
  `admin_users.permissions` to contain `threshing_floor`. Implemented via a
  `SECURITY DEFINER` helper or inline subquery consistent with existing RLS patterns
  in migrations 005/016.

### Draft API (`app/threshingfloor/api/drafts/`)

All handlers perform the same `threshing_floor` permission check; failures return 404.

- `GET /threshingfloor/api/drafts` — list: `[{ episode_number, updated_at }]`,
  ordered by `updated_at` desc. Powers the Load picker.
- `GET /threshingfloor/api/drafts/[episode]` — full row for one episode.
  Also supports `?before=<episode>` mode: returns the draft with the highest numeric
  episode number strictly less than the given one (powers "previous rankings").
- `PUT /threshingfloor/api/drafts/[episode]` — upsert `{ data }`. Sets `updated_by`
  to the caller and `updated_at = now()`. Rejects payloads over **10 MB** with a clear
  error (drafts can embed base64 card images; this caps runaway growth).

### Data endpoint for auto-fill (`app/threshingfloor/api/data/route.ts`)

One handler, `?kind=` query param, same permission check:

- `kind=tournaments` — upcoming tournament listings via the existing
  `loadUpcomingListings()` logic (`app/tournaments/actions.ts`). Returns the fields the
  page already consumes: `tournament_type`, `start_date`, `end_date`, `city`, `state`,
  `venue_name`, name. Serves both `fetchUpcomingTournaments()` and
  `fetchNationalsInfo()` (the page filters client-side).
- `kind=spoilers` — recent spoilers via the existing spoilers loader, returning the
  fields the page's spoiler picker consumes.
- `kind=deck&id=<deckId>` — deck summary via `loadPublicDeckDetail()`
  (`app/api/v1/decks/[id]/route.ts` already wraps this): deck name, creator,
  format, counts — whatever `parseDeckHtml()` currently extracts. The page will parse
  the deck id out of the pasted profile URL.

## HTML Patches

Surgical edits to `outline.html`; everything else byte-identical:

1. **`saveData()`** — PUT draft to the API keyed by `ep-num` (default `"draft"` if
   blank, matching current behavior). Status line shows save result + time. A new
   "Download JSON" ghost button in the toolbar preserves the original
   file-download behavior as an escape hatch.
2. **`loadData()`** — fetch the episode list, present a simple picker (reuse the
   page's existing `<select>` + Add button pattern, e.g. like `upcoming-picker`),
   load the chosen draft, and feed it through the existing restore logic unchanged.
3. **`loadPreviousRankings()` / `loadPreviousMetaRankings()`** — replace the file
   dialogs with a fetch of `?before=<current ep-num>`; same field-prefill behavior.
4. **`fetchTournamentListings()`** — fetch `?kind=tournaments` JSON; delete the
   regex-on-HTML parsing.
5. **`fetchRecentSpoilers()`** — fetch `?kind=spoilers` JSON; delete regex parsing.
6. **`fetchDeckInfo()`** — extract deck id from the pasted URL, fetch `?kind=deck&id=`;
   delete `parseDeckHtml()` and remove the "paste page source" fallback textarea
   (`dotw-paste`) and its instructions, no longer needed.

`localStorage` dark-mode persistence stays as-is.

## Error Handling

- All API routes: unauthenticated/unauthorized → 404; malformed input → 400 with a
  short message the page surfaces in its existing status spans.
- Page fetch helpers keep their current status-text error reporting (e.g.
  "Could not fetch…") — just with new failure sources.
- PUT size cap: 413 with message shown in the save-status span.

## Testing

- Unit-test the permission check helper path used by the route handlers (authorized,
  authenticated-but-unauthorized, anonymous → 404).
- Manual verification (Playwright or browser): as a granted user — page loads, save a
  draft, reload, load it back, load-previous-rankings prefills; as a normal user —
  `/threshingfloor` and all API routes return 404.
- Verify migration idempotency (re-run grants safely).

## Cleanup

- Delete `TF Outline VersionB Toggle.html` from the repo root in the same PR that adds
  `app/threshingfloor/outline.html`.
