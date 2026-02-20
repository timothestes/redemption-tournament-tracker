# Public Deck Sharing — Design & Implementation Plan (v2)

## Current State Assessment

| Thing | Status |
|---|---|
| `is_public` column on `decks` table | ✅ exists |
| RLS policies for public deck reads | ✅ configured |
| `view_count` column on `decks` | ✅ exists |
| Toggle UI to make deck public | ✅ exists |
| Public deck viewing page | ✅ exists |
| Share link button |✅ exists |
| "Copy to My Library" | ✅ exists |
| Community browse page | ✅ exists |

No migrations needed. The infrastructure is there.

---

## URL Structure Decision

### The Question
Should a shared deck link go to `/decklist/card-search/<deck-id>`?

**No.** The card-search page is a full editing environment — filter grids, add/remove buttons,
deck validation, sidebar state — all build-mode UI that would confuse a viewer receiving a link.
Sharing and editing are different user intents and deserve different experiences.

### Proposed URL Structure

```
/decklist                        # Hub page (currently a dead stub — fix this)
/decklist/card-search            # Deck builder: new deck
/decklist/card-search?deckId=X   # Deck builder: edit existing (no change to this)
/decklist/my-decks               # Your deck library (auth required)
/decklist/[deckId]               # Public deck view — READ ONLY
```

### Why `/decklist/[deckId]` (not `/decklist/public/[deckId]`)?

- **Short shareable URLs**: `https://site.com/decklist/abc-123` vs `/decklist/public/abc-123`
- **Next.js App Router** automatically gives static segments priority: `my-decks` and
  `card-search` folders win over the dynamic segment `[deckId]`, so there's no collision.
- Feels natural: "here's my decklist" → `domain.com/decklist/{id}`

The previous plan (`/decklist/public/[deckId]`) is fine if you prefer the explicit namespace,
but `/decklist/[deckId]` is cleaner for sharing.

---

## What Should `/decklist` Be?

Currently it renders a dead page with just a "Decklist" heading. Fix it to be a useful hub:

**Smart redirect (simplest):**
- If authenticated → redirect to `/decklist/my-decks`
- If not authenticated → redirect to `/decklist/card-search`

**OR — Hub landing page (nicer UX):**
Three feature cards:
1. **Build a Deck** → `/decklist/card-search?new=true`
2. **My Decks** → `/decklist/my-decks` (or "Sign in to view")
3. **Community Decks** → `/decklist/community` (grayed out "Coming Soon" until ready)

The hub page approach is better long-term. The smart redirect is 10 minutes of work.

---

## What `/decklist/[deckId]` Should Look Like

This is a lightweight read-only page. The viewer does NOT have deck builder access.

### Content to show
- Deck name, format, paragon (if applicable)
- Creator's display name (from Supabase auth.users metadata)
- Created/Updated date
- Card count (main + reserve)
- Cards grouped by type (Good Characters, Evil Characters, Enhancements, etc.)
- Card images (use the existing blob CDN)
- Deck description (if set)

### Actions
- **Copy to My Library** — duplicates deck into the viewer's account (requires auth)
  - Prompt sign-in if not authenticated
- **Share button** — copies current URL to clipboard
- **Open in Builder** — if the viewer IS the owner, show a button to open in editor
  - Detect: `session.user.id === deck.user_id`

### What it should NOT have
- Add/remove card buttons
- Filter grid
- Save/load controls
- Any editing UI

---

## Implementation Phases

### Phase 1 — Minimum Viable Sharing (just links)

**Goal:** A user can make a deck public and hand someone a URL. Viewer sees the deck read-only.

#### 1a. New server action: `toggleDeckPublicAction`
File: `app/decklist/actions.ts`

```typescript
export async function toggleDeckPublicAction(deckId: string, isPublic: boolean) {
  // Verify ownership (select deck, check user_id === session user)
  // UPDATE decks SET is_public = $isPublic WHERE id = $deckId
  // revalidatePath('/decklist/my-decks')
  // revalidatePath(`/decklist/${deckId}`)
}
```

