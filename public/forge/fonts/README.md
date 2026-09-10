# Forge preview fonts — LIBRE ONLY

Only **freely-redistributable** fonts live here. The printed title and stats faces
(Symphony Black, Grail Light) are licensed, so they are never committed: `make forge-fonts`
uploads them from gitignored `tmp/` to the private Forge Blob store and
`/forge/api/fonts/[face]` streams them to forge members only. `forge-fonts.css` lists that
route as the first `src` of `ForgeTitle` / `ForgeStat` and the files below as the browser's
fallback. Do **NOT** add the original fonts here — they were removed to avoid
redistribution/DMCA exposure in this public repo:

| Removed (proprietary) | Owner | Replace with (libre) | License |
|---|---|---|---|
| Helvetica Bold / Oblique | Apple / Linotype (Monotype) | **Arimo** (Regular/Bold/Italic) — metrically identical to Helvetica | Apache-2.0 |
| Symphony Black (CG Symphony = Syntax) | Agfa / Monotype | **Mukta ExtraBold** (card titles; `Mukta-OFL.txt`) — humanist, spurless G, slanted t, picked against printed Roots / T2C / II cards. Anton and Archivo Black were tried first: too condensed / too grotesque. | SIL OFL 1.1 |
| grail.ttf (stats numerals) | WSI (proprietary clone) | **PT Serif Bold** (stats readout; `PTSerif-OFL.txt`) — printed stats are a bold serif | SIL OFL 1.1 |

Drop the chosen `.ttf`/`.woff2` files here and wire them via `@font-face` in
`app/forge/forge-fonts.css` (`ForgeTitle`, `ForgeStat`, `ForgeBody`). A different substitute is a
one-line swap there; the preview sizes titles for Symphony Black (~0.53em per character,
`TITLE_EM` in `ForgeCardPreview.tsx`), so retune that if the primary face changes width. The
body face also feeds the text-fit check: `make forge-font-metrics` regenerates
`app/forge/lib/fontMetrics.ts` (Arimo Bold / Italic advance widths) if `ForgeBody` ever changes.
