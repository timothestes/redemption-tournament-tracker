# Card Price Matching: Problem Statement

## Goal

Display accurate card prices from Your Turn Games (YTG) Shopify store alongside cards in a Redemption CCG deck builder. The two datasets have no shared primary key and are independently maintained.

## The Two Datasets

### Dataset A: Card Data (`carddata.txt`)

Source: Community-maintained GitHub repo (`jalstad/RedemptionLackeyCCG`). Tab-separated, ~5,333 rows.

Key fields per card:
- **Name** (col 0): The card name, which often includes set/variant info baked into the name itself
- **Set code** (col 1): Short internal code like `Ki`, `Pri`, `T2C`, `RoJ (AB)`
- **Image file** (col 2): Sanitized filename for card image
- **Official set** (col 3): Human-readable set name like `Kings`, `Priests`, `Times to Come`

The deck builder uses `name|set_code|img_file` as its internal unique key.

**Important quirks:**
- Card names sometimes embed set info: `"Aaron (Pi)"`, `"Abel (CoW)"`, `"Abraham's Servant to Ur (LoC)"`
- Some use bracket notation instead of parens: `"Abed-nego (Azariah) [T2C]"`, `"Abandoned [K]"`
- Variant suffixes appear in names: `"Aaron, Moses' Brother (1st Print - L)"`
- Same card exists across many sets/editions: `"Aaron's Rod"` appears in sets C, G, L, UL
- ~5,321 unique card names across ~53 set codes

**Sample rows:**
```
Name                                    Set         OfficialSet
Angel of the Lord                       Pri         Priests
Aaron (Pi)                              Pri         Priests
Abed-nego (Azariah) [T2C]              T2C         Times to Come
Aaron, Moses' Brother (1st Print - L)   L1P         L Starter (1st Print)
Abraham's Servant to Ur (LoC)           LoC         Lineage of Christ
Lost Soul "Shut Door" (Luke 13:25)      GoC         Gospel of Christ
```

### Dataset B: Shopify Products (YTG Store)

Source: Shopify Admin API, ~5,131 products total, **4,868 are singles** (product_type = "Single").

Key fields per product:
- **title**: Product title, almost always in format `"Card Name (Set Abbreviation)"`
- **handle**: URL slug, stable identifier (e.g., `angel-of-the-lord-ot-j`)
- **tags**: Comma-separated, includes set name, brigade color, card type (e.g., `"Hero, Silver, Kings, Rotation Cards"`)
- **product_type**: `"Single"` for individual cards
- **variants**: Array with price, SKU (usually empty), inventory_quantity

**Naming pattern:** `"Card Name (Set Abbreviation)"` — examples:
```
"Angel of the Lord (Pi)"       — $0.25
"Angel of the Lord (J Deck)"   — $2.50
"Spirit as a Dove (Promo)"     — $3.00
"Denarius (I & J+)"            — $0.50
"Lost Soul "Shut Door" (Luke 13:25) (Legacy Rare)"  — $1.50
```

**16 products don't follow the `Name (Set)` pattern** — these are banned/out-of-print cards with suffixes like `*Banned from official play*` or `*Out of Print*`.

**Variants:** 97% of singles have exactly 1 variant (1 price). Multi-variant singles are rare.

**Tags are rich and structured:**
- Set name: `"Kings"`, `"Priests"`, `"Gospel of Christ"`, `"I & J+"`
- Brigade: `"White"`, `"Silver"`, `"Crimson"`
- Card type: `"Hero"`, `"Evil Character"`, `"Good Enhancement"`, `"Lost Soul"`, `"Artifact"`
- Special: `"Rotation Cards"`, `"Legacy Rare"`, `"Promos"`, `"Dominant"`

## Set Code Mapping Problem

The set codes/abbreviations differ between the two datasets:

