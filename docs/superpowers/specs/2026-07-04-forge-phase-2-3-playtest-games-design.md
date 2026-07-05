# Forge Phase 2.3 — Playtest Games (SpacetimeDB-isolated)

**Status:** approved by Tim 2026-07-04 (join mechanism: identity allowlist). Revised same day after
two-subagent review (security/leak-spine: SOUND-WITH-FIXES; feasibility: FEASIBLE-WITH-CHANGES) —
all findings folded in below.
**Branch:** `forge-phase-2-3-playtest-games` (stacked on `forge-deckbuild-parity`, PR #150).
**Parent spec:** `2026-06-19-forge-card-design-playtesting-design.md` § "SpacetimeDB isolation (Phase 2)".
**Prerequisites shipped:** 2.1 playtester access + grants, 2.2 mixed-pool deckbuilder + `forge_decks`,
approved-version art proxy (`/forge/api/art/[cardId]?v=approved[&kind=finished][&t=]`).

## Goal

A forge member (playtester, elder, or superadmin) selects a saved Forge deck and plays a
real-time 1v1 game on the existing `/play` engine against another forge member, such that:

1. **No forge card data — name, raw text, or art bytes — ever enters SpacetimeDB.** STDB rows
   carry only opaque UUIDs. (STDB tables are world-readable; this is the leak defense.)
2. **Only server-authorized forge members can occupy a seat** in a forge game (identity
   allowlist — game codes alone no longer grant entry, on ANY join path).
3. No spectators in forge games.

## Non-goals

Spectator support for forge games; republish notifications (Phase 2.4); public-pool promotion
(2.5); deck-swap rematch (v1 rematches with the same forge deck); pregame deck-change and
mid-game deck-reload inside forge games (blocked server-side in v1); brigade/type-aware server
*ability* logic for forge cards (raw-text cards have no structured fields post-descope; sandbox
philosophy — players drag manually; brigade-keyed reducers like `matthew_draw_brigades` still
no-op for forge cards since brigade stays empty); resolver-aware game-log rendering (forge cards
show blank names in the action log — cosmetic follow-up); retrofitting identity gating onto
public games.

## Key facts this design rests on (verified in code 2026-07-04)

- STDB identity is **not** bridged to Supabase: `useSpacetimeConnection.ts` connects with an
  anonymous localStorage token; `supabaseUserId` is a spoofable reducer arg. The module cannot
  verify forge membership itself — the Next.js server must vouch for identities.
- The deck pipeline has one write seam per entry path: `loadDeckForGame` (server action) builds
  `GameCardData[]` JSON that reducers pass to `insertCardsShuffleDraw`, which copies fields
  verbatim into public `CardInstance` rows. Entry paths that accept client deckData:
  `create_game`, `join_game`, `pregame_change_deck`, `request_rematch`/`respond_rematch`
  (stored in world-readable `Game.rematchDeckData0/1`), and mid-game `reload_deck`.
- Lobby handoff (corrected by review): `GameLobby` stashes params (`role`, `deckId`,
  `displayName`, `format`, `paragon`, …) in sessionStorage — **not** deckData — and navigates
  to `/play/[code]`; `client.tsx` loads deckData post-navigation via `loadDeckForGame(deckId)`
  (~line 240) and calls `createGame`/`joinGame` (~550-612). Rematch (`GameOverOverlay`) opens a
  deck picker and freshly calls `loadDeckForGame`. The client knows its `identityHex` after
  connect.
- The render pipeline: `cardInstanceToGameCard` (`app/play/utils/cardAdapter.ts`) via
  `useStableAdaptedCards` (two call sites in `useGameState.ts`: player + spectator views) plus
  three direct calls in `MultiplayerCanvas.tsx` (~404, 3234, 3304); images via
  `getCardImageUrl` (`app/shared/utils/cardImageUrl.ts` — already passes through leading-`/`
  URLs; returns `''` for "no image", not null) and the preloader
  (`app/play/lib/multiplayerImageUrls.ts` — skips falsy URLs); plus a deck-warmup memo in
  `client.tsx` (~269-286) that calls `getCardImageUrl` on raw deckData.
- Rematch (`respond_rematch`) resets the game **in place** with the already-seated identities —
  no new authorization needed; game id (and thus forge marker) survives.
- `join_as_spectator` already rejects private games; forge games are always private, so the
  explicit forge guard is defense-in-depth.
- Identity comparison idiom throughout the module is `ctx.sender.toHexString() === hex` (14
  sites). SDK is `spacetimedb` 2.3.0; `POST /v1/database/<db>/call/<reducer>` and
  `POST /v1/identity` exist on this stack.

## Design

### 1. STDB schema & reducers (all additive; existing table shapes and reducer signatures untouched)

**Why no `Game.isForge` column:** adding a column to the public `game` table changes the BSATN
row shape — deployed clients with stale bindings hit deserialization errors on their `game`
subscriptions the moment the module publishes, breaking live public games until the web deploy
completes. A separate marker table is invisible to old clients' explicit SQL subscriptions —
truly zero-impact.

**Why separate forge reducers:** changing `create_game`/`join_game` signatures would similarly
break deployed clients calling them.

- New **public** table `forge_game` — `{ gameId: t.u64().primaryKey() }`. A row marks its game
  as a forge game. (Content is one opaque id; public visibility is required so clients can
  branch behavior and the forge lobby can list open forge games.)
- New **private** table `forge_config` — singleton `{ id: t.u64().primaryKey(), serverIdentityHex: t.string() }`.
- New **private** table `forge_seat_auth` —
  `{ id: t.u64().primaryKey().autoInc(), code: t.string(), identityHex: t.string(), authorizedAt: t.timestamp() }`
  with btree index `{ accessor: 'seat_auth_code', columns: ['code'] }` (2.0 `accessor:` syntax).
  Private tables have no client visibility (repo SDK rules §7); a guardrail test asserts
  neither new private table declares `public: true`.
- A module constant `FORGE_OWNER_IDENTITY_HEX` (Tim's publisher identity hex — identity hexes
  are public information; only tokens are secrets, so baking it into the open-source module is
  safe). This is the unstealable recovery/admin principal.
- New reducers (identity args are `t.string()` hex — SATS-JSON identity encoding over the HTTP
  API is fragile; hex + `toHexString()` comparison is the codebase idiom):
  - `set_forge_server_identity({ identityHex })` — permitted when `forge_config` is empty
    (first-set-wins), OR `ctx.sender.toHexString()` equals the current `serverIdentityHex`,
    OR it equals `FORGE_OWNER_IDENTITY_HEX`. The owner override makes the first-set race
    non-fatal: even a lost race is recoverable without republish. Called immediately after
    every publish that resets the DB (prod first publish; every dev `--clear`); the deploy
    procedure **fails loudly** if the call throws and verifies the stored value via
    `spacetime sql` afterward. Fail-closed: while `forge_config` is empty, no auth rows can be
    minted, so forge games cannot be entered.
  - `forge_authorize_seat({ code, identityHex })` — sender must match `serverIdentityHex`;
    upserts a `forge_seat_auth` row for (code, identityHex) stamped `ctx.timestamp`; sweeps
    rows older than 10 minutes.
  - `create_forge_game(...)` — same args as `create_game` minus `isPublic`/`lobbyMessage`;
    requires a fresh (≤10 min) `forge_seat_auth` row matching `ctx.sender` + `code`, consumes
    it (single-use); validates deckData parses to a non-empty array (mirroring
    `pregame_change_deck`); runs the shared create core with `isPublic: false`, then inserts
    the `forge_game` marker row.
  - `join_forge_game(...)` — same args as `join_game`; target game must have a `forge_game`
    marker; requires + consumes a fresh auth row; validates deckData; shared join core.
- **Guards on existing reducers** (each looks up the `forge_game` marker by gameId and rejects
  with the same error a nonexistent game would produce — no oracle):
  - `join_game` (public path) — **the critical one**: without it, a code read off the public
    `game` table still seats an attacker via the old reducer, bypassing the allowlist.
  - `pregame_change_deck` and `reload_deck` — the deckData-accepting mutation paths the v1 UI
    disables must also be closed server-side.
  - `set_game_public` — a seated player must not be able to flip a forge game public (which
    would list it and re-open spectator entry).
  - `join_as_spectator` — defense-in-depth on top of the existing private-game rejection.
- `create_game`/`join_game` bodies are extracted into shared helpers (`createGameCore`,
  `joinGameCore`) so the public path stays behavior-identical.

### 2. Deck serialization — the leak spine

New server action module `app/forge/lib/playDecks.ts` (`"use server"`, `requireForge()` first
statement):

- `loadForgeDeckForGame(deckId)` — loads the caller's `forge_decks` row (owner-scoped RLS),
  hydrates entries via the existing `hydrateEntries` (revoked/unapproved forge refs are dropped
  — fail-closed), and serializes to the `GameCardData[]` shape:
  - public entries → full text, identical enrichment to `loadDeckForGame` (via `findCard`);
  - forge entries → **stub**: `{ cardName: '', cardSet: 'Forge', cardImgFile: 'forge:<uuid>',
    cardType: '<type display, LS for lost souls>', brigade: '', strength: '', toughness: '',
    alignment: '', identifier: '', reference: '', specialAbility: '', isReserve: zone === 'reserve' }`.
    Type strings are a deliberate, user-approved metadata relaxation (2026-07-04) so server-side
    lost-soul auto-routing works; names/text/art remain empty.
- **Paragon validation:** `Player.paragon` and `Game.rematchParagon0/1` are world-readable
  strings — the action validates the deck's paragon against the public paragon list and emits
  `''` otherwise, so a forge card name can never ride the paragon field.
- **Empty-deck rejection:** hydration can legitimately drop a deck to empty (revoked grant);
  the action rejects empty results with a user-facing error (`{ ok: false }` union — narrow
  with `r.ok === false` per the tsconfig `strict:false` gotcha).
- The serializer is a **pure function** (`buildForgePlayDeck`) unit-tested to assert forge
  stubs contain no non-empty text field other than `cardSet: 'Forge'` and the `forge:` URI,
  and that the paragon-validation and empty-deck rules hold. The same serialized shape is what
  the client re-sends on rematch, so the test covers that path by construction.

No STDB `CardInstance` schema change: the UUID rides the existing `cardImgFile` column;
`insertCardsShuffleDraw` copies stubs verbatim.

### 3. Client resolver — the render seam

- New server action `getForgePlayResolver()` (`requireForge` first): returns the viewer's
  granted approved cards as `{ id, name, rawText, hasFinished, hasArt, approvedVersionId }[]`
  (reuses the 2.1/2.2 granted-pool loaders; booleans + version id only — no blob keys;
  `approvedVersionId` is the immutable `?t=` cache stamp). Non-members get an empty result.
- `/play/[code]` client: when the game is forge (marker row, or `isForge` handoff param), fetch
  the resolver once into a `Map<uuid, entry>`.
- `cardInstanceToGameCard` gains an optional resolver argument. For rows whose `cardImgFile`
  starts with `forge:`: merge `cardName = name`, `specialAbility = rawText`, and rewrite
  `cardImgFile` to the proxy URL — `/forge/api/art/<uuid>?v=approved&kind=finished&t=<vid>`
  when `hasFinished`, else `?v=approved&t=<vid>` when `hasArt`, else leave the `forge:` URI
  (downstream renders a labeled placeholder). Resolver threads through **all** call sites:
  `useStableAdaptedCards` (both `useGameState.ts` views — resolver becomes part of the
  `useGameState` API and a memo dependency) and the three direct `MultiplayerCanvas.tsx` calls.
- `getCardImageUrl`: add `forge:` → `''` (the established "no image" value — this also stops
  the deck-warmup memo 404-spamming the blob CDN with `forge:` names). Resolved `/forge/api/…`
  URLs already pass through the existing leading-`/` branch. Fix `getCardImageUrlOrNull`,
  which lacks that branch and would mangle proxy URLs. The deck-warmup memo and the preloader
  (`multiplayerImageUrls.ts`) get the same small resolution helper so forge art preloads
  through the proxy (immutable-cacheable via `?t=`) and unresolved URIs are skipped.
- `CardPreviewSystem`, right panel, context menus, zone search, opponent hand all consume
  `GameCard` downstream of the adapter — name + raw text appear automatically. The waiting
  room path (`client.tsx` parses deckData → `convertToGoldfishDeck` → `WaitingRoomGoldfish`)
  applies the merge helper to the parsed `GameCardData[]` first (aggregation keys on
  `cardImgFile`, so distinct `forge:<uuid>` values stay distinct).
- **Expected behavior (fail-closed, by design):** the resolver returns only the *viewer's*
  granted cards and the art proxy is per-viewer RLS — if the opponent plays cards from a set
  the viewer isn't granted, the viewer sees opaque placeholders mid-game.

### 4. Entry flow & lobby

- The desk "Find a game" tile (playtester branch, currently disabled placeholder) goes live →
  **new forge-gated page `/forge/play/games`** (`requireForge` first statement; gate-first scan
  auto-covers it):
  - **Create:** pick one of your `forge_decks` (existing `listForgeDecks`), same code
    generation as the public lobby, always private.
  - **Join:** enter a code.
  - **Open games list:** client-side STDB subscription over `forge_game` + `game`, joined
    client-side, filtered to waiting games — rendered only on this members-only page. Listing
    codes is safe: a code no longer grants a seat on any path.
  - Handoff mirrors `GameLobby`: sessionStorage params gain `isForge: true`, then navigate to
    `/play/[code]`.
- `/play/[code]` `client.tsx` forge branch — two insertion points:
  1. Deck load (~line 240): `isForge` → `loadForgeDeckForGame(deckId)` instead of
     `loadDeckForGame`.
  2. Reducer calls (~550-612): after connect (identity known), call the new server action
     `authorizeForgeSeat({ code, identityHex })` — `requireForge`, then POST to the STDB HTTP
     API (`/v1/database/<db>/call/forge_authorize_seat`) with the server token, and log
     `(supabase user_id, code, identityHex)` server-side for audit attribution — then call
     `createForgeGame`/`joinForgeGame`. Authorization failure surfaces via the existing
     lifecycle error UI with retry.
- Public `/play` lobby: forge games are excluded by `isPublic: false` (existing filter).
- **Rematch (v1 = same deck):** `GameOverOverlay` gets a forge branch — skip the deck picker,
  call `loadForgeDeckForGame(myPlayer.deckId)` (fresh hydration; if the deck has been
  revoked/emptied since, surface the error). Deck-swap rematch deferred.
- Pregame deck-change and mid-game reload-deck: UI hidden/disabled in forge games; reducers
  reject regardless (§1 guards).

### 5. Security analysis

World-readable STDB surface for a forge game (all opaque or already-public-shaped):

| Surface | Content | Verdict |
|---|---|---|
| `Game` row | code, display names, format, timestamps | no card data |
| `Game.rematchDeckData0/1` | stub JSON re-sent at rematch | UUID-only (serializer-enforced; unit-tested) |
| `Game.rematchParagon0/1`, `Player.paragon` | paragon name | validated against public paragon list, else `''` |
| `forge_game` row | game id | opaque |
| `Player` rows | displayName, supabaseUserId (public today for all games), forge deck UUID, `pendingDeckData` stubs | UUID-only |
| `CardInstance` rows | zones/positions + `forge:<uuid>` + `cardSet:'Forge'` + type string (approved metadata relaxation) | UUID-only |
| `GameAction` log | payloads built from row fields (verified row-sourced across all `logAction` call sites; empty for forge cards; tokens/Paragon souls come from public registries) | UUID/empty |
| `ChatMessage` / card `notes` | member-typed text | NDA'd members; same trust as today |

- Seat authorization: only identities vouched for by a `requireForge`-gated server action
  within a 10-minute window; rows single-use; enforced on **every** seat path (`create_forge_game`,
  `join_forge_game`) with the public `join_game` hard-rejecting forge games. Reconnects don't
  re-join (already-seated identities skip create/join in `client.tsx` and STDB tokens persist
  in localStorage), so no second auth row is needed.
- `imitate_lost_soul` cannot launder forge names: source must be a registry Imitate card and
  targets are validated via `reference` (empty for forge stubs → rejected); `imitatingName`
  copies a row field that is empty for forge cards.
- A forge member *can* authorize an arbitrary identity (accomplice) — accepted within the NDA
  trust model (equivalent to screen-sharing); the audit log attributes every authorization to
  a Supabase user.
- The art proxy is unchanged: per-request `requireForge` + RLS lookup; `?v=approved` serves
  only frozen approved images.
- This design **supersedes the parent spec's "short-lived minted join token"** wording with an
  identity allowlist via trusted server identity — same intent, stronger binding (identity
  rather than bearer string). Approved by Tim 2026-07-04.

### 6. Env & deploy

- New server-only env: `SPACETIMEDB_SERVER_TOKEN` (minted via `POST /v1/identity` on the STDB
  host; set in `.env.local` + Vercel). HTTP base URL derived from
  `NEXT_PUBLIC_SPACETIMEDB_HOST` (`ws(s)://` → `http(s)://`).
- Module publish via the `spacetimedb-deploy` skill (regen bindings). Dev module may need
  `--clear` (known index-panic gotcha) — **every `--clear` wipes `forge_config`; re-run
  `set_forge_server_identity` immediately after, fail loudly on error, verify via
  `spacetime sql`.** Prod: additive publish → set server identity (same fail-loud + verify) →
  deploy web.
- Publish order is safe for live games: new tables + reducers are additive; **no existing
  table's row shape changes** (that's the point of the marker table) and public reducer
  signatures are unchanged.
