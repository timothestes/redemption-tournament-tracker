"use client";

import React from "react";
import { useDndContext } from "@dnd-kit/core";
import { Card } from "../utils";
import { useCardImageUrl } from "../hooks/useCardImageUrl";

interface DragGhostProps {
  card: Card;
}

/**
 * Visual rendered inside @dnd-kit's <DragOverlay> while a card is being
 * dragged. Just the card image at reduced opacity — no controls, no badges.
 *
 * When the drag has no droppable underneath (`over === null`) AND originates
 * from a deck zone, a red overlay + ✕ icon appears: releasing here will
 * remove one copy via handleDragEnd's drag-to-remove path.
 */
export default function DragGhost({ card }: DragGhostProps) {
  const { getImageUrl } = useCardImageUrl();
  const { active, over } = useDndContext();
  const fromZone = active?.data.current?.fromZone as string | undefined;
  const willRemove = !over && !!fromZone;

  return (
    <div
      className={`relative rounded-md overflow-hidden shadow-2xl pointer-events-none ring-2 transition-colors ${
        willRemove ? "ring-red-500" : "ring-primary/60"
      }`}
      style={{ width: 96, opacity: 0.6 }}
    >
      <img
        src={getImageUrl(card.imgFile)}
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