#### 1b. New server action: `loadPublicDeckAction`
File: `app/decklist/actions.ts`

```typescript
export async function loadPublicDeckAction(deckId: string) {
  // SELECT deck + creator display_name (join profiles or use auth.users metadata)
  // SELECT deck_cards WHERE deck_id = deckId
  // Increment view_count (fire-and-forget)
  // Return { deck, cards, creatorName } | { error }
}
```

No RLS change needed — existing policy already allows reading public decks.

#### 1c. Toggle UI in My Decks
File: `app/decklist/my-decks/client.tsx`

Add to each deck's dropdown menu:
- Toggle labeled "Public" / "Private" with a globe/lock icon
- When toggling to public: small confirmation or inline note ("Anyone with the link can view this deck")
- Visual badge on deck card: "Public" pill when `is_public = true`

Also add toggle in the deck builder header/settings area.

#### 1d. Share Link in My Decks
File: `app/decklist/my-decks/client.tsx`

Add a "Copy Link" button to public decks in the dropdown:
```
https://site.com/decklist/{deckId}
```
Gray it out / show tooltip for private decks: "Make deck public to share."

#### 1e. Public deck view page
New files:
- `app/decklist/[deckId]/page.tsx` — server component, fetches deck, handles 404/private
- `app/decklist/[deckId]/client.tsx` — interactive parts (copy link, copy to library)

The server component handles:
- Auth check to determine if viewer is owner
- 404 if deck doesn't exist or is not public (and viewer isn't owner)
- OG meta tags for social preview

#### 1f. "Copy to My Library" action
File: `app/decklist/actions.ts`

Reuse the existing `duplicateDeckAction` or a new variant that accepts a source deck owned by
a different user. The duplicate will:
- Set `user_id` to the current session user
- Set `is_public = false` on the copy
- Give it the same name (maybe prefix with "Copy of")

---

### Phase 2 — Community Browse Page

**Goal:** Anyone can browse public decks. Useful discovery surface.

New route: `app/decklist/community/page.tsx`

Features:
- Grid of public deck cards
- Sort by: newest, most copied, most viewed
- Filter by: format (Type 1, Type 2, Paragon), brigade, paragon name
- Search by deck name or creator
- Pagination or infinite scroll

New server action: `loadPublicDecksAction({ page, format, sort, search })`

This requires good indexes. Check that `decks` has:
```sql
CREATE INDEX ON decks (is_public) WHERE is_public = true;  -- partial index
CREATE INDEX ON decks (updated_at DESC);
CREATE INDEX ON decks (view_count DESC);
```

---

### Phase 3 — Admin Labels

**Goal:** Admins can create labels and apply them to public decks. Labels appear as filterable
badges on the community browse page.

#### Data model

```sql
-- migration 008_add_labels.sql

CREATE TABLE labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT,                          -- hex string e.g. '#6366f1', for badge display
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deck_labels (
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  label_id UUID REFERENCES labels(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (deck_id, label_id)
);

-- RLS: anyone can read, only admins can write
-- (use the existing admins table pattern from migration 005)
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Labels are publicly readable" ON labels FOR SELECT USING (true);
CREATE POLICY "Only admins can manage labels" ON labels FOR ALL
  USING (EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()));

ALTER TABLE deck_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deck labels are publicly readable" ON deck_labels FOR SELECT USING (true);
CREATE POLICY "Only admins can assign labels" ON deck_labels FOR ALL
  USING (EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()));

-- Index for filtering
CREATE INDEX ON deck_labels (label_id);
```

#### Prepopulated labels vs. format column

Deck type (T1, T2, Paragon) is **already stored as `decks.format`** — no need to create label
records for those. The community browse filter UI exposes both:
- **Format filter**: derived from `decks.format` directly (fast, no join needed)
- **Label filters**: from the `labels` / `deck_labels` tables (admin-curated)

