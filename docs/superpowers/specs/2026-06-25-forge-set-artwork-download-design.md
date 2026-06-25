# The Forge — Set Artwork Download (ZIP)

**Date:** 2026-06-25
**Branch:** `forge-set-artwork-download`
**Scope:** A standalone Phase-1 capstone (the slimmed-down survivor of the deferred "download all for printer" idea). Not a numbered 1a/1b slice.

---

## Context

The Forge design toolset is complete through Phase 1b (studio, sets, lifecycle/versions, private art, review layer, realtime). The master spec's "Promotion & Print Export" called for a "Download all for printer" feature; after brainstorming we **dropped the print-ready PDF / card-face compositing entirely** (non-trivial, low near-term value) and kept only the genuinely useful core: **let a set's elders bulk-download the finished artwork.**

Per-card art download already exists (the art proxy `app/forge/api/art/[cardId]/route.ts` supports `?download=1` → attachment + audit, built in 1a.3). The gap is a **set-level bulk download**.

---

## Goal / non-goals

**Goal:** A "Download artwork (ZIP)" action on a set that streams a ZIP of the **approved** cards' full-res original illustrations, via the existing gated private-blob path. Art keys never reach the client.

**Non-goals:**
- No print-ready PDF, no tiled imposition, no bleed/crop marks, no card-face compositing (frame+text). **Raw illustrations only.**
- No manifest/CSV (just the art files).
- No status change — pure read. The `promoted` status + public-pool promotion remain Phase 2.
- No draft/playtesting art — **approved cards only.**

---

## Behaviour

**Which art.** For every card in the set whose `status='approved'` (i.e. `approved_version_id` is set), read that frozen `card_versions` row and take `art_original_key` (full-res original), falling back to `art_key` when `art_original_key` is null. **Skip** any approved card whose chosen art is a placeholder (`art_is_placeholder`) or missing (both keys null) — those simply don't appear in the ZIP.

**ZIP contents.** One file per included card, named `{NN}_{card-slug}.{ext}`:
- `NN` = a 2+-digit sequence (by `version_number` then name) for stable ordering.
- `card-slug` = slugified card name (from the version's `data.name`).
- `ext` = derived from the blob's `contentType` (`image/png`→`png`, `image/webp`→`webp`, `image/jpeg`→`jpg`) — fixes the 1a.3 "Content-Disposition has no extension" follow-up.
- Collisions (same slug) get the `NN` prefix to stay unique.

**Empty case.** A set with zero qualifying cards: the UI button is **disabled** with a hint ("No approved card art yet"); if the route is hit directly with nothing to export it returns **404** (indistinguishable from the not-authorized 404 — no information about set contents leaks).

---

## Architecture

**Route** — `GET app/forge/api/sets/[setId]/artwork/route.ts` (mirrors the per-card art proxy):
1. `requireForge()` first statement → if not a member, **404**.
2. Authorize: the caller must be a **set-elder of this set or superadmin** (the set-read rule). Otherwise **404**. (Reuse the existing set-read check / `getSet` → notFound pattern, or `is_forge_set_elder` ∨ `is_forge_superadmin`.)
3. `export const dynamic = 'force-dynamic'`; response headers `Cache-Control: private, no-store`.
4. Read the approved cards' art keys **server-side** (RLS-scoped query on the caller's `ctx.supabase`, or a small definer helper if RLS blocks reading a set's approved `card_versions` — confirmed during planning). Keys stay in the route; never serialized to the client.
5. For each key, `get(key, { access: 'private' })` (the `app/forge/lib/art.ts` helper) → bytes + contentType. Tolerate a missing/failed blob by skipping that card (don't fail the whole export); if the result is indistinguishable-404 like the proxy, skip.
6. Assemble an **in-memory ZIP** with **`fflate`** (`zipSync`) — card counts are small (tens), so in-memory is fine and simplest.
7. Respond `200` with the ZIP bytes, `Content-Type: application/zip`, `Content-Disposition: attachment; filename="{set-slug}-artwork.zip"`, `Cache-Control: private, no-store`.

**UI** — on `app/forge/sets/[setId]/progress/` (the gate's UI): a "Download artwork (ZIP)" control. It's a plain link/anchor to the route (`<a href="/forge/api/sets/{id}/artwork">`), so the browser performs the download; **no art keys or blob bytes pass through any client prop.** The server page computes a boolean `hasApprovedArt` (count of approved cards with non-placeholder art > 0) and disables the control with a hint when false.

**Audit (optional, lightweight).** One `forge_audit` entry per bulk download (reuse `forge_log_art_download` per included card, or a single set-level event). Non-blocking; include if cheap.

**Dependency.** Add `fflate` (tiny, zero-dependency). No other new deps.

---

## Security

This is a leak-sensitive surface (it streams prerelease art bytes), handled exactly like the per-card proxy:
- The route **gates first** (`requireForge` as the first statement, then the set-elder check) — satisfies the `forge-gate-first` guardrail (every `/forge` surface gates itself; there is no `/forge` middleware).
- Non-member / non-set-elder → **404**, indistinguishable from "set has no exportable art."
- All bytes flow through the **private-blob `get(..., {access:'private'})`** path; **no public URL is ever generated**; `Cache-Control: private, no-store`.
- **Art keys never cross to the client** (consistent with 1a.3's `hasArt:boolean`-not-key rule).
- **Guardrail coverage:** extend the Forge test guardrails so the new route is asserted to 404 for anon / non-member (and `forge-gate-first` recognizes the route gates itself).

---

## Testing

- **Pure unit tests** for the two pure helpers: the filename builder (`{NN}_{slug}.{ext}` from name + contentType, collision-safe) and the content-type→extension map. TDD, hermetic.
- **Guardrail:** anon / non-member `GET /forge/api/sets/{id}/artwork` → 404 (extend `forge-anon-leak` live probes and/or `forge-gate-first`).
- `npm run build` clean; `npm test` green (allowing the one pre-existing unrelated `store-route` failure).
- **Manual smoke:** as a set-elder, approve ≥1 card with real art, click "Download artwork" → a ZIP with correctly-named files downloads; a set with only placeholders/drafts shows the disabled button.

---

## Open items resolved during planning

- Exact set-read predicate to reuse for the route gate (`getSet`/`is_forge_set_elder`) and whether a definer helper is needed to read approved `card_versions` art keys under RLS.
- Whether `get()` returns `contentType` reliably for ext derivation (the proxy already relies on it).
