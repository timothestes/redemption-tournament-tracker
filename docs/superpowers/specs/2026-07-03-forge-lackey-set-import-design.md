# Forge: Lackey Set Import — Design

**Date:** 2026-07-03
**Status:** Approved for implementation (autonomous session; user pre-authorized)
**Revision (2026-07-03, post-build):** §4.4's per-card Server Action was replaced by a
batched route handler `app/forge/api/import/route.ts` (POST multipart: `payload` JSON +
`file-N` parts, ≤12 cards/request, per-card results). Next.js serializes Server Action
calls from one client, so the action-based import ran single-lane (~30 cards/min
measured); route-handler batches run genuinely in parallel (wizard: 8 cards/batch,
4 batches in flight, one shared dup-check query per batch). Gate, validation,
RPC pipeline, idempotency, and error semantics are unchanged.
**Depends on:** Forge phases 1a.x/2.x on `main`, incl. the 2026-07-03 descope (raw-text cards + finished-card images, migration 061)

## 1. Problem

The playtest elder team maintains new-set card data in LackeyCCG plugin format: a folder zip
containing `sets/carddata.txt` (the same 16-column TSV the public app already ingests via
`make update-cards`) plus full composed card scans in `sets/setimages/general/<ImageFile>.jpg`.
They want those cards inside the Forge (private, RLS-guarded) so the team can browse, deck-build,
and eventually playtest — without any of the data touching the public repo, public Blob store, or
git history.

The zip contains garbage we don't want (other sets' rows and images, decks, packs, sounds). Only
the rows matching a chosen set code (e.g. `EoT`) and their images matter.

Scope note (from the elder-team conversation): this slice delivers **goal 1** (elder uploads a
Lackey zip, filtered by set, populating a Forge set). Goals 2–3 (playtester deckbuilding /
in-app games with those cards) already exist as Forge phases 2.1–2.2 and activate the moment the
imported cards are published + approved — no new work in this slice.

## 2. Constraints that shaped the design

- **Vercel request bodies cap at ~4.5MB** (and `serverActions.bodySizeLimit` is 16MB). The zip is
  37MB → the zip **cannot** be posted to the server. It must be unpacked in the browser.
- **Security spine** (master Forge spec): secret data only in Postgres behind RLS; images only in
  the private Blob store, served via the authed proxy; every write via SECURITY DEFINER RPCs.
  This slice must not add any new leak surface.
- **Descoped card model** (2026-07-03): a Forge card = `title` + `working_snapshot` jsonb
  (name/rawText/…) + private artwork + private **finished-card image**. A Lackey scan *is* a
  finished-card image. Perfect fit — no schema change.
- The existing RPCs already compose into an import:
  `forge_create_card` → `forge_save_card` → `forge_set_working_finished` → `forge_share_card_to_set`.
  **Zero migrations. Zero new RPCs. Zero anon-leak-test surface change.**

## 3. Approaches considered

1. **Client-side unzip + per-card server action (CHOSEN).** fflate (already a dep) unpacks the
   zip in the elder's browser; carddata.txt is parsed and filtered locally; a preview renders
   straight from zip bytes (object URLs — instant, zero server round-trips); then one server
   action call per card (~200KB image each) creates the card via existing RPCs.
   - - no body-limit problems, no server zip-bomb surface, instant preview, per-card
     progress/retry, resumable.
2. **Upload zip to private Blob (client-direct), process server-side.** Needs client-upload token
   round trip, a long-running function unzipping 37MB, and progress plumbing. More moving parts,
   worse UX, new attack surface (server-side zip parsing). Rejected.
3. **Offline script (make target / node CLI).** Fails "elder can do it themselves in the app" and
   nails no permissions. Rejected.

## 4. Feature design

### 4.1 Route & permissions

- New page **`/forge/import`** (server component): calls `requireForge()` first (gate-first test
  compliance), redirects `role === "playtester"` to `/forge/play` (same pattern as other
  elder-only pages), 404s non-members via `notFound()`. The import UI itself is elder+superadmin
  only.