This keeps the labels system for *semantic* categorization: e.g. "Tournament Winner",
"Nationals 2025", "Budget Build", "Aggressive", "Control", "Beginner Friendly".

#### Admin UI

Location: `/admin/labels` (or add a "Labels" tab to `/admin/registrations` area)

Features:
- Create label (name + color picker)
- Delete label (cascades via FK)
- View all public decks, assign/remove labels from each

Alternatively: add label assignment directly to the public deck view page — show a label
picker visible only to admins. Simpler than a dedicated admin page since the deck is
already being displayed there.

#### Filtering on community browse page

The `loadPublicDecksAction` filter object gains a `labelIds: string[]` param.
Query becomes a JOIN + WHERE IN when labels are selected.

```typescript
// Filter payload
{ page, format, sort, search, labelIds: string[] }

// SQL (simplified)
SELECT d.* FROM decks d
LEFT JOIN deck_labels dl ON dl.deck_id = d.id
WHERE d.is_public = true
  AND (labelIds.length === 0 OR dl.label_id = ANY($labelIds))
  AND ($format IS NULL OR d.format = $format)
ORDER BY ...
```

---

## The Search Query URL Problem

### What's happening now

`updateURL()` in [card-search/client.tsx:261](../app/decklist/card-search/client.tsx) serializes
every active filter to a raw query param on every keystroke/filter change. There are 20+ params.
The result is URLs like:

```
/decklist/card-search?icons=%5B%7B%22icon%22%3A%22Blue%22%2C%22operator%22%3A%22AND%22%7D%5D&legality=Rotation&alignment=Good,Evil&rarity=R,UR&testaments=OT...
```

There's also a latent bug: when you have a saved deck open (`?deckId=X`) and change a filter,
`updateURL` fires and replaces the URL with filter params — silently dropping `deckId` from the URL.
Refresh the page and your deck context is gone.

### The fix: Two URL modes

The deck builder page is doing two different jobs and the URL should reflect that.

**Mode 1 — Deck editing** (`deckId` present or deck has been saved):
- URL: `/decklist/card-search?deckId=abc123` — nothing else
- Filter state lives in React state only, NOT written to the URL
- Rationale: you're working on a deck, not sharing a card search. Filters are ephemeral UI.
- Change: in `updateURL`, skip writing params when `deckId` is in state

**Mode 2 — Browse/search mode** (no deck, just filtering cards):
- Compress the entire filter state into a single `?s=` param
- `btoa(JSON.stringify(activeFilters))` → one base64 string
- URL: `/decklist/card-search?s=eyJxIjoiYWJyYWhhbSIsImljb25zIjpbXX0=`
- Decode on load: `JSON.parse(atob(searchParams.get('s')))`
- Much shorter, still shareable, single param to manage
- Backwards-compatible: keep reading old individual params so existing shared links still work

This is a contained change to `updateURL()` and the params-reading `useEffect`. No routing
changes needed. No new dependencies.

---

## Navigation Redesign

### Current state of the nav (cluttered)

```
[Logo] | Nationals | Tournaments | My Decks | Deck Builder | Deck Check PDF | Resources ▾ | Report a Bug | [Theme] [Auth]
```

Adding Community Decks as a flat nav item would make this 8+ items, clearly too many.

### Current deck items

- **My Decks** → `/decklist/my-decks`
- **Deck Builder** → `/decklist/card-search`
- **Deck Check PDF** → `/decklist/generate`
- *(future)* **Community Decks** → `/decklist/community`

### Recommendation: "Decks" dropdown

Consolidate all deck-related nav items under a single **Decks ▾** dropdown, modeled after the
existing Resources dropdown pattern. This:
- Reduces the nav bar from 6 items to 4 (Nationals | Tournaments | **Decks ▾** | Resources ▾)
- Makes community decks visible and prominent — it's the first item in the dropdown
- Follows an established nav pattern already in the codebase
- Keeps "Build a Deck" one click away

