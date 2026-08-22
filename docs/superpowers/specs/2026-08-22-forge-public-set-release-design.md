# Forge Set Public Release ("Big Red Button") — Design

**Date:** 2026-08-22
**Status:** Proposal, rev 2 (revised after adversarial review — see §12)
**Scope:** A forge-admin action that releases an entire Forge set into the main app's public card catalog — data, images, and deck migration — establishing a hybrid card-data source: upstream Lackey `carddata.txt` **plus** forge-released sets.

---

## 1. Problem

New sets are now designed and playtested in The Forge. When a set is done, there is no path from the Forge to the public app. Today the public catalog comes exclusively from `make update-cards` (curl upstream `jalstad/RedemptionLackeyCCG` → `scripts/parse-carddata.js` → `lib/cards/generated/cardData.json`), which **regenerates the catalog wholesale** — anything not in the upstream TSV is wiped on the next update. Historically a release meant: Chris's spreadsheet → hand-massaged into Lackey carddata columns → wait for the upstream repo → `make update-cards`, plus a separate Python script cropping print images to 345×495.

We want a button in the Forge that does this end-to-end, without waiting on the upstream Lackey repo.

## 2. Current-state facts (verified 2026-08-22)

### 2.1 The public card index

- `make update-cards` (makefile:96-105) curls upstream carddata.txt → `scripts/data/carddata.txt` (committed) → `node scripts/parse-carddata.js` → `lib/cards/generated/cardData.json` (5,692 rows, committed), `cardData.ts` (types only), `abMap.json`.
- `CardData` = 15 flat **string** fields: `name, set, imgFile, officialSet, type, brigade, strength, toughness, class, identifier, specialAbility, rarity, reference, alignment, legality`.
- Card identity everywhere is `name|set|imgFile` (with cascading fallbacks to `name|set` and `name` in `lib/cards/lookup.ts` `findCard`). `set` is the short TSV code (`RR2`), `officialSet` the display name (`Roots 2`).
- `parse-carddata.js` is a **positional** TSV parser with a `< 5000` row guard and hard-fail AB-pairing assertions (AB sets hardcoded `CoW|RoJ|T2C`).
- Refresh is manual-only; there is no runtime fetch. `CARDS` is imported synchronously at module scope in dozens of client and server files — the catalog cannot become an async/DB read without a massive refactor.

### 2.2 Consumers keyed to the catalog (blast radius of a new set)

| Consumer | Source | New-set requirement |
|---|---|---|
| Deck validation / deckcheck API | `lib/cards/lookup` | Nothing after codegen |
| Formats/legality (`lib/formats.ts`) | `legality` column | `PARAGON_EXCLUDED_SETS` is a **blacklist by officialSet** → a new set is Paragon-legal by default (decision needed); Limited/T2 pool = `legality === 'Rotation'` |
| Card images (app) | Vercel Blob `card-images/<imgFile>.jpg` via `getCardImageUrl` | The daily `sync-card-images` cron fetches from the **upstream GitHub repo** by imgFile — forge-released cards would 404 there forever. Release must upload to Blob directly. Cron `head()`-skips existing blobs, so pre-uploaded images are safe. |
| Sister API repo (`redemption-tournament-api`) | its own git-tracked `assets/carddata/carddata.jsonl` + `assets/cardimages/*.webp` (5,777 files), matched by **exact card name** | **Hardest dependency.** Deck-check PDFs and deck images are generated there; a card missing from its jsonl is *silently dropped* from generated sheets. Its own generators read a stale local Lackey install (5,463 cards vs 5,691 — running `make json` today would delete Roots 2). Requires committed jsonl rows + 345×495 webps + deploy. |
| Pricing | `CARDS` × Shopify, key `name\|set\|imgFile` | Degrades gracefully. Optional `set_aliases` row; optionally add code to `UNSOLD_SETS`. |
| SpacetimeDB module | none (client-denormalizes card fields onto rows) | **Nothing.** `CARD_ABILITIES` entries are opt-in follow-ups (both registry copies + republish). Star cards work automatically (ability-text regex). |
| Metagame / results / card identity | catalog fields | Nothing |
| Rulings, RNRS, duplicate groups (ORDIR) | free text / external | Nothing (ORDIR groups arrive whenever a new ORDIR publishes) |
| `cardIndex.ts` testament derivation | `reference` field | Cards with empty scripture reference need a `TESTAMENT_OVERRIDES` entry (preflight should flag) |

