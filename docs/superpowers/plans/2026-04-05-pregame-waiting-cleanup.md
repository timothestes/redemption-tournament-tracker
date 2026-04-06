# Pregame Waiting Screen Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declutter the pregame waiting screen by removing duplicate UI, collapsing the lobby message to a pencil icon, repositioning "Back to lobby," and removing redundant status indicators.

**Architecture:** All changes are in a single file (`app/play/components/PregameScreen.tsx`). We modify three sub-components (`GameCodeHeader`, `WaitingActions`, and the main `PregameScreen` layout) and delete no files.

**Tech Stack:** React, Tailwind CSS, Framer Motion (already imported), inline SVG icons.

---

### Task 1: Move "Back to lobby" to top-left with chevron icon

**Files:**
- Modify: `app/play/components/PregameScreen.tsx:95-157` (main PregameScreen return)

- [ ] **Step 1: Remove the "Back to lobby" link from the bottom of the card**

In `PregameScreen`, delete lines 151-157 (the `{/* Back to lobby */}` block that sits after the action area div):

```tsx
          {/* Back to lobby */}
          <a
            href="/play"
            className="mt-4 inline-block text-xs text-amber-200/25 hover:text-amber-200/50 transition-colors"
          >
            Back to lobby
          </a>
```

- [ ] **Step 2: Add "Back to lobby" at the top-left of the card, above GameCodeHeader**

Insert the following immediately after the opening `<div className="relative z-10 rounded-xl ...">` (line 95), before the `{/* Game code header */}` comment:

```tsx
          {/* Back to lobby */}
          <a
            href="/play"
            className="flex items-center gap-1 text-xs text-amber-200/40 hover:text-amber-200/60 transition-colors mb-4 self-start"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to lobby
          </a>
```

Note: The parent div uses `text-center`, so we need `self-start` won't work here (it's not a flex child in the block direction). Instead, wrap in a div or use `text-left`:

```tsx
          {/* Back to lobby */}
          <div className="text-left mb-4">
            <a
              href="/play"
              className="inline-flex items-center gap-1 text-xs text-amber-200/40 hover:text-amber-200/60 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back to lobby
            </a>
          </div>
```

- [ ] **Step 3: Visual check**

Run: `npm run dev`

Verify:
- "Back to lobby" appears top-left of the card with a chevron-left icon
- It's visible but subtle (amber-200/40)
- Hover brightens to /60
- No link remains at the bottom of the card

- [ ] **Step 4: Commit**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: move back-to-lobby to top-left with chevron icon"
```

---

### Task 2: Make game code tappable for invite link, remove share icon

**Files:**
- Modify: `app/play/components/PregameScreen.tsx:168-224` (GameCodeHeader)

- [ ] **Step 1: Remove the share/link icon button from GameCodeHeader**

Delete the second `<button>` block (lines 206-220) — the one with `onClick={copyLink}` and the share node SVG icon. Also remove the `linkCopied` state and `copyLink` function since they'll no longer be used at this location.

The state to remove:
```tsx
  const [linkCopied, setLinkCopied] = useState(false);
