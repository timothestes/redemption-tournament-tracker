# Catalog Admin Editor — public card metadata + image CRUD

**Date:** 2026-08-23 (rev 2, post-adversary — findings + dispositions in §12)
**Status:** Approved design, pre-implementation
**Prereq:** Forge set promotion (PR #317, migration 091) — this feature reuses its
overlay architecture and image pipeline.

## 1. Purpose & scope

A superuser-gated admin surface for correcting the **public card catalog**: fix a
typo in a special ability, errata a legality flag, adjust a brigade, or replace a
bad/mis-cropped card image — for **any** public card (upstream Lackey cards and
forge-released cards alike), without hand-editing data files.

Locked decisions (owner-approved):

- **Scope: all public cards.** Overrides deliberately shadow upstream Lackey data.
- **Operations: update + image replace only.** No create (Forge promote and the
  YTG importer cover new cards), no delete (removing a catalog card breaks every
  deck that references it — the Roots 2 failure class).
- **Identity is immutable.** `name`, `set`, and `imgFile` cannot be edited. Decks
  reference cards as `name|set`; a rename is a delete in disguise. The editable
  fields are the other 12 of `CardData`'s 15: `officialSet`, `type`, `brigade`,
  `strength`, `toughness`, `class`, `identifier`, `specialAbility`, `rarity`,
  `reference`, `alignment`, `legality`.
- **Cards and images are different resources.** ~151 imgFiles serve 2+ catalog
  cards (Limited/Unlimited pairs share art). Metadata edits key on `name|set`;
  image replacement keys on `imgFile` (§4, §6) — replacing "a card's image"
  necessarily replaces it for every co-owning card, and the model says so
  instead of hiding it.

## 2. Current state (what this builds on)

- The catalog is **compile-time generated code**: `scripts/parse-carddata.js`
  reads upstream `scripts/data/carddata.txt` (re-downloaded by `make
  update-cards` — any local edit to it is clobbered) plus the forge-released
  overlay `scripts/data/forge-released.json` (upstream wins on `name|set`), and
  emits `lib/cards/generated/cardData.json` + typed accessors. Every consumer —
  server and client — imports `CARDS` / `findCard` from `lib/cards/lookup.ts`.
- **Images** are decoupled and runtime: public Vercel Blob
  `card-images/<imgFile>.jpg`. URL construction is **duplicated across at least
  six builders** (`app/shared/utils/cardImageUrl.ts`, `lib/card-images.ts`,
  `app/decklist/card-search/hooks/useCardImageUrl.ts`,
  `app/play/components/CardPreviewSystem.tsx`, local copies in
  `my-decks/client.tsx` + `QuickLookModal.tsx`, inline literals in two admin
  pages) — a pre-existing wart this design must consolidate (§5.3) for
  cache-busting to actually work. The daily sync cron
  (`app/api/sync-card-images/route.ts`) `head()`-skips any existing blob, so a
  replaced image is never clobbered back to the Lackey original.
- One hardcoded proto-override already exists: `LEGALITY_OVERRIDES` in
  `lib/cards/lookup.ts` (Ephesian Widow unban), applied at module load precisely
  because in-file edits don't survive `make update-cards`. §5.5 folds it in.
- Superuser gating precedent: `app/admin/permissions/lib/auth.ts`
  `requireSuperuser()` — SQL `public.is_superuser()`, page answers 404 (never
  401/403) so the surface stays invisible.

## 3. Architecture: the third overlay

Two Supabase tables are the source of truth for edits; a committed overlay file
`scripts/data/card-overrides.json` carries them into codegen, applied **last and
winning** over both upstream and forge-released rows:

```
carddata.txt (upstream, canonical)
  └─ + forge-released.json    (appended; upstream wins on name|set)
       └─ + card-overrides.json    (sparse field patches + image versions; overrides win)
            └─ cardData.json / imgVersions.json  (generated, committed)
```

- **Metadata edits ride a deploy** (edit in UI → rows accumulate → `make
  pull-card-overrides` → PR → deploy), identical to the release loop. Many edits
  batch into one PR.
- **Image replacements are immediate** (direct Blob overwrite, §6); only their
  cache-bust rides the next deploy.

Rejected alternatives: runtime DB-backed catalog (restructures every `CARDS`
consumer including client bundles); app-side GitHub auto-commits (token plumbing,
merge conflicts, bad failure modes).

## 4. Data model — migration 092

```sql
create table public.card_overrides (         -- metadata edits, keyed by card
  id           uuid primary key default gen_random_uuid(),
  card_name    text not null,                -- catalog identity, matched byte-for-byte
  set_code     text not null,                --   against CardData name|set (strict — §6.2)
  fields       jsonb not null default '{}'::jsonb,  -- SPARSE: only changed fields
  note         text not null,                -- why: errata source, typo…
  updated_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (card_name, set_code)
);

create table public.card_image_versions (    -- image replacements, keyed by IMAGE
  img_file     text primary key,             -- the blob's identity
  version      int  not null,                -- monotonic; bump = atomic UPDATE … RETURNING
  note         text,
  updated_by   uuid not null references auth.users(id),
  updated_at   timestamptz not null default now()
);
```

- Two tables because the resources have different identities (§1): a version
  keyed per card row was shown to produce non-monotonic `?v=` regressions and
  archive clobbering for shared-art cards (adversary F2).
- `fields` holds only the 12 editable keys, string values; the write path
  rejects unknown keys, non-string values, identity keys, caps the jsonb at
  16KB, **trims and strips control characters** (tabs/newlines are inexpressible
  in the upstream TSV and untested everywhere downstream), and enum-validates
  `legality` and `alignment` against the value sets present in `CARDS` (F10).
- The write path must **accept an override equal to the current live value** —
  required by the §5.5 seeding, and harmless generally (F9).
- A `card_overrides` row whose `fields` becomes empty is deleted — the table
  only ever holds live overrides. The "pull PR needed" signal survives deletion
  because pending-state is computed by diffing DB against the **bundled** overlay
  (§7), not by the row's existence (F4).
- **RLS:** all operations `to authenticated using/with check
  (public.is_superuser())` on both tables; `revoke all from anon`. No definer
  RPCs — single-admin tables, no cross-row invariants; the one atomic
  requirement (version bump) is a single `UPDATE … RETURNING`. (The permissions
  portal uses `super_*` RPCs because its actions touch multiple tables; these
  don't.)
- Server actions in `app/admin/catalog/actions.ts` gate on `requireSuperuser()`
  **and** rely on RLS beneath — same belt-and-suspenders as the portal.

## 5. Codegen changes

### 5.1 Pull script

`scripts/pull-card-overrides.js` (+ `make pull-card-overrides`), mirroring
`pull-forge-releases.js`: service-role client reads both tables, writes
`scripts/data/card-overrides.json`:

```json
{
  "overrides": [
    { "name": "…", "set": "…", "fields": { "legality": "Rotation" }, "note": "…" }
  ],
  "imageVersions": { "<imgFile>": 3 }
}
```

Sorted for stable diffs. The file is committed (like `forge-released.json`); an
absent file means no overrides (backward compatible). The script chains
`parse-carddata.js`, same as the releases pull.

### 5.2 Merge-last in parse-carddata.js

Applied **after** the forge-released append and **before** AB-map derivation and
emission, via a shared, unit-tested patch module (`scripts/lib/`, CJS):

- For each override, find the merged row by exact `name|set`. **Missing row =
  exit 1** ("orphan override — the catalog changed underneath; fix or delete the
  override in /admin/catalog, then re-pull"). The error names the recovery path
  because an orphan blocks `make update-cards` AND `make pull-forge-releases`
  until resolved (F7). **Non-unique match = exit 1** (the catalog tolerates
  last-wins `name|set` collisions; patching a shadowed row would be a silent
  no-op) (F12).
- **Unknown or identity field keys in the overlay = exit 1** — the file is
  DB-shaped data, not trusted input (F12).
- For each field where the base row's value already equals the override value,
  print a per-field retire suggestion. Warning only, never fatal.
- Patch the remaining fields onto the row.
- **AB-map guard:** derive the AB map twice — pre-patch and post-patch — and
  exit 1 if any pairing differs. The pairing tiebreaks on editable fields
  (`reference`, brigade/strength/toughness/type/alignment), so an override can
  silently re-pair an AB card while staying complete and 1:1; the existing
  assertions cannot catch that (F6). A legitimate pairing change goes through
  `abOverrides.json`, as today.
- For each `imageVersions` key, **exit 1 if no merged row's `imgFile` matches**:
  upstream changing a card's imgFile (same `name|set`, so no orphan fires
  otherwise) would silently revert its art to the Lackey original while the
  replacement sits stranded at the old path (F5). The message names the fix
  (re-replace under the new imgFile, retire the old key).

### 5.3 Image versions + URL-builder consolidation

parse-carddata.js emits `lib/cards/generated/imgVersions.json` from the
overlay's `imageVersions` map (empty object when none).

**Prerequisite consolidation (F1):** the six URL builders collapse onto
`app/shared/utils/cardImageUrl.ts` — the deckbuilder's `useCardImageUrl.ts`,
the play preview, the two deck-page local copies, the two admin inline
literals, and `lib/card-images.ts` callers all route through the shared helper
(deleting the local copies; `lib/card-images.ts` becomes a thin re-export or is
absorbed). Without this, the surfaces where a bad image is most visible — the
deckbuilder — would never cache-bust. The consolidation is mechanical (all
builders produce the same URL shape) and is v1 scope, not a nice-to-have.

The shared helper then consults the map — **keyed on
`sanitizeImgFile(input)`**, since some callers pass deck-stored values with
extensions (F13) — and appends `?v=<n>` on a hit. `CardData`'s shape is
unchanged; the map costs a few bytes in the client bundle.

Care-point: verify the Blob CDN keys its cache on query strings (browsers do;
if the edge strips them, `?v=` still busts every browser cache, which is the
audience that matters — note the result in the PR).

### 5.4 `<5000` guard

Unchanged and still upstream-only — an override can never mask a truncated
upstream download.

### 5.5 Fold in LEGALITY_OVERRIDES

Seed one `card_overrides` row (`Ephesian Widow` / `TPC [Ban]` →
`legality: "Rotation"`, note pointing at Deck Construction & Format Specific
Rules 2.0) via the admin UI once live, then delete the hardcoded map from
`lib/cards/lookup.ts` in the same PR that lands the first overlay pull. Order
matters: **UI row first, map removal only in a PR whose overlay already carries
the row**, or the unban regresses for a deploy. Note: at runtime the live value
is already "Rotation" (the map mutates shared objects at module load), so this
seed is exactly the equal-to-live write §4 requires the write path to accept;
`lib/__tests__/formats.test.ts` is the existing tripwire if the fold-in is
botched.

## 6. Image replacement

### 6.1 Route, not server action

`POST /admin/catalog/api/image` (route handler — card scans routinely exceed the
1MB server-action body default; promote set the route precedent). Superuser-
gated, 404 on failure. Input: `name`, `set`, the image file, and an optional
transform (same `ReleaseImageTransform` union as promote: cover default,
Printer 1/2 presets, stored rect).

### 6.2 Pipeline (reuses promote's)

1. Resolve the card via **strict `name|set` map lookup — never `findCard`**,
   whose name-only/lowercase fallbacks can resolve a stale or typo'd `set` to a
   different print (the exact trap promote's verify-live documents) (F3).
   Derive the blob path from the resolved card's `imgFile`; no new slugger.
2. **Bump first, atomically:** `UPDATE card_image_versions SET version =
   version + 1 … RETURNING version` (insert-on-conflict for the first replace).
   Two racing submits get distinct versions and therefore distinct archive
   names (F11); the UI also disables the button in flight.
3. **Archive:** copy the current blob to
   `card-images-archive/<imgFile>.v<new - 1>.jpg` using the Blob API's
   server-side `copy()` — not a fetch through the public CDN URL, which can
   capture stale edge bytes on back-to-back replaces (F8). If the source blob
   doesn't exist (never synced), skip.
4. Transform via `transformReleaseImage()` from `app/forge/lib/releaseImage.ts`
   — exact 345×495 JPEG passthrough / tolerance resize / preset/crop / center
   cover, q90 mozjpeg. `auditReleaseImage()` powers the UI's class preview.
5. `put` to `card-images/<imgFile>.jpg` with `access: 'public'`,
   `addRandomSuffix: false`, **`allowOverwrite: true`** (public store token
   `BLOB_READ_WRITE_TOKEN`).

Crash between 2 and 5 leaves a bumped version with the old (or archived-only)
bytes — visible in the UI as the version/badge state, healed by re-running the
replace. No window leaves a new image live with no bump.

### 6.3 Cache semantics (accepted trade-off)

Cold caches see the new image instantly. Warm CDN/browser caches serve stale
until either their TTL lapses or the next deploy ships the bumped
`imgVersions.json` and `?v=<n>` busts them. Card images change rarely; no
further mitigation.

### 6.4 Cron and co-owner interplay

`sync-card-images` `head()`-skips existing blobs — it never reverts a
replacement and never touches `card-images-archive/`. The image panel lists
**every catalog card sharing this imgFile** ("this image also serves: …") so a
replacement's full blast radius is visible before the button (F2).

## 7. Admin UI — `/admin/catalog`

Server component gate: `requireSuperuser()` → `notFound()` (invisible, portal
precedent). Client experience, Forge-editor-adjacent but read-mostly:

- **Search** over `CARDS` client-side (name substring, same pattern as the
  duplicate-groups admin), showing name / set / type / thumbnail.
- **Editor** per card:
  - Image panel: current public image, co-owning cards list, upload replacement
    → audit preview (exact / resize / crop class), Cover / Printer 1 / Printer 2
    buttons with live final-framing preview (reuse promote's `CropPreviewBox`
    math), Replace button. Shows the image's version and a link to the archived
    previous version when one exists.
  - Field grid: each editable field shows the **live** value (from `CARDS`) and
    the override input. Per-field revert deletes the key from `fields`; the
    next codegen restores whatever the base data says. Identity fields
    rendered read-only with a lock explaining why.
  - Note field (required — future-you wants the why).
- **Pending-deploy state — diff DB against the bundled overlay, not against
  `CARDS`** (F4, F9): the client imports the committed
  `scripts/data/card-overrides.json` (bundled at build = exactly what the
  running deploy was generated from) and diffs it against the live tables, in
  both directions. This surfaces every drift state with one mechanism:
  new/changed overrides, **deleted overrides the overlay still carries** (the
  state with zero indicators under a rows-only model), and image bumps not yet
  shipped. The overrides list view renders these diffs and doubles as the
  "is a pull PR needed?" dashboard.
- Nav: link from the superuser portal; no public nav entry.

## 8. Ops loop

| Change | Takes effect |
|---|---|
| Image replace | Immediately (cold caches); fully after next overlay deploy (`?v=` bust) |
| Metadata edit / revert | After `make pull-card-overrides` → PR → deploy |

The overlay pull can ride the same PR as a `make pull-forge-releases` run —
independent files.

**Cross-feature care-point (F7):** aborting a forge release whose overlay has
already been pulled deletes its `card-images/` blobs (including any the editor
replaced — the archive copy survives) and turns any `card_overrides` on its
cards into codegen-blocking orphans. The promote `abortRelease` action gains a
warning listing affected override rows before the confirm, and the orphan error
message (§5.2) names the recovery path.

## 9. Explicitly out of scope (v1)

- Create and delete (locked decision, §1).
- Renames / identity edits (locked, §1).
- Manual free-rect crop UI (same deferral as promote; presets + cover only —
  the stored-rect transform variant is already accepted by the pipeline).
- Sister API repo sync: overrides do not flow to the API repo's jsonl/webp
  bundles. An edit that must reach it is a manual follow-up; the overrides list
  is the checklist of what would need porting.
- Editing forge release manifests: overrides layer on top of released rows the
  same as upstream rows — one mechanism, uniformly.
- Shopify media churn: versioned URLs will flow into future YTG imports'
  `originalSource`; harmless today, revisit only if import re-runs ever compare
  media sources (F15).

## 10. Testing

- **Pure patch module** (`scripts/lib/applyCardOverrides.js`, CJS — new
  directory, `require`d by parse-carddata.js, imported by vitest via esbuild
  interop): orphan exit, non-unique exit, unknown/identity-key exit, sparse
  patch, absorbed detection, AB-map-diff guard, image-version orphan exit.
- **URL helper**: `?v=` present/absent, `sanitizeImgFile` normalization of
  extension-bearing inputs, `forge:`/leading-slash passthroughs unchanged.
- **Security:** both tables added to the superuser anon-leak suite (anon
  select/insert/update/delete fail); the image route 404s anon and
  non-superusers. Honesty note (F14): this suite is `FORGE_LEAK_TEST=1`-gated
  and **no CI runs it** — it is a manual `npm run test:security` bar, run after
  applying 092, not continuous coverage. The authenticated-non-superuser case
  needs a minted fixture the suite doesn't have yet; if that's disproportionate,
  cover it manually and say so in the PR.
- **Codegen behaviors** hand-verified in all modes (no overlay / patch / each
  exit-1 path / absorbed warning), plus one byte-identical no-op regeneration
  check.

## 11. Implementation shape

- Migration `092_card_overrides.sql` (two tables + RLS + anon revokes).
- URL-builder consolidation (F1) — mechanical, first commit, independently
  verifiable (byte-identical URLs before `?v=` lands).
- `scripts/pull-card-overrides.js`, makefile target,
  `scripts/lib/applyCardOverrides.js` + parse-carddata.js hook,
  `imgVersions.json` emission.
- `app/admin/catalog/` — `page.tsx` (gate) + client, `actions.ts`,
  `api/image/route.ts`.
- `abortRelease` warning for affected overrides (promote touch, F7).
- `lib/cards/lookup.ts`: remove `LEGALITY_OVERRIDES` (sequenced per §5.5).
- Tests per §10. Worktree + PR per repo convention.

## 12. Adversarial review findings (rev 1 → rev 2)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| F1 | BLOCKER | "Two URL helpers" was false — six independent builders; the deckbuilder (where bad images are most visible) would never cache-bust | **Spec changed** (§2, §5.3): consolidation onto the shared helper is v1 scope; CDN query-string behavior verified during impl |
| F2 | BLOCKER | 151 imgFiles serve 2+ cards; per-card `img_version` gives non-monotonic `?v=` (regression to older cached image) and archive clobbering | **Spec changed** (§1, §4, §6): dedicated `card_image_versions` table keyed by `img_file`; UI shows co-owning cards |
| F3 | SERIOUS | `findCard` name-only/lowercase fallbacks can resolve a wrong print for the image route / write path | **Spec changed** (§6.2): strict `name|set` lookup, promote's verify-live precedent |
| F4 | SERIOUS | Reverting a deployed override deletes the row and with it the only "pull needed" signal; prod serves the override indefinitely | **Spec changed** (§4, §7): pending state = DB ⟷ bundled-overlay diff, both directions |
| F5 | SERIOUS | Upstream imgFile drift (same name|set) silently reverts replaced art, strands the blob, mis-busts | **Spec changed** (§5.2): image-version key with no matching merged imgFile = exit 1 |
| F6 | SERIOUS | AB assertions only catch incomplete/non-1:1; an override to reference/stat fields can silently re-pair an AB card | **Spec changed** (§5.2): pre/post-patch AB-map diff, exit on change |
| F7 | SERIOUS | Aborting an already-pulled release deletes replaced blobs and turns its overrides into codegen-blocking orphans with no recovery hint | **Spec changed** (§5.2, §8): recovery path in the error; abortRelease warns on affected overrides |
| F8 | MINOR | Archiving via public-CDN fetch can capture stale edge bytes | **Spec changed** (§6.2): server-side Blob `copy()` |
| F9 | MINOR | §5.5 seed writes an override equal to live; a natural "reject no-op" guard would break it | **Spec changed** (§4, §5.5): write path must accept equal-to-live; badge logic (F4 fix) shows it pending correctly |
| F10 | MINOR | No value validation; `"Rotaton"` silently removes a card from Limited/T2; control chars are TSV-inexpressible territory | **Spec changed** (§4): enum-validate legality/alignment, strip control chars, trim |
| F11 | MINOR | Double-submit replace: same archive name, one bump for two replaces | **Spec changed** (§6.2): atomic bump-first RETURNING; distinct archive names; button disabled in flight |
| F12 | MINOR | Codegen trusted DB-shaped overlay keys; shadowed `name|set` rows patch as silent no-ops | **Spec changed** (§5.2): unknown-key and non-unique-match exits |
| F13 | MINOR | `lib/card-images.ts` receives deck-stored values with extensions; raw map lookup misses | **Spec changed** (§5.3): map lookup keyed on `sanitizeImgFile(input)`; builder absorbed in consolidation |
| F14 | MINOR | Promised security tests live in an opt-in suite no CI runs; authenticated fixture doesn't exist | **Spec changed** (§10): stated as a manual bar, fixture scoped honestly |
| F15 | MINOR | `?v=` URLs flow into Shopify media `originalSource` | **Accepted with note** (§9) |

Verified-correct claims (per the adversary): overlay merge semantics, `<5000`
guard placement, cron head-skip safety, `requireSuperuser` precedent,
`transformReleaseImage` behavior + `allowOverwrite` semantics, field counts,
migration numbering, CJS/vitest interop, play-stack `?v=` inheritance via the
forge resolver, zero traversal-capable imgFiles in the current catalog.
