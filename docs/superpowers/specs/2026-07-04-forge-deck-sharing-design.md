# Forge Deck Sharing — Design

**Date:** 2026-07-04
**Branch:** forge-phase-2-3-playtest-games
**Status:** Approved for implementation (autonomous session; decisions follow existing public-side sharing patterns)

## Goal

Forge members (playtesters, elders, superadmin) can share their playtest decks
with the rest of the Forge, browse each other's shared decks from the decks
page, and open any shared deck via a copyable link that shows a read-only
preview — like the public app's `/decklist/[deckId]` page, but gated behind
Forge membership.

## Non-goals

- No "public"/"unlisted" tiers. The audience is always exactly Forge members,
  so sharing is a single boolean: **Private** or **Shared with the Forge**.
- No copy-to-my-decks, tags, cover cards, prices, goldfish, or PDF/image
  export on the Forge preview. Those are public-side features; the Forge
  preview stays minimal (view + copy link + owner shortcuts).
- No OG/social metadata. The page 404s for non-members; scrapers see nothing.

## How the public side works (reference)

- `decks.visibility` (`private`/`unlisted`/`public`) + `ShareDeckModal`
  (visibility picker + copy-link input) in the builder / My Decks.
- Share link `/decklist/[deckId]` renders a read-only preview
  (`PublicDeckClient`): header (name, format badge, paragon, author, counts,
  dates), main deck grouped by card type with thumbnails, reserve section,
  card modal, Copy Link, owner-only editing shortcuts.

## Data model — migration `064_forge_deck_sharing.sql`

```sql
alter table public.forge_decks
  add column if not exists is_shared boolean not null default false;

-- widen reads: owner OR shared, always forge-member-gated
drop policy if exists "forge_decks_select" on public.forge_decks;
create policy "forge_decks_select" on public.forge_decks
  for select to authenticated
  using (public.is_forge_member() and (owner_id = auth.uid() or is_shared));

create index if not exists forge_decks_shared_idx
  on public.forge_decks (updated_at desc) where is_shared;
```

Insert/update/delete policies are untouched (owner-only), so a member can
never flip or edit someone else's deck. Anon still has no policy → 0 rows.

## Server actions (`app/forge/lib/forgeDecks.ts`)

- `listForgeDecks()` — unchanged filter (own decks), now also selects
  `is_shared` so the list can show a Shared badge.
- `setForgeDeckShared(id, shared)` — owner-only update (RLS-enforced).
- `listSharedForgeDecks()` — shared decks by **other** members
  (`is_shared = true`, `owner_id <> auth.uid()`), newest first, joined with
  `playtest_members.display_name` (readable by any member per migration 048).
- `getForgeDeckView(id)` — one deck (RLS: owner or shared) plus
  `ownerName`, `isOwner`, `isShared`, `updatedAt` for the preview page.
  Returns null → caller 404s, keeping the area secret.
- `getForgeDeck(id)` — gains `ownerId` in its return so the builder page can
  detect non-owners (reads are no longer owner-only under the new policy).

## Entry resolution (`app/forge/lib/deckView.ts`)

Pure, unit-testable resolver mirroring `forgeBuilderConfig.loadById`:
`resolveDeckEntries(granted: GrantedForgeCard[], entries: ForgeDeckEntry[])`
→ view items tagged `forge` (with `DesignCard`, art flags), `public` (with
catalog `Card`), or `dangling` (forge ref the viewer has no grant for →
rendered as an explicit "not shared with you" tile, same as the builder).
Grouping (type → display group) reuses the public page's group semantics.

## UI

### `/forge/play/decks` — decklists hub
- **Your decks** (existing list): each row gains a Share action opening
  `ForgeShareDeckModal` — two options (Private / Shared with the Forge),
  copy-link input when shared, modeled on the public `ShareDeckModal`.
  Shared decks show a subtle "Shared" badge.
- **Shared with the Forge** (new section): other members' shared decks —
  name, owner display name, format, card count, updated — linking to the
  view page.

### `/forge/play/decks/[deckId]/view` — read-only preview
- Server page: `requireForge()` else `notFound()`; `getForgeDeckView` else
  `notFound()`; fetches `listGrantedForgeCards()` for art resolution.
- Client viewer: header (name, format badge, paragon line, "by <owner>",
  main/reserve counts, updated date), actions (Copy link for everyone;
  owner also gets Share modal + "Edit in builder"), main deck grouped by
  type with thumbnails, reserve section, click-to-enlarge card modal.
- Art priority identical to the builder: approved finished upload
  (`/forge/api/art/{id}?v=approved&kind=finished`) → CSS composite
  (`ForgeCardPreview`) → public card image URL. Plain `<img>` only
  (next/image is banned under `app/forge/**`).

### Builder route guard
`/forge/play/decks/[deckId]` (builder) now compares `deck.ownerId` to the
caller and `redirect()`s non-owners to `…/view`, so shared decks can't be
opened in the builder where saves would silently no-op under RLS.

## Testing

- Unit: `deckView` resolver (forge/public/dangling mapping, grouping,
  counts) in vitest, following `forgeBuilderConfig.test.ts` conventions.
- Existing suites must stay green (`npm test`), plus `npm run build`.
