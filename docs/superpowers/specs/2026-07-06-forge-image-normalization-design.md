# Forge Image Normalization — Design Spec

**Date:** 2026-07-06
**Status:** Approved (design review in session)

## Problem

Forge card images arrive at wildly different sizes and framings. A survey of all
1,420 blobs in the private Forge store (2026-07-06) found:

| Dimensions | Count | Source |
|---|---|---|
| 345×495 JPEG (~50KB) | 1,323 | Lackey bulk import — flush, edge-to-edge |
| 815–825×1125 PNG (0.9–1.6MB) | 42 | Card-tool exports (recent studio uploads) |
| 1047×1503 PNG | 3 | Oversized exports |
| 1×1 JPEG | 44 | Broken uploads — all orphaned (unreferenced) |

Two user-visible problems:

1. **Baked-in print-bleed margins.** Card-tool exports (e.g. Heavenly Temple
   [EoT], 815×1125) include white bleed margins in the file; the card face
   occupies ~92% of the canvas. In any equal-size display box the card renders
   visibly smaller than its flush neighbors.
2. **Weight.** The PNG exports are 20–30× heavier than the JPEG norm, served
   through the authed `/forge/api/art` proxy on every uncached view.

There is currently **no image processing anywhere in the pipeline**: uploads are
stored byte-for-byte ([app/forge/lib/art.ts](../../../app/forge/lib/art.ts), "the
uploaded file IS the original").

## Goals

- Every stored card image is flush (no baked-in margins), at most 1050px tall,
  and JPEG-encoded.
- One implementation covers every upload path (studio upload, Lackey bulk
  import, future callers).
- Existing odd-sized/margined images are backfilled to the same standard.
- Undecodable uploads are rejected with a clear error instead of stored.

## Non-goals

- No upscaling of small images (the 345×495 Lackey norm stays as-is).
- No re-encode of already-conforming images (no generation loss on 1,323 JPEGs).
- No changes to display CSS, the art proxy, RLS, or auth.
- No general orphaned-blob garbage collection (only the 44 known 1×1 orphans
  are swept, as they are unambiguously garbage).

## Design

### 1. Normalizer module — `app/forge/lib/imageNormalize.ts`

Server-only module using a new `sharp` dependency.

```ts
export type NormalizedImage = { data: Buffer; contentType: "image/jpeg" };
export async function normalizeCardImage(input: Buffer): Promise<NormalizedImage>;
```

Pipeline:

1. `sharp(input).rotate()` — apply EXIF orientation.
2. **Corner-gated margin trim.** Sample the four corner pixels (after alpha
   flattening logic below). Only when **all four corners** are near-white
   (each RGB channel ≥ ~240 after flattening transparent pixels to white) does
   the trim step run: `.trim({ background: "#ffffff", threshold: 25 })`.
   - Rationale: print-bleed margins are white/transparent; full-bleed card
     images have dark frame borders at the corners. Trimming with a white
     background cannot eat a dark border ring, and the corner gate skips the
     step entirely for full-bleed images.
   - **Degenerate-trim guard:** if the trimmed result is smaller than 60% of
     the original along either axis, discard the trim and use the untrimmed
     image (protects near-white card faces).
   - **Significance floor:** the trim must remove at least 3% along at least
     one axis, or it is discarded. Live Lackey scans have white rounded-corner
     pixels (passing the corner gate) plus a ~9px (1.8%) near-white fringe; a
     2026-07-06 dry-run showed that without this floor every one of the 1,323
     conforming JPEGs would trim marginally and re-encode, violating the
     no-generation-loss non-goal. Real print-bleed margins (Heavenly Temple:
     ~8%) clear the floor easily.
3. `.resize({ height: 1050, withoutEnlargement: true })` — cap resolution,
   preserve aspect ratio, never upscale.
4. `.flatten({ background: "#ffffff" })` — remove alpha.
5. `.jpeg({ quality: 85, mozjpeg: true })`.

Skip-if-conforming: when the input is already JPEG, ≤1050px tall, and the
corner gate says no trim is needed, return the **original buffer unchanged**
(`contentType: "image/jpeg"`). This makes the backfill safe to run over all
referenced blobs and avoids generation loss.

Errors: if sharp cannot decode the input, throw. Callers surface a clear
upload error ("Could not read image file.") instead of storing garbage — this
closes the door on future 1×1-style blank blobs.

### 2. Wire-in — `app/forge/lib/art.ts`

`uploadForgeArt(file)` and `uploadForgeFinished(file)` normalize before `put()`:

- Convert the `File` to a `Buffer`, run `normalizeCardImage`, upload the result
  with `contentType: "image/jpeg"`.
- Existing validation (`validateArtFile`: type allowlist, 15MB cap) still runs
  first, against the original file — unchanged semantics.
- Decode failure → the studio server actions return `{ ok: false, error:
  "Could not read image file." }`; the import route already wraps
  `uploadForgeFinished` in a per-card try/catch and reports that card as
  failed ("Image upload failed"), which is unchanged.

This is the single choke point: `uploadArt`/`uploadFinished` server actions
([app/forge/lib/cards.ts](../../../app/forge/lib/cards.ts)) and the Lackey
import route ([app/forge/api/import/route.ts](../../../app/forge/api/import/route.ts))
all pass through these two helpers.

### 3. Backfill script — `scripts/forge-normalize-images.mjs`

One-off, run manually with `.env.local` creds (service-role Supabase key +
`FORGE_BLOB_READ_WRITE_TOKEN`). Never runs in the app.

1. Collect every **referenced** blob key: `forge_cards.working_art_key`,
   `working_art_original_key`, `working_finished_key`; `card_versions.art_key`,
   `finished_key`.
2. For each unique key: download, run `normalizeCardImage`. If the output is
   byte-identical (skip-if-conforming), do nothing.
3. Otherwise: upload the normalized bytes under a **new** UUID key with the
   same prefix, update **every** row/column referencing the old key, touch
   `forge_cards.updated_at` for affected cards (busts the working-view `t`
   cache param), then best-effort delete the old blob.
4. Sweep the 44 orphaned 1×1 blobs (hardcoded list captured in the 2026-07-06
   survey, re-verified unreferenced at run time before deletion).
5. `--dry-run` (default) prints the per-key plan (trim? resize? re-encode? →
   new dims/bytes) without writing; `--apply` executes.

Uses `@supabase/supabase-js` (already a dependency) with
`SUPABASE_SERVICE_ROLE_KEY`. Column updates are plain
`UPDATE ... WHERE <col> = <old key>`; RLS is bypassed by the service role. `card_versions` rows are otherwise immutable — only the key
column is re-pointed; `data` JSON is untouched.

**Known caveat:** play-mode art URLs are browser-cached immutably keyed on
`t=versionId`, which does not change. Players who already loaded a card may
see the old margins until their cache evicts. Cosmetic and accepted.

### 4. Tests

Vitest unit tests for the normalizer, using sharp itself to generate fixtures
in-test (no binary fixtures in the repo):

- White-margin PNG (card-colored center block, white border) → trimmed to the
  content block, JPEG out.
- Full-bleed image with dark corner pixels → dimensions unchanged (corner gate
  skips trim).
- 1500px-tall PNG → 1050px tall JPEG.
- 345×495 JPEG → returned byte-identical (skip-if-conforming, no upscale).
- Near-all-white image → degenerate-trim guard keeps original dimensions.
- Corrupt buffer → throws.

Existing `cards.test.ts` upload tests keep passing (they mock `lib/art`).
A small test asserts the upload helpers reject undecodable files with the new
error string (mock `normalizeCardImage` to throw).

### 5. Config / deployment

- `sharp` added to `dependencies`. Next 15 externalizes `sharp` for the server
  build by default; if the build complains, add it to `serverExternalPackages`
  in `next.config.js` (same treatment as `@vercel/blob`).
- Vercel's Node runtime ships sharp-compatible binaries; no config expected.
- Verify with `npm run build` before PR.

## Expected outcome

Heavenly Temple [EoT]: 815×1125 PNG, 940KB, white bleed margins → ~750×1046
flush JPEG, ~150KB, renders the same visual size as every other card in the
studio, set grids, deckbuilder, and online play.
