"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/** Prev/next wiring. Omit when there is no list to cycle through — the arrows,
 * arrow keys, swipe and the "N of M" counter all disappear with it. */
export interface CardEnlargeNav {
  /** 0-based position of the card on screen, for the counter. */
  index: number;
  total: number;
  onNavigate: (delta: number) => void;
}

/**
 * Full-screen enlarged card: arrows / arrow keys / swipe cycle through the
 * deck, Escape or a backdrop click closes.
 *
 * Extracted from the Forge deck view so the host's submission modal can enlarge
 * a card the same way — its grid tiles are too small to read a card name on.
 */
export default function CardEnlargeModal({
  children,
  onClose,
  name,
  qty,
  subtitle,
  nav,
}: {
  /** The enlarged card face. */
  children: ReactNode;
  onClose: () => void;
  /** Caption under the card. Omit `name` for a bare image (the Paragon case). */
  name?: string;
  qty?: number;
  subtitle?: string;
  nav?: CardEnlargeNav;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.stopPropagation();
        nav?.onNavigate(-1);
      } else if (e.key === "ArrowRight") {
        e.stopPropagation();
        nav?.onNavigate(1);
      }
    }
    // Capture phase + stopPropagation so that when this sits inside another
    // dialog (the host's submission modal), Escape closes the enlarged card
    // instead of tearing down the dialog underneath it.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, nav]);

  const touchStartX = useRef<number | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Close"
      >
        <X className="h-6 w-6" />
      </button>
      <div
        className="flex w-full max-w-lg items-center justify-center gap-2 sm:gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {nav && (
          <button
            onClick={() => nav.onNavigate(-1)}
            className="hidden flex-shrink-0 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25 sm:block"
            aria-label="Previous card"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <div
          className="w-full max-w-sm"
          onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const start = touchStartX.current;
            touchStartX.current = null;
            if (start === null) return;
            const dx = e.changedTouches[0].clientX - start;
            if (Math.abs(dx) > 48) nav?.onNavigate(dx > 0 ? -1 : 1);
          }}
        >
          {children}
          {name !== undefined && (
            <div className="mt-3 text-center">
              <p className="text-sm font-semibold text-white">
                {name}
                {qty !== undefined && qty > 1 && (
                  <span className="font-normal text-white/70"> ×{qty}</span>
                )}
              </p>
              <p className="text-xs text-white/70">
                {subtitle}
                {nav && `${subtitle ? " · " : ""}${nav.index + 1} of ${nav.total}`}
              </p>
            </div>
          )}
        </div>
        {nav && (
          <button
            onClick={() => nav.onNavigate(1)}
            className="hidden flex-shrink-0 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25 sm:block"
            aria-label="Next card"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  );
}