```
Decks ▾
├── 🌐 Community Decks     → /decklist/community     (NEW — promoted to top)
├── ── (divider) ──
├── 📚 My Decks            → /decklist/my-decks
├── 🔨 Deck Builder        → /decklist/card-search?new=true
└── 📄 Deck Check PDF      → /decklist/generate
```

**Active state:** The "Decks" button shows as active when `pathname.startsWith('/decklist')`.

**Community Decks as "New" badge:** When it first launches, put a small "New" badge next to the
Community Decks item in the dropdown to draw attention. Remove it after a month.

### Alternative: "Decks" → hub page (no dropdown)

If you want zero dropdowns, make "Decks" a single link to `/decklist` and put the
navigation on the hub page itself (tabs across the top: Community | My Decks | Build).
The downside is an extra click to reach the builder.

Given that Deck Builder is the most-used feature, the dropdown is probably better — it keeps
one-click access to everything.

### Mobile nav

Currently the mobile menu shows all nav items as a flat list. With the dropdown approach:
- The Decks section in mobile becomes an expand/collapse group (same as Resources today)
- Or just list them flat under a "DECKS" section header — simpler, no expand needed on mobile
  since screen space is less of a concern there

---

## Deck Preview / Thumbnail

Each deck card in the community browse grid needs a cover image. **Decision: user-chosen
cover card, with a smart auto-default.** One image per deck card, served from the existing
blob CDN — same path as every other card image in the app.

### DB column

```sql
-- part of migration 007_add_profiles_and_cover_card.sql
ALTER TABLE decks ADD COLUMN cover_card_img TEXT;  -- nullable, stores card_img_file value
```

Resolved to a full blob URL at render time using the same logic as `CardImage.tsx` /
`useCardImageUrl.ts`. No new image infrastructure needed.

### Default value (auto-assigned on save)

When a deck is saved and `cover_card_img` is null, compute it from `deck_cards`:

1. If `format = 'Paragon'` → use the paragon card image (already stored in `decks.paragon`,
   resolve to image via card name lookup)
2. Otherwise → first card matching priority order: Good Hero → Evil Character → Enhancement → any

Set this in `saveDeckAction` so it's always populated for new saves. Existing decks will
have `null` until re-saved; show a placeholder in the browse grid until then.

### "Set as cover" UI (Phase 2, not launch)

In the deck builder, add a "Set as cover" option to the card hover/context menu. This writes
`cover_card_img` on the next save. No separate save action needed.

### Browse grid card layout

```
┌──────────────────────────────┐
│  [cover card image, ~120px]  │  ← next/image, unoptimized=false (blob CDN, not /api/)
├──────────────────────────────┤
│  Deck Name                   │
│  Format badge  •  X cards    │
│  [label chips]               │
└──────────────────────────────┘
```

Cover image aspect ratio: card natural ratio (~0.72 tall), cropped/fitted to a fixed height.
Use `object-fit: cover` with a fixed container so browse grid stays uniform regardless of
which card was chosen.

### Not doing: composite thumbnail

A grid of 4–9 tiny card images would require N image requests per deck card in the browse
grid — too slow. Pre-rendering to a single image via canvas + Vercel Blob is too much
infrastructure for a thumbnail. Skipped.

---

## Profiles / Creator Display Names

**Current state:** There is NO profiles table. User identity = email from `auth.users`.
Showing emails publicly is a privacy problem.

**What's needed for "deck by X" attribution:**
```sql
-- migration 007 (or combine with cover_card migration)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: anyone can read, only owner can write
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are publicly readable" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update their own profile" ON profiles FOR ALL USING (auth.uid() = id);
```

**For Phase 1 public deck view**, fall back gracefully:
- Show `display_name` if profile exists
- If no profile → show nothing / show "Anonymous"
- Don't block the launch on profiles being complete

**Profile setup flow** (future): prompt on first save of a public deck — "Add a display name
so people know who built this?"

---

## Implementation Notes for the Next Claude Session

