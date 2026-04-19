# Virtual Canvas Scaling System

**Date:** 2026-03-29
**Status:** Design approved, pending implementation
**Scope:** Display refactor for goldfish and multiplayer play modes

## Problem

Both play modes (goldfish and multiplayer) calculate card sizes and zone positions as proportions of the viewport/container. Cards at 5.2% of viewport width look different on every screen. The goldfish mode hard-caps at 2.0 aspect ratio as a band-aid. The multiplayer mode has no cap at all. Users report the game looks wrong on their displays, and there's no way to dial in a layout that works across standard monitors, ultrawides, and tablets without testing each one.

## Decision

Replace viewport-relative layout math with a **fixed virtual canvas** (1920x1080). All layout coordinates, card sizes, and zone positions are expressed in this virtual space. A single Konva layer-level scale transform fits the virtual canvas to any real screen, with styled letterboxing on mismatched aspect ratios. This is the standard approach in 2D game engines.

### Key decisions made during brainstorming

- **One shared scaling system** for both goldfish and multiplayer (same virtual canvas size, same scaling engine, different zone layout functions)
- **Desktop + ultrawide support** — mobile deferred
- **Strict 16:9 letterbox** — no flexible-width stretching on ultrawide. Letterbox areas show the cave background texture. Every player sees the same layout.
- **Konva Stage scale transform** (Approach A) — versus manual coordinate scaling or CSS transform. Konva handles both rendering and pointer event transformation natively.

## Architecture

### Virtual Canvas Module

New shared module: `app/shared/layout/virtualCanvas.ts`

```typescript
// Virtual canvas constants
export const VIRTUAL_WIDTH = 1920;
export const VIRTUAL_HEIGHT = 1080;
export const VIRTUAL_ASPECT_RATIO = VIRTUAL_WIDTH / VIRTUAL_HEIGHT; // 16:9

// Scaling calculation
export function calculateScale(containerWidth: number, containerHeight: number) {
  const scale = Math.min(
    containerWidth / VIRTUAL_WIDTH,
    containerHeight / VIRTUAL_HEIGHT
  );
  const scaledWidth = VIRTUAL_WIDTH * scale;
  const scaledHeight = VIRTUAL_HEIGHT * scale;
  const offsetX = (containerWidth - scaledWidth) / 2;
  const offsetY = (containerHeight - scaledHeight) / 2;
  return { scale, offsetX, offsetY };
}

// Coordinate transforms for HTML overlays
export function virtualToScreen(
  vx: number, vy: number,
  scale: number, offsetX: number, offsetY: number
): { x: number; y: number } {
  return { x: vx * scale + offsetX, y: vy * scale + offsetY };
}

export function screenToVirtual(
  sx: number, sy: number,
  scale: number, offsetX: number, offsetY: number
): { x: number; y: number } {
  return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
}
```

### React Hook

```typescript
export function useVirtualCanvas(containerRef: RefObject<HTMLDivElement | null>) {
  const [container, setContainer] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainer({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const scaling = useMemo(
    () => calculateScale(container.width, container.height),
    [container.width, container.height]
  );

  return { ...scaling, containerWidth: container.width, containerHeight: container.height };
}
```

### Konva Stage Structure (both modes)

```jsx
<Stage
  width={containerWidth}
  height={containerHeight}
  pixelRatio={window.devicePixelRatio}
>
  {/* Layer 0: Letterbox background (real pixel coords) */}
  <Layer>
    <Rect width={containerWidth} height={containerHeight} fill="#0d0905" />
    {/* Cave texture image filling real canvas */}
  </Layer>

  {/* Layer 1: Game board (virtual coords, scaled) */}
  <Layer scaleX={scale} scaleY={scale} x={offsetX} y={offsetY}>
    <Rect width={1920} height={1080} /* game board background */ />
    {/* All zones, cards, hand — 1920x1080 virtual coordinates */}
  </Layer>
</Stage>
```

## Layout Changes

### Card Dimensions Become Constants

**Goldfish** — single card size:
- Card width: 100 (was `1920 * 0.052`)
- Card height: 140 (was `100 * 1.4`)

**Multiplayer** — four tiers, all fixed:
- Main card: ~115x161 (derived from `1632 * 0.06`, where 1632 = play area width at 1920 - 15% sidebar)
- LOB card: same as main if it fits in LOB zone height, otherwise scaled to fit (one-time calculation)
- Opponent hand card: ~86x121 (75% of main)
- Pile card: derived from sidebar slot height (one-time calculation)

These are computed once from the fixed 1920x1080 space and stored as constants. The dynamic card sizing functions (`getMainCardDimensions`, `getLobCardDimensions`, `getOpponentHandCardDimensions`, `getPileCardDimensions`, `getCardDimensions`) are replaced by constant values.

### Zone Layout Functions

`calculateZoneLayout(stageWidth, stageHeight, isParagon)` becomes `calculateZoneLayout(isParagon)`.

All zone rects use fixed virtual coordinates derived from the current proportions applied to 1920x1080. For example:

- Goldfish phase bar: `y=0, height=54` (was `stageHeight * 0.05`)
- Goldfish hand: `y=842, height=238` (was `stageHeight * 0.22`)
- Goldfish territory: `y=54, height=529` (derived from play area proportions)
- Goldfish sidebar: `x=1632, width=288` (was `stageWidth * 0.15`)

