---
name: spacetimedb-deploy
description: >
  Publish the SpacetimeDB module and regenerate TypeScript client bindings.
  Always use this skill after any change to spacetimedb/src/schema.ts or
  spacetimedb/src/index.ts — including new/modified reducers, table definitions,
  or index changes. Do not skip even for small edits; the client will get
  runtime errors (e.g. "reducer X not found", "SenderError") until the module
  is republished and bindings are regenerated. Also use when the user explicitly
  runs `spacetime publish` or `spacetime generate`, or passes --clear to wipe
  the database.
---

# SpacetimeDB Deploy

Publish the SpacetimeDB server module and regenerate TypeScript client bindings
after changes to `spacetimedb/src/`. The client will produce runtime errors
calling new or modified reducers until both steps are complete.

## Configuration

| Setting                  | Value                                      |
|--------------------------|---------------------------------------------|
| Module path              | `spacetimedb/` (relative to repo root)     |
| Production database      | `redemption-multiplayer`                   |
| Dev database             | `redemption-multiplayer-dev`               |
| Server                   | `maincloud.spacetimedb.com` (default)      |
| Config file              | `spacetime.json` (repo root) — locked to production db |
| Client bindings output   | `lib/spacetimedb/module_bindings/`         |
| Env vars                 | `.env.local` — `NEXT_PUBLIC_SPACETIMEDB_HOST`, `NEXT_PUBLIC_SPACETIMEDB_DB_NAME` |

**Important:** `.env.local` sets `NEXT_PUBLIC_SPACETIMEDB_DB_NAME=redemption-multiplayer-dev`,
so the local dev server connects to the **dev** database. Check which database the client
actually connects to before publishing — schema mismatches between the client bindings and
the deployed module cause BSATN deserialization errors at runtime.

## Steps

### 1. Publish the module

**Production** (uses `spacetime.json` config):
```bash
echo "y" | spacetime publish redemption-multiplayer --module-path spacetimedb
```

**Dev** (must bypass `spacetime.json` with `--no-config`):
```bash
echo "y" | spacetime publish redemption-multiplayer-dev --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
```

The `echo "y"` is required — the CLI prompts for confirmation when publishing
to a non-local server and aborts without it.

**With `--clear`** (destroys all game data):
```bash
# Production
echo "y" | spacetime publish redemption-multiplayer --clear-database -y --module-path spacetimedb
# Dev
echo "y" | spacetime publish redemption-multiplayer-dev --clear-database -y --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
```

**Default behavior:** Publish to **both** production and dev databases unless the
user specifies one. Always publish dev first to catch migration issues early.

### 2. Regenerate client bindings
```bash
spacetime generate --lang typescript --out-dir lib/spacetimedb/module_bindings --module-path spacetimedb
```

Regenerates TypeScript types and reducer wrappers in
`lib/spacetimedb/module_bindings/`. These files are checked into git.

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
| `SenderError: Invalid zone for search: X` | Server doesn't know a new zone value | Republish the module |
| `reducer X not found` | Client bindings reference a reducer the server doesn't have | Republish + regenerate |
| `Publish aborted by user` | Missing `echo "y"` pipe | Use `echo "y" \| spacetime publish ...` |
| `reading 'tag'` on publish | Indexes defined in wrong position in `table()` call | Indexes go in the 1st arg (OPTIONS), not 2nd (COLUMNS) |
| Binding import errors | Stale generated types | Regenerate with `spacetime generate` |
| `Adding a column X requires a default value` | Existing rows can't auto-migrate with new column | Use `--clear-database -y` to wipe and republish, or add `.default()` to schema column |
| `No database target matches 'X'` | `spacetime.json` restricts to a single db name | Use `--no-config --server maincloud` with absolute `--module-path` |
| BSATN `RangeError: Tried to read N byte(s)` | Client bindings don't match deployed module schema | Republish the correct database (check `NEXT_PUBLIC_SPACETIMEDB_DB_NAME` in `.env.local`) + regenerate bindings |