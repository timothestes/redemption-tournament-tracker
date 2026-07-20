# WS-1 Forge Lobby & Deck-Choice Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Forge lobby to parity with the normal `/play` lobby and unify deck-choice copy, per `docs/superpowers/specs/2026-07-20-ws1-forge-lobby-parity-design.md`.

**Architecture:** Surgical, inline edits to three existing files. Port shadcn `Button`/loading patterns that already exist in `GameLobby.tsx`. No shared-component extraction, no lobby merge (that is WS-6).

**Tech Stack:** Next.js 15 / React 19 / TypeScript, shadcn `Button`/`Badge`, lucide-react icons, Tailwind. Verification is type-check + manual visual (no unit tests exist for these surfaces).

## Global Constraints

- Deck-change verb is **"Change deck"** everywhere a control changes the deck. First-time-selection surfaces (`Choose a deck…` placeholder, `Choose a deck` dialog titles) stay.
- Spectate stays **off by default**; item only improves the ON-state's legibility — no routing/logic change.
- Design system: restrained; reserve primary green for CTAs/hover; no flashy color (`[[feedback_reserve_green_accent]]`, `[[feedback_no_focus_rings]]`).
- Type gate is `npx tsc --noEmit` — do **not** run a full `next build` (dev server may share `.next`).
- Stage only the files named in each task; never `git add -A`.

---

### Task 1: Forge lobby — real Host CTA, loading feedback, empty-state link, tighter rows

**Files:**
- Modify: `app/forge/play/games/ForgeGameLobby.tsx`

Covers spec items #1 (real CTA), #2 (loading feedback), #3 (builder link), #4 (tighter open-games rows).

- [ ] **Step 1: Add imports**

At the top import block, add:

```tsx
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
```

- [ ] **Step 2: Add `isCreating` state + wire `handleCreate`**

Add next to the other `useState`s in `LobbyInner`:

```tsx
const [isCreating, setIsCreating] = useState(false);
```

Change `handleCreate` to set it before navigating (navigation unmounts the lobby, so no reset needed):

```tsx
function handleCreate() {
  const code = Math.random().toString(36).slice(2, 6).toUpperCase();
  if (!stash(code, "create")) return;
  setIsCreating(true);
  router.push(`/play/${code}`);
}
```

- [ ] **Step 3: Empty state → builder link**

Replace the empty-state paragraph (currently `<p ...>No Forge decks yet — build one first.</p>`) with:

```tsx
<div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
  No Forge decks yet.{" "}
  <Link
    href="/forge/play/decks/new"
    className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
  >
    Build one
  </Link>{" "}
  to start playtesting.
</div>
```

- [ ] **Step 4: Host card → real Button CTA with feedback**

Replace the `<button onClick={handleCreate} ...>Host a game ...</button>` card (the first grid child) with a card whose action is a real primary `Button`, keeping symmetry with the Join card:

```tsx
<div className="flex flex-col gap-2 rounded-lg border p-4 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20">
  <div className="font-medium">Host a game</div>
  <div className="text-sm text-muted-foreground">Get a code to share with another playtester.</div>
  <Button
    onClick={handleCreate}
    disabled={!selected || isCreating}
    className="mt-1 w-full"
  >
    {isCreating ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading deck…
      </>
    ) : (
      "Create game"
    )}
  </Button>
</div>
```

- [ ] **Step 5: Join-by-code button → shadcn Button (parity)**

In the "Join by code" card, swap the bare `<button ...>Join</button>` for:

```tsx
<Button
  variant="outline"
  onClick={() => handleJoin(joinCode)}
  disabled={!selected || joinCode.trim().length !== 4}
  className="h-10 shrink-0 px-4"
>
  Join
</Button>
```

- [ ] **Step 6: Tighten the open-games rows**

On the open-games `<ul>` (`className="divide-y rounded-lg border ..."`), add a width cap so the clickable row isn't a full-bleed banner:

```tsx
<ul className="max-w-md divide-y rounded-lg border [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20">
```

Also swap each row's `<button ...>Join</button>` for a shadcn `Button`:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={() => handleJoin(g.code)}
  disabled={!selected}
>
  Join
