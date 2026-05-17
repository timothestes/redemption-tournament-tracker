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
  /** Move one copy of the card from maybeboard into the currently visible
   *  tab's zone (main or reserve). The destination is controlled by the
   *  parent via `activeZone`; the strip only fires the callback. */
  onMoveToActive: (cardName: string, cardSet: string) => void;
  onDecrement: (cardName: string, cardSet: string) => void;
  onViewCard?: (card: Card) => void;
  /** Add a card directly to the maybeboard from an external source (search-tile drag). */
  onAddCard?: (cardName: string, cardSet: string) => void;
  /** The zone the user is currently viewing (Main or Reserve tab). Used to
   *  label the move button so the user knows where the card will land. */
  activeZone: "main" | "reserve";
  /** Stable identifier for persisting collapsed state per deck. */
  deckId?: string;
}

const cardKey = (dc: DeckCard) => `${dc.card.name}|${dc.card.set}`;
const draggableId = (dc: DeckCard) => `maybeboard:${cardKey(dc)}`;
const collapsedKey = (deckId?: string) =>
  `redemption-maybeboard-collapsed-v2:${deckId ?? "local"}`;

/**
 * Persistent horizontal-scroll strip pinned to the bottom of the deck panel,
 * visible across all deck panel tabs. Renders the maybeboard — a scratchpad
 * of cards under consideration; excluded from legality, totals, and play.
 *
 * Each thumbnail is a @dnd-kit draggable. The strip itself is a droppable
 * for `zone:maybeboard`. Long-press activates drag (TouchSensor, 200ms).
 */
