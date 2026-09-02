# Mobile Multiplayer Backlog — `/play` on phones

The wave-to-wave memory. One row per item, in the player's words. **A status in
this file is only valid if it was measured in the wave named in "last verified"
— do not carry a status forward without re-measuring it.** An item deferred in
three consecutive waves gets escalated: fixed, or closed with one sentence on
why it is permanently out of scope. Anything that can only be verified on real
iOS hardware lives as a checkbox in `mobile-device-qa-checklist.md`, not here.

Statuses: `open` / `fixed` / `regressed` / `needs-device` / `product-call` / `closed`.
Impact: `blocker` (cannot finish the game) / `rage-quit` (loses the game or their
work) / `annoyance`.

## Open

| id | Symptom, as a player experiences it | Last verified | Status | Impact |
|---|---|---|---|---|
| card-choice-prompts-no-read | KeepOne/ResurrectHeroes/DeckExchange show 96px thumbnails I cannot read, and picking blind loses me the game | 2026-09-02 w9 | open (escalated — next wave MUST stage it: seed a deck with an exchange/keep-one ability card; the fix design is first-tap-opens-CardReaderOverlay, the pattern every other surface now uses) | rage-quit |
| cross-side-retarget-feedback | Tapping the other side of the board flips the rail's Mine/Theirs toggle at the bottom edge and nothing near my finger tells me | 2026-09-02 w9 (re-measured: tap at (360,165) flipped `aria-pressed` silently, card did not move) | open | annoyance |
| browse-grid-drift-tap-inert | In card grids a slightly-sloppy tap does nothing and I have to tap again | 2026-09-01 w8 | open — NOT re-measured in w9, do not trust | annoyance |
| battle-landscape-vertical-context | The Battle jump shows the band and ~1 card of context; territories feeding it are clipped | 2026-09-02 w9 (band 132..308 in a 393 viewport; top souls clip at y=-37) | open | annoyance |
| fit-parks-under-chat-rail | At Fit, cards on the right sit under the chat rail where I can't tap them | 2026-09-02 w9 — could NOT reproduce (0 cards past x=808 at Fit on a spread board); re-check on a right-edge-crowded board before closing | open (unreproduced) | annoyance |
| rematch-log-appends | After a rematch the log still shows all of game 1 above game 2 | 2026-09-02 w9 (game-1 "created the game" line still present after two rematches; REMATCH seam renders) | open — server-side (gameId reuse), needs Tim's call | annoyance |
| request-denied-silent | As a spectator, my hand request shows "REQUEST SENT" forever when both players dismiss it — only the 30s cooldown resets the button | 2026-09-02 w9 | open — needs a server denial signal (dismiss is client-local); client-only wave cannot fix | annoyance |

## Fixed this wave (w9, all re-driven live in the state that produced the bug)