| Carddata Set Code | Shopify Set Abbreviation | Notes |
|---|---|---|
| `Ki` | `Ki` | Direct match |
| `Pri` | `Pi` | Different abbreviation |
| `Pat` | `Pa` | Different abbreviation |
| `RR` | `Roots` | Completely different |
| `T2C` | `TtC` | Different abbreviation |
| `War` | `Wa` | Different abbreviation |
| `Wom` | `Wo` | Different abbreviation |
| `FoOF` | `FooF` | Capitalization difference |
| `TEC` | `EC` | Different abbreviation |
| `TPC` | `PC` | Different abbreviation |
| `Prp` | `Pr` | Different abbreviation |
| `Pmo-P1/P2/P3` | `Promo` | Multiple codes → one |
| `I/J+` | `I & J+` | Formatting difference |
| `K`, `K1P` | `K Deck` | Added "Deck" suffix |
| `L`, `L1P` | `L Deck` | Added "Deck" suffix |
| `A`–`J` | `A Deck`–`J Deck` | Added "Deck" suffix |
| `CoW (AB)` | `CoW AB` | Parens vs no parens |
| `RoJ (AB)` | `RoJ AB` | Parens vs no parens |
| `Main`, `Main UL` | `Or` | Old editions → "Original" |
| `1E`, `1EU`, `2E`, `2ER`, `3E`, `10A`, `Fund` | *(not sold)* | YTG doesn't stock these |

## Current Matching Results (Naive Approach)

With a hard-coded set mapping and title construction (`name + " (" + shopify_set + ")"` compared to Shopify titles):

- **67% match rate** on first pass (3,592 / 5,333)
- **~850 cards from old/unsold sets** (Main, 1E, 2E, 3E, etc.) — no price will ever exist
- Remaining ~1,741 unmatched break down into:
  - Cards with embedded set in name (double-wrapping when constructing title)
  - Bracket notation `[Set]` vs paren notation `(Set)`
  - `1st Print` variant suffixes
  - Promo subset variations
  - Minor naming differences

**Match rates by modern set (excluding old editions):**
- Kings (Ki): 97% matched
- Priests (Pri): 96%
- Roots (RR): 97%
- Patriarchs (Pat): 97%
- Apostles (Ap): 92%
- Warriors (War): 93%
- But GoC: 84%, FoM: 73%, LoC: 82% — worse due to name embedding and variants

## Constraints & Requirements

1. **Accuracy over coverage**: Wrong prices are worse than missing prices. Only show prices for confident matches.
2. **Multiple printings**: Show cheapest available price across all printings of the same card.
3. **Stable over time**: Solution must handle new products being added to Shopify, new cards being added to carddata.txt, and set code conventions potentially changing.
4. **Prices are slow-changing**: Updated weekly or less frequently is fine.
5. **Output format**: JSON file keyed by `cardName|setCode` for the deck builder to consume.
6. **Fallback**: For unmatched cards, the UI can show a "Search on YTG" link (already implemented).

## What I Need

A scalable, maintainable architecture for matching these two datasets. The solution should:

1. **Not be brittle** — avoid hard-coded set mappings that break when new sets are released
2. **Handle new products automatically** or with minimal manual intervention
3. **Produce a reviewable mapping** — I should be able to audit matches and fix mistakes
4. **Separate matching from price fetching** — matching is done once (or incrementally), price updates are frequent
5. **Account for the name embedding problem** — carddata names like `"Aaron (Pi)"` where the set is part of the name field, not a separate field

## Available Data Points for Matching

From carddata.txt: `name`, `set_code`, `official_set`, `img_file`, `type`, `brigade`, `rarity`

From Shopify: `title`, `handle`, `tags` (set name, brigade, card type), `product_type`, `price`

Both datasets have overlapping metadata (brigade colors, card types, set names) that could be used for disambiguation beyond just name matching.

## File Locations

- Shopify product dump: `scripts/output/ytg_products.json` (4,868 singles)
- Card data source: fetched from GitHub at runtime
- Existing YTG URL utilities: `app/decklist/card-search/ytgUtils.ts`
- Deck builder card loading: `app/decklist/card-search/hooks/useDeckState.ts`
