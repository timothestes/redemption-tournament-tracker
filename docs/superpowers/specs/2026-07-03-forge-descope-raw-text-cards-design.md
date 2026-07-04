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

**Existing-data caveat (review finding #3):** the studio's current "napkin"
textarea (`StudioEditor.tsx`) binds the freeform box to `snapshot.specialAbility`,
**not** `rawText`. We introduce `rawText` and rebind the textarea to it — but any
card already saved in napkin mode has its text in `specialAbility` and would read
blank. To avoid silent data loss WITHOUT a backfill migration, **every read of the
raw text falls back**: `snapshot.rawText ?? snapshot.specialAbility` (in
`ForgeCardFace` and the reveal tile). Writes go to `rawText` only.

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
   `search_path=''`, sets `working_finished_key` + `updated_at`.
   `revoke execute … from public, anon; grant … to authenticated`. **Copy the
   auth gate from the 052 version of `forge_set_working_art`** (owner OR
   `is_forge_superadmin()` OR `is_forge_set_elder(set_id)` of *this card's* set) —
   NOT the older 050 version (`is_forge_elder_or_super()`), which 052 tightened
   for the I1 write-authz fix. (Finding #5.)
4. **Freeze `finished_key` into `card_versions` at BOTH writers.** Two RPCs INSERT
   into `card_versions` and MUST each add the `finished_key` column (value
   `v_card.working_finished_key`) to their INSERT — otherwise the finished image
   silently vanishes from playtest reveal on whichever path is taken:
   - `forge_publish_card` (defined in 052) — CREATE OR REPLACE.
   - **`forge_accept_proposal` (defined in 053) — CREATE OR REPLACE.** (Finding
     #1, BLOCKER: the review→accept flow also freezes a new published version. Its
     INSERT is at 053 lines ~156–161.)
   All other behavior of both RPCs verbatim (FOR UPDATE, auth gates, status
   guards, stale-base guard, max+1 version, supersede-prior, working-snapshot
   sync).
   - The other lifecycle RPCs (`forge_approve_card` / `forge_unapprove_card` /
     `forge_archive_card` / `forge_send_card_to_private`) only UPDATE status or
     flip pointers — they carry the existing row's `finished_key` forward, so no
     change is needed. **Implementer guard (finding #2):** before writing 058,
     run `grep -rn "insert into public.card_versions" supabase/migrations/` to
     confirm these two are still the only version writers.

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
  → select **`card_versions.finished_key`** from that version row (404 if null).
  Serves the **frozen** finished image, never the elder's live working slot — same
  guarantee art already gives. (No placeholder guard: finished cards have no
  placeholder concept, so unlike the art branch there is no `is_placeholder`
  check — just null → 404. Finding #6.)
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
  rawText: string | null;   // callers pass snapshot.rawText ?? snapshot.specialAbility (finding #3)
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
- **`play.ts` `listSetApprovedCards`**: add `finished_key` to the `card_versions`
  select; map `hasApprovedFinished: !!v.finished_key` on `RevealCard` (keep
  `hasApprovedArt`). The `finished_key` value stays server-side — it must never
  enter the returned object; only the boolean crosses to the client, mirroring
  `art_key`. **Second consumer (finding #4):** `app/forge/lib/deckPool.ts` also
  calls `listSetApprovedCards` and destructures `RevealCard`. Adding the new
  boolean field does not break it (it ignores the field); the deckbuilder pool
  simply won't show finished images — consistent with the deckbuilder being out
  of scope. No change needed to `deckPool.ts`.
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
  `update()` — note the textarea currently binds `specialAbility`; rebind it to
  `rawText`).
- **Lift the art-upload UI out of `FullModeForm` (finding #8).** The artwork
  `<input type=file>`, its `onUpload` handler, the placeholder-art checkbox, and
  the "Download original" link currently live *inside* `FullModeForm.tsx`
  (lines ~139–158), which we are commenting out. Move that art fieldset into the
  descoped `StudioEditor` body (or a small shared `ArtUpload` subcomponent) so it
  is not orphaned. Keep the placeholder-art checkbox for artwork.
- Add a new **Finished card** upload beside it (calls `uploadFinished`, with its
  own `?kind=finished&download=1` download link). No placeholder control for
  finished.
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