### 2.3 Images

- Main cards: uniform **345×495 JPEG** (aspect 0.69697), byte-copied from upstream to public Blob, delivered via `next/image`.
- Forge finished images: private Blob, normalizer (`app/forge/lib/imageNormalize.ts`) enforces only a **height ≤ 1050 cap** — no aspect target, no pad. Measured aspects run 0.69–0.73 per card: Lackey-imported scans pass through at exactly 345×495; studio print files (~815×1125 with bleed) trim to ~750×1046; sub-3%-margin or dark-cornered uploads aren't trimmed at all.
- Every display box in the app is aspect 0.714 (2.5:3.5). This is why forge cards visibly mismatch: content aspect varies per card while public cards are uniformly 0.697. **Releasing through a single 345×495 pipeline erases the mismatch for released cards.**
- The historical Python crop script encodes the missing bridge: printer bleed-crop (two printer presets) → resize 345×495 JPEG q100. Its printer-2 crop box (46,43)–(769,1082) lands almost exactly on 0.696 — i.e., the presets are "crop bleed to final card aspect."

### 2.4 The Forge model

- Card content is structured (`DesignCard`: cardType/alignment/brigades enums, strength/toughness, class+icons, identifiers, rarity, reference, legality) + free-text ability (`rawText`, legacy `specialAbility` fallback via `cardRawText()`). An adapter to the public `Card` shape already exists (`app/forge/lib/deckAdapter.ts` `designCardToCard`), as does a Lackey-row serializer (`app/forge/lib/lackey.ts` `serializeCarddata`, used by the set-export zip).
- Missing per-card vs public shape: only `set` (code), `officialSet`, `imgFile` — all assignable at release time. `testament`/`isGospel` are derived from `reference` downstream.
- Lifecycle: `private_idea | draft | playtesting | approved | promoted | archived`. **`promoted` exists in the enum since migration 051 and is never set by any RPC** — the public-release state was planned but never built.
- Versioning: "Release to playtest" (`forge_publish_card`, current body in migration 083) freezes `working_snapshot` into immutable `card_versions`; "Mark final" flips the published version to `approved`. **The set-export zip currently serializes the *working draft*, not the frozen version — a public release must export frozen versions.**
- Deck refs: `forge_decks.cards` stores `{source:'forge', cardId}` tagged objects; in-memory the string form is `forge:<uuid>`. Hydration **fail-closes** — an unresolvable forge ref is dropped (the mechanism behind the Roots 2 outage).
- Roots 2 precedent (2026-07-22, one-off prod SQL, no code exists): after the set went public upstream, 39 decks / 142 entries were remapped `{source:'forge', cardId}` → `{source:'public', name, set:'RR2'}`, keyed by exact snapshot name. It worked only because forge and catalog names matched byte-for-byte. **A real release generates the public rows itself, so the mapping is exact by construction (cardId → manifest row).**
- Playtester RLS (migration 057) shows only `status IN ('playtesting','approved')` — flipping released cards to any other status without a deck story recreates the Roots 2 outage.
- Permissions: release-shaped operations gate on `is_forge_superadmin() OR is_forge_set_elder(set_id)` at the RPC (pattern of `forge_delete_set`); server actions use `requireElder()`/`requireForgeSuperadmin()`.

## 3. Design overview

### Chosen approach: release manifest in Supabase + committed overlay file in git

The release is **staged, not atomic** — it inherently spans two git repos and two deploys (tracker + sister API), so the design is a small resumable state machine with everything automatable done by the button, and the git steps reduced to one command per repo.