- New server actions in `app/forge/lib/importSet.ts` (`"use server"`), each starting with
  `requireElder()`. The underlying definer RPCs re-enforce authorization — the action gate is
  defense-in-depth, exactly like `cards.ts`.
- Entry point: a "Import a set" link/button on `/forge/sets` (elder view) → `/forge/import`.

### 4.2 Client wizard (`app/forge/import/ImportWizard.tsx`, client component)

Single-page stepper, all state local:

1. **Pick zip.** `<input type="file" accept=".zip">`. Parse with fflate in the browser
   (async `unzip` to keep the main thread responsive; only decompress `*/sets/carddata.txt`
   eagerly, images lazily on demand). Locate the carddata entry by suffix match
   `sets/carddata.txt` at any folder depth (Lackey zips wrap everything in a root folder whose
   name varies). Malformed/missing carddata → clear error state.
2. **Choose set filter.** Distinct `Set`-column values are shown as clickable chips with row
   counts (sorted desc) + a free-text input. Matching rule: case-insensitive exact match against
   `Set` **or** `OfficialSet`; a value wrapped in slashes (`/eot|tst/`) is treated as a
   case-insensitive regex (user request). Live match count updates as you type.
3. **Preview.** Grid of matched cards rendered **from zip bytes** (object URLs, revoked on
   unmount), with name + image-missing badge. No network. This is the "set preview as fast as
   the deckbuilder" moment — it's local, so it's faster.
4. **Choose destination.** Radio: **create new set** (name input, prefilled with the filter
   value) or **existing set** (dropdown from `listSets()`). Creating uses existing
   `createSet()` action.
5. **Import.** Client loops matched cards with concurrency 3; per card calls
   `importLackeyCard(setId, meta, formData)`. Progress bar + per-card status list
   (pending/uploading/done/skipped/failed + error text). Failed rows get a **Retry** button.
   Import is **idempotent by card title within the target set**: the action skips a card whose
   title already exists there, so re-running a partial import is safe.
6. **Done.** Summary (imported/skipped/failed) + link to `/forge/sets/{id}/cards`.

### 4.3 Parsing & mapping (`app/forge/lib/lackey.ts`, pure, client-safe)

TDD'd pure module, no server imports (mirrors `parse-carddata.js` conventions):

- `parseCarddata(text): LackeyRow[]` — split lines, `\t`-split, header row maps the 16 columns
  (`Name Set ImageFile OfficialSet Type Brigade Strength Toughness Class Identifier
  SpecialAbility Rarity Reference Sound Alignment Legality`), tolerate extra trailing columns
  (real files have rows with trailing tabs) and skip rows without a Name.
- `matchesFilter(row, filter): boolean` — the §4.2 rule.
- `distinctSets(rows): {set: string; count: number}[]`
- `imageEntryName(row): string` — `sets/setimages/general/${row.imageFile}.jpg` suffix, matched
  case-insensitively against zip entries (also accepts `.jpeg`/`.png`/`.webp`).
- `lackeyRowToDesignCard(row): DesignCard` — best-effort structured mapping so the Phase-2.2
  deckbuilder gets real data, with **full fidelity guaranteed by the finished image + rawText**:
  - `name` ← Name
  - `rawText` **and** `specialAbility` ← SpecialAbility (`-` → empty). rawText is what the studio
    textarea edits; specialAbility is what `designCardToCard` feeds the deckbuilder.
  - `cardType[]` ← Type split on `/`, trimmed, mapped: `Hero`, `Evil Character`→`EvilCharacter`,
    `GE`|`Good Enhancement`→`GE`, `EE`|`Evil Enhancement`→`EE`, `Lost Soul`→`LostSoul`,
    `Artifact`, `Dominant`|`Evil Dominant`→`Dominant`, `Fortress`, `Site`, `City`, `Curse`,
    `Covenant`. Unknown parts dropped (the image carries the truth).
  - `brigades[]` ← Brigade split on `/`, parentheticals lifted (`Purple (Crimson)` → Purple +
    Crimson), mapped (`Pale Green`→`PaleGreen`, `Good Gold`→`GoodGold`, rest 1:1); values not in
    the `Brigade` enum (e.g. Red/Teal/Evil Gold, multi-color words) dropped; `-` → [].
  - `strength`/`toughness` ← ints; `-`/empty → null.
  - `class[]` ← `Warrior`/`Weapon`; `icons[]` ← `Territory`/`Star`/`Cloud` (Lackey's Class column
    mixes both).
  - `identifiers[]` ← Identifier split on `,` trimmed; `-` → [].
  - `alignment` ← `Good`/`Evil`/`Neutral`; `Good/Evil` → `Good_Evil`.
  - `legality` ← value if in the enum, else omitted. `rarity`/`reference` ← value unless `-`.

