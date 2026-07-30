"use client";

import React from "react";
import type { Card } from "../utils";
import { CardThumb } from "../components/CardThumb";

const PREVIEW_WIDTH = 300;
const PREVIEW_HEIGHT = 400;
const PADDING = 10;

/** Position the preview beside the hovered element, flipping/clamping so it
 *  never runs off screen. Mirrors `calculatePreviewPosition` in DeckCardList. */
function calculatePreviewPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect();

  let x = rect.right + PADDING;
  let y = rect.top;

  // Would overflow the right edge → put it on the other side instead
  if (x + PREVIEW_WIDTH > window.innerWidth) {
    x = rect.left - PREVIEW_WIDTH - PADDING;
  }
  if (y + PREVIEW_HEIGHT > window.innerHeight) {
    y = window.innerHeight - PREVIEW_HEIGHT - PADDING;
  }
  if (y < PADDING) {
    y = PADDING;
  }

  return { x, y };
}

/**
 * Floating card preview on hover, anchored to whatever element the pointer is
 * over. Used by the search-results grid; the deck panel has its own inlined
 * copy of the same behavior in `DeckCardList`.
 *
 * Usage:
 *   const { hoverProps, clear, overlay } = useHoverPreview(enabled);
 *   <div {...hoverProps(card)}> … </div>
 *   {overlay}
 */
export function useHoverPreview(enabled: boolean) {
  const [preview, setPreview] = React.useState<{ card: Card; x: number; y: number } | null>(null);
  const clear = React.useCallback(() => setPreview(null), []);

  // Drop a live preview the moment previews are switched off
  React.useEffect(() => {
    if (!enabled) setPreview(null);
  }, [enabled]);

  // Safety net: dismiss on any interaction that can hide or unmount the hovered
  // element without dispatching its onMouseLeave (clicking opens a modal over
  // the cursor, the tile re-renders, scrolling, switching tabs). Without this
  // the preview can get stuck on screen until a refresh.
  React.useEffect(() => {
    if (!preview) return;
    const dismiss = () => setPreview(null);
    // pointerdown fires before any modal mounts or the tile unmounts
    window.addEventListener("pointerdown", dismiss);
    // capture: true so inner scroll containers are caught, not just window
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("blur", dismiss);
    document.addEventListener("visibilitychange", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("visibilitychange", dismiss);
    };
  }, [preview]);

  const hoverProps = React.useCallback(
    (card: Card) =>
      enabled
        ? {
            onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
              setPreview({ card, ...calculatePreviewPosition(e.currentTarget) });
            },
            onMouseLeave: () => setPreview(null),
          }
        : {},
    [enabled],
  );

  const overlay =
    enabled && preview ? (
      <div
        className="fixed z-50 pointer-events-none"
        style={{
          left: `${preview.x}px`,
          top: `${preview.y}px`,
          maxWidth: `${PREVIEW_WIDTH}px`,
        }}
      >
        <CardThumb
          card={preview.card}
          alt={preview.card.name}
          className="rounded-lg shadow-2xl border-2 border-border"
          style={{ maxHeight: `${PREVIEW_HEIGHT}px`, width: "auto" }}
        />
      </div>
    ) : null;

  return { hoverProps, clear, overlay };
}
