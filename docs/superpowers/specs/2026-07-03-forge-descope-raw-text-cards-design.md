# Forge Descope: Raw-Text Cards + Finished-Card Upload

**Date:** 2026-07-03
**Status:** Design — approved in brainstorming, pending subagent review then implementation
**Related:** `project_forge_playtesting` memory; builds on migrations 048–057.

## 1. Motivation

The Forge card model grew into a full structured-template designer: a card is a
`DesignCard` (type / alignment / brigade / strength / toughness / ability /
reference / identifiers / flavor …) rendered as a **layered CSS composite**
(`ForgeCardPreview`, from frame-asset WebPs + libre fonts). That is more machinery
than the workflow needs.

**Descope:** a Forge card becomes **a name + a freeform block of raw text**, plus
**two optional private image uploads** — the existing **artwork** (illustration)
and a new **finished card** (a fully-composed card image made elsewhere). We stop
rendering the composite. Wherever a card is shown, we display the **finished-card
image → artwork → a plain text tile** (in that order).

## 2. Scope

**In scope** (approved fork = "Studio + all display surfaces"):

- **Studio editor** (`app/forge/cards/[cardId]/StudioEditor.tsx`): remove the
  structured template form + composite hero; raw text + two uploads instead.
- **Display surfaces**: ideas/set card grids (`ForgeCardGrid`) and the playtest
  reveal (`app/forge/play/[setId]/RevealGrid.tsx`) stop rendering the composite
  and use the new fallback face.

**Explicitly left untouched this pass (flagged):**

- **Review / proposal / diff layer** (`ProposalDiff.tsx`) — still imports
  `ForgeCardPreview`. With structured fields gone, its composite renders mostly
  empty. Acceptable for a descope; not touched here.
- **Deckbuilder pool** (`app/forge/play/decks/[deckId]/forgeBuilderConfig.tsx`) —
  still renders the composite and still adapts `DesignCard`→playable `Card` for
  deck validation. New raw-text cards will have no structured type/brigade, so
  they will not validate/play meaningfully. Not touched here.
- `ForgeCardPreview.tsx`, `FullModeForm.tsx`, `designCard.ts` structured schema —
  **kept on disk** (commented out / unimported), so the structured designer is
  recoverable. Nothing is deleted.

**Non-goals:** no change to roles/invites/RLS spine, sets, lifecycle
(publish/approve/archive), realtime, set-artwork ZIP download, or the leak-test
architecture beyond adding the new RPC to the anon probe list.

## 3. Data model

### 3.1 Raw text — no migration

Reuse the existing `forge_cards.working_snapshot` jsonb. Add one field to the
`DesignCard` TS type:

```ts
rawText?: string;
```

Stored via the existing `forge_save_card(p_card_id, p_snapshot)` RPC (64 KB cap,
column-only) — the same debounced autosave the studio already uses. `name` stays
as `working_snapshot.name`. Frozen `card_versions.data` carries `rawText`
automatically (it is just the snapshot jsonb), so the reveal text tile reads it
from the frozen version.

We do **not** touch the `_forge_is_card_field` suggestion allowlist (053) — the
review layer is out of scope and no longer surfaces field-anchored suggestions in
the descoped studio.

### 3.2 Finished-card image — migration `058_forge_finished_card.sql`

The finished image **cannot** live in `working_snapshot` (that jsonb is sent to
the client for grids/reveal; blob keys must never cross the client per the leak
spine). It gets its own column, served through the existing authed art proxy —
mirroring the art pipeline exactly. A **single key** column suffices (finished
images are never processed, so there is no original-vs-display split, and no
placeholder concept — a finished card is by definition final):