export default function MaybeboardStrip({
  cards,
  onMoveToActive,
  onDecrement,
  onViewCard,
  onAddCard,
  activeZone,
  deckId,
}: MaybeboardStripProps) {
  const activeZoneLabel = activeZone === "main" ? "main deck" : "reserve";
  // Two states: "peek" (~56px row visible) and collapsed (header only).
  // Default: collapsed on mobile (the peek row sticks out under the bottom nav
  // and crowds the deck list); peek on desktop where there's room. Hydration
  // effect below resolves the viewport-based default after mount.
  const [collapsed, setCollapsed] = React.useState(false);
  const [overflowsLeft, setOverflowsLeft] = React.useState(false);
  const [overflowsRight, setOverflowsRight] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Live vertical drag offset from the drawer header (touch-style sheet drag).
  // null when not dragging; otherwise the current pointer deltaY in px. Drag-up
  // is negative, drag-down is positive. See onHeaderPointerDown/Move/Up below.
  const [dragOffset, setDragOffset] = React.useState<number | null>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    startY: number;
    startTime: number;
    startedCollapsed: boolean;
    moved: boolean;
  } | null>(null);
  // Set when a pointer drag committed a real motion, so the synthesized
  // post-pointerup `click` on the header button doesn't ALSO toggle.
  const justDraggedRef = React.useRef(false);

  // Inner content wrapper used to measure the natural unfurled height of the
  // strip so we can animate `height: 0 ↔ height: contentHeight` smoothly.
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = React.useState(0);

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
  // Memoize the combined ref so React doesn't re-invoke it on every re-render —
  // otherwise the native drag listeners (attached via setExternalDropRef) get
  // detached and re-attached on each parent state change. The browser doesn't
  // re-fire dragenter when listeners are re-attached mid-drag, so the
  // drop-affordance flickers depending on render timing.
  // Also stash the actual DOM node so the approach-detection effect below can
  // read the strip's live bounding box.
  const sectionElRef = React.useRef<HTMLElement | null>(null);
  const sectionRef = React.useMemo(
    () => combineRefs<HTMLElement>(setDroppableRef, setExternalDropRef, sectionElRef),
    [setDroppableRef, setExternalDropRef],
  );

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

  // "Eager" state — when the user is moving the pointer DOWNWARD and within
  // reach of the strip, the strip leaps up to meet them. We track live cursor
  // Y from both `dragover` (HTML5 native, used by search-tile drags — pointer
  // events are suppressed during a native drag) and `pointermove` (used by
  // dnd-kit in-deck drags). A small motion score with asymmetric hysteresis
  // means a brief upward jiggle while approaching doesn't retract the strip,
  // but a real upward sweep does. The lift retracts when drag ends.
  const [isApproaching, setIsApproaching] = React.useState(false);
  React.useEffect(() => {
    if (!isDragging) {
      setIsApproaching(false);
      return;
    }
    let lastY: number | null = null;
    let downScore = 0;
    const update = (clientY: number) => {
      const prev = lastY;
      lastY = clientY;
      if (prev === null) return;
      if (clientY > prev) {
        downScore = Math.min(downScore + 1, 5);
      } else if (clientY < prev - 1) {
        downScore = Math.max(downScore - 2, 0);
      }
      const rect = sectionElRef.current?.getBoundingClientRect();
      if (!rect) return;
      // +ve = cursor above strip top; -ve = cursor at/inside/below strip.
      const distance = rect.top - clientY;
      const movingDown = downScore >= 2;
      // Approach reach: ~280px above strip top; sticky once committed so a
      // pause inside the band keeps it lifted.
      const inReach = distance < 280 && distance > -240;
      setIsApproaching((cur) => {
        const next = (movingDown && inReach) || (cur && inReach && downScore > 0);
        return next === cur ? cur : next;
      });
    };
    const onDragOver = (e: DragEvent) => update(e.clientY);
    const onPointerMove = (e: PointerEvent) => update(e.clientY);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("pointermove", onPointerMove);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("pointermove", onPointerMove);
    };
  }, [isDragging]);

  // Hydrate persisted collapsed state once. Per-deck so different decks remember
  // independently. When no saved value exists, default to collapsed on mobile
  // (< md) and peek on desktop.
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(collapsedKey(deckId));
      if (saved !== null) {
        setCollapsed(saved === "1");
      } else {
        const isMobile = window.matchMedia("(max-width: 767px)").matches;
        if (isMobile) setCollapsed(true);
      }
    } catch {
      // localStorage may throw in private modes; safe to ignore.
    }
  }, [deckId]);

  // Persist only on explicit user toggle (see toggleCollapsed). We don't use a
  // [collapsed]-effect because that would also save the viewport-derived default
  // on first mount, defeating the mobile-collapsed-by-default behavior on any
  // device that ever loaded an older build that saved "0".
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(collapsedKey(deckId), next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, [deckId]);

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

  // Measure the natural height of the inner content so the height-animated
  // wrapper can resolve `height: contentHeight` instead of `auto` (auto can't
  // animate). ResizeObserver covers the empty-state → populated transition.
  React.useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const update = () => setContentHeight(el.scrollHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isHeaderDragging = dragOffset !== null;

  // Live wrapper height during a drag: anchored to whichever state we started
  // in, plus the inverse of deltaY (drag-up = negative delta = grows height).
  const liveHeight = React.useMemo(() => {
    if (!isHeaderDragging || !dragRef.current) {
      return collapsed ? 0 : contentHeight;
    }
    const base = dragRef.current.startedCollapsed ? 0 : contentHeight;
    const next = base - (dragOffset ?? 0);
    return Math.max(0, Math.min(contentHeight, next));
  }, [isHeaderDragging, dragOffset, collapsed, contentHeight]);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // While a card drag is in flight, the header is a passive drop surface —
    // don't start a drawer drag that would fight dnd-kit's pointer capture.
    if (isDragging) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startTime: Date.now(),
      startedCollapsed: collapsed,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers throw if the pointer can't be captured; safe to ignore.
    }
  };

  const onHeaderPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (isDragging) return;
    const s = dragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const delta = e.clientY - s.startY;
    if (!s.moved && Math.abs(delta) > 4) {
      s.moved = true;
    }
    if (s.moved) {
      setDragOffset(delta);
    }
  };

  const finishDrag = (commit: boolean, e?: React.PointerEvent<HTMLButtonElement>) => {
    const s = dragRef.current;
    if (!s) return;
    if (e) {
      try {
        e.currentTarget.releasePointerCapture(s.pointerId);
      } catch {
        // ignore
      }
    }
    dragRef.current = null;
    setDragOffset(null);

    if (!commit || !s.moved) {
      // Tap (no meaningful motion) — let the button's onClick handle it.
      return;
    }

    // Suppress the synthesized click that follows pointerup-after-drag.
    justDraggedRef.current = true;

    const now = Date.now();
    const duration = Math.max(now - s.startTime, 1);
    const finalDelta = e ? e.clientY - s.startY : (dragOffset ?? 0);
    const velocity = finalDelta / duration; // px/ms; +ve = downward (closing)

    const DIST_THRESHOLD = Math.max(20, contentHeight * 0.33);
    const FLICK = 0.5;

    if (s.startedCollapsed) {
      // Drag-up opens.
      const shouldOpen = -finalDelta > DIST_THRESHOLD || -velocity > FLICK;
      if (shouldOpen && collapsed) toggleCollapsed();
    } else {
      // Drag-down closes.
      const shouldClose = finalDelta > DIST_THRESHOLD || velocity > FLICK;
      if (shouldClose && !collapsed) toggleCollapsed();
    }
  };

  const onHeaderPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
    finishDrag(true, e);
  };
  const onHeaderPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
    finishDrag(false, e);
  };

  const onHeaderClick = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    toggleCollapsed();
  };

  const announce = (msg: string) => {
    setAnnouncement(msg);
    setTimeout(() => setAnnouncement(""), 1000);
  };

  const handleMoveToActive = (dc: DeckCard) => {
    onMoveToActive(dc.card.name, dc.card.set);
    announce(`Moved 1 ${dc.card.name} to ${activeZoneLabel}`);
  };
  const handleDecrement = (dc: DeckCard) => {
    onDecrement(dc.card.name, dc.card.set);
    announce(`Removed 1 ${dc.card.name} from maybeboard`);
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
  // Eager = the strip should be visibly lifted: either the user is actively
  // approaching from above, or the cursor has already arrived on the strip.
  const isEager = isApproaching || showDropAffordance;

  return (
    <section
      ref={sectionRef}
      aria-label={`Maybeboard, ${totalCount} ${totalCount === 1 ? "card" : "cards"}`}
      className={cn(
        "relative sticky bottom-0 z-10 bg-card backdrop-blur flex-shrink-0",
        "transition-[background-color,border-color,box-shadow] duration-300 ease-out",
        // Permanent 2px transparent border on all sides so the idle → eager
        // border-color transition doesn't shift layout by a pixel.
        "border-2 border-transparent shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.4)]",
        // Eager state — stronger shadow + bigger affordance below. We DON'T
        // translate-y here (that would create dead space below the lifted
        // strip — the gap between the lifted bottom and the viewport bottom
        // sits outside the section's bounding box, so drops there wouldn't
        // register). Instead the section grows naturally because the empty-
        // state placeholder / scroll-container grows below, and `sticky
        // bottom-0` keeps the bottom anchored so the section extends upward.
        isEager && "shadow-[0_-20px_40px_-10px_rgba(0,0,0,0.6)]",
        // Drop affordance — fires on isEager (approaching OR over), not just
        // hover, so the whole zone lights up while the user is still in flight.
        // Use a 3px solid border on all sides (more reliable than `ring` across
        // browsers, no shadow-stacking conflicts) plus a stronger bg tint so
        // the whole strip — not the small inner placeholder — reads as the
        // landing zone.
        isEager
          ? "bg-primary/15 border-primary"
          : "border-t-border",
      )}
    >
      {/* Approach zone — invisible band above the section that extends the
          HTML5 drag hit area upward. Native dragenter/over/leave/drop bubble
          from this child to the section's listeners (useExternalDropTarget),
          so dropping in this band still lands in the maybeboard. dnd-kit uses
          getBoundingClientRect on the section, which absolute children don't
          grow — but the -translate-y-2 lift already shifts that rect upward,
          and the strip auto-expands during drag for additional surface area.
          Only mounted during drag so it can't intercept normal pointer use. */}
      {isDragging && (
        <div
          aria-hidden
          className="absolute left-0 right-0 -top-12 h-12 pointer-events-auto"
        />
      )}

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
          onClick={onHeaderClick}
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerCancel}
          style={{ touchAction: isDragging ? "auto" : "none" }}
          className={cn(
            "group/drawer flex flex-1 items-center justify-between gap-2 py-1.5",
            "rounded-md transition-colors select-none",
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
          the collapsed → expanded transition during a drag. Height-animated
          wrapper drives both the tap-toggle and the live drag-from-header
          gesture; the inner `contentRef` is the measurement target. */}
      <div
        id="maybeboard-strip-content"
        aria-hidden={collapsed && !isHeaderDragging}
        style={{
          height: liveHeight,
          overflow: "hidden",
          transition: isHeaderDragging
            ? "none"
            : "height 220ms cubic-bezier(0.2, 0.0, 0.0, 1)",
        }}
      >
        <div ref={contentRef}>
          {/* Shared wrapper — identical px-3 / pb-2 geometry across empty and
              populated states so the measured contentHeight doesn't shift
              when count goes 0 → 1 (margin-collapse vs padding asymmetry
              otherwise causes a ~2px jump). */}
          <div
            className={cn(
              "px-3 pb-2 transition-[padding] duration-200 ease-out",
              uniqueCount > 0 && isEager && "pb-32",
            )}
          >
            {uniqueCount === 0 ? (
              <div
                className={cn(
                  "rounded border border-dashed flex items-center justify-center px-3",
                  "transition-[height,border-color,background-color] duration-200 ease-out",
                  // Grow the placeholder dramatically during drag so the
                  // section becomes a real drop target, not a thin strip with
                  // empty area inside it.
                  isEager ? "h-48" : "h-[56px]",
                  isEager ? "border-primary bg-primary/10" : "border-border/70",
                )}
              >
                <p
                  className={cn(
                    "text-center leading-tight transition-colors duration-200",
                    isEager
                      ? "text-base font-semibold text-primary"
                      : "text-[11px] text-muted-foreground",
                  )}
                >
                  {isEager ? "Drop into Maybeboard" : "Drag or use the menu to add cards."}
                </p>
              </div>
            ) : (
              <div
                ref={scrollRef}
                className="relative overflow-x-auto overflow-y-hidden flex gap-1.5"
                style={maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined}
              >
                {cards.map((dc) => (
                  <MaybeboardThumbnail
                    key={cardKey(dc)}
                    dc={dc}
                    onMoveToActive={() => handleMoveToActive(dc)}
                    onDecrement={() => handleDecrement(dc)}
                    onView={() => onViewCard?.(dc.card)}
                    activeZoneLabel={activeZoneLabel}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A single draggable thumbnail in the maybeboard strip. Split out so we can
 * use `useDraggable` cleanly — each thumbnail gets its own draggable identity.
 */
function MaybeboardThumbnail({
  dc,
  onMoveToActive,
  onDecrement,
  onView,
  activeZoneLabel,
}: {
  dc: DeckCard;
  onMoveToActive: () => void;
  onDecrement: () => void;
  onView: () => void;
  activeZoneLabel: string;
}) {
  const { getImageUrl } = useCardImageUrl();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId(dc),
    data: { fromZone: "maybeboard" as DeckZone, card: dc.card },
  });

  // Keyboard handlers on the focused thumbnail. Note: Space is reserved by
  // @dnd-kit's KeyboardSensor for drag pickup, so we keep Enter for "view".
  // ArrowUp / "+" both promote the card out of the maybeboard into the
  // currently visible tab's zone (main or reserve); "-" still removes a copy.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") {
      e.preventDefault();
      onMoveToActive();
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      onDecrement();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onView();
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
          onView();
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

        {/* Action buttons − / ↑ — nested inside the draggable so pointerdown
            on either bubbles to dnd-kit's listeners. Stationary taps below the
            activation distance still fire the button's onClick; press-and-drag
            starts a card drag like dragging from the image. Always visible on
            touch, revealed on hover on desktop.
              • −  removes a copy from the maybeboard.
              • ↑  promotes one copy into the active tab's zone (main/reserve).
            The chevron destination follows the user's current tab, so the
            button reads as "send this up where I'm looking right now". */}
        <div className="absolute top-0 right-0 pointer-events-none flex opacity-100 md:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecrement();
            }}
            className="pointer-events-auto w-6 h-6 rounded-l bg-black/60 hover:bg-black/80 text-white text-sm font-bold leading-none"
            aria-label={`Remove one copy of ${dc.card.name} from maybeboard`}
          >
            −
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoveToActive();
            }}
            className="pointer-events-auto w-6 h-6 rounded-r bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
            aria-label={`Move ${dc.card.name} to ${activeZoneLabel}`}
            title={`Move to ${activeZoneLabel}`}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>
        </div>
      </div>

    </div>
  );
}
