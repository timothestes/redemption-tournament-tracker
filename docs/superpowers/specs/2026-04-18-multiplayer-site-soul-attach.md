# Multiplayer Site/Soul Attach — Spec

**Status:** Ready to plan. Fresh context can start here.

**Goal:** Let players drop a Site/City card onto a lost-soul card (or vice versa) in **Land of Bondage**. The site attaches visually behind the soul, the soul remains draggable (and can still be rescued to Land of Redemption), and all existing LOB mechanics keep working.

**Why:** Mirrors real Redemption gameplay — souls "sit on" a site until rescued. Today we have no representation for this; sites go to LOB as loose cards with no visual link to the souls they protect.

**Reference implementation:** The multiplayer equip port — [`docs/superpowers/specs/2026-04-17-multiplayer-equip-port.md`](./2026-04-17-multiplayer-equip-port.md) and commits `aa08cc7`-ish onward. This feature is *the same shape* (an "attached to" pointer + render offset + cascade on move) in a different zone. Read that spec first; this one focuses on the deltas.

---

## Semantics — where this differs from equip

| Concept | Equip (existing) | Site/soul (this spec) |
|---|---|---|
| Zone | Territory (free-form) | Land of Bondage (auto-arrange strip) |
| Host card (renders in front at natural position) | Warrior | Lost soul |
| Accessory card (renders behind at offset) | Weapon | Site/City |
| Pointer | `accessory.equippedToInstanceId = host.id` | Same — **reuse the same column** |
| Drag to attach | Weapon → warrior | Soul → site, **or** site → soul (bidirectional) |
| Attach cap | 1 weapon per warrior | 1 site per soul |
| Cascade on host leaving zone | Warrior leaves Territory → weapons unlink (→ Discard if destination is LOB) | Soul leaves LOB (typically rescue → LOR) → site stays in LOB, attachment clears |
| Cascade on accessory leaving zone | Weapon leaves Territory → weapon's own `equippedToInstanceId` clears | Site leaves LOB (bounce/discard) → site's own `equippedToInstanceId` clears; soul stays in LOB |
| Detach UI | Unlink icon at seam in Territory | Same — unlink icon at seam in LOB |

**Key insight:** `equippedToInstanceId` is a generic "attached to" pointer, not equip-specific. This feature reuses it. No schema change needed.

---

## Gameplay rules

1. **Sites in LOB.** A Site/City card can be moved into LOB like any other card. By default it sits in the auto-arrange strip alongside other LOB cards.
2. **Attach by drop.** Dragging a soul onto a site (in LOB) — or a site onto a soul (in LOB) — attaches the accessory (site) behind the host (soul). Use the same ≥25% rect-overlap threshold as equip. Only the owner of both cards can trigger the attach.
3. **Visual.** Site renders behind the soul at a diagonal offset (reuse `computeEquipOffset`). The soul stays in its auto-arrange slot; the attached site does *not* occupy a separate slot.
4. **Soul rescue (host leaves zone).** Soul dragged to LOR (or any zone ≠ LOB) → attachment clears; site stays in LOB and recomputes into the auto-arrange strip.
5. **Site bounced/discarded (accessory leaves zone).** Site dragged to Hand / Discard / anywhere ≠ LOB → site's own `equippedToInstanceId` clears; soul stays in LOB, auto-arrange strip recomputes.
6. **Detach (seam icon).** Clicking the unlink icon at the soul/site seam breaks the link without moving either card; the site joins the auto-arrange strip at the soul's slot's neighbor.
7. **Cap.** 1 site per soul, enforced server-side.
8. **Only the local player's own pair.** No interactions with opponent cards.

### Rescue flow (important)

When a player drags the soul out of LOB to LOR, they're rescuing. The reducer cascade *must not* send the site with the soul. Specifically: **when a host in LOB leaves LOB, the accessory (site) stays in LOB, detached.** This is the mirror-opposite of the Territory→LOB equip cascade (where weapons went to Discard with their warrior). Encode this as a generic rule: *cascade the accessory with the host only when host-is-warrior-going-to-LOB.* All other host-leaves-zone cases just clear the pointer on the accessory and leave it in place.

---

## What exists already (that you'll build on top of)