1. `forge_cards`: add `working_finished_key text` (private-blob UUID pathname).
2. `card_versions`: add `finished_key text` (frozen at publish).
3. `forge_set_working_finished(p_card_id uuid, p_key text)` — SECURITY DEFINER,
   `search_path=''`, owner-or-elder-or-super gate (verbatim copy of
   `forge_set_working_art`'s auth check), sets `working_finished_key` +
   `updated_at`. `revoke execute … from public, anon; grant … to authenticated`.
4. **Replace** `forge_publish_card` (CREATE OR REPLACE — currently defined in 052)
   to also freeze `finished_key`: add the column to the `card_versions` INSERT
   with value `v_card.working_finished_key`. All other publish behavior verbatim
   (FOR UPDATE, max+1 version, supersede prior, status transitions).

No new tables → no new entry in `FORGE_TABLES`. The new RPC **is** added to the
anon-cannot-exec probe list in `__tests__/forge-anon-leak.test.ts`.

**Migration is a prod DB change → requires explicit user authorization before
applying** (per the Forge prod-migration policy).

## 4. Art/blob helpers (`app/forge/lib/art.ts`)

- Add `FINISHED_PREFIX = "forge-finished/"` and `uploadForgeFinished(file: File)`
  (mirrors `uploadForgeArt`, same private store + `validateArtFile` limits:
  JPEG/PNG/WebP, ≤15 MB). Reuse `readForgeArt` for reads (it takes any key).
- No change to `forgeAuth`, `readForgeArt`, or the private store.

## 5. Proxy (`app/forge/api/art/[cardId]/route.ts`)

Add a `kind` query param (`art` default | `finished`). Same gate (`requireForge`
→ 404), same stream + `Cache-Control: private, no-store`, same `?download=1`
audit. Key selection:

- `kind=finished`, working: select `working_finished_key`.
- `kind=finished`, `v=approved`: read `approved_version_id ?? published_version_id`
  → `card_versions.finished_key` (404 if null). Serves the **frozen** finished
  image, never the elder's live working slot — same guarantee art already gives.
- `kind=art` (default): unchanged.

## 6. Server actions & types (`app/forge/lib/cards.ts`)

- `ForgeCardFull`: add `hasFinished: boolean`. `CARD_COLS`: add
  `working_finished_key`. `toFull`: `hasFinished: !!row.working_finished_key`.
- Add `uploadFinished(cardId, formData)` server action — mirror of `uploadArt`:
  `requireElder` → `validateArtFile` → `uploadForgeFinished` →
  `forge_set_working_finished` RPC → `revalidatePath`.

## 7. New component: `app/forge/components/ForgeCardFace.tsx`

One small, hook-free component (usable from both server and `"use client"`
callers). Uses a **plain `<img>`** (never `next/image` — the
`forge-no-next-image` guardrail requires this and it keeps art on the authed
proxy). Card-shaped tile (`aspectRatio: 750/1050`). Render priority:

1. `finishedUrl` present → render the finished image alone (it *is* the card).
2. Else a text tile: `name` as heading + `rawText` body, with the `artUrl`
   image at the top of the tile when present. Empty → a muted "Untitled / no
   content yet" placeholder.

```ts
type Props = {
  name: string | null;
  rawText: string | null;
  finishedUrl: string | null;
  artUrl: string | null;
  className?: string;
};
```

## 8. Display-surface wiring

- **`ForgeCardGrid.tsx`**: swap `ForgeCardPreview` → `ForgeCardFace`, passing
  `name={c.snapshot.name}`, `rawText={c.snapshot.rawText}`,
  `finishedUrl={c.hasFinished ? `/forge/api/art/${c.id}?kind=finished` : null}`,
  `artUrl={c.hasArt ? `/forge/api/art/${c.id}` : null}`.
- **`play.ts` `listSetApprovedCards`**: select `finished_key` from
  `card_versions`; expose `hasApprovedFinished: boolean` on `RevealCard` (keep
  `hasApprovedArt`). The `finished_key` stays server-side — only the boolean
  crosses to the client, mirroring `art_key`.
- **`play/[setId]/page.tsx`**: build `RevealItem` with
  `finishedUrl: c.hasApprovedFinished ? `…?v=approved&kind=finished` : null`.
- **`RevealGrid.tsx`**: `RevealItem` gains `finishedUrl`; render `ForgeCardFace`
  (grid tile + enlarge overlay), reading `name`/`rawText` from `it.data`.

## 9. Studio editor (`StudioEditor.tsx`)

- **Comment out** the `FullModeForm` branch and the "Add card details →" toggle
  (and the `fullMode` state). File `FullModeForm.tsx` stays on disk.
- **Replace** the `ForgeCardPreview` hero with `<ForgeCardFace>` fed by the live
  snapshot + `card.hasFinished`/`card.hasArt` proxy URLs.
- Form body = **name input + one raw-text `<textarea>`** (bound to
  `snapshot.name` / `snapshot.rawText` via the existing debounced-autosave
  `update()`), plus an **Artwork** upload (unchanged, from what is currently in
  `FullModeForm`) and a new **Finished card** upload (calls `uploadFinished`,
  with its own `?kind=finished&download=1` download link). Keep the existing
  placeholder-art checkbox for artwork; no placeholder control for finished.
- Realtime presence/proposal wiring stays as-is (still keyed on `card.setId`).

## 10. Tests / guardrails

- **`forge-anon-leak.test.ts`**: add `forge_set_working_finished` to the
  anon-cannot-exec RPC probe list. (No new table; existing forge_cards /
  card_versions coverage extends to the new columns.)
- **`forge-gate-first.test.ts`**: no change — the art proxy route already exists
  and is covered; we only add a query param.
- **`forge-no-next-image.test.ts`**: `ForgeCardFace` must use plain `<img>` — the
  guardrail enforces it.
- **`forgeBuilderConfig.test.ts`** and any DesignCard/preview unit tests: left
  as-is (those surfaces untouched).
- Manual smoke (signed-in, needs creds): create a card → type raw text →
  upload art → upload finished card → confirm studio hero + ideas grid show the
  finished image; remove finished → falls back to art → remove art → text tile;
  publish into a set → playtest reveal shows the frozen finished image.

## 11. Risks / open items

- **Untouched composite surfaces render empty** for raw-text cards (ProposalDiff,
  deckbuilder). Known and accepted; flagged for a later pass if the review/deck
  flows are revived.
- **Deck validation** of raw-text Forge cards is meaningless (no structured
  type/brigade). Out of scope; deckbuilder untouched.
- **Prod migration 058** must be authorized before apply.
- **Orphaned blobs** on finished-image replace (same best-effort/no-cleanup
  behavior art already has — non-blocking, logged).
```
