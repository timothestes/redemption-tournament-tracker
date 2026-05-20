# 10 — Spectator `send_chat` accepted server-side + ID collision in `playerNames`

**Priority:** High
**Effort:** S
**Status:** TODO

## Problem

Two bugs that compound:

1. **Server accepts spectator chat.** `send_chat` resolves the sender via the Spectator table when no Player row matches the caller's identity. Currently dormant only because the client UI gate `chatDisabled` blocks the input — but `conn.reducers.sendChat({ gameId, text })` from a spectator's console succeeds.

2. **`Spectator.id` and `Player.id` collide in lookups.** Both columns are `autoInc()` starting at 1. The reducer writes `senderId = spectator.id` into the chat row; `ChatPanel` looks up `playerNames[senderId.toString()]` — so a spectator's message with `id=2` renders under Player.id=2's name.

## Why it matters

**Currently dormant; instantly Critical the day someone re-enables the chat input.** Impersonation surface — spectator can send messages that appear in-game as if from a seated player. The disabled UI gate is the only thing keeping this from being exploitable in production today.

Reviewer B: would be Critical if the input weren't disabled. Patch now to prevent a future regression.

## Code references

- [spacetimedb/src/index.ts:5439-5471](../../spacetimedb/src/index.ts#L5439-L5471) — `send_chat` reducer; accepts spectators
- [spacetimedb/src/index.ts:5454](../../spacetimedb/src/index.ts#L5454) — `senderId = spectator.id` (collision source)
- [app/play/components/ChatPanel.tsx:1584-1605](../../app/play/components/ChatPanel.tsx#L1584-L1605) — UI gate (`chatDisabled`)
- [app/play/components/ChatPanel.tsx:1789-1790](../../app/play/components/ChatPanel.tsx#L1789-L1790) — `playerNames[senderId.toString()]` lookup (collision sink)
- [app/play/components/ChatPanel.tsx:1480](../../app/play/components/ChatPanel.tsx#L1480) — dead `if (msg.senderId === 0n)` branch (signal of an incomplete previous migration)

## Fix sketch

Two parts, ship together:

**Server side:**
- Reject spectator callers in `send_chat`. Match the pattern used by `move_card` etc. — find via `findPlayerBySender`, throw on miss
- If spectator chat is a future feature, write to a separate `SpectatorChatMessage` table with `senderSpectatorId`, not the shared chat table

**Client side:**
- Namespace senderIds — either tag them (`{kind: 'player' | 'spectator', id}`) or add a separate `spectatorNames` lookup map and check senderKind before resolving names
- Clean up the dead `senderId === 0n` branch at [ChatPanel.tsx:1480](../../app/play/components/ChatPanel.tsx#L1480) while you're in there

## Notes

- Open product question: is spectator chat input meant to stay disabled forever? Drives whether this is a server-side reject (chat stays player-only) or a namespace + separate table (chat opens up later).
- The dead `senderId === 0n` branch suggests an incomplete migration from commit `102f324` — worth understanding that migration's intent before re-architecting.
- Related: `myPlayerId={BigInt(0)}` sentinel in spectator client (Low/Defer) relies on the convention that `Player.id` starts at 1 — brittle.
