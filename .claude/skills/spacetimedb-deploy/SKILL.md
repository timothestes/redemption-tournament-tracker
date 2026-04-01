---
name: spacetimedb-deploy
description: Publish the SpacetimeDB module and regenerate client bindings. Use after any change to spacetimedb/src/ files (schema.ts or index.ts) — reducers, tables, or indexes.
argument-hint: [--clear to wipe database]
allowed-tools: Bash, Read, Grep
metadata:
  filePattern: "spacetimedb/src/**"
  bashPattern: "spacetime publish|spacetime generate"
  priority: 80
---

# SpacetimeDB Deploy

Publish the SpacetimeDB server module and regenerate TypeScript client bindings. **This must be run any time you modify files in `spacetimedb/src/`** (schema changes, new/modified reducers, index changes). The client will get runtime errors calling new or modified reducers until the module is republished.

## Configuration

| Setting | Value |
|---------|-------|
| Module path | `spacetimedb` (relative to repo root) |
| Database name | `redemption-multiplayer` |
| Server | `maincloud.spacetimedb.com` (default) |
| Config file | `spacetime.json` (repo root) |
| Client bindings output | `lib/spacetimedb/module_bindings/` |
| Env vars | `.env.local` — `NEXT_PUBLIC_SPACETIMEDB_HOST` and `NEXT_PUBLIC_SPACETIMEDB_DB_NAME` |

## Steps

### 1. Publish the module

```bash
echo "y" | spacetime publish redemption-multiplayer --module-path spacetimedb
```

The `echo "y"` is required because the CLI prompts for confirmation when publishing to a non-local server. Without it, the command aborts.

**If the user passes `--clear`**, the database should be wiped and republished. This destroys all game data:

```bash
echo "y" | spacetime publish redemption-multiplayer --clear-database -y --module-path spacetimedb
```

### 2. Regenerate client bindings

```bash
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb
```

This regenerates the TypeScript types and reducer wrappers in `lib/spacetimedb/module_bindings/`. These are checked into git.

### 3. Check for binding changes

```bash
git diff --name-only lib/spacetimedb/module_bindings/
```

If bindings changed, commit them:

```bash
git add lib/spacetimedb/module_bindings/
git commit -m "chore: regenerate SpacetimeDB client bindings"
```

### 4. Verify the client compiles

```bash
npx tsc --noEmit 2>&1 | grep -v "PregameScreen" | head -10
```

The `PregameScreen.tsx` BigInt error is a known pre-existing issue — ignore it.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `SenderError: Invalid zone for search: X` | Server doesn't know about a new zone value | Republish the module |
| `reducer X not found` | Client bindings reference a reducer the server doesn't have | Republish + regenerate |
| `Publish aborted by user` | Forgot to pipe `echo "y"` | Use `echo "y" \| spacetime publish ...` |
| `reading 'tag'` error on publish | Indexes defined in wrong position in `table()` call | Indexes go in the 1st arg (OPTIONS), not 2nd (COLUMNS) |
| Bindings import errors | Stale generated types | Regenerate with `spacetime generate` |

## When to Run

- After adding/modifying a reducer in `spacetimedb/src/index.ts`
- After adding/modifying a table in `spacetimedb/src/schema.ts`
- After changing index definitions
- After adding new zone values or game actions that the server validates
- When the client gets `SenderError` for something that should work
