# Battle: Controlled Opponent Card Faces You Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When you bring an opponent's card onto your half of the Field of Battle band, it renders **upright (facing you)** while **staying owned by the opponent** (so it still auto-returns to their territory when the battle closes — "control until end of battle").

**Architecture:** Today battle rotation is welded to **card owner** (`owner==='my' ? 0 : 180`). We decouple *rotation + anchor* from ownership and drive them from **which half of the band the card sits on** (its owner-frame center relative to the centerline), while leaving *position mirroring* and *ownership* keyed on owner exactly as before. A single pure helper (`battleCardPlacement`) computes `{x, y, rotation}` for a battle card and is reused at every owner-keyed render site so they cannot drift. Ownership never transfers (spec §4/F2 unchanged).

**Tech Stack:** Next.js 15 / React 19 / TypeScript, react-konva canvas, Vitest. No server or SpacetimeDB changes — this is render-only. No new deps.

## Global Constraints

- **Ownership never transfers on battle drops** (spec §4/F2). `targetOwnerId` stays `''` for battle. This plan changes *rotation/anchor only*, never `ownerId`.
- **Position mirroring stays owner-local.** `toScreenPos(dbX, dbY, band, owner)` is unchanged; only rotation + anchor offset become side-derived. `dbX`/`dbY` are stored owner-local top-left, normalized 0–1.
- **Side is derived, never stored** (spec §3): `centerX = dbX + cardRelW/2`, `cardRelW = cardWidth / band.width`. A card is "crossed" (facing the non-owner) when `centerX < 0.5` in its owner frame. Matches `battleSideOf` in `app/play/lib/battleMath.ts`.
- **The glide slot map and the render loop MUST assign identical `{x, y, rotation}`** for the same card (existing invariant, comment at `MultiplayerCanvas.tsx:5130`). Both must call the shared helper.
- **Rotation anchor convention:** rot 0 anchors top-left; rot 180 anchors bottom-right. Flipping rotation without offsetting the anchor by `±(cardWidth, cardHeight)` moves the card a full card off its intended spot.
- **No unit test can catch a two-player mirror/anchor desync.** Task 7 (two live clients) is mandatory before merge.
- Match existing file style; do not restructure `MultiplayerCanvas.tsx`.

---

## File Structure

- `app/play/utils/coordinateTransforms.ts` — **home of the new pure helper** `battleCardPlacement`. Already owns `toScreenPos`/`toDbPos`/`adjustAnchorForRotationChange` and the `Owner` type. One clear responsibility: DB↔screen geometry.
- `app/play/utils/__tests__/coordinateTransforms.test.ts` — existing; add helper tests.
- `app/play/components/MultiplayerCanvas.tsx` — five owner-keyed battle sites call the helper: render loop (`renderBattleCard`), glide slot map (`battleSlots`), marquee bounds (`allCardBounds`), the two weapon-offset maps, and the drop handler's rotation prediction.

**No change needed** for the hover/selection glow: it is drawn *inside* `GameCardNode` from the `hoverProgress`/`isSelected` props and rotates with the node, so a correct node `rotation` fixes it for free.

---

## Task 1: Pure `battleCardPlacement` helper

**Files:**
- Modify: `app/play/utils/coordinateTransforms.ts` (add after `toScreenPos`, ~line 21)
- Test: `app/play/utils/__tests__/coordinateTransforms.test.ts`

**Interfaces:**
- Consumes: `toScreenPos(dbX, dbY, zone, owner)`, `ZoneRect`, `Owner` (all already in this file).
- Produces:
  ```ts
  export function battleCardPlacement(
    dbX: number, dbY: number, band: ZoneRect, owner: Owner,
    cardWidth: number, cardHeight: number,
  ): { x: number; y: number; rotation: 0 | 180 };
  ```
  Returns the Konva anchor `{x, y}` and `rotation` for a battle card. When the card sits on the half opposite its owner (`centerX < 0.5`), it flips to face the other player and the anchor is offset so the visual rectangle is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `app/play/utils/__tests__/coordinateTransforms.test.ts`:

```ts
import { battleCardPlacement } from '../coordinateTransforms';

describe('battleCardPlacement', () => {
  // 1000px-wide band at origin; a 100px card => cardRelW = 0.1.
  const band = { x: 0, y: 0, width: 1000, height: 400 } as const;
  const W = 100, H = 140;

  it('my card on my half (center >= 0.5) → rot 0, top-left anchor unchanged', () => {
    // dbX 0.6 → center 0.65 → own side. toScreenPos('my') = 600.
    const p = battleCardPlacement(0.6, 0.2, band, 'my', W, H);
    expect(p.rotation).toBe(0);
    expect(p.x).toBeCloseTo(600);
    expect(p.y).toBeCloseTo(80);
  });

  it('opponent card on its own half (center >= 0.5) → rot 180, bottom-right anchor unchanged', () => {
    // owner 'opponent': toScreenPos mirrors (1 - dbX). dbX 0.6 → center 0.65 → own side.
    // toScreenPos('opponent') x = (1 - 0.6) * 1000 = 400.
    const p = battleCardPlacement(0.6, 0.2, band, 'opponent', W, H);
    expect(p.rotation).toBe(180);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(320); // (1 - 0.2) * 400
  });

  it('opponent card dragged onto MY half (center < 0.5) → rot 0, anchor offset by -(W,H)', () => {
    // dbX 0.1 → center 0.15 → crossed. toScreenPos('opponent') x = (1 - 0.1)*1000 = 900 (bottom-right).
    // Flip to rot 0 (top-left) keeping same rectangle → anchor = 900 - 100 = 800.
    const p = battleCardPlacement(0.1, 0.1, band, 'opponent', W, H);
    expect(p.rotation).toBe(0);
    expect(p.x).toBeCloseTo(800);
    expect(p.y).toBeCloseTo(760); // (1 - 0.1)*400 - 140 = 900 - 140
  });

  it('my card shoved onto the opponent half (center < 0.5) → rot 180, anchor offset by +(W,H)', () => {
    // dbX 0.1 → center 0.15 → crossed. toScreenPos('my') x = 100 (top-left).
    // Flip to rot 180 (bottom-right) keeping same rectangle → anchor = 100 + 100 = 200.
    const p = battleCardPlacement(0.1, 0.1, band, 'my', W, H);
    expect(p.rotation).toBe(180);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(180); // 40 + 140
  });

  it('center exactly on the line (0.5) counts as own side (not crossed)', () => {
    // dbX 0.45, cardRelW 0.1 → center 0.5 → NOT crossed (>= 0.5).
    const p = battleCardPlacement(0.45, 0.2, band, 'my', W, H);
    expect(p.rotation).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts -t battleCardPlacement`
Expected: FAIL — `battleCardPlacement is not a function`.

- [ ] **Step 3: Implement the helper**

In `app/play/utils/coordinateTransforms.ts`, after `toScreenPos` (line 21):

```ts
/**
 * Screen placement (anchor + rotation) for a card in the Field of Battle band.
 *
 * Battle cards face the SIDE of the band they occupy, not their owner: a card
 * whose owner-frame center has crossed the centerline (`centerX < 0.5`) — e.g.
 * an opponent hero you've brought onto your half, or your hero shoved onto
 * theirs — flips to face the OTHER player. Ownership is untouched (spec §4);
 * only the visual rotation/anchor follow the side.
 *
 * Position mirroring stays owner-local (`toScreenPos(..., owner)`). rot 0
 * anchors top-left; rot 180 anchors bottom-right, so a flip offsets the anchor
 * by ±(cardWidth, cardHeight) to keep the visual rectangle in place.
 */
export function battleCardPlacement(
  dbX: number,
  dbY: number,
  band: ZoneRect,
  owner: Owner,
  cardWidth: number,
  cardHeight: number,
): { x: number; y: number; rotation: 0 | 180 } {
  const { x, y } = toScreenPos(dbX, dbY, band, owner);
  const cardRelW = cardWidth / (band.width || 1);
  const crossed = dbX + cardRelW / 2 < 0.5;
  if (!crossed) {
    return { x, y, rotation: owner === 'my' ? 0 : 180 };
  }
  // Flip to face the other player, offsetting the anchor to preserve the rect.
  return owner === 'my'
    ? { x: x + cardWidth, y: y + cardHeight, rotation: 180 }
    : { x: x - cardWidth, y: y - cardHeight, rotation: 0 };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run app/play/utils/__tests__/coordinateTransforms.test.ts -t battleCardPlacement`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/play/utils/coordinateTransforms.ts app/play/utils/__tests__/coordinateTransforms.test.ts