- `FORGE_OWNER_IDENTITY_HEX` constant: read Tim's publisher identity hex from the local
  `spacetime` CLI login at implementation time.

### 7. Testing

- **Unit:** pure deck serializer (leak assertion incl. paragon + empty-deck rules), adapter
  merge (resolved / unresolved / memo-invalidation), `getCardImageUrl` `forge:`→`''` +
  `getCardImageUrlOrNull` passthrough, authorize action gating (mocked fetch), preloader and
  warmup skip/resolve behavior.
- **Guardrails:** `/forge/play/games` auto-covered by the gate-first scan; new scan asserting
  `forge_config`/`forge_seat_auth` never declare `public: true`; new server actions follow the
  `requireForge`-first convention.
- **e2e (Playwright, `e2e/forge/`, existing `chromium-desktop`/`chromium-mobile` projects):**
  anon → 404 on `/forge/play/games`; member sees the lobby. Full two-client game is out of CI
  scope — final signed-in two-account smoke is manual (established pattern).
- **Module smoke (dev):** anon `join_game` against a forge game fails; `join_forge_game`
  without auth row fails; with auth row succeeds; `set_game_public`/`pregame_change_deck`/
  `reload_deck`/`join_as_spectator` reject forge games.

## Rollout

1. STDB module changes + dev publish + bindings regen; module smoke.
2. Server actions + serializer unit tests.
3. Client resolver + adapter/image seams + waiting room.
4. Forge lobby page + desk tile + `client.tsx` forge path + rematch branch.
5. Env minting + `set_forge_server_identity` + Vercel env.
6. Whole-branch review; build + test gates; PR stacked on #150; prod publish + identity set;
   manual two-account smoke by Tim.
