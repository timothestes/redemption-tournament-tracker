# Lobby Design for /play Page

**Date:** 2026-03-24
**Status:** Draft

## Problem

The /play page currently requires players to share game codes out-of-band (Discord, text) to find opponents. There's no way to see who's waiting for a game, browse open games, or quickly find a match. The page needs a lobby that provides discoverability, social presence, and matchmaking convenience without overcomplicating things.

## Design Summary

Add a two-tab layout to the /play page: **"Create / Join"** (today's flow, enhanced) and **"Open Games"** (live lobby list). Games can be public (visible in lobby) or private (code-only, like today). Lobby state lives in SpacetimeDB alongside existing game state, with real-time updates via subscriptions.

## Page Layout

The page structure becomes:

```
+-----------------------------------------------+
|              PLAY ONLINE (header)              |
+-----------------------------------------------+
|  [Deck Preview Card - shared across tabs]      |
|  First Animals (Copy) · 51 cards · [Change]    |
+-----------------------------------------------+
|  [ Create / Join ]  [ Open Games ]   (tabs)    |
+-----------------------------------------------+
|                                                |
|  (tab content area)                            |
|                                                |
+-----------------------------------------------+
```

The deck picker card stays above the tabs — it's relevant to both creating and joining games, so it remains a shared top-level element. This preserves the current deck selection UX exactly.

### Create / Join Tab

Same as today's UI with one addition to the "Create Game" flow:

- **"Public game" toggle** (default: on). When on, a text input appears for a **custom message** (optional, placeholder: e.g. "casual game, new players welcome"). When off, the game is private/code-only — identical to today's behavior.
- The join-by-code input and spectate input remain unchanged.

### Open Games Tab

A real-time list of public games waiting for an opponent. Each row displays:

| Field | Source | Notes |
|-------|--------|-------|
| Creator display name | `game.createdByName` | Denormalized at creation |
| Custom message | `game.lobbyMessage` | Optional, may be empty |
| Format | `game.format` | T1, T2, etc. |
| Time waiting | Derived from `game.createdAt` | Relative time, e.g. "3 min" |
| Join button | — | Triggers standard join flow |

**Real-time updates:** Games appear instantly when created, disappear when joined (status changes from `waiting` to `playing`). Powered by SpacetimeDB subscription.

**Empty state:** "No open games right now. Create one!" with a button/link that switches to the Create / Join tab.

**Joining from lobby:** Clicking "Join" on a lobby row triggers the same flow as today's join-by-code — calls `loadDeckForGame`, stores params in sessionStorage, navigates to `/play/[code]`. The player must have a deck selected (the shared deck picker above the tabs handles this).

## SpacetimeDB Data Model Changes

### New fields on `game` table

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `isPublic` | `boolean` | `true` | Whether the game appears in the lobby |
| `lobbyMessage` | `string` | `""` | Optional custom message from creator |
| `createdByName` | `string` | `""` | Creator's display name, denormalized for lobby display |

**Why denormalize `createdByName`?** The lobby subscription only needs the `game` table. Joining against the `player` table would require subscribing to all players across all games just to show names in the lobby. Denormalizing avoids this — the name is set once at creation and never changes.

**Schema migration note:** Adding columns to an existing SpacetimeDB table requires a `--clear-database` republish — SpacetimeDB does not support live schema migrations. This will wipe existing game data. Acceptable since games are ephemeral.

### Reducer changes

**`createGame`** — Add two new parameters:

- `is_public: boolean`
- `lobby_message: string`

These are written to the game row at creation. The creator's existing `displayName` parameter (currently only written to the `Player` row) is also written to `game.createdByName` as a new write target.

Client-side game code generation (in `GameLobby.tsx`) is intentionally preserved — no change to this flow.

No new reducers needed. Joining from the lobby uses the existing `joinGame(code, ...)` reducer — we already have the code from the lobby row.

### Lobby subscription

On the "Open Games" tab, subscribe to:

```sql
SELECT * FROM game WHERE status = 'waiting' AND is_public = true
```

This is a filtered subscription — only waiting public games are sent to the client. Games disappear from the subscription automatically when their status changes.

## Client-Side Integration

### SpacetimeDB connection on /play

Currently, the SpacetimeDB connection is only established on `/play/[code]`. For the lobby to work, we need a connection on `/play` itself.

Use the existing `useSpacetimeConnection` hook (from `app/play/hooks/useSpacetimeConnection.ts`) to build a connection, then wrap lobby content in the custom `SpacetimeProvider` (from `app/play/lib/spacetimedb-provider.tsx`). The lobby subscription is separate from the game-specific subscription in `/play/[code]/client.tsx` — the lobby only subscribes to `SELECT * FROM game WHERE status = 'waiting' AND is_public = true`, not to all 8 game tables. If the existing `useSpacetimeConnection` hook has game-specific logic, it may need minor refactoring to support a lobby-only connection.

The connection could be established eagerly (on page load) or lazily (when the Open Games tab is first selected). Lazy is slightly more efficient but eager keeps the lobby instantly populated.

**Recommendation:** Eager connection. The subscription is tiny (just waiting public games) and having the lobby populated when the user switches tabs feels better.

### Component structure

This is a refactor of the existing `GameLobby.tsx` — not a new component. The current create/join/spectate sections get wrapped in a tab layout, and the lobby list is added as a second tab.

```
/play/page.tsx (server component — fetches auth + decks, unchanged)
└── GameLobby.tsx (client component — refactored to add tabs)
    ├── Deck picker card (existing, shared above tabs)
    ├── SpacetimeProvider (wraps entire tab area for lobby subscription)
    ├── Tabs
    │   ├── "Create / Join" tab
    │   │   ├── Create Game section (existing + public toggle + message input)
    │   │   ├── Join by code section (existing)
    │   │   └── Spectate section (existing)
    │   └── "Open Games" tab
    │       └── LobbyList.tsx (new component)
    │           ├── Real-time game list rows
    │           └── Empty state
```

### LobbyList component

- Uses `useTable(tables.Game)` filtered client-side to `status === 'waiting' && isPublic === true`
- Renders rows with: display name, message, format, relative time, join button
- "Time waiting" is derived from `createdAt` — note that SpacetimeDB timestamps are `microsSinceUnixEpoch` BigInts, so conversion is `new Date(Number(row.createdAt.microsSinceUnixEpoch / 1000n))`. Re-rendered every ~30 seconds via a timer.
- Join button: validates deck is selected, then calls `loadDeckForGame`, stores sessionStorage params, navigates to `/play/[code]`

### Tab state

Managed via React state in `GameLobby`. Optionally persisted as a URL query param (`?tab=lobby`) for direct linking, but not required for v1.

## Edge Cases

- **No deck selected when joining from lobby:** Disable the Join button and show a hint to select a deck first.
- **Game fills while viewing lobby:** The game row disappears from the list in real-time (status changes). If the user somehow clicks Join on a stale row, the existing `joinGame` reducer already validates the game is still in `waiting` status and returns an error.
- **Creator disconnects while waiting:** The existing disconnect timeout (5 min) will eventually set the game to `finished`, removing it from the lobby. No new logic needed.
- **Many open games:** Unlikely given community size, but the list is a simple scrollable container. No pagination needed for v1.
- **Same user creates multiple public games:** The `createGame` reducer could optionally prevent this (one public game at a time per identity), but not required for v1.

## What This Does NOT Include

- Lobby chat / shoutbox
- Player profiles or friend lists
- Elo/rating display
- Matchmaking algorithm (auto-pairing)
- Challenge-a-player flow
- Game filtering/search in the lobby

These are all future possibilities but not in scope for this design.
