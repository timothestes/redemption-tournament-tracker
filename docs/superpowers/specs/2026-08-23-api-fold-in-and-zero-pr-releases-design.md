# Sister-API Fold-In + Zero-PR Releases — Design

**Date:** 2026-08-23
**Status:** Approved (owner 2026-08-23; adversary-reviewed same day, findings folded in)
**Scope:** Two-part simplification of the card-release pipeline. **Part 1:** port the sister `redemption-tournament-api` (Flask) into the tracker as TypeScript API routes and retire the repo. **Part 2:** replace the tracker's release PR with a build-time overlay fetch + Vercel deploy hook. After both parts, a Forge release is: press Promote → images upload to Blob → deploy hook fires → verify-live goes green → migrate decks. **Zero release PRs, zero second repo.** (Rare code follow-ups — testament overrides, abilities, set aliases — remain ordinary PRs; §5.)

Parts are independent; **Part 1 lands first** (owner decision, 2026-08-23). The sister API can be deprecated outright — the owner confirmed it has no external consumers.

---

## 1. Problem

Releasing Forge cards (PR #317/#318 flow) ends in a manual two-PR march:

1. **Tracker PR** — `make pull-forge-releases`, commit the overlay + regenerated catalog, PR, merge, wait for Vercel. Exists only because the catalog is compile-time code (`lib/cards/generated/cardData.json`, imported synchronously in ~52 files).
2. **API repo PR** — download the release bundle, append `carddata.jsonl`, drop in webps, commit, deploy. Exists only because that repo git-tracks a private copy of all card data and images.

Beyond release friction, the sister repo carries chronic liabilities: **~145 MB of 5,778 git-tracked webps** shipped inside the Python function (near Vercel's 250 MB uncompressed limit, growing ~26 KB per card forever, with 237 junk `.jpg.webp` duplicates), generator scripts wired to a **months-stale local Lackey install** that would delete newer sets if run (`make json`/`make webp` — the standing landmine), a 422 MiB git pack, exact-name card matching that **silently drops** unknown cards from generated sheets, and a legacy `builds`-style `vercel.json` that can't even express `maxDuration`.

## 2. Current-state facts (verified 2026-08-23)

### 2.1 The sister API surface

Flask app at `redemption-tournament-api.vercel.app`. CORS allowlist = tracker origins only (localhost, `redemption-tournament-tracker.vercel.app`, `redemptionccg.app`); no other consumer exists (owner-confirmed). Endpoints:

| Endpoint | Purpose | Tracker call sites |
|---|---|---|
| `POST /v1/generate-decklist` | Deck-check **PDF** overlaid on `t{1,2}_deck_check_v2.pdf` templates → Supabase Storage `decklists` bucket → `{data:{filename, downloadUrl, createdAt}}`, 201 | `GeneratePDFModal.tsx:82`, `generate/page.tsx:146` |
| `POST /v1/generate-decklist-image` | Card-art grid composited into one **WebP** → same bucket → same shape, 201 | `GenerateDeckImageModal.tsx:70`, `generate/page.tsx:195` |
| `POST /v1/aod-count` | Monte-Carlo AoD count; with `include_breakdown:true` adds soul count + whiff % | `AodCountCard.tsx:89` |
| `GET /`, `GET /about` | Health strings | none |

Request contract (both generators): `{decklist, decklist_type, name?, event?, show_alignment?, n_card_columns?, m_count?, aod_count?, is_legal?, deck_id?}` — `decklist` is **Lackey text** (`qty\tname` lines, `Reserve:` separator, `Tokens:` terminator). All tracker call sites send text built by `generateDeckText(deck)` or user paste; the `.dek` XML branch in `decklist.py` is unused by any tracker flow. `deck_id` is sent by four of the five call sites and **ignored** by the API. Errors come in **three** shapes: missing `decklist`/`decklist_type` or a non-JSON body → 400 `{"error":"invalid request"}` (no `status`/`message` keys); `AssertionError` → 400 `{status:"error", message}`; anything else (including malformed JSON sent with a JSON content-type) → 500 generic. PDF storage path is the **bare uuid (no extension)**; image path is `<uuid>.webp` — `decklistPdfDownloadUrl` compensates via the `?download=` param, so path shape is contract.

### 2.2 What the Python actually does (port surface)

- `decklist.py` (334 ln) — parse Lackey text; normalize curly apostrophes; resolve cards by **exact name** against its jsonl (silently skipping misses); enforce size assertions (min 40 main; T1/Paragon ≤70 main/≤10 reserve; T2 ≤140/≤20; generators other than the PDF bypass all but the ≤140/≤20 caps — plus the parser's own "at least one card in the main deck" assertion, which no path bypasses); Monte-Carlo **M count** (10k sims, expected unique brigades in 8 non-Lost-Soul cards) and **AoD breakdown** (10k sims, Daniel references top-9, trigger = Daniel ref in top-3, excluding the card "The Ancient of Days" itself).
- `text_to_pdf.py` (797 ln) — reportlab overlay onto the v2 templates: measured per-section x/y maps for T1 and T2, per-section line limits with an OVERFLOW page, `clean_card_name` display rules (Lost Soul nickname+verse, `/`-split with set-suffix retention, `(I/J+)` special case), alignment coloring, section counts, total, name/event in Times-Roman, M/AoD text, T2 header nudge (+5,+5), legality seal image centered top. Fonts used on the PDF are all **standard-14** (Helvetica/-Bold, Times-Roman).
- `text_to_webp.py` (510 ln) — PIL grid: 15 cards/row for T2 else `n_card_columns` (default 10), rows overlap 10% of card height, bg `#1e202b`, separator bar `#141621` between main and reserve, M/AoD text in DejaVu Sans Bold, seal top-left, WebP q80. Card art read from the repo's webp store; misses print-and-skip.
- `seal.py` (97 ln) — PIL-drawn circular LEGAL/ILLEGAL seal (two rings, translucent fill, format label + status text, DejaVu).
- `sort.py` (350 ln) — field comparators; sheets/images use `sort_by=["type","alignment","brigade","name"]`. That multi-field path **never consults the brigade-order arrays**: it compares the **raw** type and brigade strings lexicographically, mapping only alignment to a priority (Good 0, Evil 1, Neutral 2, else 3) and lowercasing names. The tracker's `defaultSort.ts` mirrors only the separate "default" mode and contributes nothing to the sheet sort.
- `brigades.py` (113 ln) — the tracker's `normalizeBrigadeField` (`app/decklist/card-search/cardHelpers.ts`) is a *near*-mirror with three divergences that matter here: an empty-brigade card in the complex map ("City of Refuge") resolves differently (Python `[]`, tracker `["Teal"]` — enough to move an M count past the test tolerance), the Multi-expansion branches differ structurally, and it throws `Error` (→500) where Python raises `AssertionError` (→400). The port **freezes the Python behavior** in `lib/decksheets/` (§4) rather than reusing the near-mirror.
- Assets worth carrying over: `assets/pdfs/t1_deck_check_v2.pdf` + `t2_deck_check_v2.pdf` (~756 KB for the pair, painstakingly measured — see deck-check-sheets-v2 history), `fonts/dejavu-sans-bold.ttf` (692 KB). The 145 MB webp store is **not** carried — the tracker's public Blob holds a JPEG for every catalog card (`card-images/<imgFile>.jpg`, daily cron backfills upstream art, Forge promote uploads its own). **The Blob art is NOT uniformly sized** (sampled: 345×495, 344×512, 343×512, 345×497, …) — it mirrors the webp store's variability, so the compositor must normalize (§4).

### 2.3 Tracker facts the port builds on

- Catalog access: `CARDS`/`findCard` (`lib/cards/lookup.ts`); `utils/deckcheck/cardDatabase.ts` `getCardDatabase()` already builds a name-keyed Map (legacy last-wins semantics). **Apostrophe caveat:** the API's jsonl normalized curly apostrophes in card *names* at generation time; tracker `CARDS` contains ~52 names with curly apostrophes. The port's resolver must normalize both sides or those cards regress into silent skips.
- Blob URL builder: `app/shared/utils/cardImageUrl.ts` `getCardImageUrl(imgFile)`.
- Existing public API precedent: `app/api/v1/decks` (route handlers + tests). Known wart to avoid copying: its unauth-IP rate limiter throws when Upstash env is stale — `app/join/actions.ts` has the fail-open pattern.
- Supabase Storage: the tracker server has the service-role key; the `decklists` bucket is the API's existing output store and stays.
- `sharp` ^0.35 is already a dependency (Forge image pipeline).

### 2.4 The tracker-PR mechanics (Part 2 target)

`scripts/pull-forge-releases.js` reads `forge_public_releases`/`forge_public_release_cards` (service key, **status ≥ `images_done` only**) → writes `scripts/data/forge-released.json` → `scripts/parse-carddata.js` merges upstream + overlay into `lib/cards/generated/cardData.json`. The release page's verify-live step checks the *deployment's own* `CARDS` with exact name/set/imgFile equality before unlocking deck migration. The 2026-08-22 release spec explicitly **deferred** ("not rejected") a build-time Supabase fetch + deploy hook, noting it "layers cleanly on top of the overlay design later." The just-approved catalog-admin-editor spec (2026-08-23) stacks a third overlay (`card-overrides.json`) onto the same commit-and-PR flow — Part 2 changes its delivery mechanism (§7).

## 3. Design overview

### Part 1: TypeScript port, not Python-in-tracker

The three endpoints are reimplemented as tracker route handlers under the same paths (`app/api/v1/generate-decklist`, `/generate-decklist-image`, `/aod-count`), preserving request/response contracts byte-for-byte so client changes reduce to swapping the base URL. Card data comes from the tracker's own catalog; card art comes from the public Blob at request time.

Why a port instead of hosting the Python in the tracker project: the un-mirrored surface is ~1,300 lines of rendering/parsing logic (brigades and default-sort already exist in TS); mixed-runtime would drag Pillow/reportlab/pip and a second toolchain into the tracker deploy while keeping two card-data access paths (the Python would still read a jsonl, recreating the sync problem this project exists to kill). The port makes `findCard`'s catalog the single source of truth — a card visible in the deck builder can never again be silently missing from its own deck-check sheet.

Why runtime Blob for the catalog is still rejected (the "why can't the JSON live in Blob" question): `CARDS` is a synchronous module-scope import across ~52 client and server files; an async catalog is an app-wide rewrite with no user-visible payoff. The API's *copy* of the data dies (Part 1); the tracker's copy refreshes itself at build time (Part 2). Images already are runtime Blob.

### Part 2: build-time overlay fetch + deploy hook

Promote the release spec's deferred option to the plan: on Vercel builds, a prebuild step fetches the forge-released overlay from Supabase and regenerates the catalog before `next build`; the release page grows a "Deploy" action that hits a Vercel deploy hook. Git stops being the carrier for released card data; the Forge preflight + immutable manifest is the review surface. The committed overlay/catalog files remain as the no-env fallback (local dev, worktrees).

## 4. Part 1 — module plan

New directory `lib/decksheets/` (server-only):

| Module | Ports | Notes |
|---|---|---|
| `parse.ts` | `decklist.py` text branch | `qty\tname`, `Reserve:`, `Tokens:`; curly-apostrophe + doubled-quote normalization; `.dek` XML support **dropped** (unused by every tracker flow; the repo being deprecated is the only thing that accepted it) |
| `resolve.ts` | `_map_card_metadata` | Resolves against a name-keyed map built from `CARDS` with **apostrophe-normalized keys** (both sides), preserving last-wins collisions and print-and-skip misses; attaches `quantity`, `raw_brigade`, and normalized `brigade` via a **frozen port of `brigades.py`** (not the divergent `normalizeBrigadeField`, §2.2; its assertion failures map to the 400 envelope) |
| `limits.ts` | size assertions | Same messages verbatim (they surface in the UI as 400 bodies) |
| `counts.ts` | `calculate_m_count`, `calculate_aod_breakdown` | Same 10k-sim Monte Carlo, same rounding, same "The Ancient of Days" exclusion and top-3 trigger semantics |
| `sheetSort.ts` | `sort.py` multi-field mode | Only the `["type","alignment","brigade","name"]` path the sheets use: raw type string, alignment priority (Good 0 / Evil 1 / Neutral 2 / else 3), **raw** brigade string, lowercased name — plain lexicographic compares. The brigade-order arrays in `defaultSort.ts` are **not** involved (§2.2) |
| `pdf.ts` | `text_to_pdf.py` | `pdf-lib`: load template, draw directly on page 0 (no overlay/merge dance needed). Coordinate maps, section limits, `clean_card_name`, overflow pages, alignment colors, T2 header nudge copied verbatim — reportlab and pdf-lib share bottom-left-origin point coordinates and the standard-14 fonts, so measured values transfer 1:1. **Encoding caveat:** standard-14 fonts are WinAnsi-only and pdf-lib *throws* on unencodable characters where reportlab silently degraded — every drawn string (especially free-text `name`/`event`) passes a WinAnsi sanitizer (unencodable → `?`); catalog card names are verified clean |
| `deckImage.ts` | `text_to_webp.py` | `sharp` composite: fetch each unique imgFile's JPEG from Blob (concurrency-limited, deduped), lay out with 10%-overlap rows, bg/separator colors and WebP q80 preserved. Blob art is **not** uniform (§2.2), so every fetched JPEG is resized to a fixed 345×495 cell (`fit: fill`) before compositing — this replaces the Python's probe-the-first-image sizing, and without it sharp throws on overlays that exceed the canvas. Missing blob → print-and-skip (parity) |
| `seal.ts` | `seal.py` | Seal built as an SVG string (circles + text in DejaVu), rasterized by sharp; PDF embeds the PNG, deck image composites it |
| `upload.ts` | Supabase upload | Service-role client, `decklists` bucket, upsert; PDF path = bare uuid, image path = `<uuid>.webp` (contract, §2.1) |

New deps: `pdf-lib` (pure JS). Assets `assets/decksheets/{t1,t2}_deck_check_v2.pdf` + `dejavu-sans-bold.ttf` copied into the tracker; route files declare them via `outputFileTracingIncludes` (or equivalent) so Vercel's function bundle carries them.

**Routes** (`app/api/v1/...`): thin handlers = validate → parse/resolve → generate → upload → respond, mirroring the Flask status codes and **all three** error envelopes exactly (missing fields/non-JSON → 400 `{"error":"invalid request"}`; limit violations → 400 `{status:"error", message}` with the same message text; unexpected → 500 `"something unexpected happened"`). Accept and ignore `deck_id` (parity). Add the unauth-IP rate limiter using the fail-open pattern from `join/actions.ts` — the Flask app had none, so this is strictly additive and must never 500 on limiter failure; a limited request returns **429 with the `{status:"error", message}` envelope** so existing client error paths render it instead of crashing into the generic message. No auth (deck text isn't sensitive; the old endpoints were public).

**Client changes:** the five call sites swap `${process.env.NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT}/v1/...` → relative `/api/v1/...`. The env var dies from `.env.example`, `.env.local`, and Vercel settings at cleanup.

### 4.1 Known deliberate deviations from the Python

1. `.dek` XML input dropped (dead code even in Python — the tempfile name never ends in `.dek`).
2. Deck-image cards render from Blob JPEGs **force-resized to a uniform 345×495 cell** instead of the Python's probe-the-first-webp sizing — output grids become dimensionally uniform; the many ~344×512 scans take a ~4% aspect stretch (chosen over cropping, which would clip card borders).
3. Rate limiting added (fail-open, 429 envelope per §4).
4. `GET /` and `/about` not ported.
5. Drawn PDF strings are WinAnsi-sanitized — pdf-lib throws where reportlab silently degraded, so exotic characters in `name`/`event` become `?` instead of a 500.

Everything else — sort order, coordinates, section limits, name cleaning, colors, quality settings, storage paths, response shapes — is parity by construction and verified by §6.

### 4.2 Runtime characteristics

Worst case (T2, 140 main + 20 reserve): ≤160 Blob fetches of 37–196 KB (deduped by unique card, concurrency ~10) and a ~5,175×~5,400 px compose — well within Fluid Compute defaults (300 s, function memory); no `maxDuration` config needed initially. Optional later: an in-instance LRU of fetched card JPEGs (Fluid instance reuse makes this pay off) — not in scope for the first cut.

## 5. Part 2 — zero-PR releases

- **`scripts/prebuild-catalog.js`**, wired **explicitly** into the build command — `"build": "node scripts/prebuild-catalog.js && next build"` — not as an npm `prebuild` lifecycle hook (pre-hooks silently vanish under a Vercel Build Command override or a future pnpm migration, and silent is exactly what this step must never be). Gate logic, in order:
  1. `CATALOG_PREBUILD=0` → skip entirely; committed snapshot is used. This is the **kill switch** and the *only* supported fallback path (the previously drafted "unset the env gate" fallback was inoperable: `VERCEL` can't be unset, and the Supabase vars are load-bearing at runtime).
  2. On Vercel (`VERCEL` set, or forced with `CATALOG_PREBUILD=1`): Supabase env **must** be present — missing/empty env is **exit 1**, not a fallback, so a mis-scoped or rotated-away key can never silently ship the stale committed snapshot.
  3. Fetch runs the existing pull logic (same `images_done`+ status gate, same overlay write, same `parse-carddata.js`); regenerated catalog files are build-local. Any fetch failure → **exit 1**.
  4. **Monotonicity guard**: the fetched overlay must contain every `name|set` key present in the committed `scripts/data/forge-released.json`, else exit 1. A *successful-but-shrunken* fetch (RLS silently returning zero rows to a mis-scoped key, a wrong/branch database) would otherwise pass the build and delete already-released cards from prod, breaking migrated decks with no verify-live left to catch it.
  5. Anywhere else (local dev, worktrees, CI): no-op, committed snapshot, zero behavior change.
- **Why fail-closed instead of fall-back-to-committed-with-a-warning**: the committed snapshot is *allowed to lag* under this design, so silently shipping it can regress released cards on any unrelated deploy — and verify-live only guards active releases, not regressions. The cost is that deploys couple to Supabase availability, including the circular case (needing to deploy *during* a Supabase incident); that case is served by a deliberate human action — set `CATALOG_PREBUILD=0`, deploy, unset — ideally after `make pull-forge-releases` freshens the snapshot if reads still work. Same escape hatch covers the codegen hard-fails (partial absorption, AB-map) which after Part 2 brick **all** deploys until reconciled instead of one dev machine — accepted: they signal real data corruption, and the switch exists.
- **Deploy hook**: a Vercel deploy hook (main branch) stored as server-only env `VERCEL_DEPLOY_HOOK_URL`. The release page's "Merge the catalog artifacts" card is replaced by a **"Deploy catalog"** button (superadmin server action POSTs to the hook) plus the note that any ordinary merge to main also picks the release up. The action surfaces the hook response and links the Vercel deployments dashboard — build success/failure is observed there; no in-app build polling in the first cut. The hook URL is an unauthenticated trigger: server-only env, superadmin-gated action, rotate if it ever leaks. Verify-live is unchanged and remains the gate for deck migration.
- **Abort closes its own race**: `forge_abort_release` on an `images_done` release deletes public blobs, then manifest rows — after Part 2 it must **also fire the deploy hook**, because any build whose fetch ran during that window (a Deploy press *or any unrelated merge*) shipped catalog rows whose images just vanished, and nothing else would rebuild until the next unrelated deploy.
- **Deletions**: the bundle route `app/forge/api/promote/bundle/[releaseId]/route.ts` + its README generation; the API-repo checklist item; release-page copy rewritten — including the `promote.ts` testament-override warning string that says "overlay PR" (the copy lives in `promote.ts`, not only `PromoteClient`). Sequencing note: the bundle route is the sister API's only remaining feed, so its deletion **depends on Part 1's cutover being complete** — with Part 1 landing first this is moot, but the parts are not fully independent on this one item. `make pull-forge-releases` survives as the way to refresh the committed dev snapshot (no longer release-critical).
- **Still PRs (rare, and honestly so)**: releases whose cards need `TESTAMENT_OVERRIDES`, `CARD_ABILITIES`, `set_aliases`/`UNSOLD_SETS`, or `PARAGON_EXCLUDED_SETS` edits still take an ordinary code PR — Part 2 removes the *catalog* PR, not these occasional code follow-ups. The Done-step checklist copy points at them.
- **Semantics that don't change**: `forge_abort_release` *gating* (staged/images_done only), the status gate preventing 404-image catalog rows, `make update-cards` (upstream refresh still edits committed `carddata.txt` via PR — rare, and genuinely reviewable).
- **Accepted consequences**: prod builds depend on Supabase availability (fail-closed rationale + kill switch above); preview deploys also fetch the live overlay (harmless — same status gate — though a preview built during a later-aborted release retains those card rows in its immutable client bundle forever; the images were already public during that window); the committed catalog can lag prod between refreshes (dev-only cosmetic); the service-role key is read at build time — it is already present in the build env for runtime use, so no new secret enters the build, but a definer-RPC readable with the anon key would narrow exposure and is noted as future hardening, not in scope.

## 6. Verification

- **Unit**: port the API's pytest cases where they exist; new tests for parse (reserve/tokens/apostrophes/quotes), limits (exact messages, incl. the parser's "at least one card" assertion on bypass routes), sheetSort (against sort.py fixture outputs), counts (statistical, fixed decks, **per-metric tolerances**: ±0.15 for m/aod/soul counts, ±2 percentage points for whiff — at 10k sims whiff's standard error is ~0.5 pp, so ±0.15 would flake permanently), clean_card_name table-driven, and the frozen brigades port diffed against `brigades.py` over the full catalog (the "City of Refuge" case included).
- **Golden-output**: a battery of real decks (T1 with reserve, T2 with overflow in ≥2 sections + reserve overflow, Lost Soul nicknames, alignment coloring on, M+AoD on, legal + illegal seals, deck with an unresolvable name) rendered by both implementations; PDFs rasterized and eyeballed side-by-side, deck images diffed visually. Coordinate parity is the release gate for the PDF route.
- **Route tests**: contract tests asserting status codes, error envelope, and storage path shapes against the shapes in §2.1.
- **Cutover**: deploy tracker routes → flip the five call sites (same deploy) → old API left running. It will **not** be instantly idle: the endpoint env var is client-baked, so cached clients keep hitting it until they reload. The archive criterion is **observed traffic**, not the calendar — archive the GitHub repo and delete the Vercel project + `NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT` env only after Flask logs show ~a week of zero traffic.
- **Part 2**: a first **production** pass (the hook deploys main; there is no staging env) — press Deploy catalog with a wave already `images_done`, watch prebuild logs, verify-live green, migrate. Plus two failure drills: a deliberately bad service key and a monotonicity trip (point at an empty table), both proving the build dies loudly — safe because a failed build never becomes the serving deployment.

## 7. Ripple effects

- **catalog-admin-editor spec (2026-08-23)**: its `card-overrides.json` overlay joins the same prebuild fetch; its "commit + PR" delivery step becomes the same Deploy button. Amend that spec before implementing it (its Supabase-tables + codegen-merge core is unchanged). Concretely conflicting: its §4 delivery loop, §8 ops-latency table, "pull PR needed" pending-state copy, §5.2 exit-1 orphan semantics (must decide warn-vs-block in the prebuild context, where exit 1 bricks all deploys), F7's abort care-point, and the companion plan doc (`docs/superpowers/plans/2026-08-23-catalog-admin-editor.md`, which scripts the pull→PR loop and greps for the bundle route). The amendment must also state plainly that with git out of the loop, admin overrides' review surface is the editor's own audit trail.
- **Memory/docs**: "new card = 3 places" collapses to 2 after Part 1 (tracker codegen + Blob) and effectively 1 button after Part 2. `prompt_context`/CLAUDE.md references to the sister repo and the two-PR flow get updated at cleanup.
- All raster text (the seal's labels **and** the deck image's M/AoD separator text) renders through sharp's SVG path and needs a **font spike first**: SVG text on Vercel requires fontconfig to find the bundled DejaVu (e.g. `FONTCONFIG_PATH` + minimal `fonts.conf`, or pre-rendering text to paths). This is the port's only real platform risk; it is task #1 of implementation so the fallback (bake text to vector paths from the font) can be chosen early.

## 8. Out of scope

- Runtime/async catalog in the tracker (rejected, §3).
- Card-JPEG LRU cache, PDF/image visual redesigns, new endpoint features.
- Auto-firing the deploy hook from the promote flow without a human click (easy later; the button keeps a human on the trigger for now).
- The catalog-admin-editor implementation itself (separate, amended spec).

## 9. Decisions (adopted 2026-08-23 with the owner's go-ahead)

1. **Route paths** — keep `/api/v1/generate-decklist` etc. (max parity, sits beside the existing `/api/v1/decks`).
2. **Old-API retirement** — archive/delete only after ~a week of observed-zero Flask traffic (§6 cutover; traffic-based, not calendar-based).
3. **Part 2 trigger** — button-only (no auto-fire on `images_done`) for the first release; revisit after one clean run. Exception: **abort auto-fires the hook** (§5) — that one exists to close a correctness race, not to save a click.
