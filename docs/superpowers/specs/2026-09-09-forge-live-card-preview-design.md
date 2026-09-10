# Forge: live rendered card preview in the studio

Issue: #387. Status: approved in chat 2026-09-09 (approach: regenerate the frame kit from the
design team's Illustrator template, draw the chrome as SVG, keep washes and icons as images,
replace the old kit wholesale, remount the composite preview in the studio).

## Goal

Designers editing a card in `/forge/cards/[cardId]` see a rough rendered card beside the form
that updates instantly as they change type, brigade, alignment, stats, identifiers, text,
scripture and art. It is a draft, not the print graphic, and stays badged "preview approximate".

## Non-goals

- Pixel-accurate print output, set symbols, card numbers, promo text, watermark.
- Inline special-ability icons (star, cloud) inside the ability text.
- Any change to how cards are stored. The preview is a pure function of `DesignCard` + art URL.

## Source material and confidentiality

- `tmp/Card_Template-SHUFFLED_3.7.ai` (Illustrator 30.7, Aug 2026). Gitignored. Never committed,
  never uploaded, never copied into `public/`. Only derived rasters and numbers ship.
- The .ai's PDF-visible layer is one flattened configuration. Everything else lives in the
  Illustrator private data: 977 `AIPrivateData` streams that concatenate to a zstd-compressed
  PostScript dialect (`%AI24_ZStandard_Data`). Inside, every object carries its Layers-panel name
  (`/XMLUID`), so extraction is by name, not by guesswork.
- Washes are embedded PDFs (876x1194 CMYK at 318 ppi with soft mask). Icons are raw CMYK
  rasters (`XI` operator) with no alpha. Icon-box colors are vector rects with CMYK fills. The
  document profile is U.S. Web Coated (SWOP) v2 and is used for every CMYK to sRGB conversion.
- `tmp/card-template-allon-editor.html` is a low-resolution third-party export of the same
  objects. Not used as a source.

## Extraction pipeline

`scripts/forge-extract-template.py` (Python 3.11, Pillow with LittleCMS, `zstd` CLI, poppler's
`pdftoppm`/`pdftocairo`). Not run in CI. Documented as `make forge-frames` with the .ai path as
input. Idempotent: it regenerates `public/forge/frames/` in full.

Steps:
1. Parse the PDF wrapper, reassemble `AIPrivateData1..N` by object id using each stream's
   declared `/Length`, strip the `%AI24_ZStandard_Data` prefix, `zstd -d`.
2. Index objects by `XMLUID`. Locate the ASCII85 blocks that precede each wash/badge name and
   decode them (strip only the line-leading `%`; `%` is a valid ASCII85 digit). They are PDFs.
3. Rasterize washes at 300 dpi, crop to the frame rect (border rect 18..180 x 18..252 pt on the
   198x270 pt artboard, i.e. 675x975 px), encode WebP. Synthesize `red` and `teal` by hue-shifting
   `crimson` and `blue`; label them synthesized in the README.
4. Decode `XI` rasters (raw CMYK/Gray bytes, `W*H*4`), convert through the SWOP profile, key the
   flat white or black background to alpha for icons, encode PNG.
5. Rasterize badge PDFs (Artifact, Good/Evil Dominant nebula with lamb/reaper, multi-brigade foil)
   with transparency.
6. Emit `app/forge/lib/frameGeometry.ts`: brigade hex map (ICC-converted), slot rects and the
   ability gradient variants, all in a 750x1050 trim-box canvas. Conversion from artboard points:
   `px = (x - 9) * 750/180`, `py = (261 - y) * 1050/252`.

## Kit layout (replaces `public/forge/frames/Elements`, `Color=*`, `Icons`)

```
public/forge/frames/
  README.md
  washes/<slug>.webp      blue clay gold green purple silver white black brown crimson gray
                          orange pale-green red* teal* lost-soul-{roots,rebellion,inheritance}
                          artifact good-dom evil-dom good-fort evil-fort
  icons/<name>.png        cross skull skull-small dragon bible bible-small site fortress
                          artifact reaper lamb star cloud territory weapon warrior
                          lostsoul-roots lostsoul-rebellion lostsoul-inheritance
  badges/<name>.webp      artifact good-dom evil-dom multi-good multi-evil
```
`*` synthesized. Fonts stay in `public/forge/fonts` (Anton for Symphony Black, Arimo for Arial).

## Geometry (artboard points, origin bottom-left)

