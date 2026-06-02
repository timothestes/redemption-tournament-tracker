# Private Deck Share Links (Three-State Visibility) — Design

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation

## Problem

Today a deck's `decks.is_public BOOLEAN` controls two things at once:

1. Whether anyone with the link can view it at `/decklist/[deckId]` (anonymous-friendly).
2. Whether it appears in community search (`/decklist/community`).

Users want a **private share link**: a deck they can hand to specific people via a link, that is **not** listed or searchable in community. There is currently no middle state between "fully private" and "public + listed."

## Decision Summary

- **Visibility model:** three states — `private` / `unlisted` / `public`.
  - `private` — owner only.
  - `unlisted` — anyone with the link can view; **excluded** from community search and sitemap; marked `noindex` so search engines don't index it.
  - `public` — viewable by link **and** listed in community search (current "public" behavior).
- **The link:** reuse the existing `/decklist/[deckId]` read-only view. Deck IDs are UUID v4 (122 bits) — already unguessable. No new route, no share token. (Consensus of 3 advisory subagents, 2–1, favored reusing the UUID over a rotatable token; the dissent's revocation concern is accepted as a known trade-off, see below.)
- **Storage:** add a `visibility` enum-like text column as the **single source of truth**. Keep `is_public` as a **trigger-mirrored** column (`is_public = (visibility IN ('unlisted','public'))`) so the existing RLS policies and all "viewable by link" readers keep working unchanged. All known **writers** of `is_public` are migrated to write `visibility` instead.

### Accepted trade-off (the dissent)

No link rotation. Revoking a leaked unlisted link means setting the deck back to `private` (which also removes access for everyone who legitimately had the link). The migration leaves room to add a nullable `share_token` column later without reworking the model, if that need ever materializes.

## Data Model

Migration `041_add_deck_visibility.sql`:

```sql
-- 1. Add the source-of-truth column.
ALTER TABLE decks
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'unlisted', 'public'));

-- 2. Backfill from existing is_public so current public decks stay listed.
UPDATE decks SET visibility = CASE WHEN is_public THEN 'public' ELSE 'private' END;

-- 3. Keep is_public as a mirror of visibility via trigger, so existing RLS
--    policies and "viewable by link" readers continue to work unchanged.
--    (is_public := true when deck is unlisted OR public.)
CREATE OR REPLACE FUNCTION sync_deck_is_public()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_public := (NEW.visibility IN ('unlisted', 'public'));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_deck_is_public
  BEFORE INSERT OR UPDATE OF visibility ON decks
  FOR EACH ROW EXECUTE FUNCTION sync_deck_is_public();

-- 4. Index for the community filter.
CREATE INDEX idx_decks_visibility ON decks(visibility);
```

Notes:
- `is_public` is **not** dropped — this keeps the blast radius small. RLS (`is_public = true OR auth.uid() = user_id`) and `deck_cards` / `deck_tags` EXISTS-subquery policies are untouched and remain correct (unlisted + public are both viewable by link).
- The trigger fires `BEFORE INSERT OR UPDATE OF visibility`. Existing code paths that update other deck columns (e.g. `saveDeckAction`, deckcheck) do **not** touch `visibility`, so they don't fire the trigger and don't disturb `is_public`. Verified: `saveDeckAction` never writes `is_public` (the `is_public?` field on `SaveDeckParams` is vestigial).

## Code Changes

### Writers of `decks.is_public` → write `visibility` instead

These are the only three writers (verified by grep); each must be migrated, or the trigger would silently force the deck `private`:

1. `app/decklist/actions.ts` — `toggleDeckPublicAction(deckId, isPublic)` → replaced by **`setDeckVisibilityAction(deckId, visibility: 'private' | 'unlisted' | 'public')`**. Owner-only; validates the enum; keeps the existing username requirement when going `public` (community listing needs a username); keeps the auto-preview-card behavior when going `unlisted` or `public`; updates `revalidate*` calls. Returns a message reflecting the new state.
2. `app/tracker/tournaments/actions.ts:301` — `.update({ is_public: true })` → `.update({ visibility: 'public' })` (re-publishing existing tournament copies).
3. `app/tracker/tournaments/actions.ts:358` — `insert({ ..., is_public: true })` → `insert({ ..., visibility: 'public' })` (fresh tournament copies).

(Unpublish deletes the copies — no `is_public: false` write to migrate.)

### Listing readers → filter `visibility = 'public'` (exclude unlisted)

1. `app/decklist/actions.ts:1290` — community list (`loadPublicDecksAction`): `.eq('is_public', true)` → `.eq('visibility', 'public')`.
2. `lib/api/cache.ts:170` and `:205` — public decks **list** API (`loadListFresh` query + its PGRST103 count fallback): `.eq('is_public', true)` → `.eq('visibility', 'public')`.
3. `app/sitemap.ts:66` — sitemap: `.eq('is_public', true)` → `.eq('visibility', 'public')` so unlisted decks aren't advertised to crawlers.
4. `app/tracker/tournaments/actions.ts:112` — admin "Search public decks" to attach to a participant: `.eq('is_public', true)` → `.eq('visibility', 'public')` (unlisted shouldn't be discoverable here).

### "Viewable by link" readers → unchanged (keep allowing unlisted via `is_public`)

These intentionally keep `is_public` semantics (true for unlisted + public), so link/id holders can view:
- `app/decklist/actions.ts:412` — `loadDeckByIdAction`.
- `app/decklist/actions.ts:965` — `loadPublicDeckAction` (anonymous view of the share link).
- `app/decklist/actions.ts:1110` — `copyPublicDeckAction` (link holders can copy).
- `lib/api/cache.ts:245` — public API **detail by id** (`loadDetailFresh`): viewing a known id is consistent with "unlisted = accessible if you have the id."

### Loaders expose `visibility`

- `loadDeckByIdAction` and `loadUserDecksAction` add `visibility` to their `select` and return it.
- `loadPublicDeckAction` returns `visibility` so the public page can decide `noindex`.
- `app/decklist/card-search/hooks/useDeckState.ts:159` — track `visibility` alongside `isPublic` in deck state.

### Search-engine privacy (`noindex` for unlisted)

`app/decklist/[deckId]/page.tsx` `generateMetadata`: when the loaded deck's `visibility === 'unlisted'`, set `robots: { index: false, follow: false }`. Public decks remain indexable; private decks already 404/error for non-owners.

### UI

- **Deck builder** (`app/decklist/card-search/components/DeckBuilderPanel.tsx`): replace the binary Public/Private toggle with a **three-option visibility control** (Private / Unlisted / Public) matching existing button styling. Wire it to `setDeckVisibilityAction`.
  - Show **"Copy Share Link"** + **"View Public Page"** when visibility is `unlisted` **or** `public` (currently only when public). The link is `${origin}/decklist/${deck.id}`.
  - Unlisted shows a helper line: *"Anyone with the link can view this deck. It won't appear in community search."*
  - Preserve the existing `needsUsername` flow — required only when choosing `public`.
  - Reuse `ToastNotification` for "Link copied."
- **My Decks list** (`app/decklist/my-decks/client.tsx`): replace the binary Public/Private badge with a three-state badge (Private / Unlisted / Public) and update the inline toggle/menu to set visibility. (Lines ~233, 249, 1095–1113, 1214, 1270–1278.)

## Testing / Verification

- **Playwright e2e** (optional per request, but used to verify): sign in → create a deck → set **Unlisted** → assert "Copy Share Link" appears → open the deck URL in a fresh logged-out context → assert it renders read-only → search `/decklist/community` and assert the deck is **absent** → set **Private** → assert the anonymous URL now shows the "private" message.
- **SQL sanity:** after migration, assert `is_public = (visibility IN ('unlisted','public'))` for all rows; assert the community query returns no `unlisted` decks.
- **Build:** `npm run build` passes.

## Out of Scope

- Rotatable / revocable share tokens (deferred; seam left in the model).
- Per-recipient access control, expiring links, view analytics beyond the existing `view_count`.
- Changes to game-lobby `is_public` (different table) or tournament publish UX.