### Backend
- [`spacetimedb/src/schema.ts`](../../../spacetimedb/src/schema.ts) — `CardInstance` already has `equippedToInstanceId: t.u64().default(0n)`. No change required.
- [`spacetimedb/src/index.ts`](../../../spacetimedb/src/index.ts):
  - `attach_card` reducer — validates ownership and that the host is in `territory`. **Must be loosened** to also accept hosts in `land-of-bondage`.
  - `detach_card` reducer — zone-agnostic today. Should work as-is.
  - `move_card` cascade — assumes "leaving territory" is the trigger. Must be generalized so "leaving the host's current zone" is the trigger, and the weapons-to-Discard cascade is gated specifically to the warrior-to-LOB case (not the soul-to-LOR case).
  - `move_cards_batch` — same generalization.

### Client
- [`app/play/components/MultiplayerCanvas.tsx`](../../../app/play/components/MultiplayerCanvas.tsx):
  - `myDerivedWeaponPositions` / `opponentDerivedWeaponPositions` — today these look at **territory only**. Must be extended to also derive positions for LOB clusters.
  - Drag-end attach hit-test — today only fires for `targetZone === 'territory'` and weapon-on-warrior. Must also fire for `targetZone === 'land-of-bondage'` and site-on-soul (or soul-on-site).
  - Drag-start equip followers — today only includes attached weapons when dragging a **warrior in territory**. Must also include the attached site when dragging a **soul in LOB**.
  - Territory two-pass cluster render — today only applies in territory. LOB currently uses `calculateAutoArrangePositions` for all cards. Needs a parallel per-cluster pass.
  - Detach overlay — today only gated on territory attachments. Extend to LOB attachments.
