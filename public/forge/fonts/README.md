# Forge preview fonts — LIBRE ONLY

The `<ForgeCardPreview>` renders with **freely-redistributable** fonts only.
Do **NOT** add the original Figma-kit fonts here — they are proprietary and were
removed to avoid redistribution/DMCA exposure in this public repo:

| Removed (proprietary) | Owner | Replace with (libre) | License |
|---|---|---|---|
| Helvetica Bold / Oblique | Apple / Linotype (Monotype) | **Arimo** (Regular/Bold/Italic) — metrically identical to Helvetica | Apache-2.0 |
| Symphony Black (CG Symphony) | Agfa / Monotype | **Anton** or **Archivo Black** (card titles) | SIL OFL 1.1 |
| grail.ttf | WSI (proprietary clone) | **Arimo** (or an OFL face matching its use) | Apache-2.0 |

Drop the chosen `.ttf`/`.woff2` files here and wire them via `@font-face` in the
preview component. `@font-face` is structured so a different substitute is a
one-line swap. Final title-font pick is tuned visually against
`../frames/Complete Cards/` references during the build.
