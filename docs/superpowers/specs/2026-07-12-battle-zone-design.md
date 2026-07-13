# Battle Zone ("Field of Battle") — Design Spec

Date: 2026-07-12
Status: Reviewed by 2 design subagents (Konva/layout lens + server/rules lens); findings incorporated.
Scope: Multiplayer play mode (`app/play`). Goldfish mode is out of scope except for shared-type fallout.

## 1. Overview

A dedicated battle zone for the Battle Phase. The 0.5%-tall divider between the two
territories animates open into a ~19%-height **Field of Battle** band. Both players drag
characters/enhancements in; the app computes side totals and initiative and automates
end-of-battle cleanup. Philosophy: **the app computes, players decide** — soft guidance,
no hard rules enforcement, everything manually overridable (consistent with Forge cards
having no mechanized abilities).

### Goals
1. Live strength/toughness totals per side, with side membership determined by card
   *placement* (top half vs bottom half), which transparently handles neutral cards,
   attacker-chosen blockers, and defender-drafted attackers.
2. Soft brigade-match warning when an enhancement has no matching-brigade character on
   its side (red pulse + toast with one-tap Discard). Never a hard block.
3. Auto-return after battle: survivors to their pre-battle territory spots, spent
   enhancements to discard, with carve-outs for attached weapons and "place" enhancements.
4. Live initiative banner per the REG Initiative Table (losing side; stalemate/mutual →
   whoever did not play the last card). **Special initiative is out of scope.**
5. Resolution flow: Claim Victory (attacker) / Battle Lost (defender) → soul-surrender
   dialog (T1: defender picks; T2 & Paragon: attacker picks, incl. Paragon shared
   LoB/soul-deck souls); End Battle (either player) for stalemate/no-block.

### Non-goals
Special initiative, automated ability resolution, automatic battle detection from phase
changes, hard legality enforcement, mobile-specific layout work beyond the Narrow profile.

## 2. Layout geometry

`calculateMultiplayerLayout` gains a `battleActive: boolean` parameter. Each profile gets
a battle variant. **Invariants (enforced by unit tests):**

- Row ratios sum to exactly 1.0 (sum-check comment like existing ones).
- T1/T2: the band's vertical midline equals the idle divider's center, so the board
  opens symmetrically around the seam. (Paragon has no divider — see the Paragon
  paragraph below.)
- Sidebar rects and `pileCard` dimensions are computed from the **idle** layout in all
  modes — piles never move or resize when battle opens/closes (reviewer F10).
- LoB heights unchanged (souls — the stakes — stay fully visible; `lobCard` stable).

Standard profile (idle divider center = 0.45):

| Row | Idle | Battle |
|---|---|---|
| Opp hand | 0.08 | 0.08 |
| Opp LoB | 0.09 | 0.09 |
| Opp territory | 0.2775 | 0.185 |
| Divider / Band | 0.005 | 0.19 (0.355–0.545, midline 0.45) |
| Player territory | 0.2775 | 0.21 |
| Player LoB | 0.09 | 0.09 |
| Player hand | 0.18 | 0.155 |

Narrow profile (idle divider center = 0.4525): band 0.17; opp territory 0.1975, player
territory 0.2125, player hand 0.15; opp hand/LoBs unchanged. Sum = 1.0.

Spectator: battle deltas compose on top of the existing spectator ratio mutation
(`multiplayerLayout.ts:292-298`); add a test that spectator+battle ratios also sum to 1.0.

Paragon: the band opens directly **below the shared LoB**, height taken equally from the
two territories. Shared LoB and Soul Deck shift up by half the band height during battle
(accepted); sidebar/pile geometry still comes from the idle layout and does not move.

Hand cards: existing cap logic (`handRect.height − 48`) shrinks hand cards ~13% while the
band is open; the size snap on open/close is accepted (no size tweens exist today).

Card sizes: `mainCard` stays width-derived (98×137 @1920) and is used in the band.
Because compressed territories can clip bottom-parked cards (positions are normalized,
write-time-clamped only), add a **render-time clamp** for free-form zones:
`y = min(y, zone.y + zone.height − cardHeight)` (mirrored for rot-180 opponent cards).

## 3. Coordinate model and side derivation

- **One zone string: `'battle'`.** One zone rect spanning the play-area width. No
  per-side zones, no stored side column.
- **Mirroring by card owner**, exactly like territories: positions stored owner-local
  (0–1), opponent-owned cards flipped at render (`toScreenPos(..., 'opponent')`, rot 180,
  bottom-right anchor). This automatically renders each player's cards on their own half
  on *both* screens with zero new transform code.