- [`app/play/layout/multiplayerAutoArrange.ts`](../../../app/play/layout/multiplayerAutoArrange.ts) — this lays out the LOB strip. It currently uses `cards.length` as the slot count. **Must skip attached sites** when computing slots (they don't take their own slot). Similar to how territory skips attached weapons.
- [`lib/cards/lookup.ts`](../../../lib/cards/lookup.ts) — has `isWarrior`/`isWeapon`. You'll need `isSite` (and possibly `isCity`, or treat "city" as a kind of site). Add there, same pattern as the others.

### Goldfish parity
Goldfish doesn't have this feature yet. **Out of scope for this task**, but worth noting: if we want goldfish parity, the same shape will port back once this is proven.

---

## Implementation plan

### Task 1 — Card classification: `isSite`

**File:** [`lib/cards/lookup.ts`](../../../lib/cards/lookup.ts)

Add:

```ts
export function isSite(card: CardData | undefined): boolean {
  const tokens = classTokens(card);
  return tokens.includes('site') || tokens.includes('city');
}
```

Classify any card whose class string contains `"site"` or `"city"` (case-insensitive, via the existing `classTokens` split). Verify with a representative card from the generated data — e.g. look up "Chariot of Fire" or any "Cities of..." card and confirm `isSite` returns true.

### Task 2 — Loosen reducer zone check

**File:** [`spacetimedb/src/index.ts`](../../../spacetimedb/src/index.ts) — `attach_card`

Today:

```ts
if (warrior.zone !== 'territory') {
  throw new SenderError('Warrior not in territory');
}
```

Change to accept `territory` **or** `land-of-bondage`, and rename local vars from `warrior`/`weapon` to `host`/`accessory` (or keep the old names — your call, but the new semantics are no longer equip-specific). When the host is in LOB, the accessory (site) doesn't inherit the host's posX/posY the way weapons do for territory; instead, clear posX/posY on the attached site (LOB is auto-arranged, positions don't matter).

Move the one-weapon-per-warrior cap into a generic one-accessory-per-host cap. Same logic, different name.

### Task 3 — Generalize move cascade

**File:** [`spacetimedb/src/index.ts`](../../../spacetimedb/src/index.ts) — `move_card` and `move_cards_batch`

Today the cascade in `move_card` is:

```ts
if (toZone !== 'territory') {
  // ...cascade accessories pointing at the mover
  if (toZone === 'land-of-bondage') {
    // send to discard
  } else {
    // just unlink
  }
}
```

Generalize to:

```ts
const fromZone = card.zone; // original zone, before this update
if (toZone !== fromZone) {
  // ...cascade: for each accessory pointing at the mover
  //   Redemption rule: warrior→LOB sends weapons to Discard.
  //   All other host-leaves-zone scenarios just unlink in place.
  const sendAccessoriesToDiscard = fromZone === 'territory' && toZone === 'land-of-bondage';
  // ...
}
```

Make the same change in `move_cards_batch`. Note that the existing batch pre-pass (`finalZoneById`) already encodes the warrior-to-LOB redirect for **batch-member** weapons — keep that but make the condition `fromZone === 'territory' && toZone === 'land-of-bondage'` explicit rather than implicit in `toZone === 'land-of-bondage'` alone.

**Watch for:** the "leaving zone" trigger today is `toZone !== 'territory'`. The new trigger is `toZone !== fromZone`. This subtly changes behavior: a weapon moving Territory → Territory (repositioning) still preserves `equippedToInstanceId`; a site moving LOB → LOB (repositioning) should also preserve it. Confirm with a test that same-zone reposition doesn't nuke the link.

### Task 4 — Auto-arrange: skip attached sites

**File:** [`app/play/layout/multiplayerAutoArrange.ts`](../../../app/play/layout/multiplayerAutoArrange.ts)

Today `calculateAutoArrangePositions` takes `cards.length` as the slot count. The render logic passes in all LOB cards. Once sites can attach, attached sites should not get a slot.

Callers (in `MultiplayerCanvas.tsx`) already have access to the full LOB card list and can filter it before calling. Simplest: compute `lobHosts = cards.filter(c => c.equippedToInstanceId === 0n)` before calling the layout helper, then render attached sites in a second pass at their host's slot + the equip offset.

No change to `multiplayerAutoArrange.ts` itself required — all the filtering lives at the call site.

### Task 5 — Derive LOB weapon positions

**File:** [`app/play/components/MultiplayerCanvas.tsx`](../../../app/play/components/MultiplayerCanvas.tsx)

Today:

```ts
const myDerivedWeaponPositions = useMemo(() => {
  const territory = myCards['territory'] ?? [];
  const myZone = myZones['territory'];
  // ...
});
```

Add a parallel memo for LOB, or generalize both memos to iterate both zones and merge results into one map. The key function is "given an accessory, compute (x, y) for its render position + (seamX, seamY) for the detach icon."

For LOB, the host's screen position comes from `calculateAutoArrangePositions(lobHosts.length, ...)` (the auto-arrange grid), not from the host's stored posX/posY. So:

1. Compute `lobHosts` (unattached LOB cards, in whatever order LOB renders them — likely `zoneIndex` ascending after `compactLobIndices`).
2. Compute slot positions for those hosts.
3. For each host that has an attached accessory (via `c.equippedToInstanceId === host.id`), derive the accessory's render position from the host's slot + `computeEquipOffset(cardWidth, cardHeight, 0)`.

Do this for both my LOB and opponent LOB. Opponent LOB renders rotated 180°, same as opponent territory — flip the offset sign the same way.

**Gotcha:** today the LOB card dimensions are `lobCard.cardWidth` / `lobCard.cardHeight`, not the main `cardWidth` / `cardHeight`. Make sure `computeEquipOffset` gets the LOB dimensions so the offset looks visually right at LOB scale.

### Task 6 — Two-pass render for LOB

**File:** [`app/play/components/MultiplayerCanvas.tsx`](../../../app/play/components/MultiplayerCanvas.tsx) — the LOB render blocks (my side and opponent side)

Today the LOB render maps over `cards` in order with `calculateAutoArrangePositions`. Refactor to:

```tsx
const hosts = sorted.filter(c => c.equippedToInstanceId === 0n);
const slotPositions = calculateAutoArrangePositions(hosts.length, zone, lobCardWidth, lobCardHeight);

hosts.flatMap((host, i) => {
  const attachedSites = sorted.filter(s => s.equippedToInstanceId === host.id);
  const nodes = [];
  for (const site of attachedSites) {
    // render site at derived offset position (behind)
  }
  // render host at its auto-arrange slot (in front)
  nodes.push(renderCard(host, slotPositions[i]));
  return nodes;
});
```

Exactly the same shape as the territory two-pass render. Mirror for opponent LOB.

### Task 7 — Drag hit-test: site↔soul in LOB

**File:** [`app/play/components/MultiplayerCanvas.tsx`](../../../app/play/components/MultiplayerCanvas.tsx) — `handleCardDragEnd`

Today the equip hit-test fires for:

```ts
!isGroupDrag &&
targetZone === 'territory' &&
hit.owner === 'my' &&
card.ownerId === 'player1' &&
isWeapon(cardMeta)
```

Extend to also fire for LOB with site/soul pairings:

```ts
// Equip (existing): weapon on warrior in territory
// Site attach (new): site on soul OR soul on site in LOB
if (!isGroupDrag && hit.owner === 'my' && card.ownerId === 'player1') {
  if (targetZone === 'territory' && isWeapon(cardMeta)) {
    // existing equip path — weapon.attachTo(warrior)
  } else if (targetZone === 'land-of-bondage') {
    const draggedIsSite = isSite(cardMeta);
    const draggedIsSoul = cardMeta?.type === 'LS' /* or equivalent check */;
    if (draggedIsSite) {
      // find a host soul at drop point; attach with roles: accessory=site, host=soul
      //   reducer call: attachCard(siteId, soulId)
    } else if (draggedIsSoul) {
      // find a free site at drop point; attach with roles: accessory=site, host=soul
      //   reducer call: attachCard(siteId, soulId) — note site is the accessory either way
    }
  }
}
```

**Invariant:** the reducer's first argument is always the accessory (weapon or site), second is always the host (warrior or soul). The attach call is symmetric w.r.t. which card the user drags — the client picks which is which based on card type.

Use the same `hitTestWarrior` helper but pass different candidate sets. Rename `hitTestWarrior` → `hitTestHost` if the generic name fits better; otherwise, leave it named for equip and reuse it — the math is the same.

**Handle the hit-test position issue from equip:** in multiplayer, `GameCard.posX/posY` is normalized (0–1), not pixels. The hit-test expects pixels. Same fix as the equip port — convert candidate positions via `toScreenPos` before passing in. For LOB hosts, the "position" comes from the auto-arrange slot, not `toScreenPos`. Just build candidate pseudo-cards with pixel `posX/posY` set to the slot coords.

### Task 8 — Drag-start: soul-drag drags its site

**File:** [`app/play/components/MultiplayerCanvas.tsx`](../../../app/play/components/MultiplayerCanvas.tsx) — `handleCardDragStart`

Today:

```ts
const equipFollowerIds =
  !isMultiSelectDrag && card.zone === 'territory' && card.ownerId === 'player1'
    ? (myCards['territory'] ?? [])
        .filter(c => c.equippedToInstanceId === BigInt(card.instanceId))
        .map(c => String(c.id))
    : [];
```

Generalize to also include the LOB case. When dragging a soul in LOB that has an attached site, the site should follow along (ghost-rasterized behind the soul during the drag). When dragging a site in LOB that has a... wait, sites are accessories, they don't have followers. The host (soul) is what drags followers.

```ts
const followerZones = ['territory', 'land-of-bondage'];
const equipFollowerIds =
  !isMultiSelectDrag && followerZones.includes(card.zone) && card.ownerId === 'player1'
    ? (myCards[card.zone] ?? [])
        .filter(c => c.equippedToInstanceId === BigInt(card.instanceId))
        .map(c => String(c.id))
    : [];
```

### Task 9 — Detach overlay for LOB

**File:** [`app/play/components/MultiplayerCanvas.tsx`](../../../app/play/components/MultiplayerCanvas.tsx) — detach overlay HTML block

Today the overlay iterates `myCards['territory']` looking for attached accessories. Extend to also iterate `myCards['land-of-bondage']`. Use the unified derived-positions map (task 5). The seam position for LOB accessories is the slot position of the host, converted to screen coords.

Use the same `toDbPos` call on detach, but for LOB cards `posX/posY` are meaningless (auto-arranged), so passing empty strings is fine — the reducer's `posX || weapon.posX` fallback handles it.

### Task 10 — Tests

Port the goldfish equip tests (`app/goldfish/state/__tests__/gameReducer.equip.test.ts`) into a new file covering the multiplayer reducer shape — but reducer-level unit tests for SpacetimeDB modules aren't straightforward. Minimum bar: a manual E2E checklist.

**Manual checklist (two browser windows on dev DB):**
- Site dragged from hand into empty LOB → site sits in auto-arrange slot.
- Soul (lost soul in LOB) dragged onto free site → attaches, site goes behind.
- Site dragged onto free soul in LOB → same attachment.
- Cap: second site dragged onto a soul already hosting one → rejected by reducer.
- Detach via unlink icon → both stay in LOB, attached becomes free.
- Rescue: soul dragged to LOR → soul rescued, site stays in LOB (attached=false).
- Bounce: site dragged from LOB to hand → site returns to hand, soul stays in LOB.
- Discard the site → site to discard, soul stays in LOB.
- Opponent view: attached pair renders mirrored correctly.
- Opponent view: no detach icon on opponent's attached pair.
- Spectator: attached pair renders correctly.

---

## Open design questions

### Q1 — Can multiple sites attach to one soul? Or multiple souls to one site?
**Answered:** no. One site per soul, one soul per site. Server-side cap (like weapons).

### Q2 — Cascade when site is discarded/banished
**Answered:** site leaves LOB → attachment clears, soul stays. No cascade. Covered by the generalized cascade rule.

### Q3 — Do sites auto-arrange in LOB alongside souls, or do they get their own sub-strip?
**Not explicitly answered.** Default proposal: sites auto-arrange alongside souls in the existing horizontal strip. Attached sites don't take a slot (they tuck behind their soul). The fresh agent should confirm with the user — a separate strip could make sense if the UX looks cramped once sites are added.

### Q4 — Does a site "protect" the soul from rescue in some rules?
Not part of this spec. We're modeling the visual/data relationship, not enforcing any rescue restrictions. The soul is always draggable; rescue always works.

### Q5 — Does a site attached to a soul count as "in LOB" for other reducers (e.g. zone search, count badges)?
Yes. An attached site is still a LOB card — just one that doesn't take its own slot visually. All zone membership checks (`c.zone === 'land-of-bondage'`) should continue to return it. Zone count badges include attached sites. Verify this by searching for any reducer / view that counts LOB cards and confirming none of them filter by `equippedToInstanceId`.

### Q6 — Opponent's sites and souls
Same visibility as normal LOB — public. Render the attached pair correctly on both sides. No attach/detach affordance for the opponent's pairs.

---

## Estimate

Smaller than the equip port (~60% the work) because:
- No schema change.
- Infrastructure (pointer, attach/detach reducers, render pipeline, overlay) already exists.
- Only the zone-specific logic and the role-disambiguating hit-test are new.

Roughly: 1h on reducer generalization, 30m on `isSite`, 1–2h on the canvas refactor (auto-arrange + two-pass render), 30m on detach overlay, 30m on manual testing. Expect ~3–4h end-to-end.

---

## Files to read before starting

1. [`docs/superpowers/specs/2026-04-17-multiplayer-equip-port.md`](./2026-04-17-multiplayer-equip-port.md) — the port this feature parallels.
2. [`spacetimedb/CLAUDE.md`](../../../spacetimedb/CLAUDE.md) — **mandatory** before touching the module.
3. [`spacetimedb/src/index.ts`](../../../spacetimedb/src/index.ts) — in particular `attach_card`, `detach_card`, `move_card`, `move_cards_batch` as they stand after the equip port.
4. [`app/play/components/MultiplayerCanvas.tsx`](../../../app/play/components/MultiplayerCanvas.tsx) — the equip hit-test, two-pass render, detach overlay, and `myDerivedWeaponPositions` memo are the templates to copy.
5. [`app/play/layout/multiplayerAutoArrange.ts`](../../../app/play/layout/multiplayerAutoArrange.ts) — LOB layout helper.
6. [`lib/cards/lookup.ts`](../../../lib/cards/lookup.ts) — card classification helpers.

---

## Gotchas carried forward from the equip port

- **Hit-test coord mismatch.** `hitTestWarrior` expects pixel coords. Multiplayer `GameCard.posX/posY` is normalized 0–1. Convert candidates to pixels via `toScreenPos` before calling. For LOB hosts, pixels come from the auto-arrange slot directly — no conversion needed, but build the candidate objects with pixel `posX/posY`.
- **Imperative z-order during warrior-drag.** The drag-end imperative `moveToTop` loop sorts group nodes so that accessories (attached cards) move-to-top **first** (so they end up below hosts). That generic rule — attached-first, then hosts — applies here too. Verify during drag of an attached soul+site pair.
- **Drag-end overlay flash.** The detach icon is hidden during drag via `isCardDraggingUi`, with a ~220ms settle delay so the DB subscription can catch up before the overlay renders. Reuse that mechanism.
- **Publish to prod requires `--clear-database`.** Schema-adjacent changes (new reducers don't count, but any `.default()` addition does) need a clear when publishing to production. This spec has **no schema change**, so publish to dev and prod without `--clear`. Verify by attempting `spacetime publish redemption-multiplayer-dev` (no `--clear`) first — if it succeeds, production will too.