```

The function to remove:
```tsx
  const copyLink = () => {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/play?join=${code}` : code;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };
```

The button JSX to remove (lines 206-220):
```tsx
        <button
          onClick={copyLink}
          title="Copy invite link"
          className="p-1.5 rounded-md text-amber-200/40 hover:text-amber-200/80 transition-colors"
        >
          {linkCopied ? (
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
          )}
        </button>
```

- [ ] **Step 2: Make the game code text tappable to copy invite link**

Add `linkCopied` state back (we still need it for feedback on the code text). Add a `copyLink` handler. Make the `<p>` with the code text a clickable element with cursor-pointer, tooltip, and feedback:

Replace the existing `GameCodeHeader` function with:

```tsx
function GameCodeHeader({ code }: { code: string }) {
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const copyLink = () => {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/play?join=${code}` : code;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <div className="mb-5">
      <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200/50 font-cinzel">Game Code</p>
      <div className="flex items-center justify-center gap-2 mt-1">
        <p
          onClick={copyLink}
          title="Tap to copy invite link"
          className="font-mono text-4xl sm:text-5xl font-bold tracking-wider text-amber-200/90 cursor-pointer hover:text-amber-200 transition-colors select-none"
        >
          {code}
        </p>
        <button
          onClick={copyCode}
          title="Copy code"
          className="p-1.5 rounded-md text-amber-200/40 hover:text-amber-200/80 transition-colors"
        >
          {codeCopied ? (
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      </div>
      {linkCopied && (
        <p className="mt-1 text-[10px] text-green-400 font-cinzel tracking-wide">Invite link copied!</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Visual check**

Run: `npm run dev`

Verify:
- Game code text shows pointer cursor on hover and brightens
- Clicking the code copies the invite URL and shows "Invite link copied!" below
- The copy-code icon still copies just the raw code
- No share icon button remains

- [ ] **Step 4: Commit**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: make game code tappable for invite link, remove share icon"
```

---

### Task 3: Remove redundant status indicators and invite button from WaitingActions

**Files:**
- Modify: `app/play/components/PregameScreen.tsx:453-551` (WaitingActions)

- [ ] **Step 1: Strip WaitingActions down**

Remove from the `WaitingActions` return JSX:
1. The "Waiting for opponent to join..." `<p>` (line 478)
2. The bounce dots `<div>` (lines 479-483)
3. The entire invite link button block (lines 507-535)
4. The `inviteCopied` state (line 466) — no longer needed
5. The `h-px` divider (line 540) — replace with `mt-4` gap on the practice button

Also remove the `code` prop from `WaitingActions` since it was only used for the invite link button.

The updated component:

```tsx
function WaitingActions({
  goldfishDeck,
  onPractice,
  onUpdateMessage,
}: {
  goldfishDeck: import('@/app/goldfish/types').DeckDataForGoldfish | null;
  onPractice: () => void;
  onUpdateMessage?: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [messageSaved, setMessageSaved] = useState(false);

  function handleSaveMessage() {
    if (!onUpdateMessage) return;
    onUpdateMessage(message);
    setMessageSaved(true);
    setTimeout(() => setMessageSaved(false), 2000);
  }

  return (
    <div>
      {/* Lobby message */}
      {onUpdateMessage && (
        <div className="mt-4">
          <div className="flex gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 100))}
              placeholder="Lobby message (optional)"
              maxLength={100}
              className="flex-1 rounded-md border border-amber-200/15 bg-black/40 px-3 py-2 text-sm text-amber-200/80 placeholder:text-amber-200/25 focus-visible:outline-none focus-visible:border-amber-200/30"
            />
            <button
              onClick={handleSaveMessage}
              disabled={messageSaved}
              className="shrink-0 w-16 rounded-md border border-amber-200/15 px-3 py-2 text-sm text-amber-200/60 hover:bg-amber-200/5 transition-colors disabled:opacity-50"
            >
              {messageSaved ? 'Saved' : 'Set'}
            </button>
          </div>
        </div>
      )}

      {/* Practice */}
      {goldfishDeck && (
        <button
          onClick={onPractice}
          className="mt-4 w-full py-2.5 rounded-lg border border-amber-200/15 hover:bg-amber-200/5 transition-colors font-cinzel tracking-wide text-sm text-amber-200/60"
        >
          Practice While You Wait
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update the WaitingActions call site to remove `code` prop**

In `PregameScreen` (around line 120-125), update:

```tsx
              <WaitingActions
                goldfishDeck={goldfishDeck}
                onPractice={onPractice}
                onUpdateMessage={onUpdateMessage}
              />
```

(Remove the `code={code}` prop.)

- [ ] **Step 3: Visual check**

Run: `npm run dev`

Verify:
- No "Waiting for opponent to join..." text or bounce dots in the action area
- No "Invite Link" button
- No divider line above "Practice While You Wait"
- Lobby message input still works (still visible at this point — will be collapsed in Task 4)
- The player cards' "Waiting" slot still has its own bounce dots

- [ ] **Step 4: Commit**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: remove redundant status text, bounce dots, and invite button from WaitingActions"
```

---

### Task 4: Collapse lobby message to pencil icon with expand/collapse

**Files:**
- Modify: `app/play/components/PregameScreen.tsx` (WaitingActions component)

- [ ] **Step 1: Add expand/collapse state and rewrite the lobby message UI**

Replace the lobby message section in `WaitingActions` with a pencil icon that expands to an input on click. Update the full component:

```tsx
function WaitingActions({
  goldfishDeck,
  onPractice,
  onUpdateMessage,
}: {
  goldfishDeck: import('@/app/goldfish/types').DeckDataForGoldfish | null;
  onPractice: () => void;
  onUpdateMessage?: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [messageSaved, setMessageSaved] = useState(false);
  const [messageExpanded, setMessageExpanded] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

  function handleSaveMessage() {
    if (!onUpdateMessage) return;
    onUpdateMessage(message);
    setSavedMessage(message);
    setMessageSaved(true);
    setMessageExpanded(false);
    setTimeout(() => setMessageSaved(false), 2000);
  }

  return (
    <div>
      {/* Lobby message — pencil icon, expands on click */}
      {onUpdateMessage && (
        <div className="mt-2">
          {messageExpanded ? (
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 100))}
                placeholder="Lobby message (optional)"
                maxLength={100}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveMessage();
                  if (e.key === 'Escape') setMessageExpanded(false);
                }}
                className="flex-1 rounded-md border border-amber-200/15 bg-black/40 px-3 py-2 text-sm text-amber-200/80 placeholder:text-amber-200/25 focus-visible:outline-none focus-visible:border-amber-200/30"
              />
              <button
                onClick={handleSaveMessage}
                className="shrink-0 rounded-md border border-amber-200/15 px-3 py-2 text-sm text-amber-200/60 hover:bg-amber-200/5 transition-colors"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setMessageExpanded(true)}
                title="Set lobby message"
                className="flex items-center gap-1.5 text-xs text-amber-200/40 hover:text-amber-200/60 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
                {savedMessage ? (
                  <span className="max-w-[200px] truncate">{savedMessage}</span>
                ) : messageSaved ? (
                  <span className="text-green-400">Saved!</span>
                ) : (
                  <span>Set lobby message</span>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Practice */}
      {goldfishDeck && (
        <button
          onClick={onPractice}
          className="mt-4 w-full py-2.5 rounded-lg border border-amber-200/15 hover:bg-amber-200/5 transition-colors font-cinzel tracking-wide text-sm text-amber-200/60"
        >
          Practice While You Wait
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Visual check**

Run: `npm run dev`

Verify:
- Default state: pencil icon + "Set lobby message" text, small and centered
- Click: expands to input + "Save" button
- Enter key saves, Escape key cancels
- After save: collapses back, shows truncated message text next to pencil
- "Saved!" feedback appears briefly after saving
- Practice button still renders below when goldfish deck is available

- [ ] **Step 3: Commit**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "feat: collapse lobby message to pencil icon with expand/collapse"
```

---

### Task 5: Build check

- [ ] **Step 1: Run the build**

Run: `npm run build`

Expected: build succeeds with no TypeScript errors related to `PregameScreen.tsx`.

- [ ] **Step 2: Fix any issues if needed**

If there are type errors (e.g., `code` prop still expected somewhere), fix them.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "fix: address build errors from pregame waiting cleanup"
```