git commit -m "feat(battle): side-based placement helper for controlled-card facing"
```

---

## Task 2: Render loop uses side-based placement

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` — `renderBattleCard` closure, ~6684-6712.

**Interfaces:**
- Consumes: `battleCardPlacement` (Task 1). `band` (`mpLayout.zones.battle`), `owner` (`'my'|'opponent'`), `cardWidth`, `cardHeight` are in scope.
- Produces: battle `GameCardNode`s whose `x/y/rotation` are side-derived. Later tasks (glide/marquee/weapons) must produce the SAME `{x, y, rotation}` for the same card.

- [ ] **Step 1: Replace the owner-based position/rotation/clamp block**

Current (~6686-6712):

```ts
                let x: number, y: number;
                if (overridePos) {
                  x = overridePos.x;
                  y = overridePos.y;
                } else if (card.posX) {
                  ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), band, owner));
                } else if (owner === 'my') {
                  x = band.x + 20;
                  y = band.y + 24;
                } else {
                  ({ x, y } = toScreenPos(0, 0, band, 'opponent'));
                }
                // Render-time clamp (spec §2): own cards clamp the bottom edge;
                // opponent-owned rot-180 anchors are the visual bottom-right, so
                // keep the anchor a card-height below the band top instead.
                if (owner === 'my') {
                  y = Math.min(y, band.y + band.height - cardHeight);
                } else {
                  y = Math.max(y, band.y + cardHeight);
                }
                return (
                  <GameCardNode
                    key={String(card.id)}
                    card={gameCard}
                    x={x}
                    y={y}
                    rotation={owner === 'my' ? 0 : 180}
```

Replace with:

```ts
                let x: number, y: number, rotation: number;
                if (overridePos) {
                  // Weapon override positions carry their own anchor; keep the
                  // owner-default rotation (weapons follow their host — Task 5).
                  x = overridePos.x;
                  y = overridePos.y;
                  rotation = owner === 'my' ? 0 : 180;
                } else if (card.posX) {
                  ({ x, y, rotation } = battleCardPlacement(
                    parseFloat(card.posX), parseFloat(card.posY), band, owner, cardWidth, cardHeight,
                  ));
                } else if (owner === 'my') {
                  x = band.x + 20;
                  y = band.y + 24;
                  rotation = 0;
                } else {
                  ({ x, y } = toScreenPos(0, 0, band, 'opponent'));
                  rotation = 180;
                }
                // Render-time clamp (spec §2) follows the RENDERED rotation, not
                // owner: rot-0 anchors top-left (clamp the bottom edge); rot-180
                // anchors bottom-right (keep it a card-height below the band top).
                if (rotation === 0) {
                  y = Math.min(y, band.y + band.height - cardHeight);
                } else {
                  y = Math.max(y, band.y + cardHeight);
                }
                return (
                  <GameCardNode
                    key={String(card.id)}
                    card={gameCard}
                    x={x}
                    y={y}
                    rotation={rotation}
```

- [ ] **Step 2: Type-check the file**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep MultiplayerCanvas || echo "no MultiplayerCanvas type errors"`
Expected: `no MultiplayerCanvas type errors`.

- [ ] **Step 3: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(battle): render controlled opponent card upright on your half"
```

---

## Task 3: Glide slot map matches the render

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` — `battleSlots` useMemo, ~5191-5231.

**Interfaces:**
- Consumes: `battleCardPlacement` (Task 1). Must emit the identical `{x, y, rotation}` the render loop (Task 2) assigns, or the FLIP tween fights the JSX value.

- [ ] **Step 1: Replace the two owner-based branches**

Current non-weapon branches (~5203-5228):

```ts
      let x: number, y: number;
      if (card.posX) {
        ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), band, 'my'));
      } else {
        x = band.x + 20;
        y = band.y + 24;
      }
      y = Math.min(y, band.y + band.height - cardHeight);
      m.set(String(card.id), { x, y, rotation: 0 });
```

Replace the `my` branch body with:

```ts
      let x: number, y: number, rotation: number;
      if (card.posX) {
        ({ x, y, rotation } = battleCardPlacement(
          parseFloat(card.posX), parseFloat(card.posY), band, 'my', cardWidth, cardHeight,
        ));
      } else {
        x = band.x + 20;
        y = band.y + 24;
        rotation = 0;
      }
      y = rotation === 0
        ? Math.min(y, band.y + band.height - cardHeight)
        : Math.max(y, band.y + cardHeight);
      m.set(String(card.id), { x, y, rotation });
