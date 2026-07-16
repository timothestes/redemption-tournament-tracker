# Static Seats & Seat-Numbering Mode — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorm with host/owner)
**Area:** Tournament tracker — pairing display, participants, print output

## Problem

Some players need a fixed physical location for the whole tournament
(accessibility, equipment, proximity to an outlet). Today a match's "table
number" is purely virtual — display index (`match_order`) plus
`starting_table_number` — so there is no way to guarantee a player a
location, and no way to express venues that number individual chairs
("seats") rather than tables.

Two features, one mechanism:

1. **Numbering mode** — a tournament can number by *tables* (one number per
   match, current behavior) or by *seats* (each player has their own chair
   number; table *k* holds seats *2k−1* and *2k*).
2. **Static pins** — the host can pin any participant to a specific table
   (tables mode) or seat (seats mode). Every round, that player's match is
   placed at their pinned location.

### Decisions locked during brainstorm

- Seats = **numbered chairs, two per table**, sequential (seats 1,2 = table 1;
  seats 3,4 = table 2; …).
- Numbering mode is a **per-tournament setting**, default `tables`; existing
  tournaments unaffected.
- Pins affect **where a match happens, never who plays whom**. The Swiss
  pairing algorithm is untouched.
- Two pinned players paired against each other: **lower number wins**,
  deterministically; the other pin is visibly overridden for that round.

## Architecture (Approach A — persisted table numbers)

Pairing stays pure Swiss. A new **pure assignment function** runs after
pairing and its result is persisted to a new `matches.table_number` column.
Every consumer (rounds view, print pairings, match slips) reads the persisted
number. One computation, one source of truth, no screen/print drift.

```
pairFirstRound / pairLaterRound   (unchanged)
        │  matches in rank order (match_order 1..N)
        ▼
assignTables(matches, pins, { startingTableNumber, mode })   ← NEW, pure
        │  matches + table_number (+ side swaps in seats mode)
        ▼
persist: matches.table_number     (createPairing / regenerate RPC / repair helper)
        ▼
display + print read match.table_number
```

## Schema (one migration)

```sql
alter table tournaments
  add column numbering_mode text not null default 'tables'
  check (numbering_mode in ('tables','seats'));

alter table participants
  add column assigned_seat integer
  check (assigned_seat is null or assigned_seat >= 1);

-- One pin value per tournament. Blocks "two players pinned to table 5".
-- Seats mode couples who share a table use different values (9 and 10).
create unique index participants_assigned_seat_unique
  on participants (tournament_id, assigned_seat)
  where assigned_seat is not null;

alter table matches add column table_number integer;
```

- `participants.assigned_seat` is interpreted per mode: a **table number**
  in tables mode, a **seat number** in seats mode. Null = no pin.
- `matches.table_number` is null for all pre-existing rounds; display falls
  back to today's index math, so legacy tournaments render unchanged.
- The `regenerate_current_round_pairings` RPC gains `table_number` in its
  `p_pairings` payload (same migration, `create or replace`).
- RLS: existing host-only policies on all three tables already cover the new
  columns; no policy changes.

## Assignment algorithm — `lib/tournament/tableAssignment.ts`

```ts
interface AssignOptions { startingTableNumber: number; mode: 'tables' | 'seats'; }

function assignTables<M extends { player1Id: string; player2Id: string; matchOrder: number }>(
  matches: M[],                       // rank order (matchOrder asc)
  pins: Map<string, number>,          // participantId -> assigned_seat (active players only)
  opts: AssignOptions,
): { matches: Array<M & { tableNumber: number }>; overriddenPins: string[] }
```

Definitions: in seats mode, seat *s* maps to table `ceil(s / 2)`; odd seat =
player-1 chair, even seat = player-2 chair. In tables mode a pin is already a
table number and has no side semantics. `startingTableNumber` does not shift
the seat↔table formula (table *k* is always seats *2k−1, 2k*); it only sets
where unpinned fill begins.

1. **Claims.** For each match in rank order, collect its players' pins.
   - Two pins in one match: the **lower value wins** and sets the claim; the
     other player's pin is overridden (recorded in `overriddenPins`). If both
     pins resolve to the *same table* in seats mode (seats 9 and 10 — the
     happy case), both are honored: no override.
   - One pin: claim = that pin's table.
   - No pins: no claim.
2. **Claim conflicts.** If two different matches claim the same table (only
   possible in seats mode: seats 9 and 10 pinned to players in different
   matches), sort claimants by (pin value asc, matchOrder asc); the first
   keeps the table, the rest drop to the unpinned pool with their pins
   overridden.
3. **Fill.** Unclaimed matches take the lowest free table numbers
   ≥ `startingTableNumber` in rank order, skipping claimed tables. Pinned
   tables may be sparse or below `startingTableNumber` (pin = table 3 with
   starting table 5 is honored at 3; pin = table 50 with 10 matches is
   honored at 50).
4. **Chair sides (seats mode only).** Within a claimed match, a player pinned
   to an even seat is placed in the `player2` slot, odd seat in `player1`, so
   they occupy their literal chair. The swap happens **before** persistence,
   when the match has no scores, so it is safe. `matchOrder` is never
   changed — rank order and physical location are independent fields.
5. **Byes / drops.** A pinned player receiving a bye, or dropped out, claims
   nothing that round. Pins of dropped players stay stored (dormant) and
   resume if the player is restored.

