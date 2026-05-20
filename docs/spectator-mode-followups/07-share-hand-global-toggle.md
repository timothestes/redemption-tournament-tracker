# 07 — `set_share_hand_with_spectators` is a global toggle, not per-spectator

**Priority:** High
**Effort:** S (counter+revoke UI) or M (per-spectator grants)
**Status:** TODO — needs product decision

## Problem

When a player accepts a hand-reveal request from one spectator (e.g., a friend streamer), `set_share_hand_with_spectators` flips a single global flag on the Player row. This grants **every current and future spectator** visibility into the hand, persistently, until the player manually toggles it off via the ChatPanel checkbox.

The `SpectatorHandRequestBanner` says "Alice wants to see your hand" — accepting it also reveals to Bob who joins five minutes later. The player has no UI signal that newly-joined spectators are also seeing their hand.

## Why it matters

**Consent model is materially wider than the UI implies.** A player intuitively reads "accept Alice's request" as "let Alice see my hand," not "let everyone see my hand from now on, including strangers who join later." Reviewer B: "the gap between user mental model and behavior is a consent-design bug" — pushed from investigators' Medium up to High.

Compounds with [17](17-anonymous-spectator-access.md): if anonymous spectating is allowed, accepting one friend's request also reveals to anyone with the URL.

## Code references

- [spacetimedb/src/index.ts:5479-5486](../../spacetimedb/src/index.ts#L5479-L5486) — `set_share_hand_with_spectators` reducer (single boolean on Player row)
- [app/play/components/SpectatorHandRequestBanner.tsx](../../app/play/components/SpectatorHandRequestBanner.tsx) — banner UI; names a single requester per banner
- [app/play/components/ChatPanel.tsx](../../app/play/components/ChatPanel.tsx) — manual revoke checkbox

## Fix sketch

Three options, decreasing complexity:

**Option A — per-spectator grants (M):**
- New table `HandRevealGrant(gameId, ownerPlayerId, spectatorIdentity)` with `public: true` (spectator needs to know its own grant)
- `accept_spectator_hand_request` writes a row instead of flipping a flag
- Client-side `isHandCardFaceVisible` checks "is this spectator's identity in the grants table for this player?"
- Most accurate to user mental model

**Option B — global flag with re-prompt on new spectator (S–M):**
- Keep the single boolean
- On any new spectator joining mid-game with the flag set, auto-flip it back to false and re-prompt the player ("Bob just joined — keep sharing your hand?")
- Simpler implementation, slightly worse UX

**Option C — global flag with visible counter (S):**
- Keep current behavior but add a persistent UI element: "N spectators currently see your hand" with one-tap revoke
- Cheapest fix; doesn't actually solve the consent gap but at least makes it visible
- Could ship as a stop-gap while Option A is designed

## Notes

- Open product question: which model matches design intent? Worth a quick decision before implementation.
- Related: per-card `revealExpiresAt` flash and `handRevealSnapshot` (player↔player reveals) also bypass spectator consent — Low/Defer.
