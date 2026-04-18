# Deck Context Menu Row Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder `SubMenuActionRow` from `[3][6][X][icon Draw]` to `[icon Draw 1][3][6][X]` so the label's count-of-1 action is visible and chips read in ascending order.

**Architecture:** Single-component JSX reorder in `app/shared/components/DeckContextMenu.tsx`. No API changes, no callsite updates, no new props. Verification is manual visual inspection in both Goldfish and Multiplayer modes — this project tests logic (`.test.ts`) but has no React component test harness, so no unit test is added for a pure layout change.

**Tech Stack:** React 19, TypeScript, inline styles using CSS custom properties (`var(--gf-*)`), Lucide icons.

**Spec reference:** [2026-04-18-deck-context-menu-row-layout.md](../specs/2026-04-18-deck-context-menu-row-layout.md)

---

## Task 1: Update `SubMenuActionRow` layout

**Files:**
- Modify: `app/shared/components/DeckContextMenu.tsx:160-229`

This task rewrites the JSX inside `SubMenuActionRow`'s return so the label comes first and chips follow in ascending order. It also appends the count of `1` to the label text.

- [ ] **Step 1: Open the file and confirm the current structure**

Run: `sed -n '160,229p' app/shared/components/DeckContextMenu.tsx`

Expected: You see the `<div style={{ display: 'flex'... }}>` wrapper, followed (in this order) by the `[3]` button, the `[6]` button, the `[X]` toggle button, and finally the label button containing `{icon}` and `{label}`. If the file layout differs, stop and reconcile with the spec before editing.

- [ ] **Step 2: Replace the row JSX**

Replace the entire JSX block spanning the opening `<div style={{ display: 'flex', alignItems: 'center', margin: '0 4px', borderRadius: 6 }}` through its closing `</div>` (the first `</div>` before the `{expanded && (...)}` fragment — do NOT touch the stepper JSX).

The full replacement is:

```tsx
      <div
        style={{ display: 'flex', alignItems: 'center', margin: '0 4px', borderRadius: 6 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <button
          style={{ ...ITEM_STYLE, flex: 1, background: 'transparent', paddingLeft: 8 }}
          onClick={() => onAction(1)}
        >
          {icon}
          {label} 1
        </button>
        {max >= 3 && (
          <button
            style={{ ...QUICK_COUNT_STYLE, marginLeft: 2 }}
            onClick={() => onAction(3)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.35)';
              e.currentTarget.style.borderColor = 'var(--gf-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.12)';
              e.currentTarget.style.borderColor = 'var(--gf-border)';
            }}
            title={`${label} 3`}
          >
            3
          </button>
        )}
        {max >= 6 && (
          <button
            style={{ ...QUICK_COUNT_STYLE, marginLeft: 2 }}
            onClick={() => onAction(6)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.35)';
              e.currentTarget.style.borderColor = 'var(--gf-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(196,149,90,0.12)';
              e.currentTarget.style.borderColor = 'var(--gf-border)';
            }}
            title={`${label} 6`}
          >
            6
          </button>
        )}
        <button
          onClick={toggleExpanded}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(196,149,90,0.35)';
            e.currentTarget.style.borderColor = 'var(--gf-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = expanded ? 'var(--gf-hover-strong)' : 'rgba(196,149,90,0.12)';
            e.currentTarget.style.borderColor = 'var(--gf-border)';
          }}
          style={{
            ...QUICK_COUNT_STYLE,
            marginLeft: 2,
            marginRight: 10,
            background: expanded ? 'var(--gf-hover-strong)' : 'rgba(196,149,90,0.12)',
            fontSize: 9,
            letterSpacing: '0.05em',
          }}
          title={`${label} custom amount...`}
        >
          X
        </button>
      </div>
```

Key changes in the replacement (so you can self-verify you applied them all):

1. Label button is now the **first** child (was last).
2. Label text is `{label} 1` (was `{label}`).
3. `[3]` and `[6]` chips both use `marginLeft: 2` (the `[3]` chip was previously `marginLeft: 10` because it was the leftmost element — it no longer needs to clear a left edge).
4. `[X]` toggle now has `marginRight: 10` (new — it's now the rightmost element and needs to clear the right edge of the wrapper, mirroring the 10px that used to sit on `[3]`'s left).
5. The `onClick`, hover handlers, `title` attributes, and styles on each button are **unchanged** — the only purpose of rewriting the full block is to reorder and add the `1` text + the new `marginRight`.

- [ ] **Step 3: Confirm no other code references need updating**

Run these in parallel:

```bash
grep -n "SubMenuActionRow" app/shared/components/DeckContextMenu.tsx
grep -rn "SubMenuActionRow" app/ --include="*.tsx" --include="*.ts"
```

Expected:
- The first command shows the component definition (around line 135) and five usages per `SubmenuTrigger` (Top / Bottom / Random Card), totaling around 15 lines.
- The second command shows matches only inside `DeckContextMenu.tsx`. The component is not imported or used elsewhere, so no callsite changes are required.

If anything else references `SubMenuActionRow`, stop and reconcile.

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit` (or whatever the project's type-check command is — check `package.json` scripts for a `typecheck` or `lint` script first).

Expected: No new errors introduced. Existing pre-existing errors (if any) are unchanged. If new errors appear, they should be confined to `DeckContextMenu.tsx` and must be fixed before moving on.

---

## Task 2: Manual browser verification — Goldfish mode

**Files:** None modified.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Expected: Server boots on http://localhost:3000 within ~10 seconds. If it fails to start, fix before continuing.

- [ ] **Step 2: Navigate to Goldfish mode and open a deck**

In the browser: go to `http://localhost:3000/goldfish`, pick any deck with 10+ cards, and start a session.