```

And the opponent branch (~5220-5228):

```ts
      const { x: rawX, y: rawY } = toScreenPos(
        card.posX ? parseFloat(card.posX) : 0,
        card.posY ? parseFloat(card.posY) : 0,
        band,
        'opponent',
      );
      const y = Math.max(rawY, band.y + cardHeight);
      m.set(String(card.id), { x: rawX, y, rotation: 180 });
```

becomes:

```ts
      const { x: rawX, y: rawY, rotation } = battleCardPlacement(
        card.posX ? parseFloat(card.posX) : 0,
        card.posY ? parseFloat(card.posY) : 0,
        band, 'opponent', cardWidth, cardHeight,
      );
      const y = rotation === 180
        ? Math.max(rawY, band.y + cardHeight)
        : Math.min(rawY, band.y + band.height - cardHeight);
      m.set(String(card.id), { x: rawX, y, rotation });
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep MultiplayerCanvas || echo "no MultiplayerCanvas type errors"`
Expected: `no MultiplayerCanvas type errors`.

- [ ] **Step 3: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(battle): glide slot map tracks side-based rotation"
```

---

## Task 4: Marquee bounds use side-based placement

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` — `allCardBounds` battle section, ~5681-5715.

**Interfaces:**
- Consumes: `battleCardPlacement` (Task 1). A `CardBound` stores the bounding-box **top-left** + `rotation`; for rot 180 the top-left is `anchor - (cardWidth, cardHeight)` (existing convention).

- [ ] **Step 1: Replace both battle loops**

Current (~5681-5715):

```ts
      for (const card of myCards['battle'] ?? []) {
        let x: number, y: number;
        if (card.posX) {
          ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), band, 'my'));
        } else {
          x = band.x + 20;
          y = band.y + 24;
        }
        bounds.push({
          instanceId: String(card.id),
          x, y, width: cardWidth, height: cardHeight, rotation: 0, owner: 'my',
        });
      }
      for (const card of opponentCards['battle'] ?? []) {
        const { x: anchorX, y: anchorY } = toScreenPos(
          card.posX ? parseFloat(card.posX) : 0,
          card.posY ? parseFloat(card.posY) : 0,
          band, 'opponent',
        );
        // Rotation=180: anchor is the bottom-right corner.
        bounds.push({
          instanceId: String(card.id),
          x: anchorX - cardWidth, y: anchorY - cardHeight,
          width: cardWidth, height: cardHeight, rotation: 180, owner: 'opponent',
        });
      }
```

Replace with (note: `pushBattleBound` folds the shared anchor→top-left conversion so both owners share one code path):

```ts
      const pushBattleBound = (card: CardInstance, owner: 'my' | 'opponent') => {
        let anchorX: number, anchorY: number, rotation: number;
        if (card.posX) {
          ({ x: anchorX, y: anchorY, rotation } = battleCardPlacement(
            parseFloat(card.posX), parseFloat(card.posY), band, owner, cardWidth, cardHeight,
          ));
        } else {
          anchorX = band.x + 20;
          anchorY = band.y + 24;
          rotation = 0;
        }
        // rot 180 anchors bottom-right; the bounding box top-left is anchor-(w,h).
        bounds.push({
          instanceId: String(card.id),
          x: rotation === 180 ? anchorX - cardWidth : anchorX,
          y: rotation === 180 ? anchorY - cardHeight : anchorY,
          width: cardWidth, height: cardHeight, rotation, owner,
        });
      };
      for (const card of myCards['battle'] ?? []) pushBattleBound(card, 'my');
      for (const card of opponentCards['battle'] ?? []) pushBattleBound(card, 'opponent');
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep MultiplayerCanvas || echo "no MultiplayerCanvas type errors"`
Expected: `no MultiplayerCanvas type errors`.

- [ ] **Step 3: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(battle): marquee bounds follow side-based rotation"
```

---

