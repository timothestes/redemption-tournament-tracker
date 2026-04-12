# Design System: The Digital Archivist

## 1. Creative North Star

**The Digital Archivist** — This design system rejects the "gamey" clutter of traditional CCG interfaces in favor of a sophisticated, high-end editorial experience. It treats decklists and card data as curated artifacts rather than spreadsheet rows, bridging the gap between a futuristic terminal and a prestige scientific journal.

**Intentional Asymmetry** breaks the "template" feel. Layouts should avoid perfectly centered grids; instead, use heavy left-aligned typography contrasted with data-dense modules shifted to the right. Overlapping elements — such as card art bleeding behind semi-transparent data panels — create a sense of layered history and depth that feels bespoke and expensive.

---

## 2. Color & Surface Architecture

### The "No-Line" Rule

**1px solid borders for sectioning are strictly prohibited.** Structural boundaries are achieved exclusively through:
- **Background Color Shifts:** A `surface-container-low` section sitting on a `surface` background.
- **Tonal Transitions:** Subtle shifts in the surface-container tiers (Lowest → Highest) to denote nested hierarchy.

### Surface Hierarchy

Treat the UI as a physical stack of light-reactive panels:

| Level | Role | Light Mode | Dark Mode |
|-------|------|-----------|-----------|
| 0 — Foundation | Main background | `surface` (#f8f9ff) | `surface` (#060E20) |
| 1 — Structure | Navigation, sidebars | `surface-container-low` (#eff4ff) | `surface-container-low` (#091328) |
| 2 — Interactive | Cards, deck slots | `surface-container-lowest` (#ffffff) | `surface-container-highest` (#192540) |
| 3 — Floating | Modals, popovers | `surface-bright` + Glassmorphism | `surface-variant` @ 60% opacity + Glassmorphism |

### Glassmorphism

Apply to any element that "hovers" over the main canvas (modals, tooltips, card previews, floating nav):
- **Light mode:** `surface-container-lowest` at 70% opacity, `backdrop-blur: 12px`
- **Dark mode:** `surface-variant` at 60% opacity, `backdrop-blur: 20px`

### Signature Gradients

Main CTAs and deck "Hero" headers use a linear gradient to add dimensional glow:
- **Light mode:** `primary` (#00288e) → `primary-container` (#1e40af)
- **Dark mode:** `primary` (#74B0FF) → `primary-container` (#5EA3F8)

---

## 3. Typography

The system thrives on the contrast between the technical (GeistSans) and the classical (Cinzel).

- **Display & Headlines (Cinzel):** Use `display-lg` and `headline-lg` for deck titles and card names. Tight letter-spacing (-0.02em) for authoritative, editorial impact.
- **Body & UI Text (GeistSans):** All functional text. Geometric clarity ensures legibility at small scales (card effect text, stats).
- **Data Labels (GeistSans):** `label-sm` in all-caps with +0.1em letter-spacing for metadata (e.g., "BRIGADE" or "COLLECTION ID") to provide a "cataloged" look. Use `on-surface-variant` color.
- **Body Text:** `body-md` for card ability text. High line-height (1.6) is mandatory for readability, especially against dark backgrounds.

---

## 4. Elevation & Depth: Tonal Layering

Hierarchy is achieved through **Tonal Stacking**, not drop shadows.

### The Layering Principle

To lift a component, move it to a "higher" surface token. A card in a "pressed" state moves to a lower surface tier, visually "sinking" into the interface.

### Ambient Shadows

Shadows are never gray — they are "Atmospheric," tinted with the primary brand color:
- **Light mode:** `0px 12px 32px 0px rgba(0, 40, 142, 0.06)` — low-opacity primary tint simulating natural light refraction.
- **Dark mode:** `0px 20px 40px rgba(6, 14, 32, 0.6)` — diffused, deep navy. Never pure black.

### The "Ghost Border" Fallback

If a visual separator is absolutely required for accessibility, use a **Ghost Border**: `outline-variant` at **15% opacity**. It should be felt, not seen. Never use a 100% opaque border.

---

## 5. Components

### Buttons

- **Primary:** Gradient fill (primary → primary-container), `on-primary` text, `rounded-md`. No border.
- **Secondary (Light):** `surface-container-high` background with `on-primary-fixed-variant` text. No border.
- **Secondary (Dark):** Ghost style. No fill, `outline` at 20% opacity. Text in `primary`.
- **Hover:** Light mode — `backdrop-filter: brightness(1.1)`. Dark mode — `primary-dim` outer glow (4px blur). Avoid simple color swaps.

### Cards & Deck Slots

- **Forbid divider lines** within cards. Use `spacing-4` (0.9rem) to separate title from ability text.
- **Structure:** `0.75rem` (spacing-3) gap between list items. Subtle background shift on hover to indicate interactivity.
- **Dark mode visuals:** Card art slightly desaturated until hovered, then full color with tonal shift to `surface-bright`.
- **Intentional Asymmetry:** Align card images slightly off-center or overlapping the card container edge.

### Input Fields

- **Light mode:** `surface-container-low` fill. Focus shifts background to `surface-container-highest` with a `2px` subtle glow using `primary` at 20% opacity.
- **Dark mode:** `surface-container-lowest` (#000000) fill with 2px bottom-accent in `outline-variant`. Focus transitions bottom accent to `tertiary` (#47C4FF) with glow.

### Data Chips (Stats/Attributes)

Small, pill-shaped (`rounded-full`). Use `secondary-container` with `on-secondary-container` text. These function as "data tags" in the archive.

### Tooltips

Glassmorphism rule applies. `surface-variant` background at 80% opacity, `12px` blur. Use `label-sm` for content.

### Navigation

"Floating Dock" style — centered, semi-transparent glass container (`surface-container-lowest` @ 80% opacity) positioned at top or bottom of viewport.

---

## 6. Do's and Don'ts

### Do

- **Use the Spacing Scale** religiously. `spacing-6` (1.3rem) between modules, `spacing-8`/`spacing-12` between major content blocks.
- **Embrace Tonal Layering.** Place high-priority information on "higher" (brighter in light, lighter in dark) surface tiers.
- **Use `tertiary`** (#47C4FF in dark mode) for interactive data points — clickable stats, filter toggles.
- **Use `surface-container-lowest`** for "cut-out" areas like search bars or empty deck slots to create physical recession.
- **Use `on-surface-variant`** for secondary text to maintain soft, premium contrast.

### Don't

- **Don't use 1px solid lines** to separate content. Use background color steps instead.
- **Don't use pure black or pure gray shadows.** Always tint with primary brand blue.
- **Don't use standard grey neutrals.** Every neutral should derive from the slate/navy `on-surface` or `outline` tokens.
- **Don't crowd the interface.** If a screen feels busy, increase spacing tokens rather than adding borders or lines.
- **Don't use standard "system" grids.** Offset columns by 1-2 units for a more bespoke, editorial layout.
