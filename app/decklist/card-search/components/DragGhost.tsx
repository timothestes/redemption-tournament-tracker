"use client";

import React from "react";
import { Card } from "../utils";
import { useCardImageUrl } from "../hooks/useCardImageUrl";

interface DragGhostProps {
  card: Card;
}

/**
 * Visual rendered inside @dnd-kit's <DragOverlay> while a card is being
 * dragged. Just the card image at reduced opacity — no controls, no badges.
 */
export default function DragGhost({ card }: DragGhostProps) {
  const { getImageUrl } = useCardImageUrl();
  return (
    <div
      className="rounded-md overflow-hidden shadow-2xl ring-2 ring-primary/60 pointer-events-none"
      style={{ width: 96, opacity: 0.6 }}
    >
      <img
        src={getImageUrl(card.imgFile)}
        alt={card.name}
        className="block w-full h-auto"
        crossOrigin="anonymous"
        draggable={false}
      />
    </div>
  );
}
