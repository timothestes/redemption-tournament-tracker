# Forge Phase 2.3 — Playtest Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forge members select saved Forge decks and play 1v1 playtest games on the existing `/play` engine with UUID-only card data in SpacetimeDB and identity-allowlisted seats.

**Architecture:** Forge cards enter SpacetimeDB only as `forge:<uuid>` stubs (existing `cardImgFile` column; zero CardInstance schema change); a client-side resolver (RLS-gated server action) merges name/rawText/art-proxy-URLs at the single adapter seam. Seats are gated by a `forge_seat_auth` allowlist written by the Next.js server (trusted via `forge_config` server identity) over SpacetimeDB's HTTP API. A `forge_game` marker table (never a `game` column — avoids BSATN row-shape breakage for live clients) flags forge games; five existing reducers gain marker-based guards.

**Tech Stack:** SpacetimeDB TS SDK 2.3.0 (module + React client), Next.js 15 server actions, Supabase RLS (no new migrations), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-04-forge-phase-2-3-playtest-games-design.md` — read it first; its §5 security table is the acceptance contract.

## Global Constraints

- **Leak spine:** no forge card name/rawText/art may appear in any STDB reducer arg or column; forge stubs carry only `cardSet:'Forge'` + `cardImgFile:'forge:<uuid>'`, all other text fields `''`.
- Every new `app/forge/**` page/route calls `requireForge()` (or stricter) as its FIRST statement; 404 via `notFound()`, never 403. (`__tests__/forge-gate-first.test.ts` enforces.)
- NO `next/image` anywhere under `app/forge/**` (`__tests__/forge-no-next-image.test.ts` enforces); plain `<img>` only.
- tsconfig has `strict:false`: narrow `{ok:true}|{ok:false}` unions with `r.ok === false` (NEVER `if (r.ok)/else` — broken narrowing, only `npm run build` catches it).
- STDB module: BigInt literals (`0n`), index `accessor:` syntax (2.0), index accessors used verbatim and module-unique, `.insert({id: 0n, ...})` for autoInc, update via spread of existing row. Follow `spacetimedb/CLAUDE.md`.
- Public reducer signatures (`create_game`, `join_game`, etc.) and existing table shapes MUST NOT change.
- No new npm dependencies.
- UI: Tailwind tokens + shadcn patterns; no `focus:ring-2` on form controls; green accent reserved for hover/CTA (not resting text).
- Dev commands: `npx vitest run <file>` for single test files, `npm test` full, `npm run build` for typecheck.

---

### Task 1: STDB schema — `forge_game`, `forge_config`, `forge_seat_auth` tables

**Files:**
- Modify: `spacetimedb/src/schema.ts` (add three tables after the `Emote` table ~line 415, and register them in the `schema({...})` export at the bottom)

**Interfaces:**
- Produces: `ForgeGame` (public, `{gameId: u64 pk}`), `ForgeConfig` (PRIVATE, `{id: u64 pk, serverIdentityHex: string}`), `ForgeSeatAuth` (PRIVATE, `{id pk autoInc, code, identityHex, authorizedAtMicros: u64}`, btree index `seat_auth_code` on `code`). Accessed in reducers as `ctx.db.ForgeGame` / `ctx.db.ForgeConfig` / `ctx.db.ForgeSeatAuth`.

- [ ] **Step 1: Add the three table definitions** to `spacetimedb/src/schema.ts` (insert after the `Emote` table definition, before the CleanupSchedule section):

```typescript
// ---------------------------------------------------------------------------
// 13. ForgeGame (public marker — a row flags its game as a Forge playtest game)
//     Deliberately a separate table, NOT a Game column: adding a column would
//     change the game row's BSATN shape and break deployed clients' game
//     subscriptions during the publish window.
// ---------------------------------------------------------------------------
export const ForgeGame = table(
  { name: 'forge_game', public: true },
  {
    gameId: t.u64().primaryKey(),
  }
);

// ---------------------------------------------------------------------------
// 14. ForgeConfig (PRIVATE singleton — trusted server identity)
//     NO `public: true` — this table must never be client-visible.
// ---------------------------------------------------------------------------
export const ForgeConfig = table(
  { name: 'forge_config' },
  {
    id: t.u64().primaryKey(),
    serverIdentityHex: t.string(),
  }
);

// ---------------------------------------------------------------------------
// 15. ForgeSeatAuth (PRIVATE allowlist — one row = one pending seat grant)
//     NO `public: true` — this table must never be client-visible.
// ---------------------------------------------------------------------------
export const ForgeSeatAuth = table(
  {
    name: 'forge_seat_auth',
    indexes: [{ accessor: 'seat_auth_code', algorithm: 'btree' as const, columns: ['code'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string(),
    identityHex: t.string(),
    authorizedAtMicros: t.u64(),
  }
);
```

- [ ] **Step 2: Register the tables** in the `schema({...})` call at the bottom of `schema.ts` — add `ForgeGame, ForgeConfig, ForgeSeatAuth,` after `CleanupSchedule,`.

- [ ] **Step 3: Typecheck the module**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: no errors (same baseline as before the change).

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/schema.ts
git commit -m "feat(forge/stdb): forge_game marker + private forge_config/forge_seat_auth tables"
```

---

### Task 2: STDB reducers — allowlist, forge create/join, guards on five existing reducers

**Files:**
- Modify: `spacetimedb/src/index.ts`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces: reducers `set_forge_server_identity({identityHex: string})`, `forge_authorize_seat({code: string, identityHex: string})`, `create_forge_game({code, deckId, displayName, paragon, format, supabaseUserId, deckData})`, `join_forge_game(same args)`. Client bindings will expose `conn.reducers.createForgeGame(...)` / `joinForgeGame(...)`. Guards added to `join_game`, `join_as_spectator`, `pregame_change_deck`, `reload_deck`, `set_game_public`.

- [ ] **Step 1: Capture the owner identity hex.** Run:

```bash
spacetime login show --token 2>/dev/null | head -2; spacetime login show
```

Copy the identity hex (64 hex chars, possibly displayed with or without `0x`). Normalize to the exact format `Identity.toHexString()` produces — check an existing comparison: the module compares `ban.identity.toHexString() === ctx.sender.toHexString()` (index.ts:1507); log or `spacetime sql <db> "SELECT ..."` if unsure. If `spacetime login show` reports not logged in, STOP and report — the deploy owner must be logged in on this machine.

- [ ] **Step 2: Add constants + helpers** near the top of `spacetimedb/src/index.ts` (after the `HAND_LIMIT` constant ~line 30):

```typescript
// ---------------------------------------------------------------------------
// Forge playtest games (Phase 2.3)
// ---------------------------------------------------------------------------
// Publisher/owner identity — the unstealable recovery principal for
// set_forge_server_identity. Identity hexes are public info (only tokens are
// secrets), so baking it into the open-source module is safe.
const FORGE_OWNER_IDENTITY_HEX = '<PASTE FROM STEP 1>';

const FORGE_AUTH_TTL_MICROS = 600_000_000n; // 10 minutes

function isForgeGame(ctx: any, gameId: bigint): boolean {
  return ctx.db.ForgeGame.gameId.find(gameId) !== undefined;
}

function forgeServerIdentityHex(ctx: any): string {
  const cfg = ctx.db.ForgeConfig.id.find(0n);
  return cfg ? cfg.serverIdentityHex : '';
}

// Single-use: consumes a fresh seat authorization for (ctx.sender, code).
// Throws when absent or stale. Opportunistically sweeps expired rows.
function consumeForgeSeatAuth(ctx: any, code: string) {
  const senderHex = ctx.sender.toHexString();
  const now = ctx.timestamp.microsSinceUnixEpoch;
  let match: any = null;
  for (const row of [...ctx.db.ForgeSeatAuth.seat_auth_code.filter(code)]) {
    if (now - row.authorizedAtMicros > FORGE_AUTH_TTL_MICROS) {
      ctx.db.ForgeSeatAuth.id.delete(row.id);
      continue;
    }
    if (row.identityHex === senderHex) match = row;
  }
  if (!match) throw new SenderError('Not authorized for this playtest game');
  ctx.db.ForgeSeatAuth.id.delete(match.id);
}

// Shared deckData sanity check for the forge entry paths (mirrors
// pregame_change_deck's validation).
function assertValidDeckData(deckData: string) {
  try {
    const parsed = JSON.parse(deckData);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not array or empty');
  } catch {
    throw new SenderError('Invalid deck data');
  }
}
```

- [ ] **Step 3: Extract `createGameCore` / `joinGameCore`.** Refactor `create_game` (index.ts:532) and `join_game` (index.ts:619) so each reducer body becomes a thin call into a helper carrying an `isForge` flag. The helpers contain the EXACT existing bodies with only these deltas:

```typescript
function createGameCore(
  ctx: any,
  args: { code: string; deckId: string; displayName: string; paragon: string;
          format: string; supabaseUserId: string; deckData: string;
          isPublic: boolean; lobbyMessage: string },
  isForge: boolean,
) {
  // ... existing create_game body verbatim, with:
  //   - `isPublic: isForge ? false : args.isPublic` in the Game insert
  //   - after the Game insert:  if (isForge) ctx.db.ForgeGame.insert({ gameId: game.id });
}

function joinGameCore(
  ctx: any,
  args: { code: string; deckId: string; displayName: string; paragon: string;
          format: string; supabaseUserId: string; deckData: string },
  isForge: boolean,
) {
  // ... existing join_game body verbatim, with ONE addition right after the
  // waiting-game lookup succeeds (after `if (!game) throw ...`):
  //
  //   // Forge games are joinable only via join_forge_game (allowlist path),
  //   // and forge joins must not land on public games. Same error as a
  //   // nonexistent game — no oracle.
  //   if (isForgeGame(ctx, game.id) !== isForge) {
  //     throw new SenderError('No waiting game found with that code');
  //   }
}

export const create_game = spacetimedb.reducer(
  { code: t.string(), deckId: t.string(), displayName: t.string(), paragon: t.string(),
    format: t.string(), supabaseUserId: t.string(), deckData: t.string(),
    isPublic: t.bool(), lobbyMessage: t.string() },
  (ctx, args) => { createGameCore(ctx, args, false); }
);

export const join_game = spacetimedb.reducer(
  { code: t.string(), deckId: t.string(), displayName: t.string(), paragon: t.string(),
    format: t.string(), supabaseUserId: t.string(), deckData: t.string() },
  (ctx, args) => { joinGameCore(ctx, args, false); }
);
```

The refactor must be mechanical — move the body, do not "improve" it. Public behavior must stay byte-identical apart from the forge marker check.

- [ ] **Step 4: Add the four new reducers** (place after `join_game`):

```typescript
// ---------------------------------------------------------------------------
// Forge playtest reducers
// ---------------------------------------------------------------------------
export const set_forge_server_identity = spacetimedb.reducer(
  { identityHex: t.string() },
  (ctx, { identityHex }) => {
    const senderHex = ctx.sender.toHexString();
    const cfg = ctx.db.ForgeConfig.id.find(0n);
    if (cfg) {
      if (senderHex !== cfg.serverIdentityHex && senderHex !== FORGE_OWNER_IDENTITY_HEX) {
        throw new SenderError('Not authorized');
      }
      ctx.db.ForgeConfig.id.update({ ...cfg, serverIdentityHex: identityHex });
    } else {
      // First-set-wins: the deploy procedure calls this immediately after any
      // publish that reset the DB; the owner override above makes a lost race
      // recoverable without a republish.
      ctx.db.ForgeConfig.insert({ id: 0n, serverIdentityHex: identityHex });
    }
  }
);

export const forge_authorize_seat = spacetimedb.reducer(
  { code: t.string(), identityHex: t.string() },
  (ctx, { code, identityHex }) => {
    const server = forgeServerIdentityHex(ctx);
    if (!server || ctx.sender.toHexString() !== server) {
      throw new SenderError('Not authorized');
    }
    const now = ctx.timestamp.microsSinceUnixEpoch;
    // Upsert: replace any existing row for this identity, sweep stale rows.
    for (const row of [...ctx.db.ForgeSeatAuth.seat_auth_code.filter(code)]) {
      if (row.identityHex === identityHex || now - row.authorizedAtMicros > FORGE_AUTH_TTL_MICROS) {
        ctx.db.ForgeSeatAuth.id.delete(row.id);
      }
    }
    ctx.db.ForgeSeatAuth.insert({ id: 0n, code, identityHex, authorizedAtMicros: now });
  }
);

export const create_forge_game = spacetimedb.reducer(
  { code: t.string(), deckId: t.string(), displayName: t.string(), paragon: t.string(),
    format: t.string(), supabaseUserId: t.string(), deckData: t.string() },
  (ctx, args) => {
    consumeForgeSeatAuth(ctx, args.code);
    assertValidDeckData(args.deckData);
    createGameCore(ctx, { ...args, isPublic: false, lobbyMessage: '' }, true);
  }
);

export const join_forge_game = spacetimedb.reducer(
  { code: t.string(), deckId: t.string(), displayName: t.string(), paragon: t.string(),
    format: t.string(), supabaseUserId: t.string(), deckData: t.string() },
  (ctx, args) => {
    consumeForgeSeatAuth(ctx, args.code);
    assertValidDeckData(args.deckData);
    joinGameCore(ctx, args, true);
  }
);
```

- [ ] **Step 5: Guard four more existing reducers.** Add these lines (each right after the reducer's game lookup succeeds):

In `join_as_spectator` (index.ts:1491, after `if (!game) throw ...`):
```typescript
    // Forge playtest games never accept spectators (defense-in-depth — they
    // are also always private). Same error as a nonexistent game.
    if (isForgeGame(ctx, game.id)) throw new SenderError('No game found with that code');
```

In `pregame_change_deck` (index.ts:1073, after `if (!game) throw ...`):
```typescript
    if (isForgeGame(ctx, gameId)) throw new SenderError('Deck change is disabled in playtest games');
```

In `reload_deck` (index.ts:5305, after its game lookup):
```typescript
    if (isForgeGame(ctx, gameId)) throw new SenderError('Deck reload is disabled in playtest games');
```

In `set_game_public` (index.ts:1701, after `if (!game) throw ...`):
```typescript
    if (isForgeGame(ctx, gameId)) throw new SenderError('Playtest games are always private');
```

- [ ] **Step 6: Typecheck**

Run: `cd spacetimedb && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(forge/stdb): identity-allowlisted forge create/join + guards on public seat/deck paths"
```

---

### Task 3: Publish dev module, regenerate bindings, module smoke

**Files:**
- Modify: `lib/spacetimedb/module_bindings/*` (generated — do not hand-edit)

**Interfaces:**
- Produces: regenerated client bindings exposing `tables.ForgeGame`, `conn.reducers.createForgeGame/joinForgeGame/setForgeServerIdentity/forgeAuthorizeSeat`.

- [ ] **Step 1: Invoke the `spacetimedb-deploy` skill** (mandatory for any module change). Publish the DEV module and regenerate TypeScript bindings per the skill. If publish hits the known "No such index" panic on connect, use the skill's `--clear` dev republish path.

- [ ] **Step 2: Seed the dev server identity (owner-as-server for smoke).** Using the CLI (owner identity):

```bash
spacetime call <dev-db-name> set_forge_server_identity '["<OWNER_IDENTITY_HEX>"]'
spacetime sql <dev-db-name> "SELECT * FROM forge_config"
```

Expected: one row, `serverIdentityHex` = owner hex. (If the CLI arg encoding rejects the JSON array form, try `'{"identityHex": "..."}'` — record which form works; Task 6's HTTP call uses the same wire format.)

- [ ] **Step 3: Smoke the allowlist path via CLI:**

```bash
# unauthorized create must fail
spacetime call <dev-db-name> create_forge_game '["ZZZ9","d1","Smoke","",  "Type 1","u1","[{\"cardName\":\"\"}]"]' ; echo "exit=$?"
# authorize self, then create succeeds
spacetime call <dev-db-name> forge_authorize_seat '["ZZZ9","<OWNER_IDENTITY_HEX>"]'
spacetime call <dev-db-name> create_forge_game '["ZZZ9","d1","Smoke","","Type 1","u1","[{\"cardName\":\"\"}]"]'
spacetime sql <dev-db-name> "SELECT * FROM forge_game"
spacetime sql <dev-db-name> "SELECT code, status, is_public FROM game WHERE code = 'ZZZ9'"
# public join into the forge game must fail
spacetime call <dev-db-name> join_game '["ZZZ9","d2","Rando","","Type 1","u2","[{\"cardName\":\"\"}]"]' ; echo "exit=$?"
```

Expected: first call errors "Not authorized for this playtest game"; create succeeds with a `forge_game` row and `is_public=false`; final `join_game` errors "No waiting game found with that code".

- [ ] **Step 4: Commit the regenerated bindings**

```bash
git add lib/spacetimedb/module_bindings
git commit -m "chore(stdb): regenerate bindings for forge playtest tables/reducers"
```

---

### Task 4: Pure serializer — `buildForgePlayDeck` + paragon sanitizer (TDD)

**Files:**
- Create: `app/forge/lib/playSerialize.ts`
- Test: `app/forge/lib/__tests__/playSerialize.test.ts`

**Interfaces:**
- Consumes: `ForgeDeckEntry` from `app/forge/lib/deckTypes` (`{source:'forge',cardId,qty,zone} | {source:'public',name,set,qty,zone}`), `findCard` from `@/lib/cards/lookup`, `getParagonByName` from `@/app/decklist/card-search/data/paragons`, `GameCardData` (type-only) from `@/app/play/actions`.
- Produces: `buildForgePlayDeck(entries, isGranted): { deckData: GameCardData[]; dropped: number }` and `sanitizeParagon(p: string | null | undefined): string`. Used by Task 5.

- [ ] **Step 1: Write the failing tests** (`app/forge/lib/__tests__/playSerialize.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { buildForgePlayDeck, sanitizeParagon } from "../playSerialize";
import type { ForgeDeckEntry } from "../deckTypes";

const FORGE_ID = "11111111-2222-3333-4444-555555555555";

describe("buildForgePlayDeck", () => {
  it("serializes forge entries as opaque stubs with zero text fields", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 2, zone: "main" },
    ];
    const { deckData, dropped } = buildForgePlayDeck(entries, () => true);
    expect(dropped).toBe(0);
    expect(deckData).toHaveLength(2);
    for (const c of deckData) {
      expect(c.cardImgFile).toBe(`forge:${FORGE_ID}`);
      expect(c.cardSet).toBe("Forge");
      expect(c.isReserve).toBe(false);
      // THE LEAK ASSERTION: every other field is empty.
      for (const key of ["cardName","cardType","brigade","strength","toughness","alignment","identifier","reference","specialAbility"] as const) {
        expect(c[key]).toBe("");
      }
    }
  });

  it("drops ungranted forge entries (fail-closed) and counts them", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 3, zone: "main" },
    ];
    const { deckData, dropped } = buildForgePlayDeck(entries, () => false);
    expect(deckData).toHaveLength(0);
    expect(dropped).toBe(3);
  });

  it("marks reserve-zone entries and skips maybeboard", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "reserve" },
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "maybeboard" as any },
    ];
    const { deckData } = buildForgePlayDeck(entries, () => true);
    expect(deckData).toHaveLength(1);
    expect(deckData[0].isReserve).toBe(true);
  });

  it("serializes public entries with full enrichment (real card from the registry)", () => {
    // 'Son of God' exists in every Redemption card registry snapshot.
    const entries: ForgeDeckEntry[] = [
      { source: "public", name: "Son of God", set: "Promo", qty: 1, zone: "main" },
    ];
    const { deckData } = buildForgePlayDeck(entries, () => true);
    expect(deckData).toHaveLength(1);
    expect(deckData[0].cardName).toBe("Son of God");
    expect(deckData[0].cardImgFile).not.toContain("forge:");
  });
});

describe("sanitizeParagon", () => {
  it("passes a real paragon through and blanks everything else", () => {
    expect(sanitizeParagon(null)).toBe("");
    expect(sanitizeParagon("Totally Not A Paragon (unreleased card name)")).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/playSerialize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `app/forge/lib/playSerialize.ts`:

```typescript
// Pure serializer for forge play decks. LEAK SPINE: forge entries become
// opaque stubs — the UUID rides cardImgFile as `forge:<uuid>`; every text
// field stays ''. Public entries get the same enrichment loadDeckForGame uses.
import { findCard } from "@/lib/cards/lookup";
import { getParagonByName } from "@/app/decklist/card-search/data/paragons";
import type { ForgeDeckEntry } from "./deckTypes";
import type { GameCardData } from "@/app/play/actions";

export function buildForgePlayDeck(
  entries: ForgeDeckEntry[],
  isGranted: (cardId: string) => boolean,
): { deckData: GameCardData[]; dropped: number } {
  const deckData: GameCardData[] = [];
  let dropped = 0;
  for (const e of entries) {
    if (e.zone !== "main" && e.zone !== "reserve") continue; // game sees main + reserve only
    const isReserve = e.zone === "reserve";
    if (e.source === "forge") {
      if (!isGranted(e.cardId)) { dropped += e.qty; continue; }
      for (let i = 0; i < e.qty; i++) {
        deckData.push({
          cardName: "", cardSet: "Forge", cardImgFile: `forge:${e.cardId}`,
          cardType: "", brigade: "", strength: "", toughness: "", alignment: "",
          identifier: "", reference: "", specialAbility: "", isReserve,
        });
      }
    } else {
      const enriched = findCard(e.name, e.set);
      for (let i = 0; i < e.qty; i++) {
        deckData.push({
          cardName: e.name, cardSet: e.set,
          cardImgFile: enriched?.imgFile || "",
          cardType: enriched?.type || "", brigade: enriched?.brigade || "",
          strength: enriched?.strength || "", toughness: enriched?.toughness || "",
          alignment: enriched?.alignment || "", identifier: enriched?.identifier || "",
          reference: enriched?.reference || "", specialAbility: enriched?.specialAbility || "",
          isReserve,
        });
      }
    }
  }
  return { deckData, dropped };
}

// Player.paragon / Game.rematchParagon* are world-readable STDB strings —
// only names from the public paragon registry may pass through.
export function sanitizeParagon(paragon: string | null | undefined): string {
  if (!paragon) return "";
  return getParagonByName(paragon) ? paragon : "";
}
```

If `findCard`'s enrichment field names differ (check `lib/cards/lookup.ts` `CardData` — mirror EXACTLY what `app/play/actions.ts:82-97` does), fix here, not there.

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/forge/lib/__tests__/playSerialize.test.ts`
Expected: PASS (all 5). Also run `npx vitest run __tests__/forge-gate-first.test.ts` — pure lib files are exempt, must stay green.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/playSerialize.ts app/forge/lib/__tests__/playSerialize.test.ts
git commit -m "feat(forge): pure play-deck serializer — UUID-only stubs, paragon sanitizer (TDD)"
```

---

### Task 5: Server actions — `loadForgeDeckForGame`, `getForgePlayResolver`, `authorizeForgeSeat`

**Files:**
- Create: `app/forge/lib/playDecks.ts`
- Create: `app/forge/lib/stdbHttp.ts`
- Modify: `app/forge/lib/play.ts` (add `versionId` to `RevealCard`)
- Modify: `app/forge/lib/deckPool.ts` (thread `versionId` through `GrantedForgeCard`)
- Test: `app/forge/lib/__tests__/stdbHttp.test.ts`

**Interfaces:**
- Consumes: Task 4 (`buildForgePlayDeck`, `sanitizeParagon`), `requireForge` from `./auth`, `getForgeDeck` from `./forgeDecks`, `listGrantedForgeCards` from `./deckPool`, `cardRawText` from `./designCard`.
- Produces (consumed by Tasks 7-9):
  - `loadForgeDeckForGame(deckId: string): Promise<{ok:true; deck:{id;name;format;paragon}; deckData: GameCardData[]; dropped:number} | {ok:false; error:string}>`
  - `getForgePlayResolver(): Promise<ForgePlayResolverEntry[]>` where `ForgePlayResolverEntry = {cardId; name; rawText; hasFinished; hasArt; versionId}`
  - `authorizeForgeSeat(input: {code: string; identityHex: string}): Promise<{ok:true} | {ok:false; error:string}>`
  - `stdbHttpBase(wsHost: string): string` (pure)

- [ ] **Step 1: Write the failing test** `app/forge/lib/__tests__/stdbHttp.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { stdbHttpBase } from "../stdbHttp";

describe("stdbHttpBase", () => {
  it("maps ws->http, wss->https, strips trailing slash", () => {
    expect(stdbHttpBase("ws://localhost:3000")).toBe("http://localhost:3000");
    expect(stdbHttpBase("wss://maincloud.spacetimedb.com/")).toBe("https://maincloud.spacetimedb.com");
    expect(stdbHttpBase("https://already.example")).toBe("https://already.example");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/stdbHttp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `app/forge/lib/stdbHttp.ts`:

```typescript
// Pure URL helper for SpacetimeDB's HTTP API. The token itself is read only
// inside server actions — never import process.env here.
export function stdbHttpBase(wsHost: string): string {
  return wsHost
    .replace(/^ws:\/\//, "http://")
    .replace(/^wss:\/\//, "https://")
    .replace(/\/+$/, "");
}
```

Run: `npx vitest run app/forge/lib/__tests__/stdbHttp.test.ts` → PASS.

- [ ] **Step 4: Add `versionId` to the reveal path.** In `app/forge/lib/play.ts`: extend the type and mapping —

```typescript
export type RevealCard = { cardId: string; data: DesignCard; hasApprovedArt: boolean; hasApprovedFinished: boolean; versionId: string };
```

and in the return mapping add `versionId: v.id as string,`. In `app/forge/lib/deckPool.ts`: add `versionId: string;` to `GrantedForgeCard` and `versionId: c.versionId,` to the push. Run `npx vitest run app/forge` to confirm nothing existing breaks (existing consumers ignore the extra field).

- [ ] **Step 5: Implement** `app/forge/lib/playDecks.ts`:

```typescript
"use server";
// Forge playtest game server actions. Every export gates with requireForge()
// FIRST. LEAK SPINE: deckData leaving here carries forge cards only as
// forge:<uuid> stubs (see playSerialize.ts); the resolver returns granted
// card text to members only and never a blob key.
import { requireForge } from "@/app/forge/lib/auth";
import { getForgeDeck } from "@/app/forge/lib/forgeDecks";
import { listGrantedForgeCards } from "@/app/forge/lib/deckPool";
import { buildForgePlayDeck, sanitizeParagon } from "@/app/forge/lib/playSerialize";
import { cardRawText } from "@/app/forge/lib/designCard";
import { stdbHttpBase } from "@/app/forge/lib/stdbHttp";
import type { GameCardData } from "@/app/play/actions";

export type ForgePlayDeckResult =
  | { ok: true; deck: { id: string; name: string; format: string | null; paragon: string }; deckData: GameCardData[]; dropped: number }
  | { ok: false; error: string };

export async function loadForgeDeckForGame(deckId: string): Promise<ForgePlayDeckResult> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Deck not found." };
  const deck = await getForgeDeck(deckId);
  if (!deck) return { ok: false, error: "Deck not found." };
  const granted = await listGrantedForgeCards();
  const grantedIds = new Set(granted.map((g) => g.cardId));
  const { deckData, dropped } = buildForgePlayDeck(deck.entries, (id) => grantedIds.has(id));
  if (deckData.length === 0) {
    return { ok: false, error: "This deck has no playable cards — its Forge cards may no longer be shared with you." };
  }
  return {
    ok: true,
    deck: { id: deck.id, name: deck.name, format: deck.format, paragon: sanitizeParagon(deck.paragon) },
    deckData,
    dropped,
  };
}

export type ForgePlayResolverEntry = {
  cardId: string; name: string; rawText: string;
  hasFinished: boolean; hasArt: boolean; versionId: string;
};

export async function getForgePlayResolver(): Promise<ForgePlayResolverEntry[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const granted = await listGrantedForgeCards();
  return granted.map((g) => ({
    cardId: g.cardId,
    name: g.data.name || "Playtest card",
    rawText: cardRawText(g.data),
    hasFinished: g.hasApprovedFinished,
    hasArt: g.hasApprovedArt,
    versionId: g.versionId,
  }));
}

export async function authorizeForgeSeat(
  input: { code: string; identityHex: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const code = (input.code || "").trim().toUpperCase();
  const identityHex = (input.identityHex || "").trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/i.test(code) || !/^(0x)?[0-9a-f]{16,128}$/.test(identityHex)) {
    return { ok: false, error: "Invalid request" };
  }
  const token = process.env.SPACETIMEDB_SERVER_TOKEN;
  const host = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST;
  const db = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || "redemption-multiplayer";
  if (!token || !host) {
    console.error("[forge] authorizeForgeSeat: missing SPACETIMEDB_SERVER_TOKEN / host env");
    return { ok: false, error: "Playtest games are not configured yet" };
  }
  const res = await fetch(`${stdbHttpBase(host)}/v1/database/${db}/call/forge_authorize_seat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([code, identityHex]),
    cache: "no-store",
  }).catch((e) => {
    console.error("[forge] authorizeForgeSeat fetch failed", e);
    return null;
  });
  if (!res || !res.ok) {
    const detail = res ? `${res.status} ${await res.text().catch(() => "")}` : "network";
    console.error("[forge] authorizeForgeSeat rejected", detail.slice(0, 300));
    return { ok: false, error: "Could not authorize your seat — try again" };
  }
  // Audit attribution: STDB identities are otherwise anonymous.
  console.log("[forge-audit] seat authorized", { userId: ctx.user.id, code, identityHex });
  return { ok: true };
}
```

**Wire-format note:** the arg body `JSON.stringify([code, identityHex])` (positional array) must match whatever form Task 3 Step 2 verified with `spacetime call`. If the named-object form is what worked, use `JSON.stringify({ code, identityHex })`. Verify once against the dev server with a real curl before committing:

```bash
curl -s -X POST "http://<dev-host>/v1/database/<dev-db>/call/forge_authorize_seat" \
  -H "Authorization: Bearer $SPACETIMEDB_SERVER_TOKEN" -H "Content-Type: application/json" \
  -d '["ABCD","<some-identity-hex>"]'
```

- [ ] **Step 6: Dev env.** Append to `.env.local` (do NOT touch `.env.example`): `SPACETIMEDB_SERVER_TOKEN=<token>`. For dev, mint against the dev host: `curl -s -X POST http://<dev-host>/v1/identity` → `{identity, token}`. Then point the dev module's server identity at it: `spacetime call <dev-db> set_forge_server_identity '["<that identity hex>"]'` (owner override permits the re-set).

- [ ] **Step 7: Gates**

Run: `npx vitest run app/forge` and `npm run build`
Expected: forge tests green; build clean (catches union-narrowing mistakes).

- [ ] **Step 8: Commit**

```bash
git add app/forge/lib/playDecks.ts app/forge/lib/stdbHttp.ts app/forge/lib/play.ts app/forge/lib/deckPool.ts app/forge/lib/__tests__/stdbHttp.test.ts
git commit -m "feat(forge): play-deck load, resolver, and seat-authorization server actions"
```

---

### Task 6: Image seams — `forge:` handling + resolver URL helpers (TDD)

**Files:**
- Create: `app/play/utils/forgeResolver.ts`
- Modify: `app/shared/utils/cardImageUrl.ts`
- Test: `app/play/utils/__tests__/forgeResolver.test.ts`

**Interfaces:**
- Consumes: `ForgePlayResolverEntry` (type-only) from Task 5.
- Produces (consumed by Tasks 7-8): `ForgeResolverMap = Map<string, ForgePlayResolverEntry>`, `forgeCardIdFromImgFile(imgFile): string | null`, `forgeProxyUrl(entry): string`, `resolveCardImageUrl(imgFile, resolver?): string`, `mergeForgeDeckData(cards: GameCardData[], resolver?): GameCardData[]`.

- [ ] **Step 1: Write the failing tests** `app/play/utils/__tests__/forgeResolver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { forgeCardIdFromImgFile, forgeProxyUrl, resolveCardImageUrl, mergeForgeDeckData } from "../forgeResolver";
import { getCardImageUrl, getCardImageUrlOrNull } from "@/app/shared/utils/cardImageUrl";

const ID = "11111111-2222-3333-4444-555555555555";
const entry = { cardId: ID, name: "Test Hero", rawText: "Does things.", hasFinished: true, hasArt: true, versionId: "v-1" };
const resolver = new Map([[ID, entry]]);

describe("forge image seams", () => {
  it("getCardImageUrl returns '' for forge: URIs (never the public CDN)", () => {
    expect(getCardImageUrl(`forge:${ID}`)).toBe("");
  });
  it("getCardImageUrlOrNull passes through leading-/ URLs and nulls forge:", () => {
    expect(getCardImageUrlOrNull("/forge/api/art/x?v=approved")).toBe("/forge/api/art/x?v=approved");
    expect(getCardImageUrlOrNull(`forge:${ID}`)).toBeNull();
  });
  it("extracts the forge card id", () => {
    expect(forgeCardIdFromImgFile(`forge:${ID}`)).toBe(ID);
    expect(forgeCardIdFromImgFile("SomeCard.jpg")).toBeNull();
  });
  it("prefers finished scan, falls back to artwork, else ''", () => {
    expect(forgeProxyUrl(entry)).toBe(`/forge/api/art/${ID}?v=approved&kind=finished&t=v-1`);
    expect(forgeProxyUrl({ ...entry, hasFinished: false })).toBe(`/forge/api/art/${ID}?v=approved&t=v-1`);
    expect(forgeProxyUrl({ ...entry, hasFinished: false, hasArt: false })).toBe("");
  });
  it("resolveCardImageUrl: resolved -> proxy URL; unresolved -> ''", () => {
    expect(resolveCardImageUrl(`forge:${ID}`, resolver)).toContain("/forge/api/art/");
    expect(resolveCardImageUrl(`forge:${ID}`, new Map())).toBe("");
    expect(resolveCardImageUrl(`forge:${ID}`, null)).toBe("");
  });
  it("mergeForgeDeckData merges name/text/img and leaves public cards alone", () => {
    const cards = [
      { cardName: "", cardSet: "Forge", cardImgFile: `forge:${ID}`, cardType: "", brigade: "", strength: "", toughness: "", alignment: "", identifier: "", reference: "", specialAbility: "", isReserve: false },
      { cardName: "Public", cardSet: "S", cardImgFile: "Public.jpg", cardType: "", brigade: "", strength: "", toughness: "", alignment: "", identifier: "", reference: "", specialAbility: "", isReserve: false },
    ];
    const merged = mergeForgeDeckData(cards as any, resolver);
    expect(merged[0].cardName).toBe("Test Hero");
    expect(merged[0].specialAbility).toBe("Does things.");
    expect(merged[0].cardImgFile).toContain("/forge/api/art/");
    expect(merged[1]).toBe(cards[1]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run app/play/utils/__tests__/forgeResolver.test.ts` → FAIL.

- [ ] **Step 3: Modify `app/shared/utils/cardImageUrl.ts`:**

```typescript
export function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  if (imgFile.startsWith('forge:')) return ''; // opaque Forge ref — resolved via the forge resolver, never the public CDN
  if (imgFile.startsWith('/')) return imgFile;
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

export function getCardImageUrlOrNull(imgFile: string | null | undefined): string | null {
  if (!imgFile) return null;
  if (imgFile.startsWith('forge:')) return null;
  if (imgFile.startsWith('/')) return imgFile; // local assets & same-origin proxy URLs
  if (!BLOB_BASE_URL) return null;
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}
```

- [ ] **Step 4: Create `app/play/utils/forgeResolver.ts`:**

```typescript
// Client-side forge card resolution. STDB rows carry only `forge:<uuid>` in
// cardImgFile; these helpers merge the viewer's RLS-granted card text and
// rewrite image URLs to the cookie-authed forge art proxy. Unresolved cards
// (viewer lacks the grant) stay opaque — fail-closed by design.
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import type { ForgePlayResolverEntry } from '@/app/forge/lib/playDecks';
import type { GameCardData } from '@/app/play/actions';

export type ForgeResolverMap = Map<string, ForgePlayResolverEntry>;

export function forgeCardIdFromImgFile(imgFile: string): string | null {
  return imgFile.startsWith('forge:') ? imgFile.slice('forge:'.length) : null;
}

export function forgeProxyUrl(e: ForgePlayResolverEntry): string {
  if (e.hasFinished) return `/forge/api/art/${e.cardId}?v=approved&kind=finished&t=${e.versionId}`;
  if (e.hasArt) return `/forge/api/art/${e.cardId}?v=approved&t=${e.versionId}`;
  return '';
}

export function resolveCardImageUrl(imgFile: string, resolver?: ForgeResolverMap | null): string {
  const forgeId = forgeCardIdFromImgFile(imgFile);
  if (forgeId) {
    const e = resolver?.get(forgeId);
    return e ? forgeProxyUrl(e) : '';
  }
  return getCardImageUrl(imgFile);
}

export function mergeForgeDeckData(cards: GameCardData[], resolver?: ForgeResolverMap | null): GameCardData[] {
  if (!resolver || resolver.size === 0) return cards;
  return cards.map((c) => {
    const id = forgeCardIdFromImgFile(c.cardImgFile);
    if (!id) return c;
    const e = resolver.get(id);
    if (!e) return c;
    return { ...c, cardName: e.name, specialAbility: e.rawText, cardImgFile: forgeProxyUrl(e) || c.cardImgFile };
  });
}
```

- [ ] **Step 5: Run tests** — `npx vitest run app/play/utils/__tests__/forgeResolver.test.ts` → PASS. Also `npx vitest run app/play app/shared` for regressions.

- [ ] **Step 6: Commit**

```bash
git add app/shared/utils/cardImageUrl.ts app/play/utils/forgeResolver.ts app/play/utils/__tests__/forgeResolver.test.ts
git commit -m "feat(play): forge image seams — proxy URL resolution, CDN never sees forge refs (TDD)"
```

---

### Task 7: Adapter + game-state threading

**Files:**
- Modify: `app/play/utils/cardAdapter.ts`
- Modify: `app/play/hooks/useGameState.ts` (both `useStableAdaptedCards` call sites: ~313 and ~1125)
- Modify: `app/play/components/MultiplayerCanvas.tsx` (direct `cardInstanceToGameCard` calls at ~404, ~3234, ~3304 + a new optional prop)
- Modify: `app/play/lib/multiplayerImageUrls.ts`
- Test: extend `app/play/utils/__tests__/` — create `cardAdapterForge.test.ts`

**Interfaces:**
- Consumes: Task 6 helpers.
- Produces: `cardInstanceToGameCard(card, counters, owner, forgeResolver?)`; `useStableAdaptedCards(cards, counters, opponentPlayerId, forgeResolver?)`; `useGameState(gameId, forgeResolver?)` additionally returning `isForgeGame: boolean`; `buildPrioritizedImageUrls(my, opp, shared, forgeResolver?)` / `buildCriticalImageUrls(my, opp, shared, forgeResolver?)`; `MultiplayerCanvas` prop `forgeResolver?: ForgeResolverMap | null`.

- [ ] **Step 1: Write the failing test** `app/play/utils/__tests__/cardAdapterForge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { cardInstanceToGameCard } from "../cardAdapter";

const ID = "11111111-2222-3333-4444-555555555555";
const entry = { cardId: ID, name: "Test Hero", rawText: "Does things.", hasFinished: false, hasArt: true, versionId: "v-9" };

function stubInstance(over: Record<string, unknown> = {}) {
  return {
    id: 1n, gameId: 1n, ownerId: 1n, originalOwnerId: 1n, zone: "hand", zoneIndex: 0n,
    posX: "", posY: "", isMeek: false, isFlipped: false,
    cardName: "", cardSet: "Forge", cardImgFile: `forge:${ID}`, cardType: "", brigade: "",
    strength: "", toughness: "", alignment: "", identifier: "", specialAbility: "",
    reference: "", notes: "", equippedToInstanceId: 0n, isSoulDeckOrigin: false,
    isToken: false, revealExpiresAt: undefined, revealStartedAt: undefined,
    outlineColor: "", imitatingName: "", ...over,
  } as any;
}

describe("cardInstanceToGameCard forge resolution", () => {
  it("merges name/text/proxy URL when resolver has the card", () => {
    const gc = cardInstanceToGameCard(stubInstance(), [], "player1", new Map([[ID, entry]]));
    expect(gc.cardName).toBe("Test Hero");
    expect(gc.specialAbility).toBe("Does things.");
    expect(gc.cardImgFile).toBe(`/forge/api/art/${ID}?v=approved&t=v-9`);
  });
  it("leaves the opaque URI when unresolved (fail-closed placeholder)", () => {
    const gc = cardInstanceToGameCard(stubInstance(), [], "player1", new Map());
    expect(gc.cardName).toBe("");
    expect(gc.cardImgFile).toBe(`forge:${ID}`);
  });
  it("does not touch public cards", () => {
    const gc = cardInstanceToGameCard(stubInstance({ cardImgFile: "Public.jpg", cardName: "Pub" }), [], "player1", new Map([[ID, entry]]));
    expect(gc.cardName).toBe("Pub");
    expect(gc.cardImgFile).toBe("Public.jpg");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run app/play/utils/__tests__/cardAdapterForge.test.ts` → FAIL (wrong arity / no merge).

- [ ] **Step 3: Implement the adapter merge** in `app/play/utils/cardAdapter.ts`:

```typescript
import { forgeCardIdFromImgFile, forgeProxyUrl, type ForgeResolverMap } from './forgeResolver';

export function cardInstanceToGameCard(
  card: CardInstance,
  counters: readonly CardCounter[],
  owner: 'player1' | 'player2',
  forgeResolver?: ForgeResolverMap | null,
): GameCard {
  const forgeId = forgeCardIdFromImgFile(card.cardImgFile);
  const resolved = forgeId ? forgeResolver?.get(forgeId) : undefined;
  return {
    instanceId: String(card.id),
    cardName: resolved ? resolved.name : card.cardName,
    cardSet: card.cardSet,
    cardImgFile: resolved ? (forgeProxyUrl(resolved) || card.cardImgFile) : card.cardImgFile,
    // ... rest of the existing fields unchanged, EXCEPT:
    specialAbility: resolved ? resolved.rawText : card.specialAbility,
    // ...
  };
}
```

In `useStableAdaptedCards`, add the 4th param `forgeResolver?: ForgeResolverMap | null`, pass it to `cardInstanceToGameCard`, and add it to the `useMemo` dependency array (resolver arrives once per game; a new Map identity correctly invalidates the reference cache).

- [ ] **Step 4: Thread through `useGameState`.** Add an optional second parameter `forgeResolver?: ForgeResolverMap | null` to `useGameState` and pass it to the `useStableAdaptedCards` call at ~313. At ~1125 (inspect the enclosing hook — it is the spectator variant): pass `undefined` (forge games reject spectators). Also add inside `useGameState`:

```typescript
import { tables } from '@/lib/spacetimedb/module_bindings';
// with the other useTable calls:
const [forgeGameRows] = useTable(tables.ForgeGame, /* mirror the .where(r => r.gameId.eq(gameId)) pattern used by the other per-game tables */);
const isForgeGame = forgeGameRows.length > 0;
```

and include `isForgeGame` in the returned object. Mirror the exact `useTable` predicate idiom already used in this file for other per-game tables (the `.where` filter must be on the hook, not just subscription SQL).

- [ ] **Step 5: MultiplayerCanvas.** Add to its props interface: `forgeResolver?: ForgeResolverMap | null;` and pass it as the 4th arg at the three direct `cardInstanceToGameCard` call sites (~404, ~3234, ~3304).

- [ ] **Step 6: Preloader.** In `app/play/lib/multiplayerImageUrls.ts`, replace the private `resolve()` body with `resolveCardImageUrl(card.cardImgFile, forgeResolver)` by threading an optional last param through `buildPrioritizedImageUrls` / `buildCriticalImageUrls` and `pushZone`:

```typescript
import { resolveCardImageUrl, type ForgeResolverMap } from '@/app/play/utils/forgeResolver';