**Overridden pins are derivable, not stored**: any view can compare a
player's `assigned_seat` to their match's actual table/seat and badge the
mismatch. `overriddenPins` in the return value exists for tests and for
potential toast messaging at generation time.

## Write paths (3)

1. **`createPairing`** ([utils/tournament/pairingUtilsV2.ts](../../utils/tournament/pairingUtilsV2.ts)) —
   after `pairFirstRound`/`pairLaterRound`, load pins + mode + starting table
   (already loads state via `stateAdapter`; extend it), run `assignTables`,
   include `table_number` in `persistMatches`, and persist any seats-mode
   side swaps in the same insert.
2. **Regenerate** (`regenerateCurrentRoundPairingsAction` in
   [app/tracker/tournaments/repair-actions.ts](../../app/tracker/tournaments/repair-actions.ts)) —
   same computation server-side; passes `table_number` through the updated
   RPC.
3. **Repairs** (pairing-swap modal, swap-player-with-bye) — after any swap, a
   shared helper `reassignRoundTables(client, tournamentId, round)` reloads
   the round's matches (rank order), re-runs `assignTables`, and updates
   `table_number` (and player slots for seats-mode sides). Repairs are
   already gated to "no results entered this round," so re-placement is
   physically safe.

Pins edited mid-tournament apply at the **next** pairing generation,
regenerate, or repair — never retroactively to an already-placed round.

## UI

- **Edit Participant modal**
  ([components/ui/EditParticipantModal.tsx](../../components/ui/EditParticipantModal.tsx)) —
  optional numeric field below the name, labeled per mode ("Static table #" /
  "Static seat #"), clearable. Unique-index violation surfaces as
  "Seat 9 is already assigned to ⟨name⟩."
- **Players tab**
  ([components/ui/ParticipantTable.tsx](../../components/ui/ParticipantTable.tsx)) —
  compact badge on pinned rows (`T5` tables mode, `S9` seats mode), desktop
  and mobile layouts.
- **Tournament settings**
  ([components/ui/TournamentSettings.tsx](../../components/ui/TournamentSettings.tsx)) —
  "Numbering" toggle: Tables (default) / Seats, with one help sentence.
  When any participant has a pin, switching shows an inline warning that pin
  values will be reinterpreted under the new mode (edge case 11).
- **Rounds view**
  ([components/ui/TournamentRounds.tsx](../../components/ui/TournamentRounds.tsx)) —
  table number displays `match.table_number ?? index + starting_table_number`
  (legacy fallback). Rows sort by `table_number` (nulls → `match_order`
  fallback) so the host reads the room in physical order. Seats mode shows
  each player's seat (`2t−1` / `2t`). A pinned player whose actual placement
  differs from their pin gets a subtle "pin overridden" badge.
- **Print pairings** ([utils/printUtils.ts](../../utils/printUtils.ts), the
  compact multi-column layout from PR #208) — table badge shows the persisted
  `table_number`. Seats mode: replace the single leading badge with per-name
  seat numbers (`9 Alice  vs  10 Bob`). Print handlers pass matches with
  their persisted numbers instead of relying on array index.
- **Match slips** — header "Table N" reads the persisted number; seats mode
  shows "Seats 9 & 10", and each player row is annotated with their seat.

## Edge cases

| # | Case | Behavior |
|---|------|----------|
| 1 | Two pinned players paired together, different tables | Lower pin value hosts; other pin overridden + badged |
| 2 | Two pinned players paired together, same table (seats 9+10) | Both honored, correct chairs, no override |
| 3 | Same pin value on two players | Blocked by partial unique index; friendly UI error |
| 4 | Seats 9 and 10 pinned, players land in different matches | Lower seat's match claims table 5; other match refilled + pin badged |
| 5 | Pin beyond match count (table 50, 10 matches) | Honored; table numbers are sparse by design |
| 6 | Pin below `starting_table_number` | Honored (explicit host intent) |
| 7 | Pinned player gets the bye | No claim that round; pin resumes next round |
| 8 | Pinned player drops out | Pin dormant; resumes if restored |
| 9 | Legacy matches (`table_number` null) | Display falls back to index math — pixel-identical to today |
| 10 | Pin edited mid-round | Current round untouched; applies at next generation/regenerate/repair |
| 11 | Numbering mode switched while pins exist | Pin values are reinterpreted under the new mode (table 5 → seat 5). Settings toggle shows an inline warning listing how many players have pins ("3 players have static assignments — review them after switching"); no auto-conversion, no blocking |

## Testing

Unit tests for `assignTables` (pure, no IO — mirrors existing
`lib/tournament/__tests__` style):

- No pins → identity: tables `start..start+N−1` in rank order.
- Single pin (tables + seats modes), sparse pin, pin below starting table.
- Two pins one match: lower wins, override recorded; seats 9+10 happy case.
- Cross-match same-table claim conflict (case 4).
- Seats-mode chair sides: even-seat pin lands in player2 slot; odd in player1.
- Pinned bye / dropped player claims nothing.
- Determinism: same inputs → same outputs (no RNG in this function).

Pairing algorithm tests are untouched — the algorithm doesn't change.
Integration smoke: generate a round with pins in a dev tournament and verify
rounds view, print pairings, and match slips agree on every number.

## Out of scope (YAGNI)

- Per-round pin overrides ("pin only for round 3").
- Pin-aware opponent selection (pairing integrity stays pure Swiss).
- Auto-assigning seats to all players.
- Any change to bye mechanics or scoring.
