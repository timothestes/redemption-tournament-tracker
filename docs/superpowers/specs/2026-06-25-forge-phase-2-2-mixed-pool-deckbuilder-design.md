# The Forge — Phase 2.2: Mixed-Pool Deckbuilder (Design)

**Date:** 2026-06-25
**Status:** Approved, ready for implementation plan
**Branch:** `forge-phase-2-1-playtester-access` (stacked on Phase 2.1, PR #133)
**Predecessor:** Phase 2.1 — Playtester Access Foundation (`docs/superpowers/specs/2026-06-25-forge-phase-2-1-playtester-access-design.md`)
**Master spec:** `docs/superpowers/specs/2026-06-19-forge-card-design-playtesting-design.md`

## Summary

The second sub-slice of **Phase 2 (Playtester play)**. A granted **playtester** (or elder/superadmin — roles are hierarchical) builds a Redemption deck from a **mixed pool**: the full public card pool plus the **approved** cards of every Forge set granted to them. Decks are validated live, **saved privately**, and listed/loaded/edited/deleted. This wires up the "Build a deck" tile that shipped disabled in 2.1 and lays the persisted-deck foundation that Phase 2.3 (games) will consume.

Phase 2.1 already delivered everything this slice stands on: the playtester role, set grants, the `/forge/play` surface, the approved-card reader (`listSetApprovedCards`), and the `?v=approved` art proxy. This slice adds **deck persistence + the builder**.

## Goals

- A granted playtester can browse a **merged pool** (public cards + granted approved Forge cards), build a deck across the standard zones (main / reserve / maybeboard), and see **live deck validation**.
- Decks **persist privately** (RLS), and the member can list, load, rename, edit, and delete them.
- Forge card identities/text **never leave Postgres-behind-RLS**: saved decks store Forge cards as opaque `card_id` UUID refs and re-resolve them live under the member's RLS.
- Reuse the existing public deck-validation rules unchanged; reuse the genuinely-pure deckbuilder modules; leave the live public builder (`/decklist`) untouched.

## Non-goals (deferred)

| Deferred to | Item |
|---|---|
| 2.3 | Lobby + SpacetimeDB-isolated games (a persisted deck is the input they'll consume) |
| 2.4 | "Updated card available" republish diff/swap + notifications |
| 2.5 | Public-pool promotion |
| — | Deck import/export **text** (the public token format has no Forge-UUID notion) |
| — | Tournament legality stamping (`deckcheck` / `decks.is_legal`) — Forge decks are not tournament entries |

## Security boundary (the dominant constraint)

The Forge spine is unchanged: prerelease card data reaches **no non-member**, and Forge card **text never lands outside Postgres-behind-RLS**.

- The new `forge_decks` table stores Forge cards as **`card_id` UUID refs only**. Public cards are stored as `name|set` strings (those identities are already public). No Forge card name/text/stats are persisted in the deck row.
- On load, Forge refs are **re-resolved live** under the member's own RLS (the same path `listSetApprovedCards` uses) to the **current approved version**. This also yields the master spec's "live resolution to current published version, never version-pin" property (Phase 2.4's republish *notification* stays out of scope; live resolution is free here).
- **Fail-closed by construction:** if a grant is later revoked, or a card is archived / sent back (un-approved), its `card_id` no longer resolves under the member's RLS and the entry silently drops out of the loaded deck. A non-member never reaches any of these routes (`requireForge()` → 404).
- The builder renders Forge approved-card art through the existing authed proxy `/forge/api/art/{cardId}?v=approved`. **No blob keys cross to any client component** — only booleans and the opaque `?v=approved` URL, exactly as the 2.1 reveal grid does.
- Storing a Forge `card_id` the owner cannot resolve **leaks nothing**: UUIDs are not enumerable, and resolution under the owner's RLS returns nothing for a foreign ref. Ref validation is therefore a data-quality concern, not a security one.

The keystone leak test gains one more table (`forge_decks`) and continues to assert anon reads **0 rows** from it.

## Reuse approach

**Chosen: a focused Forge builder that reuses the pure modules behind a thin Forge-specific shell.**

Reused as-is or near-as-is:
- `app/decklist/card-search/utils/deckValidation.ts` — `validateDeck(deck)`, **unchanged**.
- The card-grid rendering + filter predicates and the `Card` type (`app/decklist/card-search/utils.ts`).
- `<ForgeCardPreview>` (composite) and `CardImage` (already `unoptimized`-handles `/api/` URLs).
- Deck-state mechanics modeled on `useDeckState` (a small Forge-aware variant — see §"Card identity").

**Rejected alternatives:**
- *Parameterize the existing `CardSearchClient`* (~3000 lines). It is tightly coupled to public concerns — it imports `ALL_CARDS` directly, builds public blob image URLs, cloud-saves to the public `decks` table, and carries paragon/import-export machinery. Threading the private-art proxy and `forge_decks` persistence through it adds a conditional at every one of those seams, on a security boundary, while destabilizing a live public feature.
- *Extract a shared headless core and refactor both builders onto it.* A large refactor of working, security-sensitive public code — out of scope and against "surgical changes."

The focused builder keeps the security-critical paths (private art, RLS persistence, Forge identity) isolated and auditable, mirrors how every prior Forge slice was built (thin Forge shells over shared pure libs), and leaves `/decklist` untouched.

## Data model — migration 056 `forge_decks`

```sql
create table forge_decks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  format      text not null,          -- 'Type 1' | 'Type 2' | 'Paragon' | 'Classic' (existing format strings)
  paragon     text,                   -- set only when format = 'Paragon'
  cards       jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

`cards` jsonb is an array of deck entries, one of two shapes:

```jsonc
{ "source": "public", "name": "Angel of the Lord", "set": "Pa", "qty": 1, "zone": "main" }
{ "source": "forge",  "cardId": "<uuid>",          "qty": 1, "zone": "reserve" }
```

`zone ∈ { 'main', 'reserve', 'maybeboard' }`.

**RLS (default-deny):** select / insert / update / delete policies all gate on `owner_id = auth.uid()`. Owner-scoped personal data — there is **no superadmin read branch** (decks are not shared design assets). Anon is denied by default-deny + the leak test.

**Write path — a deliberate departure from the definer-RPC convention.** Other Forge tables route writes through `SECURITY DEFINER` RPCs because they involve multi-author authz over shared design assets. `forge_decks` is single-owner, so writes go through a **server action using the member's own RLS client** (`ctx.supabase` from `requireForge()`), with the `owner_id = auth.uid()` policies as the authority. This is simpler and adds no new RPC surface, with no loss of safety. (If review prefers strict convention-consistency, swapping to `forge_save_deck` / `forge_delete_deck` definer RPCs is mechanical.)

No new tables beyond `forge_decks`. No changes to `forge_set_grants`, `forge_cards`, or `card_versions`.

## Mixed-pool assembly & adapters

- **Server loader** (`app/forge/lib/play.ts` or a sibling): reuse `listSets()` + `listSetApprovedCards(setId)` (2.1) to gather every granted set's approved cards as `RevealCard[]` (`{ cardId, data: DesignCard, hasApprovedArt }`), tagged with their originating set. This already runs under the member's RLS — non-granted sets contribute nothing.
- **Pure adapter** `designCardToCard(reveal): Card` — maps a `DesignCard` into the deckbuilder's `Card` shape: collapse `cardType[]` / `brigade[]` into the delimited string form `validateDeck` expects, derive `alignment` and stats. This extends the `toCardData()` adapter the master spec already anticipated in `app/forge/lib/designCard.ts`. Pure and unit-tested.
- The merged pool handed to the builder = public `ALL_CARDS` ⊕ the adapted Forge cards, each Forge card carrying a `source: 'forge'` + `forgeCardId` marker for identity and image resolution.

## Card identity

The public deck-state keys entries by `name|set|zone`. A Forge "Angel of the Lord" must not collide with the public one, nor with a same-named card in another granted set. Forge entries therefore key on **`forge:{cardId}|zone`**. This single difference is why the builder uses a small **Forge-aware deck-state** (modeled on `useDeckState`) rather than the public hook verbatim. Public entries continue to key on `name|set|zone`.

## Validation

Reuse `validateDeck(deck)` **unchanged** for live structural + legality feedback in the deck panel (deck size, lost-soul ratios, reserve limits, dominants, Type 2 balance, Paragon brigade distribution). Playtest cards conform to existing deck-building rules (master spec §"Playtest cards conform to existing deck-building rules"), so no rule changes are needed.

**Skip** the server-side `deckcheck` / `is_legal` stamp — that path is for tournament-submitted public decks and expects real card names in a registry that Forge cards are absent from. Forge decks are practice/playtest artifacts, not tournament entries.

## Image rendering

A card-image resolver decides the source per card:
- **Public card** → existing public blob URL (`useCardImageUrl` / `cardImageUrl`).
- **Forge card with approved art** → authed proxy `/forge/api/art/{cardId}?v=approved` (already streamed with `Cache-Control: private, no-store`; `CardImage` already sets `unoptimized` for `/api/` URLs).
- **Forge card without approved art** → render the `<ForgeCardPreview>` CSS composite, mirroring the 2.1 reveal grid.

No blob keys cross to the client; only the opaque `?v=approved` URL and the `hasApprovedArt` boolean.

## Routes & UX

All under `/forge/play`, each page calling `requireForge()` (gate-first guardrail), and **allowed for the playtester role** (unlike the authoring routes, which redirect playtesters away).

- **`/forge/play`** — the 2.1 desk; the **"Build a deck" tile becomes enabled** and links to `/forge/play/decks`.
- **`/forge/play/decks`** — the member's saved Forge decks (name, format, card count, updated-at) + a **"New deck"** action.
- **`/forge/play/decks/[deckId]`** — the builder (a `new` sentinel for create):
  - **Left:** merged-pool search grid with a **source toggle (All / Forge-only)** and a **capable subset** of facets (free-text query + type / brigade / testament). The Forge portion of the pool is small, so the job is "surface the cards under test and add public support cards," not replicate the full public search.
  - **Right:** deck panel — main / reserve / maybeboard zones, quantity steppers, and the **live `validateDeck` summary** (issues + stats).
  - **Top:** deck name, format selector (+ Paragon picker when format = Paragon), and **Save**.

## Guardrails & tests

- Add `forge_decks` to `FORGE_TABLES` in `__tests__/forge-anon-leak.test.ts` (anon reads 0 rows). No new RPCs to probe (server-action write path).
- Unit-test the pure `designCardToCard` adapter and the deck-entry serialize / deserialize round-trip.
- The `forge-gate-first` test auto-covers the new `/forge/play/...` pages (each calls `requireForge()`).
- `npm test` green (Forge suites); `npm run build` clean (incl. the new `/forge/play/decks` routes).
- **Remaining manual step (no creds in session):** signed-in smoke as a granted playtester — build a mixed deck, save, reload, edit, delete; confirm approved Forge art renders via the proxy and a revoked grant drops its cards on reload.

## File-level plan (indicative)

| Area | File(s) |
|---|---|
| Migration | `supabase/migrations/056_forge_decks.sql` |
| Deck persistence (server action, RLS client) | `app/forge/lib/decks.ts` (`saveDeck` / `listDecks` / `getDeck` / `deleteDeck`) |
| Mixed-pool loader | `app/forge/lib/play.ts` (extend) or sibling |
| Pure adapter | `app/forge/lib/designCard.ts` (extend `toCardData`) + a `designCardToCard` helper |
| Forge-aware deck-state | `app/forge/play/decks/lib/useForgeDeckState.ts` (modeled on `useDeckState`) |
| Builder UI | `app/forge/play/decks/[deckId]/*` (client shell, search grid, deck panel) |
| Deck list | `app/forge/play/decks/page.tsx` |
| Desk tile | `app/forge/page.tsx` (enable "Build a deck") |
| Guardrail | `__tests__/forge-anon-leak.test.ts` (add `forge_decks`) |

## Open follow-ups (logged, non-blocking)

- Definer-RPC vs server-action write path for `forge_decks` (chosen: server action over RLS — see §Data model).
- A revoked-grant / un-approved card silently dropping from a saved deck is acceptable here; a *visible* "card no longer available" notice is part of the 2.4 republish/notification surface.
- Deck import/export text and tournament legality stamping remain out of scope by design.
