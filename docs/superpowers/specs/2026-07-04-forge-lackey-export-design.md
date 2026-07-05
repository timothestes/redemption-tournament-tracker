# Forge — Export sets as a Lackey zip

**Date:** 2026-07-04
**Status:** Approved design, pending implementation plan

## Problem

The Forge has an **Import a set** flow (`app/forge/import/ImportWizard.tsx`) that unpacks a
LackeyCCG plugin zip in the browser and creates Forge cards from `sets/carddata.txt` +
`sets/setimages/general/*`. There is no inverse: a designer cannot get the cards they are
building back out of the Forge to playtest them in LackeyCCG or to share/back them up.

## Goal

Add an **Export a set** action that lets a designer pick one or more Forge sets from a modal
and download a single zip whose structure exactly matches what the importer reads. This
guarantees a Forge round-trip and gives a Lackey user drop-in `carddata.txt` rows + images to
merge into their existing Redemption plugin.

## Decisions (confirmed with user)

1. **Export format:** a Forge/Lackey *mergeable* zip — `sets/carddata.txt` +
   `sets/setimages/general/*` + `sets/setlist.txt`. NOT a full drop-in Lackey plugin
   (no `plugininfo.txt` / `updatelist.txt` hashes / `formats.txt` / `cardback` / decks). The
   full-plugin route is out of scope: much more to generate, brittle, and redundant since
   designers already have the Redemption plugin installed.
2. **Cards included:** all non-archived cards' **working** snapshot + **working** finished
   image (i.e. exactly what is "being worked on in Forge", mirroring what Import brings in).
   Cards with no finished image still get a `carddata.txt` row (no image file).

## Zip layout

```
<name>-forge-export.zip
 └─ sets/
     ├─ carddata.txt          header + one row per exported card (tab-delimited)
     ├─ setlist.txt           the exported set names
     └─ setimages/general/
         ├─ Alpha-and-Omega.jpg
         └─ …                 working finished image per card that has one
```

`carddata.txt` header (exact 16 columns, matching the sample export):

```
Name  Set  ImageFile  OfficialSet  Type  Brigade  Strength  Toughness  Class  Identifier  SpecialAbility  Rarity  Reference  Sound  Alignment  Legality
```

(Columns are tab-separated. The importer's `parseCarddata` matches columns **by header name**,
so column order/extra columns like `Sound` are harmless; we emit the full canonical header.)

## Components

### 1. Pure helpers — invert the Lackey mapper

Location: `app/forge/lib/lackey.ts` (client-safe, unit-tested), alongside the existing
`lackeyRowToDesignCard`.

- `CARDDATA_HEADER: string[]` — the exact 16-column order above.
- `designCardToLackeyRow(card: DesignCard, ctx: { set: string; officialSet: string; imageFile: string }): string[]`
  — the inverse of `lackeyRowToDesignCard`:
  - **Type:** `CardType[]` → Lackey type strings joined with `/`
    (`EvilCharacter`→`Evil Character`, `GE`→`GE`, `EE`→`EE`, `LostSoul`→`Lost Soul`, others
    pass through: `Hero`, `Artifact`, `Dominant`, `Fortress`, `Site`, `City`, `Curse`,
    `Covenant`).
  - **Brigade:** `Brigade[]` → names joined with `/` (`GoodGold`→`Good Gold`,
    `PaleGreen`→`Pale Green`, others as-is).
  - **Strength / Toughness:** number → string; `null`/absent → empty string.
  - **Class:** recombine `card.class` (`Warrior`/`Weapon`) **and** `card.icons`
    (`Territory`/`Star`/`Cloud`) into the single Class column, joined with `/` — because the
    importer's `splitMulti` on the Class column feeds both `class` and `icons`.
  - **Identifier:** `identifiers[]` joined with `, `.
  - **SpecialAbility:** `cardRawText(card)` (raw text, falling back to legacy
    `specialAbility`).
  - **Rarity / Reference:** pass through.
  - **Alignment:** `Good_Evil`→`Good/Evil`, else `Good`/`Evil`/`Neutral`.
  - **Legality:** pass through (`Rotation`/`Classic`/`Scrolls`/`Paragon`/`Banned`).
  - **Sound:** always empty.
  - **Name / Set / ImageFile / OfficialSet:** from `card.name` and `ctx`.