- **Side is derived, never stored:** `battleSideOf(card): dbY >= 0.5 ? ownerSeat :
  opponentSeat` (owner-local frame — a card dragged past the centerline fights for the
  other side). One shared helper in `app/play/lib/battleMath.ts` used by totals,
  initiative, and brigade checks. Rationale: intra-zone drags go through
  `update_card_position`, which would never refresh a stored column (reviewer consensus).
- **Half membership is center-point-based** (a mainCard is taller than a half-band;
  containment clamping degenerates). Cards clamp to the *full band* rect only.

## 4. Interaction

- **Hit-testing:** insert the band rect (and, when idle, a ~3%-tall "divider proxy" strip)
  at the **front** of `findZoneAtPosition`'s check order, before territory rects. Half
  detection compares drop-center Y to the centerline.
- **Ownership never transfers on battle drops:** battle drops send `targetOwnerId: ''`.
  (Modeling halves as owner-scoped zones would hand your hero to the opponent — F2.)
- **Starting a battle:** dragging a card onto the divider proxy (or the toolbar's ⚔
  button) calls one **atomic** `enter_battle` reducer (open-if-closed + move + stamp);
  a client-side `startBattle(); moveCard();` pair races the opponent.
  `battleAttackerSeat` = the seat whose turn it is, not who dragged first.
- **Mid-drag safety (the old attempt's killer):**
  - Battle open/close layout flips are **deferred while `isDraggingRef.current`** and
    flushed at dragend (zone rects are recomputed at drop already; the problems are the
    dragged node teleporting via unconditional `x`/`y` props and stale snap-back refs).
  - Add an effect: if the dragged card's row changes zone server-side (e.g. opponent's
    end_battle auto-returned it), call `node.stopDrag()` and clear drag refs — never let
    react-konva destroy a node mid-drag (ghost-card class).