function resolve(card: CardInstance | undefined, forgeResolver?: ForgeResolverMap | null): string | null {
  if (!card?.cardImgFile) return null;
  const url = resolveCardImageUrl(card.cardImgFile, forgeResolver);
  return url || null;
}
```

(Update `pushZone` and both exported builders to accept and forward `forgeResolver`.)

- [ ] **Step 7: Run tests + build**

Run: `npx vitest run app/play` then `npm run build`
Expected: new tests PASS, no regressions, build clean (this catches every call-site arity mismatch).

- [ ] **Step 8: Commit**

```bash
git add app/play/utils/cardAdapter.ts app/play/hooks/useGameState.ts app/play/components/MultiplayerCanvas.tsx app/play/lib/multiplayerImageUrls.ts app/play/utils/__tests__/cardAdapterForge.test.ts
git commit -m "feat(play): thread forge resolver through adapter, game state, canvas, preloader"
```

---

### Task 8: `/play/[code]` forge path — deck load, authorize, reducers, UI gating, rematch

**Files:**
- Modify: `app/play/[code]/client.tsx`
- Modify: `app/play/components/GameOverOverlay.tsx`
- Modify: `app/play/components/PregameScreen.tsx` (only if the change-deck control isn't already driven from client.tsx — inspect first)

**Interfaces:**
- Consumes: `loadForgeDeckForGame`, `authorizeForgeSeat`, `getForgePlayResolver` (Task 5); `mergeForgeDeckData`, `resolveCardImageUrl`, `ForgeResolverMap` (Task 6); `useGameState(gameId, forgeResolver)` + `gameState.isForgeGame` (Task 7); bindings `conn.reducers.createForgeGame/joinForgeGame` (Task 3).
- Produces: `GameParams.isForge?: boolean` (set by Task 9's lobby); `GameOverOverlay` props gain `{ isForge?: boolean; myDeckId?: string }`.

- [ ] **Step 1: Extend `GameParams`** (client.tsx:57): add `isForge?: boolean;`.

- [ ] **Step 2: Forge state + resolver fetch.** In the component body (near the `deckData` state, ~235):

```typescript
const isForge = gameParams?.isForge === true || gameState.isForgeGame;