- [ ] **Step 3: Verify the top-level right-click menu is unchanged**

Right-click the deck pile. Confirm the top-level menu still shows (top to bottom):
- Search Deck
- Draw 1
- Draw X...
- (separator)
- Top Card ▸
- Bottom Card ▸
- Random Card ▸
- (separator)
- Shuffle Deck

If any of these are missing, broken, or reordered, something was modified outside `SubMenuActionRow`. Stop and audit the edit.

- [ ] **Step 4: Verify submenu row layout and labels**

Hover over `Top Card ▸` to open its submenu. Confirm each of the five rows renders as:

```
[icon + "Draw 1"     flex-filling]  [3]  [6]  [X]
[icon + "Look 1"     flex-filling]  [3]  [6]  [X]
[icon + "Reveal 1"   flex-filling]  [3]  [6]  [X]
[icon + "Discard 1"  flex-filling]  [3]  [6]  [X]
[icon + "Reserve 1"  flex-filling]  [3]  [6]  [X]
```

- Chips are to the **right** of the label (not the left).
- Chip order reading left-to-right is `3`, `6`, `X` (ascending).
- The label text ends with ` 1` (e.g. "Draw 1", not "Draw").
- Row hover highlights the whole row.
- Individual chip hover shows the stronger accent border.

Repeat for `Bottom Card ▸` and `Random Card ▸`.

- [ ] **Step 5: Verify click behavior on the label**

Click "Draw 1" in the Top Card submenu. Expected: exactly one card is drawn from the top of the deck into your hand.

Re-open the menu and click "Reveal 1" in the Top Card submenu. Expected: exactly one card is revealed (whatever the current reveal UX does). Repeat for "Discard 1" and "Reserve 1" and "Look 1". Each should act on a single card.

- [ ] **Step 6: Verify click behavior on quick-count chips**

Re-open the menu. Click the `3` chip in the Draw row of Top Card. Expected: three cards are drawn.

Re-open the menu. Click the `6` chip in the Reveal row of Top Card. Expected: six cards are revealed.

Re-open the menu. Click `X` in the Discard row. Expected: the stepper row appears below that row with `− / count (3) / + / Go`. Bump the stepper to 4, click Go. Expected: four cards are discarded.

- [ ] **Step 7: Verify small-deck chip hiding**

Bring the deck size down to 5 cards (draw cards until only 5 remain). Re-open the Top Card submenu. Expected: the `6` chip disappears from every row but `3` and `X` remain, and the label still reads `"Draw 1"` etc.

Bring the deck size down to 2. Expected: both `3` and `6` chips are hidden; only the label and `X` remain.

- [ ] **Step 8: Visual screenshot (optional but recommended)**

Take a screenshot of the Top Card submenu with the new layout and save it to `/tmp/deck-menu-new-layout.png` for later reference when writing the commit message or future comparisons.

---

## Task 3: Manual browser verification — Multiplayer mode

**Files:** None modified.

- [ ] **Step 1: Open a multiplayer game**

Navigate to `http://localhost:3000/play` and either create or join a game with at least one other client (two browser windows on the same machine works — use an incognito window for the second player).

- [ ] **Step 2: Verify own-deck menu**

Right-click your own deck. Hover into `Top Card ▸`. Confirm the same layout as the Goldfish verification: `[icon verb 1]  [3]  [6]  [X]`, all five action rows (Draw / Look / Reveal / Discard / Reserve) present and ascending.

Click "Draw 1" and confirm one card is drawn.

- [ ] **Step 3: Verify opponent-deck menu (`hideDrawActions`)**

Right-click the **opponent's** deck. Hover into `Top Card ▸`. Confirm:

- The `Draw` row is **hidden** (because `hideDrawActions` is true on opponent decks).
- The remaining four rows (Look / Reveal / Discard / Reserve) each render in the new layout: `[icon verb 1]  [3]  [6]  [X]`.
- The top-level menu also hides its `Draw 1` and `Draw X...` entries, which is existing behavior and unchanged by this plan.

- [ ] **Step 4: Verify no regressions in submenu hover**

Hover between `Top Card ▸`, `Bottom Card ▸`, and `Random Card ▸`. Confirm each submenu opens and closes smoothly — no stuck submenus, no submenu closing while you're trying to reach a chip. (This tests that the `SubmenuTrigger` auto-close timing was not affected. It shouldn't have been, since we only edited inside `SubMenuActionRow`.)

---

## Task 4: Commit

- [ ] **Step 1: Review the diff**

Run: `git diff app/shared/components/DeckContextMenu.tsx`

Expected diff boundaries:
- Reordered children inside the row `<div>` of `SubMenuActionRow`.
- Label button moved to top of the children list; its text changed from `{label}` to `{label} 1`.
- `[3]` chip's `marginLeft: 10` changed to `marginLeft: 2`.
- `[X]` toggle gained `marginRight: 10`.

If the diff touches anything else (other components, the `SubmenuTrigger`, the stepper, `DeckContextMenuProps`, etc.), stop and narrow the change.

- [ ] **Step 2: Stage and commit**

```bash
git add app/shared/components/DeckContextMenu.tsx
git commit -m "$(cat <<'EOF'
feat(play): reorder deck menu rows to [label 1][3][6][X]

Label now reads "Draw 1" / "Look 1" / etc. and sits on the left,
quick-count chips follow in ascending order on the right. Makes
the implicit count-of-1 action discoverable and fixes the
previously unordered 1 / X / 6 / 3 reading sequence.
EOF
)"
```

- [ ] **Step 3: Confirm clean working tree**

Run: `git status`

Expected: "nothing to commit, working tree clean" (or only unrelated changes from before this plan).