## Task 5: Weapon offsets follow the host's facing

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` — `myBattleDerivedWeaponPositions` (~5067-5093) and `opponentBattleDerivedWeaponPositions` (~5098-5124).

**Background:** A weapon is offset from its host by `computeEquipOffset`. For a top-left (rot 0) host the weapon extends `+ (dx, dy)`; for a bottom-right (rot 180) host it extends `- (dx, dy)`. Today the sign is chosen by owner. It must instead follow the host's **rendered facing** so a weapon on a controlled (crossed) host stays attached.

**Interfaces:**
- Consumes: `battleCardPlacement` (Task 1).

- [ ] **Step 1: Rewrite `myBattleDerivedWeaponPositions` host placement + offset sign**

Replace (~5081-5090):

```ts
      const { x: hostX, y: hostY } = toScreenPos(
        parseFloat(host.posX),
        parseFloat(host.posY),
        battleBandRect,
        'my',
      );
      accessories.forEach((w, i) => {
        const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
        result.set(String(w.id), { x: hostX + dx, y: hostY + dy });
      });
```

with:

```ts
      const { x: hostX, y: hostY, rotation } = battleCardPlacement(
        parseFloat(host.posX), parseFloat(host.posY), battleBandRect, 'my', cardWidth, cardHeight,
      );
      const sign = rotation === 180 ? -1 : 1;
      accessories.forEach((w, i) => {
        const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
        result.set(String(w.id), { x: hostX + sign * dx, y: hostY + sign * dy });
      });
```

- [ ] **Step 2: Rewrite `opponentBattleDerivedWeaponPositions` host placement + offset sign**

Replace (~5112-5121):

```ts
      const { x: hostX, y: hostY } = toScreenPos(
        parseFloat(host.posX),
        parseFloat(host.posY),
        battleBandRect,
        'opponent',
      );
      accessories.forEach((w, i) => {
        const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
        result.set(String(w.id), { x: hostX - dx, y: hostY - dy });
      });
```

with:

```ts
      const { x: hostX, y: hostY, rotation } = battleCardPlacement(
        parseFloat(host.posX), parseFloat(host.posY), battleBandRect, 'opponent', cardWidth, cardHeight,
      );
      const sign = rotation === 180 ? -1 : 1;
      accessories.forEach((w, i) => {
        const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
        result.set(String(w.id), { x: hostX + sign * dx, y: hostY + sign * dy });
      });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep MultiplayerCanvas || echo "no MultiplayerCanvas type errors"`
Expected: `no MultiplayerCanvas type errors`.

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(battle): weapon offsets follow controlled host's facing"
```

---

## Task 6: Drop lands where the cursor is for cross-side drops

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` — drop handler rotation prediction, ~4102-4120.

**Background:** On drop, `adjustAnchorForRotationChange` shifts the drop position by `±(cardW, cardH)` when the card crosses rotation contexts, so it lands visually under the cursor. `targetIsRotated` currently predicts the battle rotation as `sourceOwner === 'opponent'`. After Tasks 2–3 the rendered rotation follows the **drop half** (viewer-relative), so the prediction must too, or a controlled card lands one card-width off the cursor.

**Interfaces:**
- Consumes: `battleBandRect` (in scope as `zoneRect` when `targetZone === 'battle'`), `dropX` (drop cursor screen X).

- [ ] **Step 1: Predict rotation from the drop half, and set the render owner to match**

Current (~4102-4120):

```ts
      // Battle renders by CARD owner (my cards rot 0, opponent-owned rot 180)
      // — the hit owner is always 'my' and must not drive rotation there.
      const targetIsRotated =
        targetZone === 'battle'
          ? sourceOwner === 'opponent'
          : isOpponentTarget && isFreeFormZone(targetZone);
      const { x: adjDropX, y: adjDropY } = adjustAnchorForRotationChange(
        dropX, dropY, dragW, dragH, sourceIsRotated, targetIsRotated,
      );

      // Battle positions mirror by CARD owner ('my'/'opponent' relative to me),
      // NOT by hit owner, so each player's cards land on their own half on
      // both screens (spec §3). Shared-owned cards render rot 0 → 'my'.
      const targetOwner: 'my' | 'opponent' =
        targetZone === 'battle'
          ? (sourceOwner === 'opponent' ? 'opponent' : 'my')
          : isOpponentTarget
          ? 'opponent'
          : 'my';
