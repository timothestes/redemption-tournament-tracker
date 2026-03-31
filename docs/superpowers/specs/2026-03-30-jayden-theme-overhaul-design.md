# Jayden Theme Overhaul — Design Spec

**Date:** 2026-03-30
**Goal:** Full aesthetic pass on the jayden theme — shift primary to blue, migrate all hardcoded colors to semantic tokens, add subtle red→blue gradient on surfaces.

---

## 1. Token Updates (globals.css `.jayden` block)

### Color Shifts

| Token | Current | New | Rationale |
|-------|---------|-----|-----------|
| `--primary` | `330 90% 55%` (pink) | `230 90% 55%` (vivid blue) | Match logo's blue; all action buttons become blue |
| `--accent` | `190 95% 50%` (cyan) | `330 90% 55%` (pink) | Pink moves to accent for badges/highlights |
| `--accent-foreground` | `270 20% 4%` (dark) | `0 0% 100%` (white) | White text on pink accent |
| `--ring` | `330 90% 55%` (pink) | `230 90% 55%` (blue) | Focus rings match primary |

All other tokens unchanged.

### New Gradient Variables

Already partially added — update to match final direction:

```css
--gradient-red: hsl(0, 90%, 55%);
--gradient-pink: hsl(330, 90%, 55%);
--gradient-purple: hsl(270, 70%, 50%);
--gradient-blue: hsl(230, 90%, 55%);
--jayden-gradient: linear-gradient(135deg, var(--gradient-red), var(--gradient-pink), var(--gradient-purple), var(--gradient-blue));
--jayden-gradient-subtle: linear-gradient(135deg, hsla(0, 80%, 50%, 0.06), hsla(330, 80%, 50%, 0.04), hsla(270, 60%, 50%, 0.04), hsla(230, 80%, 50%, 0.06));
```

### Gradient Utility Classes

```css
.jayden .jayden-gradient-bg    { background-image: var(--jayden-gradient-subtle); }
.jayden .jayden-gradient-text  { background: var(--jayden-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.jayden .jayden-gradient-accent { background: var(--jayden-gradient); }
```

These are no-ops outside jayden mode.

---

## 2. Token Migration — Mapping Table

Every hardcoded Tailwind color class in the app should be replaced with a semantic token:

| Hardcoded Pattern | Replacement Token |
|---|---|
| `bg-white dark:bg-gray-800` | `bg-card` |
| `bg-white dark:bg-gray-900` | `bg-background` |
| `bg-gray-50 dark:bg-gray-900` | `bg-muted` |
| `bg-gray-100 dark:bg-gray-800` | `bg-muted` |
| `border-gray-200 dark:border-gray-700` | `border-border` |
| `border-gray-300 dark:border-gray-600` | `border-border` |
| `text-gray-900 dark:text-white` | `text-foreground` |
| `text-gray-700 dark:text-gray-300` | `text-foreground` |
| `text-gray-600 dark:text-gray-400` | `text-muted-foreground` |
| `text-gray-500 dark:text-gray-400` | `text-muted-foreground` |
| `text-gray-400 dark:text-gray-500` | `text-muted-foreground` |
| `hover:bg-gray-50 dark:hover:bg-gray-800` | `hover:bg-muted` |
| `hover:bg-gray-100 dark:hover:bg-gray-700` | `hover:bg-muted` |
| `bg-green-700 text-white` | `bg-primary text-primary-foreground` |
| `bg-emerald-700 text-white` | `bg-primary text-primary-foreground` |
| `bg-emerald-800 text-white` | `bg-primary text-primary-foreground` |
| `text-blue-500 hover:text-blue-400` | `text-primary hover:text-primary/80` |
| `text-blue-600 dark:text-blue-400` | `text-primary` |
| `hover:text-blue-600 dark:hover:text-blue-400` | `hover:text-primary` |
| `border-blue-500` | `border-primary` |
| `bg-blue-50 dark:bg-blue-900/20` | `bg-primary/10` |
| `bg-blue-600 text-white` | `bg-primary text-primary-foreground` |
| `focus:ring-blue-500` | `focus:ring-ring` |
| `placeholder-gray-400 dark:placeholder-gray-500` | `placeholder-muted-foreground` |

**Exceptions — keep hardcoded where semantically correct:**
- Badge colors for card types (T1 purple, T2 amber, Paragon blue) — these are semantic, not theme-driven
- Destructive/red buttons — already using `--destructive` token or are semantically red
- White text on `bg-black/90` overlays (e.g., spoiler lightbox) — intentional contrast
- Status indicators (green for public, gray for private deck badges) — semantic meaning

---

## 3. Surface Gradient Aesthetic

### Card Surfaces

Add `jayden-gradient-bg` class to major card containers. The gradient is 4-6% opacity — barely visible but adds warmth at top-left and coolness at bottom-right.

**Apply to:**
- Event selection boxes on `/register`
- Deck builder panel container
- Dialog/modal surfaces
- Admin page card containers
- My-decks page cards

### Background Component Updates

Update `components/ui/background.tsx` jayden overlays:
- Change flat purple overlay to diagonal gradient: warm (red/pink) top-left → cool (blue/purple) bottom-right
- Adjust the gradient vignette at the bottom to lean blue instead of pure purple
- Keep the hue-rotate filter on the background image (280deg works well with the spectrum)

---

## 4. Files Affected

### Batch 1: Globals + Background
- `app/globals.css` — token updates, gradient utilities
- `components/ui/background.tsx` — gradient overlays

### Batch 2: Auth + Shared UI
- `app/(auth-pages)/sign-in/page.tsx` — link colors
- `app/(auth-pages)/sign-up/page.tsx` — link colors
- `app/(auth-pages)/forgot-password/page.tsx` — link colors
- `components/ui/confirmation-dialog.tsx` — dialog surfaces, buttons, text
- `app/decklist/my-decks/DeleteDeckModal.tsx` — modal surfaces, text

### Batch 3: Admin Pages
- `app/admin/registrations/page.tsx` — form inputs, buttons, blue accents
- `app/admin/tags/page.tsx` — page background, card surfaces, inputs, buttons

### Batch 4: Deck Builder
- `app/decklist/card-search/components/LoadDeckModal.tsx` — dialog surfaces, badges, hover states
- `app/decklist/card-search/components/MobileBottomNav.tsx` — nav background, active states

### Batch 5: Pages + Surface Gradients
- `app/decklist/my-decks/page.tsx` — green sign-in button → primary, surface tokens
- `app/tracker/tournaments/page.tsx` — emerald "Host a Tournament" → primary
- Apply `jayden-gradient-bg` to key card surfaces across registration, deck builder, admin

---

## 5. Execution Strategy

Five parallel agents, each handling one batch. Each receives:
- The token mapping table (Section 2)
- Their specific file list
- Instructions to preserve light/dark mode appearance (only the token names change, not the visual result in light/dark)
- Instructions to NOT touch badge colors for card types or semantic status indicators

No coordination needed between agents — all batches are independent files.

---

## 6. Verification

After all agents complete:
- Visual check in jayden mode on `/register`, `/decklist/card-search`, `/admin/registrations`, `/admin/tags`
- Confirm light mode and dark mode still look the same as before
- Confirm no remaining `bg-white dark:bg-gray` patterns in migrated files
- Build passes (`npm run build`)
