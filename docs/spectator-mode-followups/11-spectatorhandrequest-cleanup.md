# 11 — `SpectatorHandRequest` not cleaned on leave/kick/disconnect + rate-limit bypass

**Priority:** Medium
**Effort:** S
**Status:** TODO
**Ship together as one patch**

## Problem

Two related issues:

1. **Orphan requests.** `leave_as_spectator`, `kick_spectator`, and `clientDisconnected` all delete the Spectator row but never touch `SpectatorHandRequest`. A spectator clicking "Request Hands" then closing their tab leaves the banner up on both players' screens for up to 30s (the scheduled expiry), with the name of someone no longer present.

2. **Rate limit bypass via rejoin.** The per-spectator rate limit is keyed on `req.spectatorId === spectator.id`. Since `spectator.id` is `autoInc`, a spectator who is kicked or leaves and rejoins gets a new `id`, so the stale `SpectatorHandRequest` (alive for up to 30s) is invisible to the rate limit and they can immediately spam another.

## Why it matters

UX wart for the orphan banner. Light spam vector for the rate-limit bypass. Both fixable in the same small patch. Reviewer B: Medium / Medium.

## Code references

- [spacetimedb/src/index.ts:1593-1611](../../spacetimedb/src/index.ts#L1593-L1611) — `leave_as_spectator` (only touches Spectator row)
- [spacetimedb/src/index.ts:5521-5549](../../spacetimedb/src/index.ts#L5521-L5549) — `kick_spectator` (only touches Spectator row)
- [spacetimedb/src/index.ts:6286-6298](../../spacetimedb/src/index.ts#L6286-L6298) — `clientDisconnected` spectator branch
- [spacetimedb/src/index.ts:6196-6200](../../spacetimedb/src/index.ts#L6196-L6200) — rate limit keyed on `spectator.id`
- [spacetimedb/src/index.ts:6233-6239](../../spacetimedb/src/index.ts#L6233-L6239) — `expire_spectator_hand_request` (the 30s safety net)

## Fix sketch

**Orphan cleanup:**
- In each of the three handlers, after deleting/disconnecting the Spectator row, also delete any matching `SpectatorHandRequest` rows
- Simple: iterate `SpectatorHandRequest.where(r => r.spectatorId === spectator.id)` and delete

**Rate limit fix:**
- Key the rate limit on the spectator's stable `identity` (hex string), not the autoInc `id`
- Optionally: bump the rate-limit window's storage from the request row to a separate `RateLimitRecord(identity, lastRequestMicros)` table so it survives spectator rejoin

## Notes

- Folded with [05](05-reconnect-didcallreducer.md)'s reconnect grace work — if spectator rows survive transient disconnects, the orphan banner becomes much rarer naturally.
- The 30s `expire_spectator_hand_request` scheduled reducer at index.ts:6233 is currently safe (guarded with `.find()` before `.delete()`).