```

Replace with:

```ts
      // Battle now renders by the SIDE the card lands on, not owner: a card
      // whose center is dropped on the viewer's LEFT half faces away (rot 180).
      // Predict that here so the anchor-adjust lands the card under the cursor.
      const bandCenterX = zoneRect ? zoneRect.x + zoneRect.width / 2 : 0;
      const dropOnViewerLeftHalf =
        targetZone === 'battle' && dropX + dragW / 2 < bandCenterX;
      const targetIsRotated =
        targetZone === 'battle'
          ? dropOnViewerLeftHalf
          : isOpponentTarget && isFreeFormZone(targetZone);
      const { x: adjDropX, y: adjDropY } = adjustAnchorForRotationChange(
        dropX, dropY, dragW, dragH, sourceIsRotated, targetIsRotated,
      );

      // Position mirroring (toDbPos frame) still keys on CARD owner so the
      // stored owner-local coords round-trip and mirror correctly on both
      // screens (spec §3/§4 — ownership never transfers). Only rotation is
      // side-derived (above); the render recomputes it from the stored center.
      const targetOwner: 'my' | 'opponent' =
        targetZone === 'battle'
          ? (sourceOwner === 'opponent' ? 'opponent' : 'my')
          : isOpponentTarget
          ? 'opponent'
          : 'my';
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep MultiplayerCanvas || echo "no MultiplayerCanvas type errors"`
Expected: `no MultiplayerCanvas type errors`.

- [ ] **Step 3: Full unit-test gate (no regressions)**

Run: `npx vitest run app/play/lib/__tests__/battleMath.test.ts app/play/utils/__tests__/coordinateTransforms.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(battle): controlled-card drops land under the cursor"
```

---

## Task 7: Two-client live verification (mandatory)

**Files:** none (manual + Playwright). No unit test can catch a mirror/anchor desync — this task is the real gate.

**Setup:** Follow the `verify` skill to mint two real Supabase sessions and drive two dev-server clients (Player A and Player B) into an active battle. Seat helpers and battle-deck seeding are in the multiplayer E2E harness (see memory `reference_multiplayer_konva_e2e_driving`).

- [ ] **Step 1: Bring an opponent card onto your half**

As Player A, open a battle. Drag one of **Player B's** cards from B's territory (or via a control-take) into the band and drop it on **A's right half**.

- [ ] **Step 2: Verify Player A's screen**

Expected: the card renders **upright (rot 0)** on A's right half, positioned under where it was dropped (not offset by a card), with the hover glow and selection outline aligned to the card. `git`-owned data unchanged: the card's `ownerId` is still Player B.

- [ ] **Step 3: Verify Player B's screen (mirror consistency)**

Expected: the same card appears on **B's left half, upside-down (rot 180)** — i.e. it faces A on both screens. No duplicate/ghost node, no drift from the shared position.

- [ ] **Step 4: Verify auto-return ("stays theirs")**

Close the band (leave the battle phase). Expected: the controlled card auto-returns to **Player B's territory** (its owner), confirming ownership never transferred.

- [ ] **Step 5: Regression — normal battle unchanged**

Each player drags their **own** hero into the band on their own half. Expected: identical to today — own cards upright on your half on your screen, upside-down on the opponent's. A defender's own card entering the band is unaffected.

- [ ] **Step 6 (edge): weapon on a controlled host**

Equip a weapon on the controlled card before/while it is on your half. Expected: the weapon stays attached at the correct offset (extends the correct direction for the host's rotation).

- [ ] **Step 7: Final commit / PR**

```bash
git add -A
git commit -m "test(battle): verified controlled-card facing across two clients"
```
Open the PR from this branch against `origin/main`.

---

## Self-Review Notes

- **Spec coverage:** "upright" → Tasks 2/3; "stays theirs" (no ownership transfer) → Global Constraints + Task 6 keeps `targetOwner` frame by owner and never touches `ownerId`; every owner-keyed render site (render, glide, marquee, weapons) → Tasks 2–5; drop accuracy → Task 6; cross-screen consistency + auto-return → Task 7.
- **Naming consistency:** helper is `battleCardPlacement(dbX, dbY, band, owner, cardWidth, cardHeight) → {x, y, rotation}` everywhere it's referenced (Tasks 2–5).
- **Known non-goal:** this plan does not add a *gesture* to distinguish "take control" from "courtesy reposition." Any drag of an opponent card onto your half will render it facing you while it sits there; ownership is unchanged, so it is purely visual and reverts on auto-return. If a stricter intent signal is wanted later, gate the crossed-flip behind an explicit "take control" action — separate task.
- **Line numbers** are from the branch state on 2026-07-16; re-locate by the quoted code if the file has shifted.
