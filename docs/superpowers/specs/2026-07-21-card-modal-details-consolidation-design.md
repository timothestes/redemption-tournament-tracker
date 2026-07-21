# Card Modal — Details Consolidation & Consistent Layout

**Date:** 2026-07-21
**Component:** `app/decklist/card-search/ModalWithClose.tsx` (mobile layout only)

## Problem

On mobile, the card-detail modal renders the card image at two different sizes
depending on the card. Cards with alternate printings (or rulings) show a taller
**2-row footer**; the card image is sized off the *leftover* height
(`CardImageFrame`, `width: min(100%, 71.4286cqh)`) and vertically centered, so a
taller footer shrinks the image and leaves a visible **gap below the card**.

Trigger for the 2-row footer (`needsFooterRow2`, line ~815): the card has
alternate printings (the `⇄ N` **Versions** button), has rulings, has the
collection stepper, or is already in the deck.

The **price is not the trigger** — `$2.00` vs `Shop` only changes the button
label. The reported cards (Lord of Armies, Darius' Decree) merely correlate:
they have alternate printings, which is the real cause.

This affects both entry points, which are the same component:
- read-only card view on `/decklist/[deckId]`
- the deck-builder card modal (`+ Main / + Rsv / + Mb`)

## Goal

A consistent, full-size card image across cards, with secondary card info
reachable from one unobtrusive affordance.

## Design

### 1. Header "details" button

- Add a small **ⓘ / info icon button** in the mobile modal header, immediately
  left of the ✕ close button (line ~872).
- It renders **only when there is secondary content** — i.e. `hasDuplicates ||
  rulings.length > 0` (admins with `canManageRulings` also get it so they can add
  a first ruling).
- Being in the header, it has **zero effect on image height**.

### 2. Combined "Card details" bottom sheet

- New `MobileCardDetailsSheet` — a single bottom sheet (one backdrop/close) that
  renders sections conditionally:
  - **Versions (N)** — the version list + switch behavior.
  - **Rulings (N)** — the rulings list, including the admin "add ruling" entry
    point (`canManageRulings` / `addRulingMode`).
- To avoid two nested backdrops, extract the *inner content* of the current
  `MobileVersionsSheet` (line ~217) and `MobileRulingsSheet` (line ~302) into
  small section components (`VersionsSectionContent`, `RulingsSectionContent`),
  and render those inside the combined sheet. The existing per-sheet wrappers are
  removed once their content is extracted.
- Opened by the header button; a single `detailsSheetOpen` state replaces the
  separate `versionsSheetOpen` / `rulingsSheetOpen` states.

### 3. Remove footer triggers

- Remove the **Versions** button (line ~1203) and the **Rulings** button
  (lines ~1182 / ~1194 admin add) from footer row 2.
- Drop `rulings` and `hasDuplicates` from the `needsFooterRow2` condition. It
  becomes: `hasMinusButtons || hasCollection`.
- Net effect: for the reported cards, the footer is 1-row → the image renders
  full-size and consistent in both entry points.

### Out of scope (unchanged)

- **Collection stepper** and **in-deck minus / Shop relocation** stay in the
  footer. They are functional deck-editing controls, appear only in narrow cases
  (collection tracking enabled; card already in the deck), and are not the cause
  of the reported per-card inconsistency.
- **Desktop side-by-side layout** is untouched — it has no "footer below image"
  and no bug.
- The `pb-[6.5rem]` / `pb-[4rem]` height hack stays; with versions/rulings gone
  from the trigger it simply resolves to `pb-[4rem]` for the affected cards.

## Verification

- Read-only view (`/decklist/[deckId]`): a card with alternate printings (e.g.
  Darius' Decree) renders the same image size as King's Sword; no bottom gap.
- Deck-builder modal: same, with `+ Main / + Rsv / + Mb` present.
- ⓘ button opens the combined sheet; Versions switch still works; Rulings list
  and admin add-ruling still work.
- A card with neither versions nor rulings shows **no** ⓘ button and is unchanged.
- Desktop layout unchanged.
