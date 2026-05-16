"use client";

import React from "react";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { DeckCard, DeckZone } from "../types/deck";
import { Card } from "../utils";
import { useCardImageUrl } from "../hooks/useCardImageUrl";
import { cn } from "@/lib/utils";
import { useExternalDropTarget, useIsExternalDragActive, combineRefs } from "../hooks/useExternalDropTarget";

interface MaybeboardStripProps {
  /** Maybeboard cards (caller filters by zone === 'maybeboard'). */
  cards: DeckCard[];
  onIncrement: (cardName: string, cardSet: string) => void;
  onDecrement: (cardName: string, cardSet: string) => void;
  onRemove: (cardName: string, cardSet: string) => void;
  onMoveCard: (cardName: string, cardSet: string, toZone: DeckZone) => void;
  onViewCard?: (card: Card) => void;
  /** Add a card directly to the maybeboard from an external source (search-tile drag). */
  onAddCard?: (cardName: string, cardSet: string) => void;
  /** Stable identifier for persisting collapsed state per deck. */
  deckId?: string;
}

const cardKey = (dc: DeckCard) => `${dc.card.name}|${dc.card.set}`;
const draggableId = (dc: DeckCard) => `maybeboard:${cardKey(dc)}`;
const collapsedKey = (deckId?: string) =>
  `redemption-maybeboard-collapsed:${deckId ?? "local"}`;

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
  onAddCard,
  deckId,
}: MaybeboardStripProps) {
  // Two states: "peek" (default, ~56px row visible) and collapsed (header only).
  // We default to peek across all viewports so the strip stays a visible
  // first-class drop target — the user has to opt into collapsing it.
  const [collapsed, setCollapsed] = React.useState(false);
  const [collapsedHydrated, setCollapsedHydrated] = React.useState(false);
  const [openMenuKey, setOpenMenuKey] = React.useState<string | null>(null);
  const [overflowsLeft, setOverflowsLeft] = React.useState(false);
  const [overflowsRight, setOverflowsRight] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: "zone:maybeboard",
    data: { zone: "maybeboard" as DeckZone },
  });

  // Native HTML5 drop target so the search-results column (rendered outside
  // this DndContext) can drop directly into the maybeboard. See
  // `useExternalDropTarget` for why both systems coexist.
  const { setRef: setExternalDropRef, isOver: isExternalOver } = useExternalDropTarget(
    onAddCard ? (payload) => onAddCard(payload.name, payload.set) : undefined,
  );
  const sectionRef = combineRefs<HTMLElement>(setDroppableRef, setExternalDropRef);

  // Surface drag state so we can grow the strip + show a "Drop here" overlay
  // while a card is being dragged from main/reserve OR from the search column.
  // `useDndContext` returns the same context shared by `useDroppable`, so no
  // extra provider needed for in-deck drags. External (HTML5) drags surface
  // through `useIsExternalDragActive`.
  const { active } = useDndContext();
  const fromZone = active?.data.current?.fromZone as DeckZone | undefined;
  const isExternalDragActive = useIsExternalDragActive();
  const isDragging = !!active || isExternalDragActive;
  const isValidDrop =
    (!!active && fromZone !== "maybeboard") || isExternalDragActive;

  // Hydrate persisted collapsed state once. Per-deck so different decks remember
  // independently. No viewport-based default — peek is always the initial state.
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(collapsedKey(deckId));
      if (saved !== null) {
        setCollapsed(saved === "1");
      }
    } catch {
      // localStorage may throw in private modes; safe to ignore.
    }
    setCollapsedHydrated(true);
  }, [deckId]);

  // Persist the user's collapsed preference. Skip until hydrated so we don't
  // overwrite the saved value with the SSR default on first mount.
  React.useEffect(() => {
    if (!collapsedHydrated) return;
    try {
      window.localStorage.setItem(collapsedKey(deckId), collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed, collapsedHydrated, deckId]);

  // Auto-expand a collapsed strip while a drag is in progress so the drop
  // target is actually visible. Save the user's pre-drag preference in a ref
  // and restore on drag end or cancel — but persist nothing while toggling.
  const prevCollapsedRef = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (isDragging) {
      if (prevCollapsedRef.current === null) {
        prevCollapsedRef.current = collapsed;
        if (collapsed) setCollapsed(false);
      }
    } else if (prevCollapsedRef.current !== null) {
      const prev = prevCollapsedRef.current;
      prevCollapsedRef.current = null;
      if (prev !== collapsed) setCollapsed(prev);
    }
  }, [isDragging, collapsed]);

  const totalCount = cards.reduce((sum, dc) => sum + dc.quantity, 0);
  const uniqueCount = cards.length;

  // Track which side(s) of the horizontal scroll have hidden content. The
  // edge fade-mask should only appear on a side that actually has more to see —
  // hiding cards behind a permanent right-edge fade looks broken when the
  // user is already scrolled to the end.
  React.useEffect(() => {
    if (collapsed) {
      setOverflowsLeft(false);
      setOverflowsRight(false);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      const max = el.scrollWidth - el.clientWidth;
      setOverflowsLeft(el.scrollLeft > 1);
      setOverflowsRight(el.scrollLeft < max - 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [collapsed, cards.length]);

  const overflows = overflowsLeft || overflowsRight;

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

  // Compute the mask-image only on sides that actually have hidden content,
  // and only when not in a valid drop (during a drop, the drop overlay sits
  // over the right edge anyway and the fade reads as visual noise).
  const maskImage = React.useMemo(() => {
    if (!overflows || isValidDrop) return undefined;
    const fadeWidth = 24;
    const left = overflowsLeft ? `transparent 0, black ${fadeWidth}px` : "black 0";
    const right = overflowsRight
      ? `black calc(100% - ${fadeWidth}px), transparent 100%`
      : "black 100%";
    return `linear-gradient(to right, ${left}, ${right})`;
  }, [overflows, overflowsLeft, overflowsRight, isValidDrop]);

  const showDropAffordance = isOver || isExternalOver;

  return (
    <section
      ref={sectionRef}
      aria-label={`Maybeboard, ${totalCount} ${totalCount === 1 ? "card" : "cards"}`}
      className={cn(
        "relative sticky bottom-0 z-10 bg-card backdrop-blur flex-shrink-0",
        "transition-[background-color,border-color] duration-150 ease-out",
        // Permanent 2px transparent border to reserve space — switching to a
        // colored border on `isOver` doesn't shift the layout by 1px the way
        // border-t → border-2 would.
        "border-t-2 border-transparent shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.4)]",
        showDropAffordance ? "bg-primary/5 border-primary/70" : "border-t-border",
      )}
    >
      {/* Polite live region for stepper changes */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Drawer header — full-width tap target so the chrome doubles as the
          collapse handle. The pill-shaped grabber + bigger chevron read as a
          drawer affordance even when collapsed flat. */}
      <div className="relative flex items-center px-3 text-xs">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={cn(
            "group/drawer flex flex-1 items-center justify-between gap-2 py-1.5",
            "rounded-md transition-colors",
            "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
          )}
          aria-expanded={!collapsed}
          aria-controls="maybeboard-strip-content"
          title={collapsed ? "Expand maybeboard" : "Collapse maybeboard"}
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            <svg
              className={cn(
                "w-4 h-4 text-muted-foreground transition-transform duration-150 ease-out",
                collapsed ? "" : "rotate-90",
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
            <span>Maybeboard ({totalCount})</span>
          </span>
          {/* Centered pill grabber — always visible, signals "this is a sheet" */}
          <span
            aria-hidden
            className={cn(
              "absolute left-1/2 -translate-x-1/2 h-1 w-9 rounded-full transition-colors",
              "bg-border group-hover/drawer:bg-muted-foreground/40",
            )}
          />
          <span className="sr-only">{collapsed ? "Expand" : "Collapse"} maybeboard</span>
        </button>

        <div className="flex items-center gap-2 pl-2">
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
        </div>
      </div>

      {/* Droppable ref is on the parent <section> so the drop target survives
          the collapsed → expanded transition during a drag. */}
      {!collapsed && (
        <div id="maybeboard-strip-content">
          {uniqueCount === 0 ? (
            <div
              className={cn(
                "mx-3 mb-2 h-[56px] rounded border border-dashed flex items-center justify-center px-3 transition-colors",
                showDropAffordance ? "border-primary bg-primary/10" : "border-border/70",
              )}
            >
              <p className="text-[11px] text-muted-foreground text-center leading-tight">
                Drag or use the menu to add cards.
              </p>
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="relative overflow-x-auto overflow-y-hidden flex gap-1.5 px-3 pb-2"
              style={maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined}
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
      {/* Drag handle / clickable image area. No `touch-action: none` so the
          strip's horizontal scroll still works; TouchSensor's 200ms delay
          arbitrates scroll vs drag. */}
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        tabIndex={0}
        role="button"
        aria-label={`${dc.card.name}, ${dc.quantity} ${
          dc.quantity === 1 ? "copy" : "copies"
        }. Press Space to pick up, Enter to view details.`}
        className={`relative w-12 h-[56px] rounded overflow-hidden bg-muted cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          isDragging ? "opacity-40" : ""
        }`}
        onClick={(e) => {
          // 10px pointer activation distance / 200ms touch delay means a true
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

      {/* Stepper −/+ — always visible on touch (no hover), revealed on hover
          on desktop. WCAG-compliant 24x24 touch targets. These sit on top of
          the drag handle and stopPropagation to avoid initiating a drag on tap. */}
      <div className="absolute top-0 right-0 pointer-events-none flex opacity-100 md:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDecrement();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto w-6 h-6 rounded-l bg-black/60 hover:bg-black/80 text-white text-sm font-bold leading-none"
          aria-label={`Decrease quantity of ${dc.card.name}`}
        >
          −
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIncrement();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto w-6 h-6 rounded-r bg-black/60 hover:bg-black/80 text-white text-sm font-bold leading-none"
          aria-label={`Increase quantity of ${dc.card.name}`}
        >
          +
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
        className="absolute bottom-0.5 left-0.5 w-6 h-6 rounded bg-black/60 hover:bg-black/80 text-white text-sm leading-none flex items-center justify-center md:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
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