</Button>
```

- [ ] **Step 7: Type-check**

Run: `cd /Users/timestes/projects/rtt-ws1-forge-lobby && npx tsc --noEmit`
Expected: no new errors in `ForgeGameLobby.tsx`.

- [ ] **Step 8: Visual check**

Load `/forge/play/games`. Confirm: "Create game" is a green button; clicking shows "Loading deck…" + spinner + disabled; with 0 decks the empty state links to `/forge/play/decks/new`; the open-games list (seed one with a second account) is compact, not full-width.

- [ ] **Step 9: Commit**

```bash
cd /Users/timestes/projects/rtt-ws1-forge-lobby
git add app/forge/play/games/ForgeGameLobby.tsx
git commit -m "feat(forge-lobby): real Host CTA + loading, builder link, tighter rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Normal lobby — "Change deck" verb, "Last played" hint, obvious spectate ON-state

**Files:**
- Modify: `app/play/components/GameLobby.tsx`

Covers spec items #5 (verb), #6 (last-played hint), #7 (spectate on-state).

- [ ] **Step 1: Add the `Eye` icon import**

Extend the existing lucide import:

```tsx
import { Loader2, Pencil, ArrowLeftRight, Eye } from 'lucide-react';
```

- [ ] **Step 2: Verb — "Swap" → "Change deck"**

In the deck-change `Button` (the one with `<ArrowLeftRight .../>`), change the label text `Swap` to `Change deck`. Keep the icon.

- [ ] **Step 3: "Last played" hint**

In the deck-info badge row (the `flex items-center gap-2 mt-0.5` div holding the format `Badge` and `{card_count} cards`), append after the card-count span:

```tsx
{selectedDeck.id === decks[0]?.id && selectedDeck.last_played_at && (
  <span className="text-xs text-muted-foreground/80">· Last played</span>
)}
```

- [ ] **Step 4: Spectate — Eye icon on the Watch button**

In the join `Button`'s content, replace the `isSpectate ? 'Watch' : 'Join'` branch so Watch carries an icon, and widen the fixed button so it fits:

```tsx
{isJoining ? (
  <Loader2 className="h-4 w-4 animate-spin" />
) : isSpectate ? (
  <>
    <Eye className="mr-1.5 h-4 w-4" />
    Watch
  </>
) : (
  'Join'
)}
```

Change that button's `className` width from `w-20` to `w-24` (`className="shrink-0 h-12 w-24"`).

- [ ] **Step 5: Spectate — explanatory caption when ON**

Immediately after the spectate-toggle row's closing `</div>` (still inside the join column), add:

```tsx
{isSpectate && (
  <p className="text-xs text-muted-foreground text-center">
    Spectating — you&apos;ll watch this game, not play.
  </p>
)}
```

- [ ] **Step 6: Type-check**

Run: `cd /Users/timestes/projects/rtt-ws1-forge-lobby && npx tsc --noEmit`
Expected: no new errors in `GameLobby.tsx`.

- [ ] **Step 7: Visual check**

Load `/play`. Confirm: the deck control reads "Change deck"; the auto-selected deck shows "· Last played" that disappears after changing decks; toggling Spectate on shows the Eye+Watch button and the caption.

- [ ] **Step 8: Commit**

```bash
cd /Users/timestes/projects/rtt-ws1-forge-lobby
git add app/play/components/GameLobby.tsx
git commit -m "feat(play-lobby): Change-deck verb, last-played hint, clearer spectate state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: In-game practice-swap confirm — copy consolidation

**Files:**
- Modify: `app/play/[code]/client.tsx` (two strings, ~L1281 and ~L1342)

Covers spec item #8. Copy-only; internal identifiers stay.

- [ ] **Step 1: Body copy**

Change `Swap your game deck to <strong>{practiceDeckConfirm.deckName}</strong>?` to `Change your game deck to <strong>{practiceDeckConfirm.deckName}</strong>?`

- [ ] **Step 2: Button label**

Change the confirm button label `Swap Deck` to `Change deck`.

- [ ] **Step 3: Type-check**

Run: `cd /Users/timestes/projects/rtt-ws1-forge-lobby && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/timestes/projects/rtt-ws1-forge-lobby
git add "app/play/[code]/client.tsx"
git commit -m "feat(play): unify deck-change verb to 'Change deck' in practice-swap confirm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** items #1-#8 each map to a task step above (Task 1 → #1-#4; Task 2 → #5-#7; Task 3 → #8). No gaps.
- **Placeholders:** none — every step shows the exact JSX/copy.
- **Type consistency:** uses existing symbols only (`Button`, `Badge`, `Loader2`, `Eye`, `Link`, `DeckOption.last_played_at`, `handleCreate`, `isCreating`).
