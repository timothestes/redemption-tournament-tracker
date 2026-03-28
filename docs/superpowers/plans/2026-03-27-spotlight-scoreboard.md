# Spotlight Scoreboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scoreboard below the card preview in spotlight mode with editable player names, scores (0-7), and a reset button.

**Architecture:** Four new state variables in `client.tsx` (two names, two scores) passed as props to `SpotlightPanel`. The scoreboard UI renders below the card/price in SpotlightPanel for both empty and card-selected states. State clears when leaving spotlight mode via the existing cleanup effect.

**Tech Stack:** React, Tailwind CSS, inline SVG icons

**Spec:** `docs/superpowers/specs/2026-03-27-spotlight-scoreboard-design.md`

---

### Task 1: Add scoreboard state to client.tsx and pass as props

**Files:**
- Modify: `app/decklist/card-search/client.tsx`

- [ ] **Step 1: Add the four state variables**

Find the spotlight mode state block (around line 211-214):
```typescript
  // Spotlight mode state
  const [mode, setMode] = useState<"deck" | "spotlight">("deck");
  const [spotlightCard, setSpotlightCard] = useState<Card | null>(null);
  const isSpotlight = mode === "spotlight";
```

Add directly after `const isSpotlight = mode === "spotlight";`:
```typescript
  const [player1Name, setPlayer1Name] = useState("Player 1");
  const [player2Name, setPlayer2Name] = useState("Player 2");
  const [player1Score, setPlayer1Score] = useState(0);
  const [player2Score, setPlayer2Score] = useState(0);
```

- [ ] **Step 2: Clear scoreboard state when leaving spotlight mode**

Find the existing cleanup effect (around line 233-238):
```typescript
  // Clear spotlight card when leaving spotlight mode
  useEffect(() => {
    if (mode === "deck") {
      setSpotlightCard(null);
    }
  }, [mode]);
```

Add the scoreboard resets inside the same effect:
```typescript
  // Clear spotlight state when leaving spotlight mode
  useEffect(() => {
    if (mode === "deck") {
      setSpotlightCard(null);
      setPlayer1Name("Player 1");
      setPlayer2Name("Player 2");
      setPlayer1Score(0);
      setPlayer2Score(0);
    }
  }, [mode]);
```

- [ ] **Step 3: Pass scoreboard props to SpotlightPanel**

Find the SpotlightPanel rendering (around line 2227-2231):
```tsx
            <SpotlightPanel
              card={spotlightCard}
              price={spotlightCard ? (getPrice(`${spotlightCard.name}|${spotlightCard.set}|${spotlightCard.imgFile}`)?.price ?? null) : null}
              onClear={() => setSpotlightCard(null)}
            />
```

Replace with:
```tsx
            <SpotlightPanel
              card={spotlightCard}
              price={spotlightCard ? (getPrice(`${spotlightCard.name}|${spotlightCard.set}|${spotlightCard.imgFile}`)?.price ?? null) : null}
              onClear={() => setSpotlightCard(null)}
              player1Name={player1Name}
              player2Name={player2Name}
              player1Score={player1Score}
              player2Score={player2Score}
              onPlayer1NameChange={setPlayer1Name}
              onPlayer2NameChange={setPlayer2Name}
              onPlayer1ScoreChange={setPlayer1Score}
              onPlayer2ScoreChange={setPlayer2Score}
              onResetScoreboard={() => {
                setPlayer1Name("Player 1");
                setPlayer2Name("Player 2");
                setPlayer1Score(0);
                setPlayer2Score(0);
              }}
            />
```

- [ ] **Step 4: Commit**

```bash
git add app/decklist/card-search/client.tsx
git commit -m "feat: add scoreboard state and pass props to SpotlightPanel"
```

---

### Task 2: Add scoreboard UI to SpotlightPanel

**Files:**
- Modify: `app/decklist/card-search/components/SpotlightPanel.tsx`

- [ ] **Step 1: Extend the props interface**

Replace the existing `SpotlightPanelProps` interface:
```typescript
interface SpotlightPanelProps {
  card: Card | null;
  price: number | null;
  onClear: () => void;
}
```

With:
```typescript
interface SpotlightPanelProps {
  card: Card | null;
  price: number | null;
  onClear: () => void;
  player1Name: string;
  player2Name: string;
  player1Score: number;
  player2Score: number;
  onPlayer1NameChange: (name: string) => void;
  onPlayer2NameChange: (name: string) => void;
  onPlayer1ScoreChange: (score: number) => void;
  onPlayer2ScoreChange: (score: number) => void;
  onResetScoreboard: () => void;
}
```

- [ ] **Step 2: Update the function signature to destructure new props**

Replace:
```typescript
export default function SpotlightPanel({ card, price, onClear }: SpotlightPanelProps) {
```

With:
```typescript
export default function SpotlightPanel({
  card,
  price,
  onClear,
  player1Name,
  player2Name,
  player1Score,
  player2Score,
  onPlayer1NameChange,
  onPlayer2NameChange,
  onPlayer1ScoreChange,
  onPlayer2ScoreChange,
  onResetScoreboard,
}: SpotlightPanelProps) {
```

- [ ] **Step 3: Add the `useState` import**

Update the React import at the top of the file:
```typescript
import React, { useState } from "react";
```

- [ ] **Step 4: Create a PlayerScore helper component inside the file**

Add this before the `SpotlightPanel` function (after the `SpotlightPanelProps` interface):