Multiplayer zone rects follow the same pattern — the existing ratio constants (`OPP_HAND_RATIO = 0.08`, etc.) are applied to 1080 once to produce fixed Y positions and heights.

The `isParagon` parameter stays — it changes sidebar zone count.

### Hand Layout

`calculateHandPositions` stays as a function (card count varies at runtime), but all inputs are virtual coordinates. The zone rect and card dimensions passed in are fixed values.

## What Gets Deleted

- `CARD_WIDTH_RATIO`, `CARD_HEIGHT_RATIO` (goldfish zoneLayout.ts)
- `getCardDimensions()` (goldfish zoneLayout.ts)
- `MAX_ASPECT_RATIO`, `getEffectiveDimensions()` (goldfish client.tsx)
- `viewport` state and `window.resize` listener (goldfish client.tsx)
- `MAIN_CARD_WIDTH_RATIO`, `MAIN_CARD_HAND_HEADROOM`, `LOB_CARD_HEADROOM`, `OPP_HAND_HEADROOM`, `OPP_HAND_SCALE`, `PILE_LABEL_RATIO` ratio constants (multiplayerLayout.ts)
- `getMainCardDimensions()`, `getLobCardDimensions()`, `getOpponentHandCardDimensions()`, `getPileCardDimensions()` (multiplayerLayout.ts)
- The `aspectRatio < 1.2` squarer-display headroom adjustment (multiplayerLayout.ts)
- Inline `ResizeObserver` in MultiplayerCanvas.tsx (replaced by `useVirtualCanvas` hook)

## Drag & Drop

Konva's layer-level scale transform auto-transforms pointer events. When a node is dragged, Konva internally calls `setAbsolutePosition` which inverts the full parent transform chain — so `e.target.x()`/`e.target.y()` in `onDragEnd` are in the Layer's local coordinate space (virtual coords). No manual conversion needed.

For non-drag pointer operations (e.g., click-to-place), use `node.getRelativePointerPosition()` which performs the same inverse transform.

- Territory free-form positions (`posX`/`posY`) become virtual coordinates (0-1920, 0-1080 range)
- In multiplayer, card positions synced via SpacetimeDB will be in virtual coords. Both players see cards in identical positions regardless of screen size.
- Drop zone hit detection, snap logic — all operate in virtual coords. No logic changes, just the coordinate range shifts.

## HTML Overlay Positioning

HTML elements positioned relative to card/zone locations need coordinate conversion.

**Needs `virtualToScreen` transform:**
- CardContextMenu, MultiCardContextMenu, ZoneContextMenu, DeckContextMenu, LorContextMenu, OpponentZoneContextMenu, HandContextMenu — all positioned at right-click location
- DeckDropPopup — positioned near deck zone
- DiceOverlay / DiceRollOverlay — if positioned relative to game board

**No changes needed:**
- Full-screen modals (ZoneBrowseModal, DeckSearchModal, DeckPeekModal, DeckExchangeModal, OpponentBrowseModal, ConsentDialog) — positioned independently of canvas
- Toast notifications (GameToast) — positioned independently
- Loupe panel (goldfish) — HTML, lives outside canvas container

**Implementation:** Context menu components receive `scale`, `offsetX`, `offsetY` as props (or via context). The click handler converts virtual coords to screen coords before setting menu position.

## Migration Path

1. **Create `virtualCanvas.ts`** — the shared module with constants, `calculateScale`, coordinate transforms, `useVirtualCanvas` hook
2. **Migrate goldfish first** (simpler — one player, fewer zones):
   - Refactor `zoneLayout.ts` to use fixed virtual coordinates
   - Refactor `client.tsx` to use `useVirtualCanvas`
   - Refactor `GoldfishCanvas.tsx` to use scaled Layer
   - Update context menu positioning
3. **Migrate multiplayer second**, applying the same pattern:
   - Refactor `multiplayerLayout.ts` to use fixed virtual coordinates
   - Refactor `MultiplayerCanvas.tsx` to use `useVirtualCanvas` and scaled Layer
   - Update context menu positioning
4. **Verify edge cases**: selection lasso, dice overlay, any `getPointerPosition()` calls

Goldfish and multiplayer can be migrated independently — they don't share layout state.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| HTML overlays positioned at wrong coordinates | Grep for all `getPointerPosition()`, `evt.target.getStage()`, and manual coordinate reads. Ensure all go through `virtualToScreen`. |
| Text/image blurriness at fractional scale | Set `pixelRatio: window.devicePixelRatio` on Stage. Konva renders at native resolution then scales. |
| Existing stored card positions (SpacetimeDB) in old coordinate space | Territory positions are relative within a zone. Since zones are recreated in virtual coords, existing positions may need a one-time reinterpretation — but during early development this is low risk (no persistent production state). |
| Selection lasso draws in wrong coordinate space | Lasso needs to operate in virtual coords (same as cards). If it currently uses raw pointer positions, pipe them through `screenToVirtual`. |

## Out of Scope

- Mobile layout (deferred)
- Flexible-width ultrawide support (strict letterbox chosen)
- Gameplay logic changes (purely a display refactor)
- SpacetimeDB server-side changes (server doesn't care about coordinate systems)