| Slot | Rect | Notes |
|---|---|---|
| Trim | 9..189 x 9..261 | 2.5 x 3.5 in, the preview's canvas |
| Border | 18..180 x 18..252, r 9.5 | 1.5 pt dark stroke, white outside |
| Art window | 27..171 x 102.81..234.44, r 7.7 | white fill when empty, dark stroke |
| Text box | 27..171 x 32.48..100.69, r 7.8 | vertical gradient light to black |
| Text inset | 30.6..167.4 | ability text top, scripture bottom |
| Identifier bubble | y 97.74..105.3, centered x 99, w 21.6..144 | black 75%, 0.5 stroke |
| Left icon box | 17.53..57.71 x 221.47..253.23 | clipped by border; brigade fill |
| Right icon box | 139.47..181.39 x 220.54..254.87 | second brigade only |
| Stat text | 22.92..51.33 x 244.62..252.76 | white, dark outline, in left box |
| Class icons | below left box, y 200..228 | up to two, stacked |
| Title band | y 235.1..248.55, right-aligned to x 171 | white, dark outline |
| Credits | y 20..31, right-aligned | "Illus. X", copyright |

Ability gradient (light until A%, black from B% of box height): 2 rows 73/86, 3 rows 64/77,
4 rows 54/68, 5 rows 47/60. Rows = estimated verse lines (~62 chars each) + the reference
line, clamped 2..5. Ability text fills the light region; the verse starts at the B% line so it
is always white-on-dark. The light region is white at 80% opacity over the wash (measured from
the template render), the dark region is the template's 100% K (#231f20).

Title: right-aligned Anton at 48 canvas px, shrinking to 36 for long names and then squeezed
with SVG `textLength` the way printed cards condense long titles. A second brigade's box
shortens the title band.

## Renderer (`app/forge/components/ForgeCardPreview.tsx`, rewritten)

Layers, bottom to top, inside a `750/1050` aspect container with `container-type: inline-size`:
1. White card ground with the trim corner radius.
2. Wash image at the border rect, rounded. Two brigades: second wash clipped to the right half
   with a soft SVG mask. Special types use their special wash (unchanged rules).
3. Uploaded art in the art window (`object-fit: cover`), or an empty white window.
4. SVG chrome (viewBox 0 0 750 1050): border stroke, art window stroke, text box with the
   gradient variant, identifier bubble, icon boxes (brigade fill, or badge image for Artifact,
   Dominant, 3+ brigades), stat text, class icons.
5. HTML text: title (Anton, right-aligned, dark outline), ability text (bold, dark), scripture
   (italic, white), reference (bold, white, right), identifiers (single bubble, joined), credits.
6. "preview approximate" badge (existing rule).

Mapping lives in `app/forge/lib/frameAssets.ts` (pure, unit-tested): `washPaths(card)`,
`iconBox(card, side)`, `typeIcon(card)`, `gradientRows(card)`, `BRIGADE_HEX`.

Type to icon: Hero cross, Evil Character skull, GE bible, EE dragon, Artifact chalice badge,
Dominant lamb/reaper badge, Fortress fortress, Site site, City fortress, Curse dragon,
Covenant bible, Lost Soul the era icon (default rebellion). Verified against real card images
before shipping; corrections go in the mapping table only.

## Studio mount

`StudioEditor` left column: finished-card image when present (unchanged), otherwise
`ForgeCardPreview` driven by the live `snapshot` and the card's art URL. `ForgeCardFace` stays
for grids, reveal, deck view and proposal diff. The deck builder already uses
`ForgeCardPreview` and inherits the new look.

## Testing and verification

- Vitest: mapping functions, geometry conversion, gradient row selection, every brigade has a
  hex and a wash, every card type has an icon, synthesized washes flagged.
- `tsc --noEmit` type gate (no `next build` beside a running dev server).
- Visual (done 2026-09-10): an SSR harness rendered a 12-card matrix (blank, Hero red with
  class icons, dual-brigade Evil Character, Lost Soul, Artifact with long text, Dominant,
  Fortress, GE with a long name, Site teal, 3-brigade multi foil with X / 6 (0) stats, Covenant
  with two class icons, Curse) at 300, 360 and 180 px and screenshots were checked by eye
  against real printed cards. A Playwright run against the studio, with every server-action
  POST blocked so nothing was written, confirmed: pick Hero → cross icon; pick Red → red wash;
  add Blue → second box and blended wash; identifiers, reference and scripture flow through.

## Follow-ups (not in this change)

- Real alpha for icons (the .ai stores it separately; keyed backgrounds are good enough for a
  rough preview).
- Inline ability icons, set symbol, card number, watermark.
- Other surfaces (grid, reveal, deck view) adopting the composite.
