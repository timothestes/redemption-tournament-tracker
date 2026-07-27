# Forge Art Candidates + Crop — Design

**Date:** 2026-07-26
**Status:** Approved design, pre-implementation
**Scope:** The Forge card studio (`/forge/cards/[cardId]`) — applies to idea cards and set cards alike, since they share the editor.

## Problem

A forge card holds exactly one artwork image. Uploading replaces it, and there is no
way to try alternate art or preview a crop. Designers exploring an idea want to
upload several candidate images and "imagine what a cropped version of the art
would look like" on the card face.

## Decisions (locked)

1. **Whole card studio**, not just the Ideas library — the editor is shared, so
   restricting to ideas would add code, not remove it.
2. **Crop bakes into the card art.** Applying a crop produces a new derivative
   image that becomes `working_art_key`; the uncropped source is preserved as
   `working_art_original_key` (the column's comment always anticipated this:
   "full-res original (== working_art_key in 1a.3; studio refines)"). No display
   surface changes anywhere — grids, playtests, version freezing, and exports all
   already render `working_art_key`.
3. **Candidates, one active.** Multiple images per card are a designer-side
   workspace. Exactly one (optionally cropped) is the active artwork; playtesters
   never see the others.
4. **Server-side crop with sharp** from a normalized crop rect — not client
   canvas pixels, not non-destructive CSS crop metadata (rejected: every render
   surface would need crop-aware logic).
5. **`react-easy-crop`** (~8 kB, touch/pinch) for the crop widget rather than
   hand-rolled pointer handles — mobile-first is a stated design principle.

## Data model — migration `082_forge_art_candidates.sql`

New table:

```sql
create table public.forge_card_art_candidates (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.forge_cards(id) on delete cascade,
  key        text not null,          -- private blob pathname (forge-art/<uuid>)
  created_at timestamptz not null default now()
);
```

- **RLS mirrors the card:** SELECT follows card visibility (the 057 policies);
  INSERT/DELETE follow card edit rights (owner elder / set elder / superadmin).
- **Cap: 12 candidates per card**, enforced in the insert RPC.
- **New RPCs only** — do not redefine `forge_set_working_art` or `forge_art_key`
  (see `reference_rpc_redefine_use_latest`). All `set search_path = ''`,
  EXECUTE revoked from `public, anon` and granted to `authenticated`
  (048 pattern). Writes are `security definer` with explicit owner-or-elder
  checks and no direct write policies, mirroring 050; the read is
  `security invoker` behind RLS, mirroring 066:
  - `forge_add_art_candidate(p_card_id uuid, p_key text) returns uuid` —
    definer; inserts a row after checking edit rights + the 12-row cap.
  - `forge_delete_art_candidate(p_candidate_id uuid) returns void` — definer;
    deletes the row; **refuses when the candidate's `key` equals the card's
    `working_art_original_key`** (it is the source of the active artwork).
  - `forge_candidate_art_key(p_card_id uuid, p_candidate_id uuid) returns text` —
    invoker; key lookup for the image proxy; returns null unless the caller
    passes the candidates SELECT policy (owner or elder/superadmin —
    candidates are a designer workspace, so playtesters are excluded).

Frozen versions (`card_versions`) copy blob *keys*, never candidate rows, so
candidate deletion can never affect version history.

## Upload flow

In the studio's **Artwork (illustration)** fieldset:

- A gallery grid of candidate thumbnails (authed proxy URLs, `t`-stamped for
  caching), plus an **Add images…** picker accepting multiple files
  (`FilePicker` gains an optional `multiple` prop with an `onFiles` callback;
  existing single-file call sites are untouched).
- Per file, sequentially: `validateArtFile` → `normalizeCardImage` (existing
  trim / 1050px cap / JPEG pipeline) → `put` to the private store →
  `forge_add_art_candidate`. One server action call per file
  (`addArtCandidate(cardId, formData)`); the client shows an "Uploading n of m…"
  counter and surfaces per-file errors without aborting the batch.
- **Auto-activate:** if the card has no artwork when a batch starts, the first
  successfully uploaded candidate becomes the active art uncropped
  (`forge_set_working_art(key, key)`), preserving today's one-step upload flow.

## Crop UI

Clicking a candidate thumbnail opens a modal:

- `react-easy-crop` pan/zoom cropper. **Frame aspect locked to the card face's
  art slot, 750:504** (the art strip is 48% of the 750×1050 face), so the frame
  contents are exactly what the card face will show. Free-form aspect is out of
  scope (noted future extension).
- Live preview of the resulting card face: beside the cropper on desktop,
  below it on mobile.
- Actions: **Use cropped** (apply crop server-side, below) and **Use uncropped**
  (make this candidate the active art as-is:
  `forge_set_working_art(candidateKey, candidateKey)`).
- Re-opening the cropper always starts from a fresh centered crop. Persisting
  the last crop rect per candidate is a noted future nicety, not in scope.

## Apply crop — server action

`applyCrop(cardId, candidateId, rect)` where `rect = {x, y, width, height}` in
**0–1 fractions of the source image's natural dimensions**:

1. Auth: `requireElder` (same gate as `uploadArt` today; the RPCs re-check).
2. Resolve the candidate's key, read the blob (`readForgeArt`).
3. Clamp the rect to image bounds; reject degenerate results (either output
   dimension < 32 px).
4. `sharp(...).extract(...)` → re-encode JPEG q85 (mozjpeg), cap height 1050 —
   a small `cropCardImage(input, rect)` helper beside `normalizeCardImage`
   (no trim pass; candidates are already normalized).
5. Upload the crop as a new private blob, then
   `forge_set_working_art(croppedKey, candidateKey)`.

## Serving & downloads

- `/forge/api/art/[cardId]` gains `candidate=<id>`, resolved via
  `forge_candidate_art_key`; identical member gate, 404-on-anything, and
  `t`-stamped `private, immutable` caching. `download=1` composes with it.
- **Download original** in the studio points at the active source candidate
  (`?candidate=<id>&download=1`) when the active art's source is a candidate;
  legacy cards (pre-gallery, where `working_art_original_key ==
  working_art_key`) keep today's link and behavior.

## Edge rules

- The candidate whose `key` equals `working_art_original_key` renders an
  "active" ring; its delete button is disabled with a hint ("source of the
  current artwork"). This keeps re-crop and download-original always working.
- Deleting any other candidate removes the **row only**; the blob is left
  dangling (private + UUID keys are invisible and harmless — the codebase's
  existing stance in `app/forge/lib/art.ts`).
- Legacy cards start with an empty gallery; their existing artwork is untouched
  and still replaceable by uploading a new candidate and activating it.
- The placeholder-art checkbox and the finished-card image flow are unchanged.

## Testing

- Vitest units: crop-rect clamp math (pure), `cropCardImage` against a sharp
  fixture image (dimensions + bounds), candidate cap logic.
- Route tests: `candidate=` param — authed happy path, non-member 404, unknown
  candidate 404 — alongside the existing art route tests.
- Extend the `forge-anon-leak` security test to probe the three new RPCs as
  anon/non-member.

## Out of scope (explicitly)

- Free-form / alternate crop aspects; per-candidate saved crop rects; showing
  candidate galleries outside the studio; blob garbage collection for deleted
  candidates; any change to finished-card images or the placeholder flow.