const [forgeResolver, setForgeResolver] = useState<ForgeResolverMap | null>(null);
const [forgeDeckMeta, setForgeDeckMeta] = useState<{ paragon: string; format: string } | null>(null);
useEffect(() => {
  if (!isForge || forgeResolver !== null) return;
  let cancelled = false;
  getForgePlayResolver()
    .then((entries) => {
      if (cancelled) return;
      setForgeResolver(new Map(entries.map((e) => [e.cardId, e])));
    })
    .catch(() => { if (!cancelled) setForgeResolver(new Map()); });
  return () => { cancelled = true; };
}, [isForge, forgeResolver]);
```

NOTE: `gameState` is created at ~260 — declare the resolver state before it and compute `isForge` after `gameState` exists; pass `forgeResolver` into `useGameState(gameId ?? BigInt(0), forgeResolver)`. Order: `const [forgeResolver, setForgeResolver] = useState(...)` → `const gameState = useGameState(gameId ?? BigInt(0), forgeResolver)` → `const isForge = gameParams?.isForge === true || gameState.isForgeGame` → the fetch effect.

- [ ] **Step 3: Deck load swap** (the effect at ~237-250):

```typescript
useEffect(() => {
  if (!gameParams || deckData !== null) return;
  let cancelled = false;
  if (gameParams.isForge) {
    loadForgeDeckForGame(gameParams.deckId)
      .then((r) => {
        if (cancelled) return;
        if (r.ok === false) { setDeckLoadError(r.error); return; }
        // The sanitized paragon/format from the server action are authoritative
        // for the reducer args (never gameParams.paragon on the forge path).
        setForgeDeckMeta({ paragon: r.deck.paragon, format: r.deck.format || 'Type 1' });
        setDeckData(JSON.stringify(r.deckData));
      })
      .catch((err) => {
        if (cancelled) return;
        setDeckLoadError(err instanceof Error ? err.message : 'Failed to load deck.');
      });
  } else {
    loadDeckForGame(gameParams.deckId)
      .then(/* existing body unchanged */)
      .catch(/* existing body unchanged */);
  }
  return () => { cancelled = true; };
}, [gameParams, deckData]);
```

- [ ] **Step 4: Authorize + forge reducer calls.** In the create/join effect (~532-620), branch on `gameParams.role` as today but wrap the forge path in an async IIFE:

```typescript
if (gameParams.isForge) {
  const identityHex = gameState.identityHex;
  if (!identityHex) return; // effect re-runs once connected identity is known
  setLifecycle(gameParams.role === 'create' ? 'creating' : 'joining');
  void (async () => {
    const auth = await authorizeForgeSeat({ code, identityHex });
    if (auth.ok === false) {
      setErrorMessage(auth.error);
      setLifecycle('error');
      return;
    }
    const args = {
      code,
      deckId: gameParams.deckId,
      displayName: gameParams.displayName,
      paragon: forgeDeckMeta?.paragon ?? '',            // sanitized server-side; NEVER gameParams.paragon here
      format: forgeDeckMeta?.format ?? gameParams.format ?? 'Type 1',
      supabaseUserId: gameParams.supabaseUserId,
      deckData,
    };
    try {
      if (gameParams.role === 'create') {
        conn.reducers.createForgeGame(args);
        setLifecycle('waiting');
      } else {
        conn.reducers.joinForgeGame(args)?.catch?.((e: unknown) => {
          setErrorMessage(e instanceof Error ? e.message : 'Could not join the game.');
          setLifecycle('error');
        });
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Could not start the game.');
      setLifecycle('error');
    }
  })();
  return;
}
// ...existing public create/join path unchanged
```

Mirror the surrounding code's exact error/lifecycle idioms (including the joiner format-mismatch preflight — keep it for forge joins too, it reads from the subscribed game row).

- [ ] **Step 5: Warmup + goldfish merges.**
  - `myDeckImageUrls` memo (~269): replace `getCardImageUrl(card.cardImgFile)` with `resolveCardImageUrl(card.cardImgFile, forgeResolver)` and add `forgeResolver` to the deps.
  - `goldfishDeck` memo (~776): wrap the parsed cards — `convertToGoldfishDeck(mergeForgeDeckData(cards, forgeResolver), ...)` and add `forgeResolver` to the deps.
  - `buildPrioritizedImageUrls(...)` / `buildCriticalImageUrls(...)` call sites in this file: pass `forgeResolver` as the new last arg.

- [ ] **Step 6: Gate deck-change UI.** Find the two `DeckPickerModal` reload sites (~1384, ~1618) and every trigger that opens them (`setShowReloadDeckPicker(true)`) plus the pregame change-deck control (search `pregameChangeDeck` / `pregame_change_deck` usage around ~1013-1096): wrap each trigger in `{!isForge && (...)}`. The reducers already hard-reject (Task 2) — this is UX, not security.

- [ ] **Step 7: Same-deck forge rematch.** In `GameOverOverlay.tsx`:
  - Add props: `isForge?: boolean; myDeckId?: string;`
  - In the `playAgainTriggered` effect and wherever `setPickerOpen(true)` / `setPickerMode(...)` fire for request/respond: when `isForge`, skip the picker and call a new handler:

```typescript
const handleForgeRematch = async (mode: 'request' | 'respond') => {
  if (!myDeckId) return;
  setIsLoading(true);
  try {
    const r = await loadForgeDeckForGame(myDeckId);
    if (r.ok === false) { console.error('Forge rematch deck load failed:', r.error); return; }
    const deckData = JSON.stringify(r.deckData);
    if (mode === 'request') gameState.requestRematch(myDeckId, deckData, r.deck.paragon, r.deck.format || 'Type 1');
    else gameState.respondRematch(true, myDeckId, deckData, r.deck.paragon, r.deck.format || 'Type 1');
  } finally {
    setIsLoading(false);
  }
};
```

  - In `client.tsx`, pass `isForge={isForge}` and `myDeckId={gameParams?.deckId}` where `GameOverOverlay` is rendered.

- [ ] **Step 8: Build + manual dev smoke**

Run: `npm run build` → clean. Then `npm run dev` and (signed in as a forge member with a saved forge deck, dev STDB running with the Task 5 Step 6 identity seeded): create a forge game from a hand-written sessionStorage entry OR defer full flow smoke to Task 9's lobby. Verify at minimum: no console errors on `/play/<code>` for a public game (regression) — public flow must be untouched.

- [ ] **Step 9: Commit**

```bash
git add "app/play/[code]/client.tsx" app/play/components/GameOverOverlay.tsx app/play/components/PregameScreen.tsx
git commit -m "feat(play): forge game path — authorized create/join, resolver wiring, same-deck rematch, deck-change gating"
```

---

### Task 9: Forge lobby `/forge/play/games` + desk tile

**Files:**
- Create: `app/forge/play/games/page.tsx`
- Create: `app/forge/play/games/ForgeGameLobby.tsx`
- Modify: `app/forge/page.tsx` (~45: replace the disabled "Find a game" tile)
- Test: `e2e/forge/playtest-lobby.spec.ts`

**Interfaces:**
- Consumes: `requireForge`, `listForgeDecks` (`ForgeDeckSummary[]`), `getForgeDeck`, sessionStorage handoff shape from Task 8 (`stdb_game_params_<CODE>` with `isForge: true`), `useSpacetimeConnection`, `tables.ForgeGame`/`tables.Game`.
- Produces: the member-facing entry point.

- [ ] **Step 1: Page (server component)** `app/forge/play/games/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listForgeDecks } from "@/app/forge/lib/forgeDecks";
import ForgeGameLobby from "./ForgeGameLobby";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgePlaytestGamesPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const decks = await listForgeDecks();
  const { data: member } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  const displayName = member?.display_name || ctx.user.email?.split("@")[0] || "Playtester";
  return <ForgeGameLobby decks={decks} displayName={displayName} userId={ctx.user.id} />;
}
```

- [ ] **Step 2: Lobby client component** `app/forge/play/games/ForgeGameLobby.tsx`. Mirror the provider wiring that `app/play/page.tsx` uses around `GameLobby` (read it first — same `SpacetimeDBProvider`/`useSpacetimeConnection` pattern), then:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SpacetimeDBProvider, useTable } from "spacetimedb/react";
import { tables } from "@/lib/spacetimedb/module_bindings";
import { useSpacetimeConnection } from "@/app/play/hooks/useSpacetimeConnection";
import type { ForgeDeckSummary } from "@/app/forge/lib/deckTypes";

interface Props { decks: ForgeDeckSummary[]; displayName: string; userId: string }

function LobbyInner({ decks, displayName, userId }: Props) {
  const router = useRouter();
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(decks[0]?.id ?? null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = decks.find((d) => d.id === selectedDeckId) ?? null;

  const [forgeGames] = useTable(tables.ForgeGame);
  const [games] = useTable(tables.Game);
  const openGames = useMemo(() => {
    const forgeIds = new Set(forgeGames.map((f) => String(f.gameId)));
    return games
      .filter((g) => forgeIds.has(String(g.id)) && g.status === "waiting")
      .sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch));
  }, [forgeGames, games]);

  function stash(code: string, role: "create" | "join") {
    if (!selected) { setError("Pick a deck first."); return false; }
    sessionStorage.setItem(
      `stdb_game_params_${code}`,
      JSON.stringify({
        role,
        deckId: selected.id,
        deckName: selected.name,
        displayName,
        supabaseUserId: userId,
        format: selected.format || "Type 1",
        paragon: null, // paragon comes from the forge deck server-side (sanitized) — Task 8 passes gameParams.paragon || ''
        isForge: true,
      }),
    );
    return true;
  }

  function handleCreate() {
    const code = Math.random().toString(36).slice(2, 6).toUpperCase();
    if (!stash(code, "create")) return;
    router.push(`/play/${code}`);
  }

  function handleJoin(codeRaw: string) {
    const code = codeRaw.trim().toUpperCase();
    if (code.length !== 4) { setError("Game code must be 4 characters."); return; }
    if (!stash(code, "join")) return;
    router.push(`/play/${code}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Playtest games</h1>
        <p className="text-sm text-muted-foreground">Private games with your Forge decks. Only members you share a code with (or listed below) can play.</p>
      </div>
      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Your deck</h2>
        {decks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Forge decks yet — build one first.</p>
        ) : (
          <select
            className="w-full rounded-md border bg-background p-2 text-sm"
            value={selectedDeckId ?? ""}
            onChange={(e) => setSelectedDeckId(e.target.value)}
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>{d.name} — {d.format || "Type 1"} ({d.cardCount})</option>
            ))}
          </select>
        )}
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <button onClick={handleCreate} disabled={!selected} className="rounded-lg border p-4 text-left hover:bg-muted/50 disabled:opacity-50">
          <div className="font-medium">Host a game</div>
          <div className="text-sm text-muted-foreground">Get a code to share with another playtester.</div>
        </button>
        <div className="rounded-lg border p-4">
          <div className="font-medium">Join by code</div>
          <div className="mt-2 flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="CODE"
              className="w-24 rounded-md border bg-background p-2 text-sm uppercase tracking-widest"
            />
            <button onClick={() => handleJoin(joinCode)} disabled={!selected || joinCode.trim().length !== 4} className="rounded-md border px-3 text-sm hover:bg-muted/50 disabled:opacity-50">Join</button>
          </div>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Open playtest games</h2>
        {openGames.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is waiting right now.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {openGames.map((g) => (
              <li key={String(g.id)} className="flex items-center justify-between gap-2 p-3">
                <div>
                  <div className="text-sm font-medium">{g.createdByName || "Playtester"}</div>
                  <div className="text-xs text-muted-foreground">{g.format} · code {g.code}</div>
                </div>
                <button onClick={() => handleJoin(g.code)} disabled={!selected} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50 disabled:opacity-50">Join</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ForgeGameLobby(props: Props) {
  const { connectionBuilder } = useSpacetimeConnection();
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <LobbyInner {...props} />
    </SpacetimeDBProvider>
  );
}
```

Adjust `SpacetimeDBProvider` prop names / `useTable` idioms to exactly match `app/play/page.tsx` and `LobbyList.tsx` (read them; the SDK prop is `connectionBuilder`). Paragon note: the lobby deliberately stashes `paragon: null` — on the forge path the reducer receives the sanitized paragon from `loadForgeDeckForGame` via `forgeDeckMeta` (Task 8), never a client-supplied value.

- [ ] **Step 3: Desk tile.** In `app/forge/page.tsx` (~45-49) replace the disabled div:

```tsx
<Link href="/forge/play/games" className="rounded-lg border p-4 hover:bg-muted/50">
  <div className="font-medium">Find a game</div>
  <div className="text-sm text-muted-foreground">Host or join a private playtest game.</div>
</Link>
```

- [ ] **Step 4: e2e** `e2e/forge/playtest-lobby.spec.ts` (mirror `e2e/forge/import.spec.ts`'s auth + anon patterns exactly — same seed users, same 404 assertion style):

```typescript
import { test, expect } from "@playwright/test";
// Reuse the exact helpers/setup import.spec.ts uses (read it and copy its auth scaffolding).

test.describe("forge playtest lobby", () => {
  test("anon gets 404", async ({ page }) => {
    const res = await page.goto("/forge/play/games");
    expect(res?.status()).toBe(404);
  });

  test("member sees the lobby", async ({ page }) => {
    // sign in via the same flow import.spec.ts uses for the elder/member account
    await page.goto("/forge/play/games");
    await expect(page.getByRole("heading", { name: "Playtest games" })).toBeVisible();
  });
});
```

Run: `npx playwright test e2e/forge/playtest-lobby.spec.ts` (both projects). Expected: green (member test may need the dev server + seeded member; follow import.spec.ts's env-guard conventions).

- [ ] **Step 5: Gates** — `npx vitest run __tests__/forge-gate-first.test.ts __tests__/forge-no-next-image.test.ts` → green (new page is auto-scanned).

- [ ] **Step 6: Commit**

```bash
git add app/forge/play/games app/forge/page.tsx e2e/forge/playtest-lobby.spec.ts
git commit -m "feat(forge): playtest games lobby — host/join/list, desk tile live"
```

---

### Task 10: Guardrail scan + full gates

**Files:**
- Create: `__tests__/forge-stdb-privacy.test.ts`

**Interfaces:** none new — CI insurance for the leak spine.

- [ ] **Step 1: Write the scan test** `__tests__/forge-stdb-privacy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schemaSrc = readFileSync(join(process.cwd(), "spacetimedb/src/schema.ts"), "utf8");

function tableOptions(name: string): string {
  // Grab the options object literal of `table({ name: '<name>' ... }` up to the
  // closing brace before the columns object.
  const idx = schemaSrc.indexOf(`name: '${name}'`);
  expect(idx, `table ${name} must exist in schema.ts`).toBeGreaterThan(-1);
  const start = schemaSrc.lastIndexOf("table(", idx);
  const end = schemaSrc.indexOf("},", idx);
  return schemaSrc.slice(start, end);
}

describe("forge STDB privacy guardrails", () => {
  it("forge_config is PRIVATE (no public: true)", () => {
    expect(tableOptions("forge_config")).not.toContain("public: true");
  });
  it("forge_seat_auth is PRIVATE (no public: true)", () => {
    expect(tableOptions("forge_seat_auth")).not.toContain("public: true");
  });
  it("forge_game marker exists and is public (clients must branch on it)", () => {
    expect(tableOptions("forge_game")).toContain("public: true");
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run __tests__/forge-stdb-privacy.test.ts` → PASS.

- [ ] **Step 3: Full gates**

```bash
npm test          # full vitest suite — only pre-existing known failures allowed (store-route / threshingfloor)
npm run build     # clean
```

- [ ] **Step 4: Commit**

```bash
git add __tests__/forge-stdb-privacy.test.ts
git commit -m "test(forge): STDB table privacy guardrail scan"
```

---

### Task 11: Ops — prod token, envs, publish, identity, PR

This task is operator-facing (run by the orchestrator, not a code subagent). Actions that touch PROD (module publish, Vercel env, `set_forge_server_identity` on prod) — do them, then report exactly what ran.

- [ ] **Step 1: Mint the prod server identity/token** against maincloud:

```bash
curl -s -X POST https://maincloud.spacetimedb.com/v1/identity
```

Expected: `{"identity":"<hex>","token":"<jwt>"}`. Record both; the token is a SECRET.

- [ ] **Step 2: Env vars.**

```bash
# local (already has the dev token from Task 5; add the prod one only in Vercel)
vercel env add SPACETIMEDB_SERVER_TOKEN production   # paste the token
vercel env add SPACETIMEDB_SERVER_TOKEN preview      # same value (previews talk to prod STDB)
```

Confirm `NEXT_PUBLIC_SPACETIMEDB_HOST` / `NEXT_PUBLIC_SPACETIMEDB_DB_NAME` already exist in Vercel (they do — the play engine uses them).

- [ ] **Step 3: Publish the PROD module** via the `spacetimedb-deploy` skill (NO `--clear` on prod). Regenerate bindings only if the skill's flow requires it (they're already committed from Task 3; a re-run must produce no diff — if it does, STOP and investigate).

- [ ] **Step 4: Set the prod server identity** (as owner via CLI) and verify:

```bash
spacetime call <prod-db-name> set_forge_server_identity '["<identity hex from Step 1>"]'
spacetime sql <prod-db-name> "SELECT * FROM forge_config"
```

Expected: exactly one row with the Step 1 identity. If the call throws 'Not authorized', the first-set race was lost — STOP, report, recover via the owner override.

- [ ] **Step 5: PR.**

```bash
git push -u origin forge-phase-2-3-playtest-games
gh pr create --base forge-deckbuild-parity --title "Forge Phase 2.3: SpacetimeDB playtest games (UUID-only + identity allowlist)" --body "<summary per repo convention; note stacked on #150; list the §5 security table verification + remaining manual two-account smoke>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

(Stacked on #150; re-target to `main` after #150 merges.)

- [ ] **Step 6: Report** the remaining manual step to Tim: signed-in two-account browser smoke (host + join a forge game, verify card faces render for granted viewers and stay opaque for ungranted, chat works, rematch works).

---

## Verification against spec (acceptance)

- §1: marker table + 4 new reducers + 5 guards — Tasks 1-2, smoke Task 3.
- §2: stubs + paragon sanitizer + empty-deck rejection — Tasks 4-5 (unit-tested).
- §3: resolver + adapter/image/preloader/waiting-room seams — Tasks 6-8.
- §4: lobby + desk tile + client forge path + same-deck rematch + deck-change gating — Tasks 8-9.
- §5: surface table holds by construction; guardrail scan Task 10; audit log Task 5.
- §6: env + deploy ordering — Tasks 3, 5, 11.
- §7: all test classes — Tasks 4, 5, 6, 7, 9, 10.
