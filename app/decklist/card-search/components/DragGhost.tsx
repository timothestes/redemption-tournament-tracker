"use client";

import React from "react";
import { Card } from "../utils";
import { CardThumb } from "./CardThumb";

interface DragGhostProps {
  card: Card;
  /** True while the pointer is in the "drag to remove" zone (left of the deck panel). */
  willRemove?: boolean;
}

/**
 * Visual rendered inside @dnd-kit's <DragOverlay> while a card is being
 * dragged. Just the card image at reduced opacity — no controls, no badges.
 * Flips to a red ✕ overlay while in the remove zone (over the search/filter
 * column) to telegraph that releasing there will discard one copy.
 */
export default function DragGhost({ card, willRemove = false }: DragGhostProps) {
  return (
    <div
      className={`relative rounded-md overflow-hidden shadow-2xl pointer-events-none ring-2 transition-colors ${
        willRemove ? "ring-red-500" : "ring-primary/60"
      }`}
      style={{ width: 96, opacity: 0.6 }}
    >
      <CardThumb
        card={card}
        alt={card.name}
        className="block w-full h-auto"
        crossOrigin="anonymous"
        draggable={false}
      />
      {willRemove && (
        <div className="absolute inset-0 bg-red-600/55 flex items-center justify-center">
          <span className="text-white text-3xl font-bold leading-none drop-shadow">
            ✕
          </span>
        </div>
      )}
    </div>
  );
}
