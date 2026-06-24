# Forge card-frame assets

Static chrome for the Forge card preview (`<ForgeCardPreview>`), composited from the
"Redemption card designer" Figma kit. Generic template art (not playtest-secret), so it
lives in `public/`. Layout canvas = **750×1050**.

## `Elements/` — the composite layers the preview actually uses (WebP)
The clean building-block layers, with NO baked text. Converted from the kit's PNGs to
WebP (`scripts/forge-convert-frames.mjs`); the raw `*.png` are git-ignored. Includes:
- `White Border.webp`, `Art Box.webp`, `Identifier Box.webp`, `Verse Lines=*.webp`
- `Background=<brigade>.webp` — brigade washes (single), e.g. `Background=blue.webp`.
  Supported brigades: blue, clay, gold, green, purple, silver, white, black, brown,
  crimson, gray, orange, pale-green. (Red / Teal / Evil Gold are unsupported.)
- `Background=<a>/<b>.webp` — nested dual-brigade washes.
- `Background={lost-soul,artifact,good-dom,evil-dom,good-fort,evil-fort,default}.webp` —
  special-type washes (brigade-less types).
- `Color=<X>/...` — dual-combo stat-box color elements (single-brigade stat boxes are
  rendered as solid color in code; no single `Color=<X>` file exists in the kit).
Asset → path mapping lives in `app/forge/lib/frameAssets.ts` (with solid-color fallback
for anything missing).

## `Icons/` — type / class icons (transparent PNG)
e.g. `Cross Icon.png` (Hero), `Skull.png` / `Evil Character.png` (Evil Character),
`Site.png`, plus `Warrior-Class.png` / `Weapon-Class.png` / `Territory-Class.png`, `Bible.png`.

## Reference frames (NOT shipped — git-ignored)
The per-type folders (`Heroes/`, `Good Enhancements/`, `Evil Enhancements/`,
`Evil Characters/`, `Sites/`, `Covenants/`, `Curses/`) and `Complete Cards/` are the
*assembled* frames with placeholder text + a checkerboard art window baked in. They are
kept locally for visual tuning only and are git-ignored — the preview never uses them.

Fonts (libre substitutes) live in `../fonts/` — see `../fonts/README.md`.