```tsx
function PlayerScore({
  name,
  score,
  onNameChange,
  onScoreChange,
}: {
  name: string;
  score: number;
  onNameChange: (name: string) => void;
  onScoreChange: (score: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);

  return (
    <div className="flex flex-col items-center gap-2 min-w-0 flex-1">
      {/* Editable name */}
      {isEditing ? (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => {
            onNameChange(editValue.trim() || name);
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onNameChange(editValue.trim() || name);
              setIsEditing(false);
            }
          }}
          className="w-full text-center text-sm font-medium bg-transparent border-b border-gray-400 dark:border-gray-500 outline-none text-gray-800 dark:text-gray-200 px-1 py-0.5"
          autoFocus
        />
      ) : (
        <button
          onClick={() => {
            setEditValue(name);
            setIsEditing(true);
          }}
          className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors truncate max-w-full cursor-text"
          title="Click to edit name"
        >
          {name}
        </button>
      )}

      {/* Score controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onScoreChange(Math.max(0, score - 1))}
          disabled={score <= 0}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={`Decrease ${name} score`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
          </svg>
        </button>
        <span className="text-3xl font-bold text-gray-800 dark:text-gray-100 tabular-nums w-8 text-center">
          {score}
        </span>
        <button
          onClick={() => onScoreChange(Math.min(7, score + 1))}
          disabled={score >= 7}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={`Increase ${name} score`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create a Scoreboard section component**

Add this after the `PlayerScore` component (before `SpotlightPanel`):

```tsx
function Scoreboard({
  player1Name,
  player2Name,
  player1Score,
  player2Score,
  onPlayer1NameChange,
  onPlayer2NameChange,
  onPlayer1ScoreChange,
  onPlayer2ScoreChange,
  onReset,
}: {
  player1Name: string;
  player2Name: string;
  player1Score: number;
  player2Score: number;
  onPlayer1NameChange: (name: string) => void;
  onPlayer2NameChange: (name: string) => void;
  onPlayer1ScoreChange: (score: number) => void;
  onPlayer2ScoreChange: (score: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="w-full mt-6" style={{ maxWidth: "400px" }}>
      <div className="flex items-start gap-6 justify-center">
        <PlayerScore
          name={player1Name}
          score={player1Score}
          onNameChange={onPlayer1NameChange}
          onScoreChange={onPlayer1ScoreChange}
        />
        <PlayerScore
          name={player2Name}
          score={player2Score}
          onNameChange={onPlayer2NameChange}
          onScoreChange={onPlayer2ScoreChange}
        />
      </div>
      <div className="flex justify-center mt-3">
        <button
          onClick={onReset}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add the Scoreboard to the empty state render**

Replace the existing empty state return (the `if (!card)` block):
```tsx
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
```

With:
```tsx
  if (!card) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div
          className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl"
          style={{ width: "min(100%, 400px)", aspectRatio: "5 / 7" }}
        />
        <Scoreboard
          player1Name={player1Name}
          player2Name={player2Name}
          player1Score={player1Score}
          player2Score={player2Score}
          onPlayer1NameChange={onPlayer1NameChange}
          onPlayer2NameChange={onPlayer2NameChange}
          onPlayer1ScoreChange={onPlayer1ScoreChange}
          onPlayer2ScoreChange={onPlayer2ScoreChange}
          onReset={onResetScoreboard}
        />
      </div>
    );
  }
```

Note: The outer div changed from `flex` to `flex flex-col` to stack the placeholder and scoreboard vertically.

- [ ] **Step 7: Add the Scoreboard to the card-selected render**

In the main return (the card-selected state), add the Scoreboard after the price `<p>` tag. Find:
```tsx
      {/* Price */}
      {price !== null && (
        <p className="mt-3 text-lg font-semibold text-gray-600 dark:text-gray-300">
          ${price.toFixed(2)}
        </p>
      )}
    </div>
```

Replace with:
```tsx
      {/* Price */}
      {price !== null && (
        <p className="mt-3 text-lg font-semibold text-gray-600 dark:text-gray-300">
          ${price.toFixed(2)}
        </p>
      )}

      {/* Scoreboard */}
      <Scoreboard
        player1Name={player1Name}
        player2Name={player2Name}
        player1Score={player1Score}
        player2Score={player2Score}
        onPlayer1NameChange={onPlayer1NameChange}
        onPlayer2NameChange={onPlayer2NameChange}
        onPlayer1ScoreChange={onPlayer1ScoreChange}
        onPlayer2ScoreChange={onPlayer2ScoreChange}
        onReset={onResetScoreboard}
      />
    </div>
```

- [ ] **Step 8: Verify build passes**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add app/decklist/card-search/components/SpotlightPanel.tsx
git commit -m "feat: add scoreboard UI to SpotlightPanel"
```

---

### Task 3: Final verification

**Files:**
- No changes — verification only

- [ ] **Step 1: Run production build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Manual test checklist**

Run dev server (`npm run dev`) and verify:

1. Enter spotlight mode — scoreboard appears below the empty card placeholder
2. Spotlight a card — scoreboard persists below card image and price
3. Click +/- buttons — scores increment/decrement correctly
4. Scores clamp at 0 (minus disabled) and 7 (plus disabled)
5. Click a player name — inline edit activates, type new name, press Enter to confirm
6. Click away from name edit — blur confirms the edit
7. Clear the card — scoreboard and scores persist
8. Spotlight a different card — scores and names persist
9. Click Reset — both names return to "Player 1"/"Player 2", both scores to 0
10. Toggle spotlight mode off and back on — scores and names are reset (clean slate)
