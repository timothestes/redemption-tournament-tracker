# Spectator Mode Follow-Ups

Backlog generated from the 6-agent audit on branch `spectator-mode` (2026-05-19). One markdown per actionable item, ordered by priority. Each file is self-contained — code references, fix sketch, effort estimate.

Raw audit materials live in `/tmp/`:
- `spectator-mode-audit-findings.md` — raw investigator output
- `spectator-mode-audit-reviews.md` — reviewer audit
- `spectator-mode-punch-list.md` — synthesizer's final punch list

## Headline

Privacy in spectator mode is enforced almost entirely client-side on top of fully-public SpacetimeDB tables. Multiple Criticals (image preloader, `CardInstance` schema, `pendingDeckData`) are direct consequences of that. The "duct tape" feel is largely the absence of a central spectator gate — individual setters and handlers drift.

## Critical (ship-blocker)

| # | Title | Effort |
|---|---|---|
| [01](01-image-preloader-leak.md) | Hand-card image preloader fetches both hands | S |
| [02](02-cardinstance-public-schema.md) | `CardInstance` is public — every hand card identity leaks | L |
| [03](03-pendingdeckdata-public.md) | `pendingDeckData` is public on Player — full decklist leak | M |
| [04](04-pile-browse-spectator-gate.md) | One-click pile browse via left- and right-click | M |
| [05](05-reconnect-didcallreducer.md) | `didCallReducer` blocks re-join after silent SDK reconnect | M |

Items 01–03 cluster around a single architectural fix (server-side privacy filtering). 04 needs a central `useSpectatorGate()` hook. 05 needs the reconnect wrapper + a server-side spectator grace period.

## High (fix soon)

| # | Title | Effort |
|---|---|---|
| [06](06-multi-tab-clobber.md) | Same-identity multi-tab clobber deletes all rows | M |
| [07](07-share-hand-global-toggle.md) | `set_share_hand_with_spectators` is global, not per-spectator | S–M |
| [08](08-lifecycle-error-clobber.md) | Lifecycle re-derivation clobbers `error` state | S |
| [09](09-joining-timeout-fallback.md) | No 12s timeout fallback in `joining` on spectator route | S |
| [10](10-spectator-chat-id-collision.md) | Spectator `send_chat` accepted + ID collision in `playerNames` | S |

## Medium (cleanup pass)

| # | Title | Effort |
|---|---|---|
| [11](11-spectatorhandrequest-cleanup.md) | `SpectatorHandRequest` not cleaned + rate-limit bypass | S |
| [12](12-spectator-row-back-nav.md) | Spectator row leaked on back-nav during join window | S |
| [13](13-subscription-accumulation.md) | Subscription accumulation across spectator→spectator nav | S |
| [14](14-banner-toast-stacking.md) | Banner + `PauseConsentToast` z-index collision; mobile overflow | S–M |
| [15](15-hover-preview-stuck.md) | Hover preview stuck when card unmounts mid-hover | S |
| [16](16-unhandled-promise-rejection.md) | Unhandled `requestSpectatorHandReveal` promise rejection | S |
| [17](17-anonymous-spectator-access.md) | Anonymous-spectator access on `/play/spectate/[code]` | S (gate); product decision |

## Low / Defer (not promoted to files)

One-liners — read the punch list for full context.

- Per-card `revealExpiresAt` flash bypasses spectator consent — `MultiplayerCanvas.tsx:223-228, 242`. Product decision.
- `handRevealSnapshot` (player↔player reveals) also propagates to spectators — `MultiplayerCanvas.tsx:242`.
- `supabaseUserId` + `identity` leak on public Player table — `schema.ts:71,76`.
- `ZoneSearchRequest` payload not deep-audited — `useGameState.ts:986-988`.
- Unread chat badge counts system messages — `app/play/spectate/[code]/client.tsx:234-243`.
- `unreadChatCount` clears only on `isLoupeVisible` change — same file, lines 246-250.
- `prevSharingRef` ignores initial `true` value — `SpectatorHandRequestBanner.tsx:33-46`.
- "Request Hands" 30s cooldown unanchored — `TurnIndicator.tsx:864-898`.
- Kick-detection startup race when row never arrives — `app/play/spectate/[code]/client.tsx:163-176`.
- `isGamesReady` returns `gamesLoading` (inverted naming) — `app/play/hooks/useGameState.ts:1154`.
- Dead `if (msg.senderId === 0n)` branch — `ChatPanel.tsx:1480`.
- `myPlayerId={BigInt(0)}` sentinel collides if `Player.id` ever starts at 0 — `app/play/spectate/[code]/client.tsx:470`.
- Double-mounted `useGameState` + `useSpectatorGameState` for rules-of-hooks — `MultiplayerCanvas.tsx:310-311`.
- `isHandCardFaceVisible` `JSON.parse`s `handRevealSnapshot` on every card render — `MultiplayerCanvas.tsx:231-235`.

## Open product questions

These aren't bugs — they need a product decision before fixes can be designed.

- Is anonymous spectating intentional? (`/play/spectate/[code]` requires no auth.)
- Should hand-reveal consent be per-spectator or global? If global, should the UI show "N spectators currently see your hand" with one-tap revoke?
- Should accepting a hand-reveal also reveal to spectators who join *later*?
- Should the per-card reveal flash and player↔player `handRevealSnapshot` reveals be visible to spectators?
- Should spectator reserve be gated by the same flag as the hand, or remain private regardless of consent?
- Is spectator chat input meant to stay disabled, or be turned on later? (Drives urgency of #10.)
- Should multiple stacked hand-request banners coalesce into one ("N spectators want to see hands")?
- Should same-identity multi-tab spectating be supported (streamer with OBS source + monitor tab)?

## Architectural themes

**Privacy lives in the wrong place.** SpacetimeDB tables are `public: true` by default and the SDK doesn't do per-subscriber column filtering. The fix shape for #01–#03 is to split tables into public skeleton + private body, where the body row is only created when data is meant to be visible to that subscriber.

**Setter-level gates are missing.** Almost every UI bug (#04, #14, #16, several Mediums) has the same shape: a render-site `!isSpectator &&` guard hides the visible artifact, but the underlying state setter still fires from a handler. Commit `9fb4abc` ("tyr to fix it") is the canonical example — it gated 12 context menus at the render boundary while leaving handlers and modal mounts unguarded. Worth a centralized `useSpectatorGate()` hook so individual handlers can't drift.

**Lifecycle is one effect doing three jobs.** The spectator client mixes "resolve gameId," "set lifecycle," "watch for kick," and "handle host-abandonment" into overlapping effects, each with a `useRef` flag (`didCallReducer`, `didSubscribe`, `wasWatching`) to paper over re-entry. The Player route papers over this with `SpacetimeConnectionResetWrapper`; the spectator route doesn't have that wrapper. Either adopt the wrapper, or refactor to an explicit state machine where reconnect is a real transition.
