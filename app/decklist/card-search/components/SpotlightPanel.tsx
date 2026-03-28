"use client";
import React from "react";
import CardImage from "./CardImage";
import type { Card } from "../utils";

interface SpotlightPanelProps {
  card: Card | null;
  price: number | null;
  onClear: () => void;
}

export default function SpotlightPanel({ card, price, onClear }: SpotlightPanelProps) {
  if (!card) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div
          className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl"
          style={{ width: "min(100%, 400px)", aspectRatio: "5 / 7" }}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
      {/* Clear button */}
      <button
        onClick={onClear}
        className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-colors"
        title="Clear spotlight"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Card image */}
      <div style={{ width: "min(100%, 400px)" }}>
        <CardImage
          imgFile={card.imgFile}
          alt={card.name}
          className="rounded-xl w-full shadow-2xl"
          sizes="400px"
        />
      </div>

      {/* Price */}
      {price !== null && (
        <p className="mt-3 text-lg font-semibold text-gray-600 dark:text-gray-300">
          ${price.toFixed(2)}
        </p>
      )}
    </div>
  );
}
