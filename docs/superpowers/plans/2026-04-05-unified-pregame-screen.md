# Unified Pregame Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-screen pregame flow (WaitingScreen + DeckSelectPhase + RollingPhase + ChoosingPhase + RevealingPhase) with a single unified screen that evolves in-place.

**Architecture:** No server-side changes. The SpacetimeDB pregame state machine (deck_select -> rolling -> choosing -> revealing) stays identical. All changes are pure UI: one React component replaces five, rendering different inline sections based on `lifecycle` (waiting/pregame) and `pregamePhase`. The game canvas no longer appears during pregame — it only renders when `lifecycle === 'playing'`.

**Tech Stack:** React 19, TypeScript, Framer Motion (existing), Tailwind CSS, SpacetimeDB client hooks (existing).

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| **Rewrite** | `app/play/components/PregameScreen.tsx` | Unified pregame screen — handles waiting + all pregame phases on one view. Keeps existing animation primitives (PregameD20, SparkBurst, RitualDie). |
| **Modify** | `app/play/[code]/client.tsx` | Remove `WaitingScreen` component. Render `PregameScreen` for both `waiting` and `pregame` lifecycle states. Pass `gameParams` and practice-while-waiting props. |

---

## Current Flow (being replaced)

```
GameLobby → /play/[code]
  ↓
WaitingScreen (full screen, cave bg, game code, invite link, practice btn)
  ↓ opponent joins
DeckSelectPhase (full screen card, ready/unready, change deck)
  ↓ both ready
RollingPhase (full screen dark overlay with d20 dice animation, winner gets choose buttons)
  ↓ winner chooses (or skip-to-reveal shortcut)
ChoosingPhase (full screen, winner picks first player)
  ↓ choice made
RevealingPhase (full screen, shield icon, "X goes first", auto-continue)
  ↓ both acknowledge
Playing (canvas renders)
```

## New Flow (unified)

```
GameLobby → /play/[code]
  ↓
UnifiedPregameScreen (one screen, evolves in-place)
  ├── waiting: game code + invite link, my card with deck, empty opponent slot, practice btn
  ├── deck_select: both player cards visible, ready buttons, change deck option
  ├── rolling: inline dice animation on player cards, winner announcement
  ├── choosing: inline prompt — winner picks who goes first (30s timer)
  └── revealing: brief "X goes first" message (auto-continues after 2s)
  ↓
Playing (canvas renders)
```

---

## Task 1: Rewrite PregameScreen as unified component

**Files:**
- Rewrite: `app/play/components/PregameScreen.tsx`

The new PregameScreen handles ALL pregame states on a single screen. It receives both lifecycle info and game state, rendering the appropriate inline sections.

### New Props Interface

- [ ] **Step 1: Define the new component interface**

Replace the current `PregameScreenProps` with a broader interface that supports both waiting and pregame states:

```typescript
interface PregameScreenProps {
  code: string;
  lifecycle: 'waiting' | 'pregame';
  gameId: bigint | null;
  gameState: GameState;
  // From sessionStorage gameParams — available before game state loads
  myDisplayName: string;
  myDeckName?: string;
  // Practice while waiting
  goldfishDeck: import('@/app/goldfish/types').DeckDataForGoldfish | null;
  onPractice: () => void;
  // Lobby message (creator only)
  onUpdateMessage?: (message: string) => void;
}
```

