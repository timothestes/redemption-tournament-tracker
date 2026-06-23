# Forge card-frame assets

Static chrome for the Forge card preview (`<ForgeCardPreview>`). Generic Redemption
template art (not playtest-secret), so it lives in `public/`. Layout canvas = **750×1050**.

## backgrounds/  — brigade washes, full-card 750×1050 PNG (1x)
One file per brigade, named by slug. The preview falls back to a solid brigade color
if a file is missing, so partial sets are fine.

Good:  `blue` `clay` `good-gold` `green` `purple` `red` `silver` `teal` `white` `good-multi`
Evil:  `black` `brown` `crimson` `evil-gold` `gray` `orange` `pale-green` `evil-multi`
Dual:  e.g. `blue-orange.png` (any order — mapping is normalized in code)
None:  `neutral.png` (Artifact/Dominant/Lost Soul with no brigade)

## icons/  — type & identifier icons, transparent PNG @2x (or SVG)
Named by meaning, e.g. `evil-character.png`, `hero.png`, `good-enhancement.png`,
`site.png`, `fortress.png`, `lost-soul.png`, `artifact.png`, `dominant.png`. If unsure
how an icon maps, just drop it here and note it — I'll wire the legend.

## reference/  — for geometry only (not shipped to the preview)
Drop a full rendered card (the Babylonians one) and/or a blank Hero template here so
slot positions can be measured against the 750×1050 canvas.
