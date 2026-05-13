"use client";

import React from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { DeckCard, DeckZone } from "../types/deck";
import { Card } from "../utils";
import { useCardImageUrl } from "../hooks/useCardImageUrl";

interface MaybeboardStripProps {
  /** Maybeboard cards (caller filters by zone === 'maybeboard'). */
  cards: DeckCard[];
  onIncrement: (cardName: string, cardSet: string) => void;
  onDecrement: (cardName: string, cardSet: string) => void;
  onRemove: (cardName: string, cardSet: string) => void;
  onMoveCard: (cardName: string, cardSet: string, toZone: DeckZone) => void;
  onViewCard?: (card: Card) => void;
}

const cardKey = (dc: DeckCard) => `${dc.card.name}|${dc.card.set}`;
const draggableId = (dc: DeckCard) => `maybeboard:${cardKey(dc)}`;

/**
 * Persistent horizontal-scroll strip pinned to the bottom of the deck panel,
 * visible across all deck panel tabs. Renders the maybeboard — a scratchpad
 * of cards under consideration; excluded from legality, totals, and play.
 *
 * Each thumbnail is a @dnd-kit draggable. The strip itself is a droppable
 * for `zone:maybeboard`. Long-press for context menu has been replaced by
 * an always-available `⋯` overflow affordance on each thumbnail — long-press
 * is now reserved for drag activation (TouchSensor, 200ms).
 */