1. **The button** (superadmin, per set) freezes an immutable **release manifest** in Supabase — the final 15-field public row for every card plus the `cardId → (name, set)` mapping — processes and uploads all images to the public Blob, and flips the forge set/cards into their released state.
2. **A committed overlay file** `scripts/data/forge-released.json` carries released rows into the repo. `parse-carddata.js` concatenates it after the upstream rows. `make update-cards` therefore can never wipe a released set. A new `make pull-forge-releases` target syncs the overlay from Supabase and regenerates.
3. **Upstream reconciliation is semi-automatic — and honestly, a bet on convention:** when a released set eventually appears in upstream carddata.txt, the parser drops overlay rows whose `name|set` now exist upstream (upstream wins) and prints them. **Partial absorption is a hard failure**: if some of a release's rows match upstream and others linger, codegen aborts and lists the lingering rows as rename/errata suspects — silence is the only wrong answer there. Name/set continuity is achievable because the upstream plugin will be built from the Forge's own Lackey export (§8), but upstream imgFile conventions are demonstrably unstable (RR2 uses `265-Seven-Years-of-Famine` numeric-prefix hyphen names; older sets use truncated `Name_(Wo)` suffixes). If upstream lands different imgFiles, the catalog's imgFile flips on absorption, which churns pricing `card_key`s, disables any `TESTAMENT_OVERRIDES` keyed to the old triple, and 404s images until the daily cron backfills — all of which is survivable but must be on the absorption checklist (§5.7), not assumed away.
4. **The sister API repo** gets a generated bundle (jsonl rows + 345×495 webps) downloadable from the release page, committed there with its own one-command make target.
5. **Deck migration is a separate, verify-gated step:** once the deployed app resolves every manifest row via `findCard`, a second button remaps forge deck refs to public entries. Until then, released forge cards remain member-visible so no deck ever breaks.

### Why not the alternatives

