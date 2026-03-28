# Spotlight Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Spotlight Mode" to the card search page that replaces the deck builder panel with a large card preview for streamers/commentators.

**Architecture:** A `mode` state in `client.tsx` toggles between `"deck"` and `"spotlight"`. When in spotlight mode, the right panel renders a new `SpotlightPanel` component instead of `DeckBuilderPanel`, and card grid items swap +/- buttons for a magnifying glass that sets the previewed card. Desktop only — mobile ignores the mode.

**Tech Stack:** React, Next.js App Router, Tailwind CSS, inline SVG icons (project convention — no lucide-react)

**Spec:** `docs/superpowers/specs/2026-03-27-spotlight-mode-design.md`

---

### Task 1: Create SpotlightPanel component

**Files:**
- Create: `app/decklist/card-search/components/SpotlightPanel.tsx`

This is a pure presentational component with two states: card selected and empty.

- [ ] **Step 1: Create the SpotlightPanel component file**

```tsx
// app/decklist/card-search/components/SpotlightPanel.tsx
"use client";
import React from "react";
import CardImage from "./CardImage";
import type { Card } from "../utils";

interface SpotlightPanelProps {
  card: Card | null;
  price: number | null;
  onClear: () => void;
}

export default function SpotlightPanel({ card, price, onClear }: SpotlightPanelProps) {
  if (!card) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div
          className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl"
          style={{ width: "min(100%, 400px)", aspectRatio: "5 / 7" }}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
      {/* Clear button */}
      <button
        onClick={onClear}
        className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-colors"
        title="Clear spotlight"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Card image */}
      <div style={{ width: "min(100%, 400px)" }}>
        <CardImage
          imgFile={card.imgFile}
          alt={card.name}
          className="rounded-xl w-full shadow-2xl"
          sizes="400px"
        />
      </div>

      {/* Price */}
      {price !== null && (
        <p className="mt-3 text-lg font-semibold text-gray-600 dark:text-gray-300">
          ${price.toFixed(2)}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the component builds**

Run: `npx next build --no-lint 2>&1 | head -20` or `npm run dev` and verify no import errors.

- [ ] **Step 3: Commit**

```bash
git add app/decklist/card-search/components/SpotlightPanel.tsx
git commit -m "feat: add SpotlightPanel component for spotlight mode"
```

---

### Task 2: Add mode and spotlightCard state to client.tsx

**Files:**
- Modify: `app/decklist/card-search/client.tsx`

Add the two new state variables near the existing panel visibility state.

- [ ] **Step 1: Add the state declarations**

Find the panel visibility state block (around line 205-208):
```typescript
// Panel visibility state
const [showDeckBuilder, setShowDeckBuilder] = useState(true);
const [showSearch, setShowSearch] = useState(true);
const [isMobileDeckDrawerOpen, setIsMobileDeckDrawerOpen] = useState(false);
```

Add directly after it:
```typescript
// Spotlight mode state
const [mode, setMode] = useState<"deck" | "spotlight">("deck");
const [spotlightCard, setSpotlightCard] = useState<Card | null>(null);
const isSpotlight = mode === "spotlight";
```

- [ ] **Step 2: Verify dev server runs without errors**

Run: `npm run dev` — page should load with no changes to visible behavior.

- [ ] **Step 3: Commit**

```bash
git add app/decklist/card-search/client.tsx
git commit -m "feat: add mode and spotlightCard state for spotlight mode"
```

---

### Task 3: Sync mode to URL params

**Files:**
- Modify: `app/decklist/card-search/client.tsx`

Integrate the `mode` param with the existing URL sync logic.

- [ ] **Step 1: Read mode from URL on initialization**

Find the URL initialization `useEffect` (around line 440-499) that starts with:
```typescript
useEffect(() => {
  if (searchParams && !isInitialized) {
```

Inside the body, after the existing param reading (before `setIsInitialized(true)`), add:
```typescript
    // Spotlight mode from URL (desktop only — mobile fallback handled in render)
    if (searchParams.get('mode') === 'spotlight') {
      setMode('spotlight');
    }
```

- [ ] **Step 2: Write mode to URL in updateURL**

Find the `updateURL` function (around line 374-420). In the browse/search mode branch, find where params are being set (after the existing `params.set(...)` calls, before the `const url = params.toString()` line). Add:

```typescript
    if (mode === 'spotlight') params.set('mode', 'spotlight');
```

Also add `mode` to the dependency array of the `useCallback` wrapping `updateURL`.

- [ ] **Step 3: Trigger URL update when mode changes**

Find the `useEffect` that calls `updateURL` when filter state changes. Add `mode` to its dependency array so toggling mode updates the URL.

If there is no such effect and `updateURL` is called directly on filter changes, add a new effect:

```typescript
useEffect(() => {
  if (isInitialized) {
    updateURL({ /* current filter state */ });
  }
}, [mode]);
```

Alternatively, if `updateURL` is already triggered by a broad set of dependencies, just adding `mode` to those dependencies is sufficient.

- [ ] **Step 4: Verify URL sync works**

Run dev server. In browser console, manually set the state: the URL should not yet show `?mode=spotlight` since the toggle UI doesn't exist yet, but navigating to `?mode=spotlight` should set the mode state (verifiable via React DevTools or by adding a temporary `console.log(mode)`).

- [ ] **Step 5: Commit**

```bash
git add app/decklist/card-search/client.tsx
git commit -m "feat: sync spotlight mode to URL params"
```

---

### Task 4: Add the Spotlight toggle button

**Files:**
- Modify: `app/decklist/card-search/client.tsx`

Add a toggle button in the toolbar area. The project uses inline SVGs — no icon library.

- [ ] **Step 1: Add the toggle button**

Find the central divider section (around line 2076) that starts with:
```typescript
{/* Central Divider with Toggle Buttons */}
{showSearch && showDeckBuilder && (
```

Add a Spotlight toggle button **before** the central divider block (so it's visible regardless of panel hide/show state). Place it as a fixed-position or absolute-position button near the top-right of the search panel, or as an additional button in the existing toolbar. A good location is right before the `{/* Central Divider with Toggle Buttons */}` comment, as a button that appears on desktop when both panels are showing:

```tsx
{/* Spotlight Mode Toggle - Desktop only */}
<button
  onClick={() => {
    const newMode = mode === "spotlight" ? "deck" : "spotlight";
    setMode(newMode);
    if (newMode === "spotlight") {
      setShowDeckBuilder(true);
      setShowSearch(true);
    }
  }}
  className={`hidden md:flex fixed top-20 right-4 z-50 items-center gap-2 px-3 py-2 rounded-lg shadow-lg transition-all text-sm font-medium ${
    isSpotlight
      ? "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30"
      : "bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600"
  }`}
  title="Spotlight Mode — preview cards for streaming"
>
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
  Spotlight
</button>
```

Note: The exact positioning (fixed top-right vs inline in a toolbar) should follow the existing page layout. If there's a toolbar/header area that already has buttons, place it there instead. The key requirement is: visible on desktop, hidden on mobile, toggles mode.

- [ ] **Step 2: Ensure toggling on also forces both panels visible**

The toggle handler above already calls `setShowDeckBuilder(true)` and `setShowSearch(true)` when entering spotlight mode, so both panels are guaranteed visible.

- [ ] **Step 3: Verify the toggle renders and toggles state**

Run dev server. The button should appear on desktop. Clicking it should toggle the `isSpotlight` state (visual change in button styling). The URL should update to include/remove `?mode=spotlight`.

- [ ] **Step 4: Commit**

```bash
git add app/decklist/card-search/client.tsx
git commit -m "feat: add spotlight mode toggle button"
```

---

### Task 5: Swap right panel to SpotlightPanel in spotlight mode

**Files:**
- Modify: `app/decklist/card-search/client.tsx`

Conditionally render `SpotlightPanel` instead of `DeckBuilderPanel` when in spotlight mode.

- [ ] **Step 1: Import SpotlightPanel**

Add to the imports at the top of `client.tsx`:
```typescript
import SpotlightPanel from "./components/SpotlightPanel";
```

- [ ] **Step 2: Replace the right panel rendering**

Find the right panel section (around line 2139) that renders `DeckBuilderPanel`:
```typescript
{/* Right panel: Deck builder (hidden on mobile, toggleable on desktop) */}
{showDeckBuilder && (
  <div
    className="hidden md:flex flex-col overflow-visible flex-shrink-0"
    style={{ width: showSearch ? `${deckPanelWidth}%` : '100%' }}
  >
    {isInitializing ? (
      ...
    ) : (
    <DeckBuilderPanel
      ...
    />
    )}
  </div>
)}
```

Wrap the inner content in a mode conditional:
```typescript
{showDeckBuilder && (
  <div
    className="hidden md:flex flex-col overflow-visible flex-shrink-0"
    style={{ width: showSearch ? `${deckPanelWidth}%` : '100%' }}
  >
    {isSpotlight ? (
      <SpotlightPanel
        card={spotlightCard}
        price={
          spotlightCard
            ? (() => {
                const priceKey = `${spotlightCard.name}|${spotlightCard.set}|${spotlightCard.imgFile}`;
                const priceInfo = getPrice(priceKey);
                return priceInfo ? priceInfo.price : null;
              })()
            : null
        }
        onClear={() => setSpotlightCard(null)}
      />
    ) : isInitializing ? (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading deck...</div>
      </div>
    ) : (
      <DeckBuilderPanel
        /* all existing props unchanged */
      />
    )}
  </div>
)}
```

Important: Do NOT remove or change any existing `DeckBuilderPanel` props. Just wrap the existing `isInitializing ? ... : <DeckBuilderPanel .../>` block in the `isSpotlight` conditional.

- [ ] **Step 3: Verify panel swap works**

Run dev server. Toggle spotlight mode on — the right panel should show the empty state (dashed card outline). Toggle off — deck builder should reappear with all state intact.

- [ ] **Step 4: Commit**

```bash
git add app/decklist/card-search/client.tsx
git commit -m "feat: swap right panel to SpotlightPanel in spotlight mode"
```

---

### Task 6: Modify card grid items for spotlight mode

**Files:**
- Modify: `app/decklist/card-search/client.tsx`

When in spotlight mode, replace +/- buttons with a magnifying glass, hide menu and quantity badges, and add a highlight ring on the spotlighted card.

- [ ] **Step 1: Replace +/- buttons with magnifying glass in spotlight mode**

Find the card grid controls overlay (around line 1968-1997) — the section with the `−` and `+` buttons inside `{/* Controls Overlay - Centered on Card */}`. Wrap the existing controls in a mode conditional:

```tsx
{/* Controls Overlay - Centered on Card */}
<div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200">
  {isSpotlight ? (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setSpotlightCard(c);
      }}
      className="flex w-11 h-11 md:w-9 md:h-9 items-center justify-center rounded-lg bg-black/50 md:bg-black/30 md:hover:bg-black/50 backdrop-blur-md text-white transition-all border border-white/20 md:opacity-0 md:group-hover:opacity-100 md:pointer-events-none md:group-hover:pointer-events-auto"
      aria-label="Spotlight this card"
      title="Spotlight this card"
    >
      <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </button>
  ) : (
    <div className="flex items-center gap-3 md:gap-2">
      {/* existing − and + buttons unchanged */}
    </div>
  )}
</div>
```

- [ ] **Step 2: Hide three-dot menu in spotlight mode**

Find the menu button section (around line 2001-2014) — `{/* Menu Button - Bottom Left */}`. Wrap it:

```tsx
{/* Menu Button - Bottom Left */}
{!isSpotlight && (
  <div className="absolute bottom-0.5 left-0.5 z-10">
    {/* existing menu button unchanged */}
  </div>
)}
```

- [ ] **Step 3: Hide quantity badges in spotlight mode**

Find the quantity badge section (around line 2017-2031) — `{/* Quantity Badge - Bottom Right, Always Visible */}`. Wrap it:

```tsx
{/* Quantity Badge - Bottom Right, Always Visible */}
{!isSpotlight && (quantityInDeck > 0 || quantityInReserve > 0) && (
  /* existing badge JSX unchanged */
)}
```

- [ ] **Step 4: Hide the menu overlay backdrop and menu items in spotlight mode**

Find the backdrop overlay and menu items overlay (around line 1882-1957). These are the `{isMenuOpen && ...}` blocks. Wrap both with `!isSpotlight`:

```tsx
{/* Backdrop overlay when menu is open */}
{!isSpotlight && isMenuOpen && (
  /* existing backdrop unchanged */
)}

{/* Menu items overlay */}
{!isSpotlight && isMenuOpen && (
  /* existing menu items unchanged */
)}
```

- [ ] **Step 5: Add highlight ring on spotlighted card**

Find the card grid item wrapper `<div>` (around line 1878):
```tsx
<div
  key={c.dataLine}
  className="relative cursor-pointer group rounded overflow-hidden transition-all duration-200"
>
```

Add a conditional ring class:
```tsx
<div
  key={c.dataLine}
  className={`relative cursor-pointer group rounded overflow-hidden transition-all duration-200 ${
    isSpotlight && spotlightCard?.dataLine === c.dataLine
      ? "ring-2 ring-amber-500 dark:ring-amber-400"
      : ""
  }`}
>
```

- [ ] **Step 6: Verify card grid behavior in spotlight mode**

Run dev server. Toggle spotlight mode on:
- +/- buttons should be replaced with magnifying glass icons
- Three-dot menu should be hidden
- Quantity badges should be hidden
- Clicking the magnifying glass should set the card in the SpotlightPanel
- The spotlighted card should have an amber ring in the grid
- Toggle spotlight mode off — all deck builder controls should reappear

- [ ] **Step 7: Commit**

```bash
git add app/decklist/card-search/client.tsx
git commit -m "feat: modify card grid controls for spotlight mode"
```

---

### Task 7: Handle mobile fallback and edge cases

**Files:**
- Modify: `app/decklist/card-search/client.tsx`

Ensure spotlight mode is ignored on mobile and handle edge cases.

- [ ] **Step 1: Reset mode on mobile**

The toggle button is already `hidden md:flex` so it's invisible on mobile. But if someone navigates to `?mode=spotlight` on mobile, the mode state would still be set. Add a guard near the top of the component (after state declarations, near where other responsive logic lives):

```typescript
// Spotlight mode is desktop-only — reset on mobile
useEffect(() => {
  const mediaQuery = window.matchMedia("(max-width: 767px)");
  const handler = (e: MediaQueryListEvent) => {
    if (e.matches && mode === "spotlight") {
      setMode("deck");
    }
  };
  // Check on mount
  if (mediaQuery.matches && mode === "spotlight") {
    setMode("deck");
  }
  mediaQuery.addEventListener("change", handler);
  return () => mediaQuery.removeEventListener("change", handler);
}, [mode]);
```

- [ ] **Step 2: Clear spotlightCard when leaving spotlight mode**

Add an effect to clean up when mode changes back to deck:

```typescript
// Clear spotlight card when leaving spotlight mode
useEffect(() => {
  if (mode === "deck") {
    setSpotlightCard(null);
  }
}, [mode]);
```

- [ ] **Step 3: Prevent card modal from opening on magnifying glass click in spotlight mode**

Currently clicking the card image opens a modal via `onClick={() => setModalCard(c)}`. In spotlight mode, clicking the magnifying glass calls `e.stopPropagation()` which prevents this. However, clicking the card image itself (not the magnifying glass) will still open the modal. This is fine — the user can still view card details in the modal if they want. The magnifying glass is the dedicated spotlight action. No change needed here.

- [ ] **Step 4: Verify mobile fallback**

Open dev server in mobile viewport (or resize browser below 768px). The spotlight toggle should be hidden. If `?mode=spotlight` is in the URL, the mode should reset to `"deck"`.

- [ ] **Step 5: Commit**

```bash
git add app/decklist/card-search/client.tsx
git commit -m "feat: handle mobile fallback and edge cases for spotlight mode"
```

---

### Task 8: Final verification and build check

**Files:**
- No changes — verification only

- [ ] **Step 1: Run production build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Manual test checklist**

Run dev server (`npm run dev`) and verify:

1. Spotlight toggle appears on desktop, hidden on mobile
2. Clicking toggle switches to spotlight mode, URL updates to `?mode=spotlight`
3. Right panel shows empty state (dashed card outline)
4. Card grid shows magnifying glass instead of +/- buttons
5. Three-dot menu and quantity badges are hidden
6. Clicking magnifying glass shows card in SpotlightPanel with image and price
7. Spotlighted card has amber ring in grid
8. Clear button (X) in SpotlightPanel clears the card back to empty state
9. Toggling back to deck mode restores DeckBuilderPanel with all state intact
10. Navigating to `?mode=spotlight` directly enters spotlight mode
11. On mobile, spotlight mode is ignored / falls back to deck mode

- [ ] **Step 3: Commit any fixes from verification**

If any issues found during testing, fix and commit:
```bash
git add -A
git commit -m "fix: address spotlight mode issues found during testing"
```
