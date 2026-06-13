# Threshing Floor — Persistent Player-Name Registry

**Date:** 2026-06-13
**Status:** Approved, implementing

## Goal

Make player-name autocomplete in the Threshing Floor outline tool persist
**across episodes** instead of being scoped to the current draft. Today
`window.knownPlayers` is an in-memory array seeded only from names typed in the
current episode (Rankings, Meta, POTM, side-event hosts); it feeds the
`rank-player-options` datalist and is lost on reload / when starting a new
episode.

This wires the existing `/threshingfloor/api/store/{key}` endpoint (key
`players`) so the datalist suggests every name ever entered.

## Scope

In scope:
- Names only. The store value is a flat JSON **array of name strings**:
  `["Hendrix", "BaboonyTim", ...]`.
- Seed autocomplete from the server on tool load.
- Persist newly entered names back to the server.

Out of scope (explicitly deferred):
- Player profile fields (real name, region, format, achievements, socials, notes).
- Any profile editor UI or auto-populate-on-name-match behavior.
- Name removal UI — the registry is append-only.
- The `tournaments` and `side-events` store keys (separate future pass).

## Storage shape

`GET/PUT /threshingfloor/api/store/players` with `data` = `string[]`.

Chosen over an object-keyed-by-handle shape because names-only needs nothing
more, and it matches the array shape of the other two store keys. A later
upgrade to full profiles migrates `["Hendrix"]` → `{ "Hendrix": {} }` in a
single PUT; the API allowlist already accepts both shapes for this key.

## Behavior

### On load
In the tool init (where `window.knownPlayers = []` is set):
1. `GET /api/store/players`.
2. On 200: union the returned array into `window.knownPlayers`, call
   `rebuildPlayerOptions()`, and cache the row's `updated_at` in
   `window.playersRegistryUpdatedAt`.
3. On 404 (nothing saved yet) or any network/parse error: no-op. The tool
   keeps today's episode-scoped behavior. Non-fatal.

### On persist
A new `syncPlayerRegistry()` is called from the **success path of both
`saveData()` and `publishEpisode()`** (publish is also a save path),
fire-and-forget:
1. If we have no confirmed view of the server yet (`playersRegistryLoaded` is
   false — the initial load was slow or failed), reconcile first: `GET`, merge,
   then push the union. This guarantees we never blind-overwrite names added by
   another host that we simply hadn't loaded.
2. Otherwise, if no names are new relative to the last successful sync
   (`knownPlayers.length <= playersRegistrySyncedCount`), skip the write.
3. Otherwise `PUT /api/store/players` with
   `{ data: union, lastSeenUpdatedAt: window.playersRegistryUpdatedAt }`.
4. On 200: update `playersRegistryUpdatedAt` and `playersRegistrySyncedCount`.
5. On 409 (someone else wrote since our last read): the set is append-only, so
   the conflict auto-resolves — `GET`, merge, push once more (no user prompt,
   unlike the draft-save 409 which must ask before overwriting). A second 409 is
   not retried again, to bound the loop.
6. On other failures: `console.warn` and move on. Never blocks or fails the
   draft save; the save status reflects the draft only.

### Server-side first-write safety
The `players` PUT closes the empty-store clobber window: when the request
carries **no** `lastSeenUpdatedAt` token (the client believes the row doesn't
exist yet), the route does a plain `INSERT` rather than an upsert. A row created
concurrently by another host then raises a unique violation, which the route
maps to **409** — so the second writer reconciles instead of silently
overwriting the first. Writes that carry a token keep the read-then-upsert
optimistic path.

### Name-entry coverage
Names reach `window.knownPlayers` from Power Rankings, Meta rankings, Player of
the Month, side-event hosts, and the **guest interview name** (wired with the
same `rank-player-options` datalist + change handler). Names that only ever
lived in a draft saved before this feature shipped are not back-filled on load;
they re-enter the registry the next time they're typed.

De-duplication uses the existing exact-match/trim behavior in
`rebuildPlayerOptions` / the name-entry handlers. Empty names are ignored.

### Trigger rationale
Persistence is tied to draft-save rather than a debounced auto-save on every
new name: fewer writes, no new timer logic, and names persist when the episode
is saved anyway. Debounced-per-name was the main alternative, rejected for
complexity.

## Testing

The API layer (`store/[key]/route.ts`) already has vitest coverage. This change
is entirely inline `outline.html` JS, which has no vitest harness today, so
verification is manual:

1. Load the tool, enter a few names in Rankings, Save the draft.
2. Start a fresh episode (or reload) — the datalist suggests the saved names.
3. Confirm a save with no new names issues no PUT (network tab).
4. Confirm a fetch failure leaves the tool usable (episode-scoped fallback).
