# Goldfish Design System: "The Illuminated Archive"

## 1. Overview & Creative North Star

This design system is built upon the concept of **The Illuminated Archive**. We are not merely building a card game interface; we are digitally excavating a sacred, ancient text by torchlight. The experience must feel dusty and venerable, yet possess a mechanical "snappiness" that reminds the user they are wielding powerful, responsive magic.

To move beyond a standard "gaming template," we utilize a **High-End Editorial** approach. This means prioritizing intentional white space (or "void space" in our cave-like palette), utilizing high-contrast typography scales, and embracing asymmetrical layouts that mimic the irregular edges of hand-cut parchment. We avoid the rigid, centered "box-within-a-box" look in favor of layered depths and organic transitions.

---

## 2. Colors

The palette is rooted in the earth: deep cave shadows, sun-bleached fibers, and the intense, flickering gold of a torch.

### The Palette

- **Background (`#19120C`)**: The "Deep Cave Shadow." This is our primary canvas.
- **Primary (`#F1BD7E`)**: "Golden Ember." Reserved for high-priority interactions and essential feedback.
- **Secondary (`#FBB982`)**: "Torchlight Glow." Used for active states and subtle illumination.
- **Tertiary (`#D8C594`)**: "Weathered Sandstone." Our foundational color for secondary UI elements.
- **Surface Tiers**: We use `surface-container-lowest` through `highest` to define tectonic shifts in the UI.

### The "No-Line" Rule

**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section content. Traditional lines are "modern" and clinical; they break the immersion of an ancient artifact.

- **Boundaries** must be defined solely through background color shifts. For example, a `surface-container-low` section should sit directly on a `surface` background to create a natural, atmospheric edge.
- **Signature Textures:** For main CTAs and Hero headers, use a subtle linear gradient transitioning from `primary` (`#F1BD7E`) to `primary-container` (`#C4955A`). This adds a metallic, "soulful" polish that flat color lacks.

---

## 3. Typography

The typographic system is a dialogue between the monumental past and functional clarity.

- **Display & Headlines (Cinzel):** Used for titles and key headers. Cinzel brings a Roman, chiseled-in-stone authority. Use wide tracking (letter-spacing) for `display-lg` to evoke the feeling of ancient temple inscriptions.
- **Body & Titles (Noto Serif / Crimson Text):** A clean, highly legible serif. We treat body text like the body of a Dead Sea Scroll—tightly composed but with generous line-height (`leading-relaxed`) to ensure the "dusty" aesthetic doesn't hinder readability.
- **Labels (Work Sans):** Used sparingly for technical metadata (e.g., "Card Count," "Version"). This provides a "snappy," functional contrast to the ancient serifs.

---

## 4. Elevation & Depth: Tonal Layering

In this design system, depth is not achieved by "lifting" objects off the page, but by "carving" them into it or "stacking" them like layers of vellum.

### The Layering Principle

Stacking `surface-container` tokens creates a soft, natural lift. Place a `surface-container-lowest` card on a `surface-container-low` section to create hierarchy without the need for artificial shadows.

### Ambient Shadows

When a floating element (like a context menu or modal) is required, use "Ambient Shadows":

- **Blur:** 24px - 40px.
- **Opacity:** 4% - 8%.
- **Color:** Tint the shadow with `on-surface` (`#F0DFD5`) rather than black. This mimics the way light wraps around objects in a dimly lit room.

### Glassmorphism & The "Ghost Border"

To maintain the "Sacred" feel, use Backdrop Blurs (12px-20px) on floating panels.

- **The Ghost Border:** If a boundary is strictly required for accessibility, use the `outline-variant` token at **15% opacity**. Never use 100% opaque borders; they feel like wireframes, not artifacts.

---

## 5. Components

### Buttons: The "Glowing Ember"

Buttons should feel like heat-treated metal or glowing embers.

- **Primary:** Gradient fill (`primary` to `primary-container`). On hover, increase the `surface-tint` to create a "bloom" effect.
- **Tertiary:** No background. Use `Cinzel` in `primary` color with a `label-md` scale.

### Cards: The "Stone Carving"

- **Styling:** Use `surface-container-low`. Forbid divider lines.
- **Spacing:** Use `spacing-6` (1.5rem) to separate internal content blocks.
- **Edges:** Apply `rounded-sm` (0.125rem) to mimic the slight irregularity of hand-chipped stone.

### Modals: "Parchment Overlays"

- **Background:** Use `surface-container-high` with a subtle texture overlay (Dead Sea Scroll fiber texture).
- **Backdrop:** A 60% opacity blur of the `background` (`#19120C`).

### Input Fields

- **State:** Unfocused inputs are `surface-container-lowest` with a "Ghost Border."
- **Focus:** The border transitions to a 40% `primary` glow, and the text uses `primary-fixed`.

---

## 6. Do's and Don'ts

### Do:

- **Use Asymmetry:** Place decorative elements or "torchlight" glows off-center to break the digital grid.
- **Embrace the Dark:** Let the `surface-dim` and `background` colors do the heavy lifting. The UI should feel like it's emerging from shadows.
- **Prioritize Serif Legibility:** Ensure all `body-md` text has a minimum contrast ratio of 7:1 against its container.

### Don't:

- **No Pure Black/White:** Never use `#000000` or `#FFFFFF`. Use our `surface` and `on-surface` tokens to maintain the weathered, organic tone.
- **No Hard Corners:** Avoid `rounded-none`. Even stone has a radius. Use `rounded-sm` for cards and `rounded-full` for action chips.
- **No Standard Dividers:** Never use a `<hr>` or a 1px line to separate list items. Use a `0.5px` shift in surface color or `spacing-4` vertical gaps.

---

## 7. Signature Element: The Torchlight Vignette

Every primary screen should feature a non-functional, decorative radial gradient in the background, using `primary-container` at 5% opacity. This "flicker" should be positioned behind the most important piece of content, acting as a spiritual spotlight.
