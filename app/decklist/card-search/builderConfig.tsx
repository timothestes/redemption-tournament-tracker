"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Card } from "./utils";
import { ALL_CARDS } from "./data/cardIndex";
import { getPublicImageUrl } from "./hooks/useCardImageUrl";
import CardImage from "./components/CardImage";

/**
 * What a card's art resolves to.
 * - Public cards are a plain image URL — the call site keeps its own bespoke
 *   `<img>`/`<CardImage>` markup and just uses this `url`.
 * - Forge cards have no single URL (they're a composite preview), so they
 *   resolve to an opaque element the call site renders verbatim. This is what
 *   keeps secret Forge art off `next/image` and away from a 404'ing `<img src>`.
 */
export type CardImageResolution =
  | { kind: "url"; url: string }
  | { kind: "element"; node: ReactNode };

/** Options for `renderThumb`, mirroring today's `<CardImage>` props exactly. */
export interface RenderThumbOpts {
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  onClick?: () => void;
}

/**
 * Injection seams that let one builder serve both the public site and the Forge.
 * - `pool` (Phase 0): the card catalog the builder searches/renders.
 * - `resolveCardImage` / `renderThumb` (Phase 1): the card-image seam. Bespoke
 *   `<img>` sites switch on `resolveCardImage(card).kind`; the ~2 sites that use
 *   the `<CardImage>` component use `renderThumb`. Public always resolves to a
 *   URL; the Forge config (Phase 3) returns an element for forge dataLines.
 *
 * See docs/superpowers/plans/2026-06-26-forge-deckbuilder-unification.md
 */
export interface DeckBuilderConfig {
  /** Card pool the builder searches and renders. Public: ALL_CARDS. Forge: [...forgeCards, ...ALL_CARDS]. */
  pool: Card[];
  /** Resolve a card's art to a URL (public) or an opaque composite element (Forge). */
  resolveCardImage: (card: Card) => CardImageResolution;
  /** Convenience renderer for sites that use the `<CardImage>` component (search grid, spotlight). */
  renderThumb: (card: Card, opts: RenderThumbOpts) => ReactNode;
}

/** Public default: the builder behaves exactly as it does today. */
export const PUBLIC_BUILDER_CONFIG: DeckBuilderConfig = {
  pool: ALL_CARDS,
  resolveCardImage: (card) => ({ kind: "url", url: getPublicImageUrl(card.imgFile) }),
  renderThumb: (card, opts) => {
    // Guard so the next/image path is structurally unreachable for an `element`
    // resolution (no-op for the public config, which is always `url`).
    const r = PUBLIC_BUILDER_CONFIG.resolveCardImage(card);
    if (r.kind === "element") return r.node;
    return (
      <CardImage
        imgFile={card.imgFile}
        alt={opts.alt}
        className={opts.className}
        sizes={opts.sizes}
        priority={opts.priority}
        onClick={opts.onClick}
      />
    );
  },
};

const BuilderConfigContext = createContext<DeckBuilderConfig>(PUBLIC_BUILDER_CONFIG);

/** Provide a `DeckBuilderConfig` to the builder subtree. Leaves read it via `useBuilderConfig()`. */
export function BuilderConfigProvider({
  config,
  children,
}: {
  config: DeckBuilderConfig;
  children: ReactNode;
}) {
  return <BuilderConfigContext.Provider value={config}>{children}</BuilderConfigContext.Provider>;
}

/** Read the active builder config. Defaults to the public config when no provider is mounted. */
export function useBuilderConfig(): DeckBuilderConfig {
  return useContext(BuilderConfigContext);
}