- **Weapons in battle:** extend the attach drop gate (today `territory && owner==='my'`)
  to accept battle-zone hosts; add a battle derived-weapon-position map (like territory's);
  server `attach_card` keeps `attachZone='battle'` when the host is in battle and stamps
  the weapon's battle fields from the host.
- `isFreeFormZone` learns `'battle'` (drives posX/posY writes, clamping, rotation adjust,
  same-zone repositions, batch positioning). Rotation adjust for battle targets keys on
  **card owner**, not target half. Marquee bounds (`allCardBounds`) and hover-glow rects
  (`allZoneRects`) include the band.

## 5. Rendering and animation

- **Single-step layout flip** (no per-frame React layout animation — it thrashes every
  memo and destroys/recreates FLIP tweens each frame). Cards glide via the existing
  `useHandLayoutTween` FLIP pattern extended with slot maps for territory/battle cards.
  Opponent-owned glide targets must bake the `+(cardW, cardH)` rot-180 anchor (PR #176
  lesson). The band background rect alone gets a one-off `Konva.Tween` for the
  "seam opens" visual.
- **Band chrome (Konva):** centerline rule, per-half totals chips (`⚔ STR/TGH`), initiative
  banner on the centerline. States: "Waiting for a blocker…" (a side has no characters);
  "⚔ INITIATIVE: <name> — losing / stalemate / mutual destruction".
- **Band buttons (HTML overlay via `virtualToScreen`,** zIndex between drag overlay 450
  and toasts 900): `⚑ Claim Victory` (attacker only), `🏳 Battle Lost` (defender only),
  `↩ End Battle` (both).
- **Battle toasts:** the default toast container is dead-center (on the band) and
  `pointerEvents: none`. Brigade-mismatch toasts (which carry a tappable **Discard**
  button) render in a dedicated band-edge-anchored container with pointer events enabled.

## 6. Battle math (client, pure lib + tests)

`app/play/lib/battleMath.ts`:
- Totals per side: Σ `parseInt(strength|toughness)` over that side's cards; unparseable
  (`''`, `*`, `X`) counts 0 and sets a `hasUnknown` flag rendered as `?` on the chip.
  Face-down cards (`isFlipped`) are excluded from sums and shown as `+?` (no info leak).
- Initiative per REG: side A **losing** iff `strA < tghB && tghA <= strB` → A has
  initiative; both `tgh > opp str` → stalemate; both `str >= opp tgh` → mutual
  destruction; stalemate/mutual → seat ≠ `lastBattlePlayBySeat`. Forge cards blank
  stats for non-granted spectators — accepted display noise.
- Brigade soft-check: enhancement's brigade tokens (split on `/`, trimmed) ∩ brigades of
  same-side characters; neutral/generic matches anything. On mismatch: red pulsing border
  + toast "No matching brigade in battle — REG says discard it" [Discard]. Non-blocking.
- Existing `pass_initiative` toast handshake stays as the manual override.

## 7. Server model (SpacetimeDB)

All state must be reconstructible from rows (reconnect/spectator-join safe). Schema
changes require the `spacetimedb-deploy` skill and a `--clear` republish on dev.

**Game columns** (all `.default('')`, rollWinner-style strings):
- `battleState`: `'' | 'active' | 'awaiting-soul'`
- `battleAttackerSeat`: `'' | '0' | '1'`
- `lastBattlePlayBySeat`: `'' | '0' | '1'`
- **Must be added to the `respond_rematch` in-place reset list** (F1) — and to no other
  reset path; resign/finish leaves them dangling by design, so **all battle UI gates on
  `status === 'playing'`.**

**CardInstance columns** (`.default('')`): `originZone`, `originPosX`, `originPosY`.
No `battleSide` column (derived — §3).

**Zone-string blast radius** — `'battle'` must be added to:
- `clearCountersIfLeavingPlay` + `leavePlayFieldOverrides` in-play lists (counters/notes/
  meek/outline must clear on battle→discard/hand/etc.). `leavePlayFieldOverrides` also
  clears the three origin fields whenever `toZone !== 'battle'` — **clearing lives only
  here**, because both move reducers have three completing write paths (token-delete,
  lost-soul redirect, main) and ad-hoc clears will miss one (F3).
- `ABILITY_SOURCE_ZONES` (5 copy-pasted sites → extract one shared const): right-click
  abilities must fire from battle.
- Client `ZoneId` union + goldfish zone initializers get a `battle: []` key (build fails
  otherwise).
- `HOME_ZONES`/`HIDDEN_HOME_ZONES`/`GRAVEYARD_PILE_ZONES`/`TOKEN_REMOVE_ZONES` correctly
  exclude battle — no change.

**Reducers:**
- `enter_battle(gameId, cardId, toPos)`: if `battleState===''` → set `'active'`, set
  `battleAttackerSeat` from `currentTurn`, clear `lastBattlePlayBySeat`; then move+stamp.
  Refuses when `status !== 'playing'`.
- `move_card` / `move_cards_batch` battle extensions: on entry into `'battle'`, stamp
  origin fields (from the card's pre-move zone/pos) + `lastBattlePlayBySeat` = **card
  owner's seat** (not sender — courtesy drags must not steal last-play). Never stamped by
  `update_card_position` (intra-band drags), exits, or token spawns. When
  `toZone==='battle'` but `battleState !== 'active'` → **redirect to territory** (mirror
  the lost-soul redirect pattern) so undo replays and stale dispatches can't create
  invisible cards in a closed band (F3/F10-undo).
- `resolve_battle(gameId)`: caller must be attacker (Claim Victory) or defender (Battle
  Lost). If the defender-side LoB (T1/T2: defender's; Paragon: shared) holds ≥1 Lost
  Soul → `battleState='awaiting-soul'`; else (battle challenge) → auto-return + clear.
- `surrender_soul(gameId, cardId)`: caller permission by `normalizeFormat(game.format)` —
  T1: defender; T2/Paragon: attacker. Validates the card is a Lost Soul in the eligible
  LoB. Transfers via the existing **`moveLostSoulToLor`** primitive targeted at **the
  attacker's LoR** regardless of caller (it already handles ownership transfer, site
  unlink, LoB compaction, Paragon shared-soul `ownerId 0n`, and `refillSoulDeck`).
  Then auto-return + `battleState=''` **in the same reducer** — never rely on a second
  client call (disconnect between calls would strand the state).
- `end_battle(gameId)`: either player, callable from **both `'active'` and
  `'awaiting-soul'`** — the unconditional escape hatch (defender can `reload_deck` away
  every surrenderable soul, or the picker can disconnect).
- `end_turn`: when `battleState !== ''`, run the auto-return routine first (battles
  cannot span turns).

**Auto-return routine** (shared helper; snapshot rows first, local per-(owner,zone)
zoneIndex counters — never re-derive from a stale snapshot):

Iterate rows currently in `zone==='battle'` (never a remembered id list — cards may have
been deleted by `reload_deck`):
1. Attached accessories (`equippedToInstanceId ≠ 0`) move with their host, attachment kept.
2. Lost Souls → owner's LoB (existing redirect semantics).
3. `isCharacterCard(...)` (handles duals + tokens) → `originZone==='territory'` ? origin
   position : a free territory spot (hand/reserve/discard-origin survivors go to
   territory per REG, never back to hidden zones).
4. Enhancements — exact `GE`/`EE` segment match on `cardType` (split on `/`, trim; there
   is **no** literal `"Enhancement"` type) → owner's **discard**, *unless*
   `/place/i.test(specialAbility)` → owner's territory free spot + log. Tokens whose
   destination is a removal pile go through `deleteTokenWithCounters`, not a move.
5. **Everything else — Dominants, Artifacts, Curses, Fortresses, unknown types, and all
   Forge cards (their `specialAbility` is blanked on the public row, so `/place/i` can
   never match) → return to origin, never discard.** Discard is the destructive branch;
   default away from it. Players drag to fix mis-routes.

All routed writes clear the origin fields. One `BATTLE_END` logAction with a summary.
Everything stays manually draggable afterward.

**Subscriptions:** no changes — player and spectator hooks already subscribe CardInstance
filtered only by gameId with the predicate on the hook. New Game columns flow through the
existing unfiltered Game `useTable`.

## 8. Resolution UX

- Attacker presses **Claim Victory** (win or mutual destruction — soul is rescued either
  way per REG), or defender presses **Battle Lost** → soul-surrender modal for the
  chooser (T1 defender / T2+Paragon attacker) listing eligible souls as card images;
  pick → soul glides to attacker's LoR, survivors return, band closes.
- **End Battle** → no dialog, auto-return, band closes (stalemate, declined challenge,
  no-block, or escape hatch).
- Defeated characters are dragged to discard manually *before* resolving — the routine
  only routes what's still in the band. Dialog-open state is a pure function of
  `battleState` (reconnect-safe).

## 9. Edge-case matrix

| Event mid-battle | Behavior |
|---|---|
| Resign / claim_timeout_victory | Game finishes; battle columns left dangling; all battle UI gated on `status==='playing'`; rematch reset clears them |
| Rematch accepted | `respond_rematch` resets battle columns (F1) |
| reload_deck | Deletes caller's battle cards; auto-return iterates live rows, degrades gracefully; `end_battle` escape always available |
| Opponent ends battle while I'm dragging | Layout flip deferred to dragend; stopDrag guard if my dragged card's row moved |
| Undo of a battle move after close | Server redirects `toZone='battle'` → territory |
| Same-turn second battle | `enter_battle` guard + origin fields re-stamped on entry; end-battle writes cleared them |
| Card re-dragged battle→territory→battle | Origin re-stamped (records the adjusted spot — fine) |
| Face-down card in battle | Excluded from totals, `+?` chip marker; row data is already client-visible today (UI-masked only) — unchanged |
| Spectator joins mid-battle | Full state from rows; band renders; read-only |

## 10. Testing

- **Unit (vitest):** `battleMath` (all four initiative-table rows incl. the `<=`/`<`
  boundaries, side derivation from posY incl. opponent mirroring, neutral placement,
  face-down exclusion, unparseable stats); layout invariants (sums = 1.0, midline pinned,
  idle-keyed sidebar, all profiles × formats × viewerKinds); auto-return routing table
  (every cardType class incl. duals `GE/Evil Character`, `Fortress / Evil Character` with
  stray spaces, tokens, Forge blanked rows, weapons-follow-host, place-enhancements).
- **E2E (verify skill, two sessions):** T1 full rescue (present → block → enhance →
  claim → defender surrender → LoR score + auto-return); T2 attacker-picks path; Paragon
  shared-soul surrender + soul-deck refill; escape hatch from `awaiting-soul`; end_turn
  auto-close.

## 11. Implementation phases

1. **Server:** schema columns + shared const extraction + stamping/clearing + redirect
   guard + reducers + auto-return + rematch reset. Deploy via `spacetimedb-deploy`
   (`--clear` on dev). Bindings regen.
2. **Layout:** battle profile variants + invariants + unit tests. `battleActive` param.
3. **Canvas plumbing (static band):** hit-test order, divider proxy, `isFreeFormZone`,
   render blocks (both owners, render-time clamp), drag-size/rotation rules, marquee/
   hover, weapon attach in battle.
4. **Battle math UI:** totals chips, initiative banner, brigade soft-check + anchored
   interactive toast.
5. **Resolution:** band buttons, `resolve_battle`/`surrender_soul` dialogs, end_turn
   hook, escape hatches.
6. **Animation & drag safety:** FLIP glides (battle + territory slot maps, rot-180
   anchors), band bg tween, mid-drag deferral + stopDrag guard.
7. **Formats & fallout:** Paragon band stacking, spectator deltas, goldfish `ZoneId`
   fallout, E2E passes.