- [ ] **Step 2: Commit interface change**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: define unified PregameScreen interface"
```

### Unified Layout Shell

- [ ] **Step 3: Build the layout shell**

The unified screen uses the cave background (consistent with the game aesthetic). Layout: centered card with game code header, two player slots, and a contextual action area below.

```tsx
export default function PregameScreen({
  code, lifecycle, gameId, gameState, myDisplayName, myDeckName,
  goldfishDeck, onPractice, onUpdateMessage,
}: PregameScreenProps) {
  const { game, myPlayer, opponentPlayer } = gameState;
  const phase = game?.pregamePhase ?? '';

  // Spectator view — no myPlayer after game starts pregame
  if (lifecycle === 'pregame' && !myPlayer && game) {
    return (
      <>
        <TopNav />
        <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
          <SpectatorPregameView game={game} />
        </div>
      </>
    );
  }

  return (
    <>
      <TopNav />
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-black">
        {/* Cave background */}
        <div
          className="absolute inset-0 bg-cover bg-no-repeat opacity-40"
          style={{ backgroundImage: 'url(/gameplay/cave_background.png)', backgroundPosition: 'center 70%' }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
        />

        <div className="relative z-10 w-full max-w-lg mx-4">
          {/* Game code header */}
          <GameCodeHeader code={code} />

          {/* Main content card */}
          <div className="rounded-xl border border-amber-200/10 bg-black/60 backdrop-blur-sm p-6 sm:p-8">
            {/* Player cards */}
            <PlayerCards
              lifecycle={lifecycle}
              phase={phase}
              game={game}
              myPlayer={myPlayer}
              opponentPlayer={opponentPlayer}
              myDisplayName={myDisplayName}
              myDeckName={myDeckName}
              gameState={gameState}
              gameId={gameId}
            />

            {/* Contextual action area */}
            <ActionArea
              lifecycle={lifecycle}
              phase={phase}
              game={game}
              myPlayer={myPlayer}
              opponentPlayer={opponentPlayer}
              gameState={gameState}
              gameId={gameId}
              goldfishDeck={goldfishDeck}
              onPractice={onPractice}
              onUpdateMessage={onUpdateMessage}
            />
          </div>

          {/* Back to lobby */}
          <div className="mt-4 text-center">
            <a
              href="/play"
              className="text-xs text-amber-200/25 hover:text-amber-200/50 transition-colors"
            >
              Back to lobby
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Commit layout shell**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: build unified pregame layout shell"
```

### GameCodeHeader Sub-component

- [ ] **Step 5: Build the game code header**

Compact header above the main card showing the 4-char code + copy/invite buttons. Always visible.

```tsx
function GameCodeHeader({ code }: { code: string }) {
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  return (
    <div className="text-center mb-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200/40 font-cinzel">Game Code</p>
      <div className="flex items-center justify-center gap-3 mt-1">
        <p className="font-mono text-4xl font-bold tracking-wider text-amber-200/90">{code}</p>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCodeCopied(true);
            setTimeout(() => setCodeCopied(false), 2000);
          }}
          title="Copy code"
          className="p-1.5 rounded-md text-amber-200/30 hover:text-amber-200/70 transition-colors"
        >
          {codeCopied ? (
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      </div>
      <button
        onClick={() => {
          const url = typeof window !== 'undefined' ? `${window.location.origin}/play?join=${code}` : code;
          navigator.clipboard.writeText(url);
          setLinkCopied(true);
          setTimeout(() => setLinkCopied(false), 2000);
        }}
        className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-200/35 hover:text-amber-200/60 transition-colors"
      >
        {linkCopied ? (
          <span className="text-green-400">Link copied!</span>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            <span>Copy invite link</span>
          </>
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Commit GameCodeHeader**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: add GameCodeHeader sub-component"
```

### PlayerCards Sub-component

- [ ] **Step 7: Build the two-column player cards**

Two player slots side by side. Each shows: name, deck status, ready indicator, and (during rolling) dice result. The opponent slot shows "Waiting..." during the waiting lifecycle.

```tsx
function PlayerCards({
  lifecycle, phase, game, myPlayer, opponentPlayer,
  myDisplayName, myDeckName, gameState, gameId,
}: {
  lifecycle: 'waiting' | 'pregame';
  phase: string;
  game: GameState['game'];
  myPlayer: GameState['myPlayer'];
  opponentPlayer: GameState['opponentPlayer'];
  myDisplayName: string;
  myDeckName?: string;
  gameState: GameState;
  gameId: bigint | null;
}) {
  const isWaiting = lifecycle === 'waiting' || !opponentPlayer;
  const isDeckSelect = phase === 'deck_select';
  const isRollingOrLater = phase === 'rolling' || phase === 'choosing' || phase === 'revealing';

  const isSeat0 = myPlayer ? myPlayer.seat.toString() === '0' : true;
  const myReady = game ? (isSeat0 ? game.pregameReady0 : game.pregameReady1) : false;
  const opponentReady = game ? (isSeat0 ? game.pregameReady1 : game.pregameReady0) : false;

  // Deck change state
  const [myDecks, setMyDecks] = useState<DeckOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isChangingDeck, setIsChangingDeck] = useState(false);

  useEffect(() => {
    if (pickerOpen && myDecks.length === 0) {
      loadUserDecks().then(setMyDecks).catch(() => {});
    }
  }, [pickerOpen, myDecks.length]);

  const handleDeckSelected = async (deck: DeckOption) => {
    setPickerOpen(false);
    setIsChangingDeck(true);
    try {
      const result = await loadDeckForGame(deck.id);
      gameState.pregameChangeDeck(deck.id, JSON.stringify(result.deckData));
    } catch (e) {
      console.error('Failed to change deck:', e);
    } finally {
      setIsChangingDeck(false);
    }
  };

  // Dice results (visible during rolling+)
  const myRoll = game ? Number(isSeat0 ? game.rollResult0 : game.rollResult1) : 0;
  const opponentRoll = game ? Number(isSeat0 ? game.rollResult1 : game.rollResult0) : 0;
  const iWonRoll = myPlayer ? myPlayer.seat.toString() === game?.rollWinner : false;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {/* My player card */}
        <div className="rounded-lg border border-amber-200/15 bg-black/40 p-4 text-center">
          <p className="text-sm font-semibold text-amber-200/80 truncate">
            {myPlayer?.displayName ?? myDisplayName}
          </p>
          <p className="text-[11px] text-amber-200/30 mt-0.5">
            {myPlayer?.deckId ? 'Deck ready' : (myDeckName ?? 'Deck loaded')}
          </p>

          {/* Ready indicator (deck_select phase) */}
          {isDeckSelect && (
            <div className="mt-3 flex flex-col gap-2">
              {!myReady && (
                <button
                  onClick={() => setPickerOpen(true)}
                  disabled={isChangingDeck}
                  className="text-[11px] text-amber-200/40 hover:text-amber-200/60 transition-colors"
                >
                  {isChangingDeck ? 'Loading...' : 'Change deck'}
                </button>
              )}
              <button
                onClick={() => gameState.pregameReady(!myReady)}
                className={`px-3 py-1.5 rounded text-xs font-cinzel font-semibold uppercase tracking-wider transition-all ${
                  myReady
                    ? 'bg-amber-200/15 border border-amber-200/30 text-amber-200/80'
                    : 'bg-amber-200/10 border border-amber-200/15 text-amber-200/50 hover:bg-amber-200/15'
                }`}
              >
                {myReady ? 'Ready' : 'Ready up'}
              </button>
            </div>
          )}

          {/* Dice result (rolling phase+) */}
          {isRollingOrLater && myRoll > 0 && (
            <div className="mt-3">
              <InlineDie value={myRoll} isWinner={iWonRoll} accentColor="#c4955a" />
            </div>
          )}
        </div>

        {/* Opponent card */}
        <div className="rounded-lg border border-amber-200/10 bg-black/30 p-4 text-center">
          {isWaiting ? (
            <>
              <p className="text-sm text-amber-200/30 font-cinzel">Waiting...</p>
              <div className="mt-2 flex justify-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-200/40 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-200/40 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-200/40" />
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-blue-300/70 truncate">
                {opponentPlayer?.displayName ?? 'Opponent'}
              </p>
              <p className="text-[11px] text-blue-300/30 mt-0.5">
                {opponentReady ? 'Ready' : (isDeckSelect ? 'Selecting deck...' : 'Deck ready')}
              </p>

              {/* Opponent ready badge (deck_select) */}
              {isDeckSelect && opponentReady && (
                <span className="inline-block mt-2 text-[10px] font-semibold text-green-400/70 bg-green-400/10 px-2 py-0.5 rounded-full">
                  Ready
                </span>
              )}

              {/* Dice result (rolling phase+) */}
              {isRollingOrLater && opponentRoll > 0 && (
                <div className="mt-3">
                  <InlineDie value={opponentRoll} isWinner={!iWonRoll} accentColor="#4a7ab5" />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Status text below cards */}
      {isDeckSelect && myReady && !opponentReady && (
        <p className="mt-3 text-center text-xs text-amber-200/35">Waiting for opponent to ready up...</p>
      )}

      <DeckPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleDeckSelected}
        myDecks={myDecks}
        selectedDeckId={myPlayer?.deckId}
      />
    </>
  );
}
```

- [ ] **Step 8: Commit PlayerCards**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: add PlayerCards sub-component for unified pregame"
```

### InlineDie Sub-component

- [ ] **Step 9: Build the compact inline die**

A smaller version of the dice display that fits inside a player card. Reuses `RitualDie` (kept from existing code) at a smaller size, or a simpler static display for post-roll phases.

```tsx
function InlineDie({ value, isWinner, accentColor }: { value: number; isWinner: boolean; accentColor: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <RitualDie
        finalValue={value}
        accentColor={accentColor}
        size={56}
        isWinner={isWinner}
        revealed={true}
        skipAnimation={false}
      />
      {isWinner && (
        <motion.span
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[10px] font-cinzel font-bold uppercase tracking-wider"
          style={{ color: accentColor }}
        >
          Winner
        </motion.span>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Commit InlineDie**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: add InlineDie sub-component"
```

### ActionArea Sub-component

- [ ] **Step 11: Build the contextual action area**

This is the section below the player cards that changes based on state. It handles: practice button (waiting), roll result + choosing (rolling/choosing), reveal message (revealing).

```tsx
function ActionArea({
  lifecycle, phase, game, myPlayer, opponentPlayer,
  gameState, gameId, goldfishDeck, onPractice, onUpdateMessage,
}: {
  lifecycle: 'waiting' | 'pregame';
  phase: string;
  game: GameState['game'];
  myPlayer: GameState['myPlayer'];
  opponentPlayer: GameState['opponentPlayer'];
  gameState: GameState;
  gameId: bigint | null;
  goldfishDeck: import('@/app/goldfish/types').DeckDataForGoldfish | null;
  onPractice: () => void;
  onUpdateMessage?: (message: string) => void;
}) {
  const isWaiting = lifecycle === 'waiting' || !opponentPlayer;

  // --- Waiting state: practice + lobby message ---
  if (isWaiting) {
    return (
      <WaitingActions
        goldfishDeck={goldfishDeck}
        onPractice={onPractice}
        onUpdateMessage={onUpdateMessage}
      />
    );
  }

  // --- Rolling: winner announcement + choose buttons ---
  if (phase === 'rolling' || phase === 'choosing') {
    return (
      <RollAndChooseArea
        game={game}
        myPlayer={myPlayer}
        opponentPlayer={opponentPlayer}
        gameState={gameState}
      />
    );
  }

  // --- Revealing: brief result ---
  if (phase === 'revealing') {
    return (
      <RevealArea
        game={game}
        myPlayer={myPlayer}
        opponentPlayer={opponentPlayer}
        gameState={gameState}
      />
    );
  }

  return null;
}
```

- [ ] **Step 12: Build WaitingActions**

```tsx
function WaitingActions({
  goldfishDeck, onPractice, onUpdateMessage,
}: {
  goldfishDeck: import('@/app/goldfish/types').DeckDataForGoldfish | null;
  onPractice: () => void;
  onUpdateMessage?: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [messageSaved, setMessageSaved] = useState(false);

  return (
    <div className="mt-5">
      {/* Lobby message (optional, creator only) */}
      {onUpdateMessage && (
        <div className="flex gap-2 mb-4">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 100))}
            placeholder="Lobby message (optional)"
            maxLength={100}
            className="flex-1 rounded-md border border-amber-200/15 bg-black/40 px-3 py-2 text-sm text-amber-200/80 placeholder:text-amber-200/25 focus-visible:outline-none focus-visible:border-amber-200/30"
          />
          <button
            onClick={() => {
              onUpdateMessage(message);
              setMessageSaved(true);
              setTimeout(() => setMessageSaved(false), 2000);
            }}
            disabled={messageSaved}
            className="shrink-0 w-14 rounded-md border border-amber-200/15 px-2 py-2 text-xs text-amber-200/60 hover:bg-amber-200/5 transition-colors disabled:opacity-50"
          >
            {messageSaved ? 'Saved' : 'Set'}
          </button>
        </div>
      )}

      {/* Practice while waiting */}
      {goldfishDeck && (
        <button
          onClick={onPractice}
          className="w-full py-2.5 rounded-lg border border-amber-200/15 hover:bg-amber-200/5 transition-colors font-cinzel tracking-wide text-xs text-amber-200/50"
        >
          Practice While You Wait
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 13: Build RollAndChooseArea**

This handles both the rolling and choosing phases. During rolling, the dice are animating on the player cards (handled by PlayerCards via RitualDie). This area shows the winner announcement and choosing buttons.

```tsx
function RollAndChooseArea({
  game, myPlayer, opponentPlayer, gameState,
}: {
  game: GameState['game'];
  myPlayer: GameState['myPlayer'];
  opponentPlayer: GameState['opponentPlayer'];
  gameState: GameState;
}) {
  const hasChosenRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(CHOOSE_TIME_LIMIT_S);

  if (!game || !myPlayer) return null;

  const mySeat = myPlayer.seat;
  const iWon = mySeat.toString() === game.rollWinner;
  const winnerName = iWon ? 'You' : (opponentPlayer?.displayName || 'Opponent');
  const isSeat0 = mySeat.toString() === '0';
  const myRollAcked = isSeat0 ? game.pregameReady0 : game.pregameReady1;

  const handleChooseFirst = (seat: bigint) => {
    if (hasChosenRef.current) return;
    hasChosenRef.current = true;
    // Use skipToReveal if we're still in rolling phase, otherwise chooseFirst
    if (game.pregamePhase === 'rolling') {
      gameState.pregameSkipToReveal(seat);
    } else {
      gameState.pregameChooseFirst(seat);
    }
  };

  // Auto-acknowledge roll for loser
  useEffect(() => {
    if (iWon || myRollAcked || game.pregamePhase !== 'rolling') return;
    const timer = setTimeout(() => {
      gameState.pregameAcknowledgeRoll();
    }, RITUAL_TUMBLE_MS + ROLLING_RESULT_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [iWon, myRollAcked, game.pregamePhase, gameState]);

  // Countdown timer for choosing
  useEffect(() => {
    if (game.pregamePhase !== 'choosing' && game.pregamePhase !== 'rolling') return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [game.pregamePhase]);

  // Auto-choose when timer expires (winner defaults to going first)
  useEffect(() => {
    if (secondsLeft === 0 && iWon) {
      handleChooseFirst(mySeat);
    }
  }, [secondsLeft, iWon]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="mt-5"
    >
      <div className="h-px bg-amber-200/10 mb-4" />

      <p className="text-center font-cinzel text-sm font-bold text-amber-200/80 tracking-wide">
        {winnerName} {iWon ? 'win' : 'wins'} the roll!
      </p>

      {iWon ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-center text-[11px] text-amber-200/40 mb-1">Who goes first?</p>
          <button
            onClick={() => handleChooseFirst(mySeat)}
            className="w-full py-2.5 rounded border border-amber-200/30 bg-amber-200/10 font-cinzel text-xs font-bold uppercase tracking-wider text-amber-200/80 hover:bg-amber-200/15 transition-all"
          >
            I'll go first
          </button>
          <button
            onClick={() => handleChooseFirst(mySeat.toString() === '0' ? BigInt(1) : BigInt(0))}
            className="w-full py-2.5 rounded border border-amber-200/10 bg-transparent font-cinzel text-xs font-bold uppercase tracking-wider text-amber-200/45 hover:text-amber-200/60 hover:border-amber-200/20 transition-all"
          >
            {opponentPlayer?.displayName || 'Opponent'} goes first
          </button>
        </div>
      ) : (
        <div className="mt-3 text-center">
          <p className="text-xs text-amber-200/35">
            {myRollAcked ? 'Waiting for them to choose...' : 'Rolling...'}
          </p>
          <div className="mt-2 flex justify-center gap-1.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-amber-200/40 [animation-delay:-0.3s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-amber-200/40 [animation-delay:-0.15s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-amber-200/40" />
          </div>
        </div>
      )}

      {/* Timer bar */}
      <div className="mt-4">
        <div className="w-full h-[2px] rounded-full bg-amber-200/8 overflow-hidden">
          <motion.div
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: CHOOSE_TIME_LIMIT_S, ease: 'linear' }}
            className="h-full rounded-full"
            style={{
              backgroundColor: secondsLeft <= 10 ? 'rgba(220, 120, 80, 0.5)' : 'rgba(196, 149, 90, 0.35)',
              transition: 'background-color 0.5s ease',
            }}
          />
        </div>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 14: Build RevealArea**

Brief display showing who goes first with auto-continue.

```tsx
const REVEAL_AUTO_ACK_MS = 2500; // Shorter than before (was 3500) since it's inline

function RevealArea({
  game, myPlayer, opponentPlayer, gameState,
}: {
  game: GameState['game'];
  myPlayer: GameState['myPlayer'];
  opponentPlayer: GameState['opponentPlayer'];
  gameState: GameState;
}) {
  const alreadyAcknowledged = game && myPlayer
    ? (myPlayer.seat.toString() === '0' ? game.pregameReady0 : game.pregameReady1)
    : false;

  // Auto-acknowledge
  useEffect(() => {
    if (alreadyAcknowledged) return;
    const timer = setTimeout(() => {
      gameState.pregameAcknowledgeFirst();
    }, REVEAL_AUTO_ACK_MS);
    return () => clearTimeout(timer);
  }, [alreadyAcknowledged, gameState]);

  if (!game || !myPlayer) return null;

  const iGoFirst = myPlayer.seat === game.currentTurn;
  const iWonRoll = myPlayer.seat.toString() === game.rollWinner;
  const opponentName = opponentPlayer?.displayName || 'Opponent';

  let headline: string;
  if (iWonRoll) {
    headline = iGoFirst ? 'You chose to go first' : `You chose ${opponentName} to go first`;
  } else {
    headline = iGoFirst
      ? `${opponentName} chose you to go first`
      : `${opponentName} chose to go first`;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mt-5"
    >
      <div className="h-px bg-amber-200/10 mb-4" />

      <div className="text-center">
        <motion.p
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="font-cinzel text-sm font-bold text-amber-200/80 tracking-wide"
        >
          {headline}
        </motion.p>
        <p className="mt-2 text-[11px] text-amber-200/35">
          {alreadyAcknowledged ? 'Waiting for opponent...' : 'Starting game...'}
        </p>

        {/* Auto-continue progress bar */}
        {!alreadyAcknowledged && (
          <div className="mt-3 w-full h-[2px] rounded-full bg-amber-200/8 overflow-hidden">
            <motion.div
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: REVEAL_AUTO_ACK_MS / 1000, ease: 'linear' }}
              className="h-full rounded-full bg-amber-200/30"
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 15: Commit ActionArea + sub-components**

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: add ActionArea with waiting, choosing, and reveal sections"
```

### Keep Animation Primitives

- [ ] **Step 16: Retain PregameD20, SparkBurst, RitualDie from the old file**

These animation primitives are kept as-is in the file. They're used by `InlineDie` (which wraps `RitualDie`). Copy them directly from the existing file — no changes needed to these functions:
- `PregameD20` (lines 179-218 of current file)
- `SparkBurst` (lines 224-260)
- `RitualDie` (lines 269-374)

Also keep the timing constants at the top of the file:
```typescript
const RITUAL_TUMBLE_MS = 1200;
const RITUAL_TUMBLE_FRAMES = 18;
const ROLLING_RESULT_DISPLAY_MS = 2200;
const CHOOSE_TIME_LIMIT_S = 30;
```

- [ ] **Step 17: Keep SpectatorPregameView**

The spectator view stays as-is from the existing file (lines 1141-1192). No changes needed — it's already simple and compact.

- [ ] **Step 18: Commit the complete rewritten PregameScreen.tsx**

Assemble all the above pieces into the final file and commit.

```bash
git add app/play/components/PregameScreen.tsx
git commit -m "refactor: complete unified PregameScreen with all phases inline"
```

---

## Task 2: Update client.tsx to use unified PregameScreen

**Files:**
- Modify: `app/play/[code]/client.tsx`

### Remove WaitingScreen

- [ ] **Step 1: Delete the WaitingScreen component**

Remove the `WaitingScreen` function (lines 164-286 of current file) and the `CopyButton` helper (lines 102-162). These are fully replaced by the unified PregameScreen.

- [ ] **Step 2: Commit removal**

```bash
git add app/play/[code]/client.tsx
git commit -m "refactor: remove WaitingScreen and CopyButton from client.tsx"
```

### Merge waiting + pregame rendering

- [ ] **Step 3: Update the render section to use PregameScreen for both states**

In `GameInner`, replace the separate `waiting` and `pregame` render blocks with a single block that renders PregameScreen for both.

Find the `lifecycle === 'waiting'` render block (around line 643-682) and the `lifecycle === 'pregame'` render block (around line 814-897). Replace both with:

```tsx
if (lifecycle === 'waiting' || lifecycle === 'pregame') {
  // Practice-while-waiting takes over the full screen
  if (isPracticing && goldfishDeck && lifecycle === 'waiting') {
    return (
      <div className="fixed inset-0 bg-background">
        {/* Floating banner */}
        <div className="fixed top-0 inset-x-0 z-50 h-12 flex items-center justify-between px-4 bg-background/90 backdrop-blur-sm border-b border-border">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-bold tracking-wider">{code}</span>
            <span className="text-sm text-muted-foreground">Waiting for opponent</span>
            <span className="flex gap-1">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </span>
          </div>
          <button
            onClick={() => setIsPracticing(false)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Exit Practice
          </button>
        </div>
        <div className="pt-12">
          <WaitingRoomGoldfish deck={goldfishDeck} />
        </div>
      </div>
    );
  }

  return (
    <PregameScreen
      code={code}
      lifecycle={lifecycle as 'waiting' | 'pregame'}
      gameId={gameId}
      gameState={gameState}
      myDisplayName={gameParams?.displayName ?? ''}
      myDeckName={gameParams?.deckName}
      goldfishDeck={goldfishDeck}
      onPractice={() => setIsPracticing(true)}
      onUpdateMessage={gameId && conn ? (message: string) => {
        conn.reducers.updateLobbyMessage({ gameId, message });
      } : undefined}
    />
  );
}
```

- [ ] **Step 4: Commit the merged render path**

```bash
git add app/play/[code]/client.tsx
git commit -m "refactor: use unified PregameScreen for waiting and pregame lifecycles"
```

---

## Task 3: Verify and Polish

**Files:**
- Verify: `app/play/components/PregameScreen.tsx`
- Verify: `app/play/[code]/client.tsx`

- [ ] **Step 1: Run the build to check for type errors**

```bash
npm run build
```

Expected: No TypeScript errors. Fix any that appear — the most likely issues are:
- Missing imports (DeckPickerModal, loadUserDecks, loadDeckForGame, motion, TopNav)
- GameState type not including all needed fields
- Prop mismatches between the new PregameScreen and client.tsx

- [ ] **Step 2: Fix any build errors**

Address each error individually. Common fixes:
- Ensure all imports at top of PregameScreen.tsx match the old file's imports
- Ensure `GameState` type from `useGameState` includes `pregameReady`, `pregameAcknowledgeRoll`, `pregameChooseFirst`, `pregameAcknowledgeFirst`, `pregameSkipToReveal`, `pregameChangeDeck`

- [ ] **Step 3: Commit fixes**

```bash
git add app/play/components/PregameScreen.tsx app/play/[code]/client.tsx
git commit -m "fix: resolve build errors in unified pregame"
```

- [ ] **Step 4: Manual testing checklist**

Verify each flow works:
1. Create a game — see unified screen with game code, your player card, empty opponent slot
2. Copy invite link — paste in another browser/tab
3. Join the game — opponent card fills in, both see deck_select state
4. Ready up — both players hit ready, dice roll animates inline
5. Winner chooses — choose buttons appear for winner, waiting text for loser
6. Game starts — canvas renders after reveal auto-continues
7. Practice while waiting — enter/exit practice mode
8. Spectator view — spectator sees simple phase summary

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: unified single-screen pregame flow"
```