export default function MaybeboardStrip({
  cards,
  onIncrement,
  onDecrement,
  onRemove,
  onMoveCard,
  onViewCard,
}: MaybeboardStripProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [openMenuKey, setOpenMenuKey] = React.useState<string | null>(null);
  const [overflows, setOverflows] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: "zone:maybeboard",
    data: { zone: "maybeboard" as DeckZone },
  });

  const totalCount = cards.reduce((sum, dc) => sum + dc.quantity, 0);
  const uniqueCount = cards.length;

  // Track horizontal overflow so the → indicator + edge fade only show when scrollable.
  React.useEffect(() => {
    if (collapsed) return;
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed, cards.length]);

  // Close context menu on outside click / Escape.
  React.useEffect(() => {
    if (!openMenuKey) return;
    const handleClick = () => setOpenMenuKey(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuKey(null);
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openMenuKey]);

  const announce = (msg: string) => {
    setAnnouncement(msg);
    setTimeout(() => setAnnouncement(""), 1000);
  };

  const handleIncrement = (dc: DeckCard) => {
    onIncrement(dc.card.name, dc.card.set);
    announce(`Added 1 ${dc.card.name} to maybeboard`);
  };
  const handleDecrement = (dc: DeckCard) => {
    onDecrement(dc.card.name, dc.card.set);
    announce(`Removed 1 ${dc.card.name} from maybeboard`);
  };
  const handleRemove = (dc: DeckCard) => {
    onRemove(dc.card.name, dc.card.set);
    announce(`Removed ${dc.card.name} from maybeboard`);
    setOpenMenuKey(null);
  };
  const handleMove = (dc: DeckCard, toZone: DeckZone) => {
    onMoveCard(dc.card.name, dc.card.set, toZone);
    announce(`Moved ${dc.card.name} to ${toZone === "main" ? "main deck" : toZone}`);
    setOpenMenuKey(null);
  };

  return (
    <section
      aria-label={`Maybeboard, ${totalCount} ${totalCount === 1 ? "card" : "cards"}`}
      className={`border-t bg-card/50 flex-shrink-0 transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      {/* Polite live region for stepper changes */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1.5 font-medium text-foreground hover:text-primary transition-colors"
          aria-expanded={!collapsed}
          aria-controls="maybeboard-strip-content"
          title={collapsed ? "Expand maybeboard" : "Collapse maybeboard"}
        >
          <span>Maybeboard ({totalCount})</span>
          <svg
            className={`w-3 h-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          {/* Info tooltip */}
          <div className="relative">
            <button
              type="button"
              onMouseEnter={() => setShowHelp(true)}
              onMouseLeave={() => setShowHelp(false)}
              onFocus={() => setShowHelp(true)}
              onBlur={() => setShowHelp(false)}
              onClick={(e) => {
                e.stopPropagation();
                setShowHelp((v) => !v);
              }}
              className="w-4 h-4 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 text-[10px] font-bold flex items-center justify-center"
              aria-label="What is the maybeboard?"
            >
              ?
            </button>
            {showHelp && (
              <div
                role="tooltip"
                className="absolute right-0 bottom-full mb-1.5 z-50 w-56 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-lg"
              >
                A scratchpad for cards you&apos;re considering. Not part of your deck.
              </div>
            )}
          </div>

          {/* Overflow scroll indicator (decorative) */}
          {!collapsed && overflows && (
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
          )}
        </div>
      </div>

      {/* Body: empty state, collapsed, or scroll strip */}
      {!collapsed && (
        <div id="maybeboard-strip-content" ref={setDroppableRef}>
          {uniqueCount === 0 ? (
            <div
              className={`mx-3 mb-2 h-[64px] md:h-[72px] rounded border border-dashed flex items-center justify-center px-3 transition-colors ${
                isOver ? "border-primary bg-primary/10" : "border-border/70"
              }`}
            >
              <p className="text-[11px] text-muted-foreground text-center leading-tight">
                Drag or use the menu to add cards.
              </p>
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="relative overflow-x-auto overflow-y-hidden flex gap-1.5 px-3 pb-2"
              style={
                overflows
                  ? {
                      maskImage:
                        "linear-gradient(to right, black 0, black calc(100% - 24px), transparent 100%)",
                      WebkitMaskImage:
                        "linear-gradient(to right, black 0, black calc(100% - 24px), transparent 100%)",
                    }
                  : undefined
              }
            >
              {cards.map((dc) => (
                <MaybeboardThumbnail
                  key={cardKey(dc)}
                  dc={dc}
                  isMenuOpen={openMenuKey === cardKey(dc)}
                  setMenuOpen={(open) =>
                    setOpenMenuKey(open ? cardKey(dc) : null)
                  }
                  onIncrement={() => handleIncrement(dc)}
                  onDecrement={() => handleDecrement(dc)}
                  onRemove={() => handleRemove(dc)}
                  onMove={(to) => handleMove(dc, to)}
                  onView={() => onViewCard?.(dc.card)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A single draggable thumbnail in the maybeboard strip. Split out so we can
 * use `useDraggable` cleanly — each thumbnail gets its own draggable identity.
 */
function MaybeboardThumbnail({
  dc,
  isMenuOpen,
  setMenuOpen,
  onIncrement,
  onDecrement,
  onRemove,
  onMove,
  onView,
}: {
  dc: DeckCard;
  isMenuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  onMove: (to: DeckZone) => void;
  onView: () => void;
}) {
  const { getImageUrl } = useCardImageUrl();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId(dc),
    data: { fromZone: "maybeboard" as DeckZone, card: dc.card },
  });

  // Keyboard handlers on the focused thumbnail. Note: Space is reserved by
  // @dnd-kit's KeyboardSensor for drag pickup, so we keep Enter for "view".
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      onIncrement();
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      onDecrement();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onView();
    } else if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      setMenuOpen(!isMenuOpen);
    }
  };

  return (
    <div
      className="relative group flex-shrink-0"
      style={{ width: 48 }}
    >
      {/* Drag handle / clickable image area */}
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        tabIndex={0}
        role="button"
        aria-label={`${dc.card.name}, ${dc.quantity} ${
          dc.quantity === 1 ? "copy" : "copies"
        }. Press Space to pick up, Enter to view details.`}
        className={`relative w-12 h-[64px] md:h-[72px] rounded overflow-hidden bg-muted cursor-grab active:cursor-grabbing touch-none outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          isDragging ? "opacity-40" : ""
        }`}
        onClick={(e) => {
          // Drag activation distance (6px pointer / 200ms touch) means a true
          // click reaches us here — open the modal.
          e.stopPropagation();
          if (isMenuOpen) {
            setMenuOpen(false);
            return;
          }
          onView();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(!isMenuOpen);
        }}
        onKeyDown={handleKeyDown}
      >
        <img
          src={getImageUrl(dc.card.imgFile)}
          alt={dc.card.name}
          className="absolute inset-0 w-full h-full object-cover object-top"
          crossOrigin="anonymous"
          loading="lazy"
          draggable={false}
        />
        {/* Quantity badge */}
        <span className="absolute bottom-0.5 right-0.5 px-1 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold leading-none tabular-nums">
          ×{dc.quantity}
        </span>
      </div>

      {/* Stepper +/− (always visible on touch, hover on desktop). These sit
          on top of the drag handle and stopPropagation to avoid initiating
          a drag on tap. */}
      <div className="absolute inset-y-0 left-0 right-0 pointer-events-none flex flex-col justify-between items-stretch opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIncrement();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto self-end m-0.5 w-5 h-5 rounded bg-black/60 hover:bg-black/80 text-white text-xs font-bold leading-none"
          aria-label={`Increase quantity of ${dc.card.name}`}
        >
          +
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDecrement();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto self-start m-0.5 w-5 h-5 rounded bg-black/60 hover:bg-black/80 text-white text-xs font-bold leading-none"
          aria-label={`Decrease quantity of ${dc.card.name}`}
        >
          −
        </button>
      </div>

      {/* Overflow (⋯) context-menu trigger — replaces the long-press menu now
          that long-press is drag activation. Always visible on touch, hover
          on desktop. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!isMenuOpen);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded bg-black/60 hover:bg-black/80 text-white text-xs leading-none flex items-center justify-center md:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        aria-label={`Options for ${dc.card.name}`}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
      >
        ⋯
      </button>

      {/* Context menu */}
      {isMenuOpen && (
        <div
          role="menu"
          className="absolute z-50 bottom-full mb-1 left-1/2 -translate-x-1/2 min-w-[140px] rounded-md border border-border bg-popover shadow-lg py-1 text-xs text-popover-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => onMove("main")}
            className="w-full px-2.5 py-1.5 text-left hover:bg-muted"
          >
            Move to main
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onMove("reserve")}
            className="w-full px-2.5 py-1.5 text-left hover:bg-muted"
          >
            Move to reserve
          </button>
          <div className="border-t border-border my-1" />
          <button
            type="button"
            role="menuitem"
            onClick={onRemove}
            className="w-full px-2.5 py-1.5 text-left text-red-600 dark:text-red-400 hover:bg-muted"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
