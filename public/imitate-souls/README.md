# imitate-souls — custom Lost Soul card assets

Custom Redemption CCG card images for use in goldfish and multiplayer
modes. Built by compositing per-card artwork onto a shared Lost Soul
base template.

## Files

- `base.jpg` (345×495) — Lost Soul card template. Has the original
  stained-glass art baked into the art window; we paint over it.
- `sources/<name>.webp` — per-card artwork (800×800), one per custom
  Lost Soul. Inputs to the composite step.
- `cards/<name>.jpg` — final composited cards. **Generated** by
  `build-cards.sh` — do not edit by hand.
- `build-cards.sh` — composite script (ImageMagick).

## Regenerating the cards

```bash
brew install imagemagick   # one-time
./build-cards.sh
```

Each card lands in `cards/<name>.jpg`, ~80 KB.

## How the source art was prepared

Originals were ~3 MB PNGs at 1254×1254. They were resized and re-encoded
to 800-wide WebP at quality 82:

```bash
for f in *.png; do
  cwebp -q 82 -resize 800 0 "$f" -o "${f%.png}.webp"
done
rm *.png
```

This dropped the folder from 97 MB → 4.7 MB (~20× smaller) with no
visible quality loss at the sizes we render cards (max 280×392).

## How the composite was built

ImageMagick draws each art image onto a copy of `base.jpg` inside the
art window, applying a small corner radius so the new art reads as a
proper inset.

Art window coordinates (tuned by eye against the original Lost Soul
bleed — see `build-cards.sh` for the live values):

| param | value | meaning                          |
|-------|-------|----------------------------------|
| x     | 28    | left edge of art window          |
| y     | 46    | top edge (just under title bar)  |
| w     | 290   | width                            |
| h     | 264   | height (stops above "imitate")   |
| r     | 6     | corner radius                    |

The per-card pipeline:

1. Resize the 800×800 source to **cover** a 290×264 box
   (`-resize 290x264^ -gravity center -extent 290x264`) — crops a bit
   of top/bottom since source art is square but the window is slightly
   wider than tall.
2. Build a transparent canvas the same size, draw a white rounded
   rectangle on it, and use `DstIn` composition to mask the art's
   corners.
3. Composite the rounded art onto `base.jpg` at (x, y) with
   `-gravity northwest -geometry +28+46`.

If you add new art:

1. Resize the source to ~800-wide WebP (see the optimization snippet
   above) and drop it in `sources/`.
2. Re-run `./build-cards.sh`.

## Adding a new Lost Soul to the Imitate ability

The right-click "Imitate..." menu on `Lost Soul "Imitate" [III John 1:11]`
lets the player click any N.T. Lost Soul in either Land of Bondage to
copy its art. If the target's `cardName` is registered in
`IMITATE_SOUL_IMAGES`, the source card's image swaps to your custom art.
Otherwise it falls back to a text label overlay with the soul's
simplified name.

To wire a new soul into that flow:

### 1. Add and build the art

1. Drop the 800×800 WebP source in `sources/<name>.webp` (resize first per
   the optimization snippet above).
2. Run `./build-cards.sh` → produces `cards/<name>.jpg`.

### 2. Find the exact `cardName`

The registry is keyed on the carddata `name` field byte-for-byte
(including quotes, set suffixes, and any double spaces). Grep the
generated dataset:

```bash
grep '"name": ".*Hopper.*"' lib/cards/generated/cardData.ts
```

Example output:
```
"name": "Lost Soul \"Hopper\" [Matthew 18:12] [2025 - Seasonal]",
```

The TS string in the registry should use **single quotes** so the inner
double quotes don't need escaping. Some AB variants have a literal
**double space** (e.g. `[III John 1:11]  [AB - RoJ]`) — preserve it
exactly.

### 3. Register the mapping in BOTH registry copies

The mapping lives in two places that a parity test enforces to stay in
sync — edit BOTH:

- [lib/cards/cardAbilities.ts](../../lib/cards/cardAbilities.ts) →
  `IMITATE_SOUL_IMAGES` (client/goldfish copy)
- [spacetimedb/src/cardAbilities.ts](../../spacetimedb/src/cardAbilities.ts) →
  `IMITATE_SOUL_IMAGES` (server copy)

```ts
'Lost Soul "Hopper" [Matthew 18:12] [2025 - Seasonal]': '/imitate-souls/cards/hopper.jpg',
```

If the same art covers multiple variants (e.g. base + AB), add a row per
variant pointing at the same file — see the existing `Forsaken`, `Dull`,
`Humble` entries for examples.

**N.T.-only:** Imitate's rules text restricts copies to New Testament
Lost Souls. The integrity test will fail if you register an OT
`cardName` — the helper `isNewTestamentLostSoul(reference)` parses the
verse reference and rejects OT books. If you need an OT mapping for some
other reason, that's a feature change, not a registry edit.

### 4. Run the parity + integrity tests

```bash
npx vitest run --exclude '.claude/**' lib/cards/__tests__/cardAbilities.test.ts
```

These assert:
- The lib and spacetimedb `IMITATE_SOUL_IMAGES` copies match exactly.
- Every key resolves to a real card via `findCard()`.
- Every value points at an existing file under `public/imitate-souls/cards/`.
- Every registered key has a New Testament reference.

If any assertion fails the error tells you which row is broken.

### 5. Publish the SpacetimeDB module

Multiplayer reads `IMITATE_SOUL_IMAGES` server-side. Any registry edit
needs a republish for multiplayer games to see the new mapping:

```bash
echo "y" | spacetime publish redemption-multiplayer-dev --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
echo "y" | spacetime publish redemption-multiplayer --module-path spacetimedb
```

No `--clear-database` flag — this is a behavior-only change, the schema
isn't moving.

Goldfish picks up the change on the next page load — hard-refresh
(Cmd+Shift+R / Ctrl+Shift+R) once dev is rebuilt.
