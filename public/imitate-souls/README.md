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
