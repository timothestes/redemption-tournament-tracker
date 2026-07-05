"use client";

import React from "react";
import type { Card } from "../utils";
import { useBuilderConfig } from "../builderConfig";

/**
 * Renders a card's image through the builder's `resolveCardImage` seam.
 *
 * For a public card this emits exactly `<img src={url} {...imgProps} />` — i.e.
 * byte-identical to the raw `<img>` the call site used before, with every native
 * attribute (className, crossOrigin, draggable, style, onLoad, ref, …) passed
 * straight through. For a Forge card the resolver returns a composite element
 * (e.g. `<ForgeCardPreview>`) which is rendered verbatim, so Forge art never hits
 * a 404'ing `<img src>` or `next/image`.
 *
 * Migrating a site is therefore a mechanical swap:
 *   `<img src={getImageUrl(card.imgFile)} {...rest} />`  →  `<CardThumb card={card} {...rest} />`
 */
type CardThumbProps = { card: Card } & React.ImgHTMLAttributes<HTMLImageElement>;

export const CardThumb = React.forwardRef<HTMLImageElement, CardThumbProps>(
  function CardThumb({ card, ...imgProps }, ref) {
    const { resolveCardImage } = useBuilderConfig();
    const r = resolveCardImage(card);
    if (r.kind === "element") {
      // Skeleton wrappers (e.g. DeckCardList's `animate-pulse` tile) rely on the
      // img's onLoad to stop pulsing — element resolutions never fire it, which
      // left Forge tiles fading forever. Strip the class on mount instead; the
      // display:contents wrapper adds no layout of its own.
      return (
        <div
          style={{ display: "contents" }}
          ref={(el) => el?.parentElement?.classList.remove("animate-pulse")}
        >
          {r.node}
        </div>
      );
    }
    return <img ref={ref} src={r.url} {...imgProps} />;
  },
);