| id | What was measured | Fix |
|---|---|---|
| portrait-phase-strip | Tap on Upkeep chip fired **End your turn**, tap on Prep fired **Concede** (elementFromPoint); strip scroll window was 87px of 463; Battle/Disc/❯ unhittable | Two-row bar under 520px: clusters on row 1, full-width scrolling strip row 2. Re-probed: Upk→Upkeep, Prep→Preparation, Battle→Battle; swipe reaches Disc; camera cluster moved to y=94 |
| end-battle-races-chooser | Attacker's ↩End during the open soul chooser killed it and awarded no soul (score stayed 0-0 after a won battle) | The awaiting-soul escape hatch is now two-step: first tap arms ("No soul?"), 3s auto-disarm, second tap dispatches. Chooser verified to survive the first tap; server anti-stall hatch semantics preserved |
| rematch-banner-buried | Loser's Accept sat at z-800 under the game-over overlay backdrop (z-900) — elementFromPoint returned the backdrop | Request now surfaces inside the result modal ("X wants to play again" + ACCEPT REMATCH); banner shows only when the modal is dismissed, at z-950 (probe returns the button) |
| unread-cleared-wrong-tab | 2 unread → panel reopened on the Spectators tab → badge cleared, messages never shown | Panel opening with unread on Spectators/Log switches to All; re-driven: message visible on open |
| tablet-search-clipped | At 1024×768 the panel Search button sat at x=1038 — fully off-viewport (`1fr auto 1fr` grid collapse) | Header is flex; tab row shrinks/scrolls. Search now at 972..1016 |
| deck-picker-under44 | My Decks/Community tabs 32px, search 36px, selects 36px on touch | `data-deck-picker` + scoped touch rule; all measured 44px |
| pause-unreachable-phone | Zero pause/resume controls in the DOM at phone size (nested in `!isBarNarrow`) | Standalone 44×44 pause button on narrow touch bars (phone + tablet), same request/accept semantics |
| spectator-pile-column-clips | DECK spanned x=316..346 while RES started at 333 — labels overprinted as "DECRK"/"DISBA" (fs() floors font size, columns don't grow) | Pile labels always clip to their zone with ellipsis; re-measured 14px clipped labels, zero overlap |
| spectator-seat-relative-labels | Board said "OPPONENT'S TERRITORY" — of whom? | Spectators see owner names; re-measured: "S_W9A…'S TERRITORY" / "S_W9B…'S TERRITORY" |
| tap-arms-opponent-card | (re-verify of #352) idle tap on opp card | Confirmed fixed: opens the reader, does not arm |
| battle-portrait-illegible | (re-verify of #352) battle framing | Confirmed fixed in landscape (band framed with cards); portrait band now reachable via the two-row bar |
| pinch-zoom-floor | 3 hard pinch-outs → hand cards still 49-60px (floor at fit) | Confirmed fixed / not reproducible |
| battle-pair-fanout | Blocker 288..345, attacker 332..389 at fit — side-by-side with 13px overlap, both faces readable | No longer "buried"; earlier waves' framing/badges resolved it. Closed as fixed |
| chat-search-autofocus | "Close search" button exists and works; autofocus keeps the keyboard flow the player asked for | Closed |
| reader-only-x-close | The scan + text column covered ~the whole screen; only the 44px × closed the reader | Tapping the scan closes it (text column still scroll-safe) |
| hand-request-copy | "Spectator is spectating and would like to see hands." | "X would like to see your hand." |

## Closed (with the one sentence)

| id | Why |
|---|---|
| edge-clip-12pct | Not reproducible in normal play: drop-position clamping keeps every card inside the max-pan window (card parked at the territory edge measured fully visible, 576..670 of 852, at max pan) — the original repro needed a card half-overhanging the board edge, which drops can no longer produce. |
| pile-art-7px | The rail pile art at whole-board fit is geometrically ~7×9px (10%-wide rail of a 393px-tall board) and the label+count carry the information; the pile TAP opens the browse sheet, which is the readable surface — permanently out of scope to make the thumbnail itself legible. |
| soul-overhang-hand-strip | Not reproducible: 24/24 hit probes across the opponent hand strip hit the strip's own zone rect, 0 hit souls. |
| cluster-occludes-hand-row | #352's collapse is the fix: expanded it covers 5/11 hand backs, one tap collapses it to a single 44px button (and portrait starts collapsed). |
| tray-collapses-every-turn | By design: the expanded tray covers the hand band, so it collapses on any outside tap; Draw is two taps per turn as the cost of never hiding hand cards. |
| territory-single-row | Inherent to fitting 1080 virtual px into 393; the browse sheet is the answer. |
| phase-gate-32px | Widening spreads the phase chips; clears WCAG 2.5.8 AA. |
| paragon-lob-idle-tap-reads | Deliberate #352 trade-off; long-press still moves. |

## Product calls (unchanged, not bugs)

| id | Symptom | Last noted |
|---|---|---|
| direct-url-limbo | Opening a game URL directly shows the waiting room but never seats me | w5 |
| anon-play-signin-wall | Without an account I can't find or watch any public game | w9 (kicked anon spectator lands on the sign-in wall) |
| play-undiscoverable-landing | "Play" isn't on the landing page | w7 |
| no-starter-deck-shelf | A new player gets 422 community decks sorted by Newest | w7 |
| goldfish-session-loss | Navigating away from goldfish silently loses the session | w7 |
| no-waiting-room-chat | No chat before the game starts | w6 |
| send-chat-server-validation | (server) no trim/cap/rate-limit | w6 |
| log-leaks-hidden-card-names | (server) `game_action` is public with real card names for hidden-zone moves — recommend priority | w6 |
| spectator-chat-id-collision | (server) sender-id collision, unreachable from shipped client | w6 |

## Needs a real device

See `mobile-device-qa-checklist.md`. Standing item: `chat-keyboard-visualviewport`
(the composer under the iOS keyboard) — emulated keyboard (viewport shrink to
235px) kept the Grant banner and composer reachable in w9, but only real iOS
proves it.