- Every emitted field is run through a sanitizer that replaces tabs and CR/LF with single
  spaces, so no card text can break the TSV.
- `serializeCarddata(rows: string[][]): string` — header line + tab-joined rows, `\n`-joined.

**Verification:** a round-trip unit test proves correctness against the real importer parser:
`DesignCard → designCardToLackeyRow → serializeCarddata → parseCarddata →
lackeyRowToDesignCard` recovers the mappable fields (cardType, brigades, stats, class, icons,
identifiers, rawText/specialAbility, alignment, legality, rarity, reference).

### 2. Server-only card+art reader

Location: `app/forge/lib/setArtwork.ts` (new export) or a small `lib/lackeyExport.ts`.

- `listSetWorkingCards(setId: string): Promise<WorkingCard[]>` — like the existing
  `listSetApprovedArt`, but reads working data:
  `select title, working_snapshot, working_finished_key from forge_cards where set_id = ?
  and status <> 'archived'`. Carries a private blob key → **server-only**, never serialized to
  a client component.
- `WorkingCard = { cardId, title, snapshot: DesignCard, finishedKey: string | null }`.

### 3. Export route

Location: `app/forge/api/export/route.ts`, `GET ?ids=setId1,setId2,…`, `dynamic =
"force-dynamic"`. Mirrors `app/forge/api/sets/[setId]/artwork/route.ts` almost line-for-line.

Flow:
1. `requireForge()` → `notFoundResponse()` (404, never 401/403 — the area stays secret).
2. Parse `ids` (comma-separated; cap the count defensively).
3. For each id: `getSet(id)` under RLS — skip silently if `null` (caller can't read it).
4. For each readable set: `listSetWorkingCards(setId)`.
5. Assemble rows: `ImageFile` = slugified title, **deduped with a numeric suffix** across the
   entire export so the flat `setimages/general/` dir can't collide across sets. `Set` = set
   slug, `OfficialSet` = set name. Build the row via `designCardToLackeyRow`.
6. For each card with a `finishedKey`: `readForgeArt(key)`; on success add bytes at
   `sets/setimages/general/<ImageFile>.<ext>` (`artExt` maps content-type → extension). Skip a
   missing/failed blob rather than failing the whole export (same as the artwork route). The
   card still keeps its `carddata.txt` row.
7. Write `sets/carddata.txt` (`serializeCarddata`) and `sets/setlist.txt` (the readable set
   names, one per line).
8. If zero readable cards across all selected sets → `notFoundResponse()` (modal surfaces
   "Nothing to export").
9. `zipSync(files, { level: 0 })` (images already compressed) → `Response` with
   `Content-Type: application/zip`, `Content-Disposition: attachment; filename="…-forge-export.zip"`,
   `Cache-Control: private, no-store`.

Filename: derived from the first selected set's slug when one set, else a generic
`forge-export`.

### 4. UI — Export modal

Location: `app/forge/sets/SetsIndex.tsx` (elder-gated, same `canCreate` guard as "Import a
set"; reuses the `Dialog` component already imported in this file).

- An **Export a set** button next to the existing **Import a set** link.
- Opens a `Dialog` with a checkbox list of all sets (name + card count), a **Select all**
  toggle, and a primary **Export N sets** button (disabled when none selected).
- On export: `fetch('/forge/api/export?ids=' + selectedIds.join(','))`, show a
  "Preparing…" state; on `res.ok` convert the blob to an object URL and trigger a download via
  a temporary anchor, then revoke the URL and close the modal. On 404/other error surface an
  inline message (e.g. "Nothing to export.").

## Out of scope

- Full drop-in Lackey plugin generation (`plugininfo.txt`, `updatelist.txt` hashes,
  `formats.txt`, `cardback`, decks, sounds).
- A per-set export entry point on the Progress tab (the existing "Download artwork (ZIP)"
  stays as-is; the multi-select modal on the Sets index is the single new entry point).
- Exporting approved/released versions (working snapshots only, per decision #2).

## Testing

- **Unit:** round-trip test for `designCardToLackeyRow` / `serializeCarddata` through the real
  `parseCarddata` + `lackeyRowToDesignCard`; sanitizer test (tab/newline in ability text);
  ImageFile dedup helper.
- **Route:** mirror the existing artwork route test — 404 for non-member; zip contents
  (`sets/carddata.txt` present, image entries at the expected paths) for a member with a
  readable set.