### The deckId-in-state detail (important for the URL fix)
`deck.id` is part of the `Deck` object returned by `useDeckState`. It's `undefined` until
first cloud save, then set to the UUID. In `client.tsx`, `updateURL` currently has no
awareness of `deck.id`.

The two-mode URL fix in `updateURL` should check:
```typescript
// deck comes from useDeckState
if (deck.id) {
  // Editing mode: keep deckId in URL, don't write filter params
  router.replace(`/decklist/card-search?deckId=${deck.id}`, { scroll: false });
  return;
}
// Browse mode: write compressed filter state
```

Also need: after a NEW deck is first saved (`deck.id` goes from undefined → uuid), push
`?deckId=X` into the URL so refresh works. Currently `useDeckState` does
`setDeck(prev => ({ ...prev, id: result.deckId }))` at line 297, but nothing pushes the URL.

### updateURL's current backwards compat note
The `?s=base64` compression for browse mode should fall back to reading old individual params
on load (so existing shared search links don't break). Read old params → decode to filter state
→ immediately replace URL with `?s=compressed`. After one visit the old URL is gone.

### Migrations needed (Phase 1)
```
007_add_profiles_and_cover_card.sql
  - CREATE TABLE profiles (...)
  - ALTER TABLE decks ADD COLUMN cover_card_img TEXT
  - ALTER TABLE decks ADD COLUMN is_public already exists ✅
```

### duplicateDeckAction for "Copy to Library"
The existing `duplicateDeckAction` in `actions.ts` clones a deck owned by the current user.
For "Copy to Library" from a public deck, it needs a variant that:
- Accepts a `sourceDeckId` that may be owned by a different user
- Verifies the source deck is public (or owned by caller) before copying
- Sets `is_public = false` on the copy
- Sets `user_id` to the session user

---

## Open Questions / Decisions Needed

1. **Creator name display**: No profiles table exists. Phase 1 can launch showing no creator name
   or "Anonymous", then add profiles as a follow-up. Don't block on it.

2. **Private → view URL behavior**: If someone has the link to a deck that the owner later makes
   private, should they get a 404 or a "This deck is private" message? A message is friendlier UX.

3. **Copy to Library for unauthenticated users**: Two options:
   - Show "Sign in to copy this deck" → redirect to auth, then redirect back to deck URL
   - Let them see the deck, but button prompts login (simpler)

4. **`/decklist` page decision**: Smart redirect vs. hub page. Smart redirect is 10 min of work.
   Hub page is worth doing before community features launch.

5. **Deck builder share button**: Once a saved deck is public, should the builder show a
   "Share" button (copy URL) in the header bar? Yes, and it should also show the public/private
   toggle there.

6. **Cover card at launch**: Option B (auto-default, no migration) or Option A (add column now)?
   Recommend: add the column in the Phase 1 migration batch so it's there, but auto-default
   the value at save time from existing card data — no picker UI needed for launch.

---

## File Checklist (Phase 1)

```
NEW:
  app/decklist/[deckId]/page.tsx          # Public deck view server component
  app/decklist/[deckId]/client.tsx        # Copy to library, share button

MODIFY:
  app/decklist/actions.ts                 # toggleDeckPublicAction, loadPublicDeckAction
  app/decklist/my-decks/client.tsx        # Public toggle, badge, copy link in dropdown
  app/decklist/card-search/client.tsx     # Public toggle + share button in builder header
  app/decklist/page.tsx                   # Make it useful (hub or smart redirect)

MAYBE:
  supabase/migrations/007_add_profiles.ts # Only if display names aren't stored anywhere
```

No new Supabase migrations needed for Phase 1 unless profiles are missing.

---

## Notes on the Existing Deck-Sharing Plan

The earlier `deck_sharing_implementation_plan.md` had the right instincts — this document
supersedes it with a clearer URL decision (`/decklist/[deckId]` over `/decklist/public/[deckId]`)
and more detail on each step. The earlier doc's "Future" list maps directly to Phase 2/3 here.