### 4.4 Server action (`app/forge/lib/importSet.ts`)

```ts
importLackeyCard(
  setId: string,
  input: { name: string; snapshot: DesignCard },
  formData: FormData            // "file": finished-card image, optional
): Promise<{ ok: true; cardId: string; skipped: boolean } | { ok: false; error: string }>
```

1. `requireElder()` → null ⇒ `{ok:false, error:"Not available"}` (no role leak).
2. Validate: non-empty `name` ≤ 200 chars; snapshot serialized ≤ 32KB (server RPC enforces 64KB
   anyway); image (when present) via existing `validateArtFile` (JPEG/PNG/WebP ≤ 15MB).
3. **Skip-duplicate:** RLS-scoped select on `forge_cards` where `set_id = setId AND title = name`
   → `{ok:true, skipped:true}`.
4. `forge_create_card(name)` → `forge_save_card(id, snapshot)` → (if image)
   `uploadForgeFinished(file)` + `forge_set_working_finished(id, key)` →
   `forge_share_card_to_set(id, setId)`. Any RPC error → `{ok:false, error}` (a half-created
   card may remain as a private idea; re-running skips by title once it reached the set, and the
   wizard surfaces the failure for manual cleanup — acceptable for an elder-only tool).
5. `revalidatePath("/forge/sets/" + setId + "/cards")`.

Imported cards land as **`draft`** in the set (exactly what `forge_share_card_to_set` produces).
Publishing/approving for playtesters remains the existing per-card lifecycle (out of scope here).

Trust model: identical to `saveCard` — an elder-authored snapshot saved verbatim under definer
RPCs that re-check authorization. No new trust granted.

### 4.5 Fast set preview (`/forge/sets/[setId]/cards`)

Today every grid image hits the authed proxy with `Cache-Control: private, no-store` — each
visit refetches every card (147 images ≈ 27MB) — while the public deckbuilder rides a CDN'd
public store + lazy loading. Forge images can never be public/CDN-cached, but they can be
**browser**-cached:

- Art proxy (`app/forge/api/art/[cardId]/route.ts`): when the request carries a `t` cache-buster
  param **and is not a download**, respond `Cache-Control: private, max-age=31536000, immutable`;
  otherwise keep `private, no-store`. (`private` forbids shared/CDN caches; only the signed-in
  member's own browser stores it. Auth/RLS behavior unchanged.)
- `forge_cards.updated_at` bumps on every snapshot/image write (verified in 050/051/061), so
  grids/studio build image URLs as `/forge/api/art/{id}?kind=finished&t={Date.parse(updatedAt)}`
  — replaced images bust the cache automatically.
- `ForgeCardFace` `<img>` gains `loading="lazy" decoding="async"` so the first paint only fetches
  the visible viewport.

Result: first visit = lazy trickle of ~200KB images; every later visit = instant from browser
cache. That matches deckbuilder-feel for a grid that legally cannot use a CDN.

### 4.6 Individual card updates after import (StudioEditor)

Already supported: open a card from the set grid → studio edits `rawText` (autosave) and can
upload a replacement **finished card** image or alternate artwork. Two additions:

- **Confirm dialog (user requirement):** replacing the finished-card image when the card already
  has one **and no card fields were changed this session** pops an inline confirm dialog —
  "You're replacing the card image but haven't updated any card fields. If the new image changed
  the ability text, update the fields to match. Replace anyway?" [Replace] / [Cancel].
  Implementation: a `fieldsDirty` ref set by any `update()` call; the finished-file input checks
  `card.hasFinished && !fieldsDirty.current` before uploading. Plain conditional dialog markup
  consistent with existing forge styling (no new dependency).
- Studio finished/artwork previews adopt the same `t=` cache-busted URLs so a replaced image
  shows immediately after `router.refresh()`.

### 4.7 Playwright verification (committed e2e)

`e2e/forge/import.spec.ts` + `e2e/forge/forgeSeed.ts`, following the existing `e2e/seed.ts`
pattern (service-role admin client; auto-skips when `SUPABASE_SERVICE_ROLE_KEY` is absent):

- **Seed:** create auth user `forge-e2e-…@e2e.test` (password login) + `playtest_members` row
  with role `elder` (+ `nda_agreed_at`, display name). Cleanup deletes the user's forge cards,
  card_versions (cascade), set, membership, and auth user. (Tiny orphaned test blobs in the
  private store are accepted and documented.)
- **Fixture:** a synthetic Lackey zip built **in the test** with fflate `zipSync` — a root folder,
  `sets/carddata.txt` with 3 rows for fake set `TST` + 1 row for another set + garbage files
  (`packs/x.jpg`, `sounds/x.wav`), and tiny valid JPEGs for 2 of the 3 TST cards (one
  intentionally missing). **No real playtest card data ever enters the repo.**
- **Flow test:** sign in via `/sign-in` → `/forge/import` → upload fixture → filter `TST` →
  preview shows 3 matched (one flagged image-missing) → create new set → import → statuses all
  done → set cards page shows 3 cards; the 2 imported images actually render through the authed
  proxy (`naturalWidth > 0`); re-running the import reports 3 skipped (idempotency).
- **Permission tests:** anonymous → `/forge/import` is 404; seeded **playtester** member →
  redirected to `/forge/play`.

Additionally this session performs a **live smoke with the real EoT zip** against the dev server
(import into a scratch set, measure preview, screenshot), then deletes the scratch set/cards/user
completely. Nothing from that run is committed.

### 4.8 Explicitly out of scope

- Auto-publish/approve of imported cards (existing per-card lifecycle stands; a bulk-publish
  button is a natural follow-up and is listed in the UI/UX notes doc).
- Re-import/update-in-place semantics beyond skip-by-title (e.g. "update abilities from a newer
  carddata.txt"); `decks/`, `packs/`, non-`general` image dirs; artwork-only (non-finished)
  import; Lackey `.dek` deck import.
- Any change to playtester deckbuilding/games (already built in 2.1/2.2).

## 5. Error handling summary

| Failure | Behavior |
|---|---|
| zip unreadable / no `sets/carddata.txt` | wizard error state, nothing uploaded |
| row with no matching image | imported without image, flagged in preview + summary |
| oversized/wrong-type image | that card fails with the `validateArtFile` message; others proceed |
| action/RPC error mid-run | card marked failed with error text; Retry button; re-run skips completed titles |
| duplicate title in target set | skipped (counted, shown) |
| non-elder calls action | `{ok:false,"Not available"}`; RPCs would refuse anyway |

## 6. Testing

- **Unit (vitest, hermetic):** `lackey.ts` — header/row parsing incl. trailing-tab rows, filter
  matching (exact + regex + OfficialSet), distinct-set counts, image-entry resolution, full
  mapping table incl. dual types, parenthetical brigades, `-` handling, Good/Evil alignment.
  Fixtures are synthetic rows only.
- **e2e (Playwright, committed):** §4.7.
- **Existing gates:** `npm test`, `npm run build`, `npm run test:security` (surface unchanged —
  no new tables/RPCs), `forge-gate-first` auto-covers `/forge/import`.