- **Runtime DB-backed catalog** — rejected. `CARDS` is a synchronous module-scope import across client bundles and server code; converting the whole app to an async catalog is a rewrite with no user-visible payoff.
- **Build-time Supabase fetch + Vercel deploy hook** (fully hands-off: button → DB rows → triggered deploy) — deferred, not rejected. It layers cleanly *on top of* the overlay design later (the build step would just refresh the overlay before codegen). Doing it first couples every build (including worktrees, which don't have `.env.local`) to Supabase env and removes git as the review surface for public-catalog changes.
- **Upstream-first (status quo)** — rejected; blocks releases on an external repo the Forge now precedes.
- **Auto-PR from the button via GitHub API** — stretch goal, not MVP. It only automates `make pull-forge-releases` + `git push`; the merge/deploy remains human anyway. Add once the manual loop is proven.

### Naming

The Forge already uses "Release" for *release to playtesters* (`lifecycleCopy.ts`). The public action uses the existing dormant enum value and is consistently called **Promote** — UI copy "Promote to the public catalog". The button is still big and red.

## 4. Data model

New migration (next free number):

```sql
create table public.forge_public_releases (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.forge_sets(id),
  set_code text not null,               -- e.g. 'EoT' — becomes CardData.set
  official_set text not null,           -- e.g. 'Eve of Tribulation' — becomes CardData.officialSet
  status text not null default 'staged',-- staged | images_done | live_verified | decks_migrated
  card_count int not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

**Deliberately NOT unique on `set_code`/`official_set`:** a set can be released in waves, or corrected via a second release after an abort. What the catalog actually needs unique is `(set_code, name)` **globally across all releases** — enforced in the promote RPC (a constraint can't span the two tables cleanly), with preflight allowing code reuse only for the *same* `set_id` and blocking it for any other set.

```sql

create table public.forge_public_release_cards (
  release_id uuid not null references public.forge_public_releases(id) on delete cascade,
  card_id uuid not null references public.forge_cards(id),
  version_id uuid not null references public.card_versions(id),  -- the frozen source
  -- the 15 public CardData fields, frozen at promote time:
  name text not null, set text not null, img_file text not null,
  official_set text not null, type text not null default '', brigade text not null default '',
  strength text not null default '', toughness text not null default '',
  class text not null default '', identifier text not null default '',
  special_ability text not null default '', rarity text not null default '',
  reference text not null default '', alignment text not null default '',
  legality text not null default '',
  image_uploaded boolean not null default false,   -- per-card resumability
  primary key (release_id, card_id),
  unique (release_id, img_file),
  unique (release_id, name)
);
```

- RLS: default-deny, member-read (the data is public post-release, but consistency with the forge spine is cheaper than a special case); writes only via definer RPCs. The sync script reads with the service key. Note one deliberate visibility widening: promoting a **private** set (migration 071) exposes its manifest text to all forge members before it is publicly live — acceptable (members are NDA'd and the content is days from public), but stated, not accidental.
- **Row construction happens in TypeScript, not SQL.** The server action builds the 15-field rows with a new shared `designCardToCatalogRow` that follows `designCardToLackeyRow`'s conventions (`app/forge/lib/lackey.ts` — class+icons recombination, `cardRawText()`'s rawText-first fallback). It must **not** reuse `designCardToCard` (`deckAdapter.ts`), whose `"—"` display placeholders for empty stats would corrupt catalog rows. Reimplementing this subtle mapping in PL/pgSQL invites drift; instead:
- `forge_promote_set(p_set_id, p_set_code, p_official_set, p_rows jsonb)` — SECURITY DEFINER, `is_forge_superadmin()` only. In one transaction: re-reads each card's `approved_version_id` itself and validates every payload row against it (card belongs to set, is `approved`, version id matches — so the payload can't smuggle unapproved content), enforces global `(set_code, name)` uniqueness across prior releases, inserts the release + card rows, flips every card `status='promoted'`, sets `forge_sets.status='released'`.
- `forge_abort_release(p_release_id)` — superadmin, allowed only while status is `staged`/`images_done` (i.e., before anything merged or verified): deletes any already-uploaded `card-images/` blobs recorded by `image_uploaded`, deletes the manifest rows, flips the cards back to `approved` and the set back to open. This is the amendment path for a typo discovered during the image audit; after `live_verified` there is deliberately no tooling (§10).
- Guards added: `forge_save_card`, `forge_publish_card`, `forge_create_proposal` (and bulk lifecycle) reject cards with `status='promoted'`; set-mutating RPCs reject `status='released'` sets. History (versions, proposals, comments, art) is retained untouched.
- **Visibility of promoted cards — the anti-Roots-2 clause, both gates:** RLS (057's policy) gets `promoted` added to the playtester-visible list, **and** — critically — so does the explicit query filter in `app/forge/lib/play.ts` (`listSetApprovedCards`'s `.in("status", ["playtesting","approved"])`), which feeds both the forge builder pool and play-deck hydration and would otherwise drop promoted cards from decks the instant the button is pressed, regardless of RLS. Implementation includes an audit of every `.in("status", …)` filter on forge_cards for the same trap (display-only surfaces like SetCardsBrowser are fine).

## 5. Release flow

### 5.1 Preflight (`/forge/sets/[setId]/promote`, superadmin-only page)

Read-only report; the button stays disabled until zero blockers:

**Blockers**
- Any card not `approved` ("Mark final"). Promote releases the *approved version's* frozen data, never the working draft.
- Any card whose approved version lacks a finished image (`finished_key`), or whose finished image fails to load.
- `set_code` collides with an existing TSV code, or matches the AB pattern `(AB)`; `official_set` collides with an existing official name. (Counts like "54 codes / 48 names" are computed live from `CARDS`, never hardcoded.) Reusing a code from a prior release of the *same* set is allowed (waves); any other set's code is blocked, as is any `(set_code, name)` pair already released.
- Within-set duplicate names or imgFile slugs.
- Name collision with an existing public card — **case-insensitive** (findCard's last fallback is lowercased, so `Red dragon` vs `Red Dragon` is a real collision) — upstream convention resolves reprints with a `(SetCode)` name suffix; the page offers one-click "append (EoT)" per collision, which writes through the normal edit→publish→approve path (so the fix is versioned).
- imgFile collision against existing `CARDS` imgFiles or any prior release's manifest — `put(..., addRandomSuffix: false)` would silently overwrite the existing public blob.
- Empty `type` or `alignment` (validation is advisory in the studio; it is blocking here).

**Warnings (releasable, listed in the post-release checklist)**
- Empty `reference` (→ testament override needed), empty `rarity`/`legality` (legality defaults to `Rotation` on the frozen row — the release makes cards tournament-legal; if a delayed-legality window is ever wanted, the Roots 2 `checkRoots2NotYetLegal` gate is the precedent, out of scope here).
- Finished-image aspect deviating > 1% from 0.697 (see §6 — needs crop attention).

Derived values shown for confirmation: per-card `imgFile` = `Name_With_Underscores_(<set_code>)` (commas stripped, matching the historical crop script's rename; the guaranteed `(set_code)` suffix is what makes imgFiles structurally collision-free), plus the full 15-field row preview. Note this is a **new** slugger, not the Lackey export's `imageFileSlug` (which hyphen-joins and appends no suffix); the export adopts the released imgFiles per §8, not the other way around.

### 5.2 Promote (the red button)

Calls `forge_promote_set` (atomic, §4). From this instant the data is frozen; everything after is derived from the manifest and idempotently resumable.

### 5.3 Image processing

Batched route handler (the Lackey-import pattern — server actions serialize per client; a batched route measured ~7× faster), superadmin-gated:

Per card: read the approved `finished_key` blob from the private store → transform (§6) → `put` to **public** Blob `card-images/<imgFile>.jpg` (`access: 'public'`, `addRandomSuffix: false`) → mark `image_uploaded`. Re-runs skip uploaded rows. When all rows are done, release → `images_done`.

This is the deliberate leak-boundary crossing: the moment of upload, the images are public. That is what "promote" means; the button copy says so.

### 5.4 Repo artifacts

- **Tracker:** `make pull-forge-releases` → `scripts/pull-forge-releases.ts` reads manifests with `status >= images_done` **only** (a `staged` release merged early would ship catalog rows whose images 404 forever — the cron can't backfill forge art from upstream), printing any skipped releases. Writes `scripts/data/forge-released.json` (CardData-shaped rows tagged with `releaseId`/`setCode`), runs `parse-carddata.js`. Commit + PR + merge + Vercel deploy as usual. Env caveat: the script needs the service key from `.env.local`, which worktrees don't carry — run it from the main checkout or copy the env file first.
- **API repo:** the release page offers `GET /forge/api/releases/[id]/bundle` → zip of `carddata-additions.jsonl` (rows in the API's lowercased-key format) + `cardimages/<imgFile>.webp` + a README of exact steps (append jsonl, drop webps in `assets/cardimages/`, commit, deploy). The webps are produced by resizing to 345×495 **first**, then encoding webp q50 — the API repo's `convert_jpg_to_webp` sets the q50 convention but does *not* resize, so it must not be "just run" on release images. Never regenerate that repo's jsonl from its stale local Lackey install.
- Both artifacts derive purely from the manifest + public Blob, so they can be regenerated anytime.

### 5.5 Verify-live

The release page (running on deployed code) checks every manifest row against its own `CARDS` — and **must not trust `findCard`'s return alone**: the lookup cascades to name-only and lowercased-name fallbacks, so a same-name card added upstream between promote and verify could false-positively "verify" and unlock migration against the *wrong* card. The check is: `findCard(name, set)` returns a card **and** `found.name === row.name && found.set === row.set && found.imgFile === row.img_file` (the `officialDecks` drift-guard test models exactly this discipline). All rows exact → `live_verified`, and the deck-migration button unlocks. This uses the deployment itself as the source of truth for "the set is live."

### 5.6 Migrate decks

`forge_migrate_release_decks(p_release_id)` (definer, superadmin): for every `forge_decks` row containing a `{source:'forge', cardId}` entry whose cardId is in the manifest, rewrite it to `{source:'public', name, set}` from the manifest, preserving zone/qty/order and merging post-conversion duplicates by summing qty **keyed on `(name, set, zone)`** — zone-scoped, or a main-deck copy and a reserve copy would wrongly collapse (the Roots 2 rebuild semantics, now in code; duplicates are real because of the §8 double-listing window). Before rewriting, copy each affected deck's prior `cards` jsonb into `forge_deck_migration_backups` — `primary key (release_id, deck_id)`, insert with `on conflict do nothing` so a re-run after partial failure never overwrites the true pre-migration backup. Idempotent: already-migrated decks have no matching forge refs. Release → `decks_migrated`.

Public-side data (tournament decklists, metagame) never referenced forge ids, so nothing else migrates.

### 5.7 Generated post-release checklist

Rendered on the release page after promote, with current done/pending state where checkable:

- [ ] Tracker overlay merged + deployed (auto-checked by §5.5)
- [ ] API repo bundle committed + deployed (manual check-off)
- [ ] **On eventual upstream absorption** (whenever the set lands in carddata.txt): if upstream imgFiles differ — re-run pricing matching (card_keys churn), re-key any `TESTAMENT_OVERRIDES` for the set, delete the orphaned `card-images/` blobs (the cron backfills the new ones)
- [ ] Paragon decision: add `official_set` to `PARAGON_EXCLUDED_SETS` or accept Paragon-legality (code change in the overlay PR)
- [ ] Pricing: `set_aliases` row if/when YTG sells the set; else add code to `UNSOLD_SETS`
- [ ] Testament overrides for flagged cards (in the overlay PR)
- [ ] `CARD_ABILITIES` entries for cards that warrant right-click abilities (follow-up, `add-card-ability` skill)
- [ ] Hand the set to the upstream Lackey plugin using the Forge Lackey export (which should emit `set_code`, not the slug, for released sets — small export tweak, §8)

## 6. Image transform rules

Goal: every released card becomes a **345×495 JPEG** (quality 90) in `card-images/`, matching the main set exactly.

Per source image, in order:
1. **Exactly 345×495** (Lackey-imported passthroughs) → upload bytes as-is.
2. **Aspect within 1% of 0.69697** → sharp resize to 345×495 (lanczos), re-encode.
3. **Everything else** → requires a crop decision, surfaced in the preflight image audit:
   - Default: **center cover-crop to 0.69697**, then resize.
   - Preset buttons: **Printer 1 / Printer 2** bleed-crops for print-res scans. The historical script's boxes are absolute pixels against its era's scan size; apply them as fractions of the source dimensions (P2 ≈ crop to left 5.6%, top 3.8%, right 94.4%, bottom 96.2% of a ~815×1125 source) so they keep working across resolutions.
   - Manual: the existing forge crop modal (`CropCandidateModal` + `imageCrop.ts`) with a locked 0.69697 aspect, writing a crop derivative used only by the release.
4. Never upscale warnings: source narrower than 345px flags a quality warning (does not block).

The audit lists every card in class 3 with a side-by-side preview (source vs result). Class 1/2 cards need no attention. This is deliberately the only part of the flow with per-card human input, because it is the only genuinely judgment-shaped step.

Out of scope but recorded: the forge-side display mismatch for *unreleased* cards (normalizer has no aspect target; `CardThumb`'s element branch drops `object-cover`) — worth a separate small fix, not part of release.

## 7. Codegen changes (`scripts/parse-carddata.js`)

- After parsing upstream rows, load `scripts/data/forge-released.json` (absent → empty, zero-diff behavior).
- For each overlay row: if `name|set` already exists from upstream → **skip and print** `absorbed upstream: <name> (<set>)`; else append. If a release is **partially** absorbed (some rows matched upstream, others lingering), codegen **exits 1** listing the lingering rows — that's the rename/errata signature, and it must never merge silently.
- Overlay rows are CardData-shaped JSON — they bypass the positional TSV fragility entirely.
- The `< 5000` guard stays on **upstream rows alone** (moving it to merged output would let a truncated upstream fetch hide behind the overlay's row count); a second assertion checks merged count ≥ upstream count. AB assertions and the diff summary operate on the merged output. Overlay sets must not match the AB pattern (enforced at promote, §5.1).
- `make update-cards` gains nothing; `make pull-forge-releases` is additive. Both end at the same regenerated `cardData.json`.

## 8. Forge aftermath

- Promoted cards: read-only history (versions/proposals/comments retained), still member-visible and deck-resolvable (both gates, §4). **Known window:** between overlay deploy and deck migration, the forge builder pool lists released cards *twice* (it concatenates forge cards + `ALL_CARDS` with no dedupe), so a member can briefly hold the forge ref and the public copy in one deck — this is exactly why the migration merge (§5.6) exists. Optional refinement: hide promoted cards from the pool's *search/add* listing while keeping them resolvable for existing deck entries. After migration, forge entries for the set simply stop existing.
- Released set: locked (`status='released'`), shown with a "Released" badge and a link to the release page; excluded from Lackey *import* destinations.
- Lackey **export** for a released set switches its `Set` column from the slug to `set_code` and its `OfficialSet` to `official_set`, and names images by the released `imgFile` — so the upstream plugin handoff produces byte-identical identity when it eventually lands in carddata.txt (making §7's dedupe fire cleanly).

## 9. Permissions & leak boundary

- Page + actions: `requireForgeSuperadmin()`. RPCs: `is_forge_superadmin()`. Rationale: promoting publishes secret content irreversibly; set-elders can be added later by loosening to the `forge_delete_set` pattern if wanted.
- Until §5.3 runs, nothing leaves the private store. The manifest tables are member-only. The bundle route is superadmin-gated.
- The anon-leak test gains all **three** new tables (`forge_public_releases`, `forge_public_release_cards`, `forge_deck_migration_backups` — the last holds member deck contents and needs the same default-deny posture) + the new RPC probes (extension points already exist: `FORGE_TABLES`, `FORGE_RPCS`). Honesty note: this suite is local vitest (`npm run test:security`), not CI — nothing in `.github/workflows/` runs tests — so it guards a release only when actually run.

## 10. Out of scope

- Rollback tooling **after** `live_verified` (the backups + manifest make a manual reversal tractable; building UI for it is not worth it until a first release survives contact). Before that point, `forge_abort_release` (§4) is the supported amendment path.
- Delayed tournament-legality windows (Roots 2 gate precedent noted in §5.1).
- Auto-PR via GitHub API (stretch, layers on cleanly).
- Fixing the forge-side display aspect mismatch for unreleased cards.
- Shopify product creation (`importSet` exists and is admin-run per set already).

## 11. Open decisions (recommendations inline)

1. **Superadmin-only vs set-elder** — recommend superadmin-only (see §9).
2. **Require `approved` on every card** — recommend yes; "Mark final" is exactly the semantic gate, and it forces the frozen-version discipline.
3. **Bundle vs auto-PR for the API repo** — recommend bundle download for MVP; the API repo has no service-key automation today.
4. **JPEG quality for released images** — recommend 90 (upstream originals are print-derived JPEGs of similar weight; q100 doubles bytes for no visible gain at 345×495).

## 12. Adversarial review record (2026-08-22)

Rev 1 was reviewed by an independent adversarial agent with full repo access. All factual spot-checks of §2 verified to the line. Findings and dispositions, folded into rev 2:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | BLOCKER | The "anti-Roots-2 clause" widened RLS only, but the actual deck-breaking gate is the explicit `.in("status", ["playtesting","approved"])` filter in `app/forge/lib/play.ts` (`listSetApprovedCards`), which feeds pool + hydration — promote would break every unmigrated deck instantly | Fixed in §4: both gates widened + audit of all status filters |
| 2 | MAJOR | Verify-live via bare `findCard` can false-positive through its name-only/lowercased fallbacks and unlock migration against the wrong card | Fixed in §5.5: exact name/set/imgFile equality required |
| 3 | MAJOR | `unique(set_code)` forbade second waves and post-abort re-releases while providing no cross-release name protection | Fixed in §4: per-release uniqueness dropped; global `(set_code, name)` enforced in the RPC |
| 4 | MAJOR | "Identity continuity by construction" overstated (upstream imgFile conventions are unstable; the claimed `imageFileSlug` parity was factually wrong); partial upstream absorption was silent | Fixed in §3.3/§5.1/§5.7/§7: claim corrected, partial absorption is a codegen hard-fail, churn fallout on the checklist |
| 5 | MAJOR | Building catalog rows in PL/pgSQL duplicates a subtle TS serializer (and `designCardToCard`'s `"—"` placeholders would corrupt rows if reused) | Fixed in §4: rows built in TS via a shared `designCardToCatalogRow`; RPC validates, never constructs |
| 6 | MAJOR | `pull-forge-releases` wasn't status-gated — a `staged` release would merge with permanently-404 images | Fixed in §5.4: syncs `images_done`+ only |
| 7 | MINOR | Moving the `<5000` guard to merged output would let a truncated upstream hide behind overlay rows | Fixed in §7: guard stays upstream-only |
| 8 | MINOR | Backup table lacked PK/conflict semantics + leak-test coverage; "CI test" misdescribed (suite is local-only) | Fixed in §5.6/§9 |
| 9 | MINOR | Duplicate merge must be zone-scoped; the double-listing window causing duplicates was unnamed | Fixed in §5.6/§8 |
| 10 | MINOR | Preflight gaps: case-insensitive name collisions, imgFile collisions (silent blob overwrite), hardcoded counts, worktree env caveat | Fixed in §5.1/§5.4 |
| 11 | NIT | API repo's `convert_jpg_to_webp` doesn't resize — bundle must resize before encoding | Fixed in §5.4 |
| — | Under-built | No amendment path between promote and overlay merge | Fixed in §4: `forge_abort_release` |

Reviewer verdict on the architecture itself: overlay file, staged state machine, leak-boundary reasoning, and the cross-store Blob mechanics (private read + public write in one handler, per-call tokens) are sound and feasible within Vercel limits; the manifest/state machine earns its complexity; fix the findings and build as designed.
