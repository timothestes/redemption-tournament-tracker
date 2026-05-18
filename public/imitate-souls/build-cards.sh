#!/usr/bin/env bash
# Composite each art WebP in this folder onto base.jpg and write the
# results to ./cards/<name>.jpg. Run from anywhere; paths are resolved
# relative to the script's location.
#
# Requirements: ImageMagick (`brew install imagemagick`)

set -euo pipefail

cd "$(dirname "$0")"

# Art window coordinates inside base.jpg (345x495), dialled in by eye
# against the original Lost Soul art bleed.
X=28
Y=46
W=290
H=264
R=6  # corner radius

mkdir -p cards

for f in sources/*.webp; do
  name="$(basename "$f" .webp)"
  out="cards/${name}.jpg"
  magick base.jpg \
    \( "$f" -resize "${W}x${H}^" -gravity north -extent "${W}x${H}" \
       \( -size "${W}x${H}" xc:none -fill white \
          -draw "roundrectangle 0,0 $((W-1)),$((H-1)) ${R},${R}" \) \
       -alpha set -compose DstIn -composite \) \
    -gravity northwest -geometry "+${X}+${Y}" \
    -compose over -composite \
    "$out"
  echo "  $out"
done

echo "Wrote $(ls cards | wc -l | tr -d ' ') card(s) to ./cards"
