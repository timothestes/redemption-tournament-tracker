import React from "react";

import { openYTGSearchPage } from "./ytgUtils";
import { useCardImageUrl } from "./hooks/useCardImageUrl";
import { useCardPrices } from "./hooks/useCardPrices";
import { useCardRulings, type CardRuling } from "./hooks/useCardRulings";
import { useIsAdmin } from "../../../hooks/useIsAdmin";
import { createRuling, updateRuling, deleteRuling } from "../../admin/rulings/actions";

/* ------------------------------------------------------------------ */
/*  Inline Edit Ruling (replaces a ruling's text with editable fields) */
/* ------------------------------------------------------------------ */

function EditRulingInline({ ruling, onSaved, onCancel }: { ruling: CardRuling; onSaved: () => void; onCancel: () => void }) {
  const [question, setQuestion] = React.useState(ruling.question);
  const [answer, setAnswer] = React.useState(ruling.answer);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSave = async () => {
    if (!question.trim() || !answer.trim()) return;
    setSubmitting(true);
    setError(null);

    const result = await updateRuling(ruling.id, {
      question: question.trim(),
      answer: answer.trim(),
    });

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
    } else {
      setSubmitting(false);
      onSaved();
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        className="w-full border border-border rounded-md px-2.5 py-1.5 text-sm bg-background text-foreground resize-y min-h-[60px]"
        autoFocus
      />
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        className="w-full border border-border rounded-md px-2.5 py-1.5 text-sm bg-background text-foreground resize-y min-h-[60px]"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={submitting || !question.trim() || !answer.trim()}
          className="px-3 py-1 rounded text-xs font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {submitting ? "Saving..." : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Add Ruling Form (inside card modal)                         */
/* ------------------------------------------------------------------ */

function AddRulingInline({ cardName, onSaved, onCancel }: { cardName: string; onSaved: () => void; onCancel: () => void }) {
  const [question, setQuestion] = React.useState("");
  const [answer, setAnswer] = React.useState("");
  const [source, setSource] = React.useState("manual");
  const [rulingDate, setRulingDate] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async () => {
    if (!question.trim() || !answer.trim()) return;
    setSubmitting(true);
    setError(null);

    const result = await createRuling({
      card_name: cardName,
      question: question.trim(),
      answer: answer.trim(),
      source,
      ruling_date: rulingDate || undefined,
    });

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
    } else {
      setQuestion("");
      setAnswer("");
      setRulingDate("");
      setSubmitting(false);
      onSaved();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Add Ruling for {cardName}</p>
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Question / Scenario</label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What is the question or scenario?"
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground resize-y min-h-[100px]"
          autoFocus
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Answer / Ruling</label>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="The official ruling or answer"
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground resize-y min-h-[100px]"
        />
      </div>
      <div className="flex gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="border border-border rounded-md px-2 py-1.5 text-xs bg-background text-foreground"
        >
          <option value="manual">Manual</option>
          <option value="discord">Discord</option>
          <option value="official_faq">Official FAQ</option>
          <option value="reg">REG</option>
          <option value="ordir">ORDIR</option>
        </select>
        <input
          type="date"
          value={rulingDate}
          onChange={(e) => setRulingDate(e.target.value)}
          className="border border-border rounded-md px-2 py-1.5 text-xs bg-background text-foreground"
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={submitting || !question.trim() || !answer.trim()}
        className="w-full py-2 rounded-md text-sm font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-40 transition-opacity"
      >
        {submitting ? "Saving..." : "Add Ruling"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Rulings Bottom Sheet (mobile)                                      */
/* ------------------------------------------------------------------ */

function MobileRulingsSheet({
  rulings,
  open,
  onClose,
  cardName,
  canManageRulings,
  onAddRuling,
  editingRulingId,
  setEditingRulingId,
  deletingRulingId,
  setDeletingRulingId,
  refetchRulings,
}: {
  rulings: CardRuling[];
  open: boolean;
  onClose: () => void;
  cardName: string;
  canManageRulings: boolean;
  onAddRuling: () => void;
  editingRulingId: string | null;
  setEditingRulingId: (id: string | null) => void;
  deletingRulingId: string | null;
  setDeletingRulingId: (id: string | null) => void;
  refetchRulings: () => void;
}) {
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const dragStartRef = React.useRef<{ y: number; sheetY: number } | null>(null);
  const [dragOffset, setDragOffset] = React.useState(0);

  // Reset drag when opening/closing
  React.useEffect(() => {
    if (open) setDragOffset(0);
  }, [open]);

  const handleDragStart = React.useCallback((e: React.TouchEvent) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    // Only start drag from the handle area (top 40px)
    const rect = sheet.getBoundingClientRect();
    const touchY = e.touches[0].clientY;
    if (touchY - rect.top > 48) return;
    dragStartRef.current = { y: e.touches[0].clientY, sheetY: 0 };
  }, []);

  const handleDragMove = React.useCallback((e: React.TouchEvent) => {
    if (!dragStartRef.current) return;
    const delta = e.touches[0].clientY - dragStartRef.current.y;
    // Only allow dragging downward
    setDragOffset(Math.max(0, delta));
  }, []);

  const handleDragEnd = React.useCallback(() => {
    if (!dragStartRef.current) return;
    // Dismiss if dragged more than 80px down
    if (dragOffset > 80) {
      onClose();
    }
    setDragOffset(0);
    dragStartRef.current = null;
  }, [dragOffset, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 z-10 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`absolute left-0 right-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 bg-card rounded-t-xl shadow-lg transition-transform duration-300 ease-out ${open ? '' : 'translate-y-full'}`}
        style={{
          maxHeight: '70vh',
          transform: open ? `translateY(${dragOffset}px)` : undefined,
          transition: dragOffset > 0 ? 'none' : undefined,
        }}
        onTouchStart={handleDragStart}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 cursor-grab">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2 border-b border-border">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            Rulings ({rulings.length})
          </span>
          <button onClick={onClose} className="p-1.5 -mr-1 text-muted-foreground active:text-foreground">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Rulings list */}
        <div className="overflow-y-auto px-4 py-3 space-y-3" style={{ maxHeight: 'calc(70vh - 5rem)' }}>
          {rulings.map((ruling) => (
            <div key={ruling.id}>
              {editingRulingId === ruling.id ? (
                <EditRulingInline
                  ruling={ruling}
                  onSaved={() => { refetchRulings(); setEditingRulingId(null); }}
                  onCancel={() => setEditingRulingId(null)}
                />
              ) : (
                <div className="text-sm border-l-2 border-muted-foreground/20 pl-3">
                  <p className="text-foreground">
                    <span className="font-semibold text-muted-foreground">Q:</span> {ruling.question}
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    <span className="font-semibold">A:</span> {ruling.answer}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {ruling.ruling_date && (
                      <span className="text-xs text-muted-foreground/60">{ruling.ruling_date}</span>
                    )}
                    {/* Admin controls — always visible on mobile (no hover) */}
                    {canManageRulings && (
                      <span className="flex items-center gap-1 ml-auto">
                        <button
                          onClick={() => setEditingRulingId(ruling.id)}
                          className="p-1.5 rounded text-muted-foreground/50 active:text-foreground transition-colors"
                          title="Edit ruling"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                          </svg>
                        </button>
                        <button
                          onClick={async () => {
                            setDeletingRulingId(ruling.id);
                            await deleteRuling(ruling.id);
                            refetchRulings();
                            setDeletingRulingId(null);
                          }}
                          disabled={deletingRulingId === ruling.id}
                          className="p-1.5 rounded text-muted-foreground/50 active:text-red-500 transition-colors disabled:opacity-40"
                          title="Delete ruling"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {canManageRulings && (
            <button
              onClick={onAddRuling}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground active:text-foreground transition-colors"
            >
              + Add ruling
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Attribute({ label, value }: { label: string; value: string | boolean }) {
  // Prettify testament display if it's an array
  let displayValue = value;
  if (label === 'Testament') {
    if (Array.isArray(value)) {
      displayValue = value.join(' and ');
    }
    // If someone encoded as a string like 'NTOT', split and join
    if (typeof value === 'string' && value.length > 2 && (value.includes('NT') || value.includes('OT'))) {
      // Try to split into NT and OT
      const parts = [];
      if (value.includes('NT')) parts.push('NT');
      if (value.includes('OT')) parts.push('OT');
      displayValue = parts.join(' and ');
    }
  }
  if (label === 'Is Gospel') {
    if (typeof value === 'boolean') {
      displayValue = value ? 'Yes' : 'No';
    } else {
      displayValue = '';
    }
  }
  return <p className="text-sm text-foreground"><strong>{label}:</strong> {displayValue}</p>;
}

function prettifyFieldName(key: string): string {
  const map: Record<string, string> = {
    name: "Name",
    set: "Set",
    officialSet: "Official Set",
    type: "Type",
    brigade: "Brigade",
    strength: "Strength",
    toughness: "Toughness",
    class: "Class",
    identifier: "Identifier",
    specialAbility: "Special Ability",
    rarity: "Rarity",
    reference: "Reference",
    alignment: "Alignment",
    legality: "Legality",
    testament: "Testament",
    isGospel: "Is Gospel",
  };
  return map[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, s => s.toUpperCase());
}

export default function ModalWithClose({
  modalCard,
  setModalCard,
  visibleCards,
  onAddCard,
  onRemoveCard,
  getCardQuantity,
  activeDeckTab = "main" // Default to main if not provided
}) {
  const { getImageUrl } = useCardImageUrl();
  const { getPrice, getProductUrl } = useCardPrices();
  const { rulings, refetch: refetchRulings } = useCardRulings(modalCard?.name ?? null);
  const { isAdmin, permissions } = useIsAdmin();
  const canManageRulings = isAdmin && permissions.includes('manage_rulings');
  const [showMenu, setShowMenu] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(false);
  const [isClosing, setIsClosing] = React.useState(false);
  const [rulingsSheetOpen, setRulingsSheetOpen] = React.useState(false);
  const [addRulingMode, setAddRulingMode] = React.useState(false);
  const [editingRulingId, setEditingRulingId] = React.useState<string | null>(null);
  const [deletingRulingId, setDeletingRulingId] = React.useState<string | null>(null);

  // Reset rulings state when card changes
  React.useEffect(() => {
    setRulingsSheetOpen(false);
    setAddRulingMode(false);
    setEditingRulingId(null);
  }, [modalCard?.name]);

  // Animate in on mount
  React.useEffect(() => {
    if (modalCard) {
      requestAnimationFrame(() => setIsVisible(true));
      setIsClosing(false);
    } else {
      setIsVisible(false);
    }
  }, [modalCard]);

  // Wrap setModalCard to animate out before unmounting
  const closeModal = React.useCallback(() => {
    setIsClosing(true);
    setIsVisible(false);
    setTimeout(() => {
      setIsClosing(false);
      setModalCard(null);
    }, 200);
  }, [setModalCard]);

  // Swipe/carousel state
  const touchStartRef = React.useRef<{ x: number; y: number; time: number } | null>(null);
  const isSwipingRef = React.useRef(false);
  const isAnimatingRef = React.useRef(false);
  const [swipeOffset, setSwipeOffset] = React.useState(0);
  // animatingTo: target panel position during slide-out animation (0 = prev, -200% = next)
  const [animatingTo, setAnimatingTo] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Pending card to set after animation completes
  const pendingCardRef = React.useRef<any>(null);
  // Skip transition for one frame after card swap to prevent reverse-slide visual glitch
  const skipTransitionRef = React.useRef(false);

  // Close menu when clicking outside
  React.useEffect(() => {
    if (!showMenu) return;
    const handleClick = () => setShowMenu(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showMenu]);

  React.useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        if (showMenu) {
          setShowMenu(false);
        } else {
          closeModal();
        }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!visibleCards || visibleCards.length <= 1) return;

        const currentIndex = visibleCards.findIndex(card => card.dataLine === modalCard.dataLine);
        if (currentIndex === -1) return;

        let nextIndex;
        if (e.key === "ArrowLeft") {
          nextIndex = currentIndex === 0 ? visibleCards.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex === visibleCards.length - 1 ? 0 : currentIndex + 1;
        }

        setModalCard(visibleCards[nextIndex]);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (!onAddCard || !onRemoveCard) return;

        if (e.key === "ArrowUp") {
          const isReserve = activeDeckTab === "reserve";
          onAddCard(modalCard, isReserve);
        } else {
          const isReserve = activeDeckTab === "reserve";
          onRemoveCard(modalCard.name, modalCard.set, isReserve);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setModalCard, closeModal, modalCard, visibleCards, showMenu, onAddCard, onRemoveCard, activeDeckTab]);

  // Get adjacent card for preview during swipe
  const getAdjacentCard = React.useCallback((direction: 'left' | 'right') => {
    if (!visibleCards || visibleCards.length <= 1) return null;
    const idx = visibleCards.findIndex(card => card.dataLine === modalCard.dataLine);
    if (idx === -1) return null;
    if (direction === 'left') {
      return visibleCards[idx === 0 ? visibleCards.length - 1 : idx - 1];
    }
    return visibleCards[idx === visibleCards.length - 1 ? 0 : idx + 1];
  }, [visibleCards, modalCard]);

  // Called when the CSS slide-out animation finishes
  const handleTransitionEnd = React.useCallback(() => {
    if (!pendingCardRef.current || !isAnimatingRef.current) return;
    // Suppress transition for the card-swap render to prevent reverse-slide glitch
    skipTransitionRef.current = true;
    isAnimatingRef.current = false;
    setAnimatingTo(null);
    setSwipeOffset(0);
    setModalCard(pendingCardRef.current);
    pendingCardRef.current = null;
  }, [setModalCard]);

  // Clear the skip-transition flag after the no-transition frame has painted
  React.useLayoutEffect(() => {
    if (skipTransitionRef.current) {
      const id = requestAnimationFrame(() => {
        skipTransitionRef.current = false;
      });
      return () => cancelAnimationFrame(id);
    }
  });

  // Navigate: animate the track to the adjacent card, then swap on transition end
  const navigateWithSlide = React.useCallback((direction: 'left' | 'right') => {
    if (!visibleCards || visibleCards.length <= 1 || isAnimatingRef.current) return;
    const currentIndex = visibleCards.findIndex(card => card.dataLine === modalCard.dataLine);
    if (currentIndex === -1) return;
    let nextIndex;
    if (direction === 'left') {
      nextIndex = currentIndex === 0 ? visibleCards.length - 1 : currentIndex - 1;
    } else {
      nextIndex = currentIndex === visibleCards.length - 1 ? 0 : currentIndex + 1;
    }
    // Store the card to switch to after animation
    pendingCardRef.current = visibleCards[nextIndex];
    isAnimatingRef.current = true;
    // Animate track: show prev (0%) or next (-200%)
    setSwipeOffset(0);
    setAnimatingTo(direction === 'left' ? '0%' : '-200%');
  }, [visibleCards, modalCard]);

  // Swipe navigation (no animation, used by desktop)
  const navigateToCard = React.useCallback((direction: 'left' | 'right') => {
    if (!visibleCards || visibleCards.length <= 1) return;
    const currentIndex = visibleCards.findIndex(card => card.dataLine === modalCard.dataLine);
    if (currentIndex === -1) return;
    let nextIndex;
    if (direction === 'left') {
      nextIndex = currentIndex === 0 ? visibleCards.length - 1 : currentIndex - 1;
    } else {
      nextIndex = currentIndex === visibleCards.length - 1 ? 0 : currentIndex + 1;
    }
    setModalCard(visibleCards[nextIndex]);
  }, [visibleCards, modalCard, setModalCard]);

  // Touch handlers
  const handleTouchStart = React.useCallback((e: React.TouchEvent) => {
    if (isAnimatingRef.current) return; // Don't start new swipe during animation
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
    isSwipingRef.current = false;
    setSwipeOffset(0);
    setAnimatingTo(null);
  }, []);

  const handleTouchMove = React.useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || !visibleCards || visibleCards.length <= 1 || isAnimatingRef.current) return;
    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;
    // Lock into horizontal swipe if horizontal movement dominates
    if (!isSwipingRef.current && Math.abs(deltaX) > 10) {
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        isSwipingRef.current = true;
      }
    }
    if (isSwipingRef.current) {
      e.preventDefault();
      setSwipeOffset(deltaX);
    }
  }, [visibleCards]);

  const handleTouchEnd = React.useCallback(() => {
    if (!touchStartRef.current || isAnimatingRef.current) return;
    const containerWidth = containerRef.current?.offsetWidth || 300;
    const swipeThreshold = containerWidth * 0.2;
    const velocityThreshold = 0.3;
    const elapsed = Date.now() - touchStartRef.current.time;
    const velocity = Math.abs(swipeOffset) / Math.max(elapsed, 1);

    const shouldNavigate = Math.abs(swipeOffset) > swipeThreshold || velocity > velocityThreshold;

    if (shouldNavigate && isSwipingRef.current) {
      if (swipeOffset > 0) {
        navigateWithSlide('left');  // Swiped right → go to previous
      } else {
        navigateWithSlide('right'); // Swiped left → go to next
      }
    } else {
      // Snap back to center
      setSwipeOffset(0);
    }

    touchStartRef.current = null;
    isSwipingRef.current = false;
  }, [swipeOffset, navigateWithSlide]);

  if (!modalCard) return null;

  const currentIndex = visibleCards ? visibleCards.findIndex(card => card.dataLine === modalCard.dataLine) : -1;
  const hasNavigation = visibleCards && visibleCards.length > 1;
  const isFundraiser = modalCard.set === "Fund" || modalCard.officialSet === "Fundraiser";

  // Get quantities for badge display
  const quantityInDeck = getCardQuantity ? getCardQuantity(modalCard.name, modalCard.set, false) : 0;
  const quantityInReserve = getCardQuantity ? getCardQuantity(modalCard.name, modalCard.set, true) : 0;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center md:p-4 transition-colors duration-200 ${isVisible && !isClosing ? 'bg-black/50' : 'bg-black/0'}`}
      onClick={() => closeModal()}
    >
      {/* Mobile: full-screen layout, with bottom padding for MobileBottomNav */}
      <div
        className={`md:hidden bg-card text-foreground w-full h-full flex flex-col relative pb-[calc(3.5rem+env(safe-area-inset-bottom))] transition-all duration-200 ${isVisible && !isClosing ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Mobile Header - compact */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex-1 min-w-0 mr-2">
            <div className="font-semibold text-base truncate">{modalCard.name}</div>
            <div className="flex items-center gap-2">
              {hasNavigation && (
                <span className="text-[10px] text-muted-foreground">{currentIndex + 1} of {visibleCards.length}</span>
              )}
              {modalCard.officialSet && (
                <span className="text-[10px] text-muted-foreground">{modalCard.officialSet}</span>
              )}
              {(() => {
                const cardKey = `${modalCard.name}|${modalCard.set}|${modalCard.imgFile}`;
                const priceInfo = getPrice(cardKey);
                return priceInfo ? (
                  <span className="text-[10px] text-muted-foreground">${priceInfo.price.toFixed(2)}</span>
                ) : null;
              })()}
            </div>
          </div>
          {/* Quantity badges */}
          {onAddCard && (quantityInDeck > 0 || quantityInReserve > 0) && (
            <div className="flex items-center gap-1 mr-2 flex-shrink-0">
              {quantityInDeck > 0 && (
                <span className="bg-primary text-white px-1.5 py-0.5 rounded text-xs font-bold">
                  ×{quantityInDeck}
                </span>
              )}
              {quantityInReserve > 0 && (
                <span className="bg-amber-600 text-white px-1.5 py-0.5 rounded text-xs font-bold">
                  ×{quantityInReserve} R
                </span>
              )}
            </div>
          )}
          <button
            className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            aria-label="Close modal"
            onClick={() => closeModal()}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mobile Card Image - carousel swipe */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative bg-black/5 dark:bg-black/20 touch-pan-y pb-[5.5rem]"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Carousel track - holds prev, current, next cards side by side */}
          <div
            className="flex h-full items-center"
            style={{
              // During drag: follow finger (no transition). During animation: slide to target. At rest: centered.
              transform: animatingTo
                ? `translateX(${animatingTo})`
                : `translateX(calc(-100% + ${swipeOffset}px))`,
              transition: animatingTo
                ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
                : (skipTransitionRef.current || swipeOffset !== 0)
                  ? 'none'
                  : 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
              willChange: 'transform',
            }}
            onTransitionEnd={handleTransitionEnd}
          >
            {/* Previous card */}
            <div className="w-full h-full flex-shrink-0 flex items-center justify-center px-2 py-1">
              {hasNavigation && (() => {
                const prev = getAdjacentCard('left');
                return prev ? (
                  <img
                    src={getImageUrl(prev.imgFile)}
                    alt={prev.name}
                    className="max-w-full max-h-full object-contain select-none rounded shadow-lg"
                    draggable={false}
                  />
                ) : null;
              })()}
            </div>

            {/* Current card */}
            <div className="w-full h-full flex-shrink-0 flex items-center justify-center px-2 py-1">
              <img
                src={getImageUrl(modalCard.imgFile)}
                alt={modalCard.name}
                className="max-w-full max-h-full object-contain select-none rounded shadow-lg"
                draggable={false}
              />
            </div>

            {/* Next card */}
            <div className="w-full h-full flex-shrink-0 flex items-center justify-center px-2 py-1">
              {hasNavigation && (() => {
                const next = getAdjacentCard('right');
                return next ? (
                  <img
                    src={getImageUrl(next.imgFile)}
                    alt={next.name}
                    className="max-w-full max-h-full object-contain select-none rounded shadow-lg"
                    draggable={false}
                  />
                ) : null;
              })()}
            </div>
          </div>

        </div>

        {/* Mobile Rulings Bottom Sheet */}
        <MobileRulingsSheet
          rulings={rulings}
          open={rulingsSheetOpen && !addRulingMode}
          onClose={() => setRulingsSheetOpen(false)}
          cardName={modalCard?.name ?? ""}
          canManageRulings={canManageRulings}
          onAddRuling={() => { setRulingsSheetOpen(false); setAddRulingMode(true); }}
          editingRulingId={editingRulingId}
          setEditingRulingId={setEditingRulingId}
          deletingRulingId={deletingRulingId}
          setDeletingRulingId={setDeletingRulingId}
          refetchRulings={refetchRulings}
        />

        {/* Mobile Add Ruling Form — bottom sheet style */}
        {addRulingMode && (
          <>
            <div className="absolute inset-0 bg-black/40 z-10" onClick={() => setAddRulingMode(false)} />
            <div className="absolute left-0 right-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 bg-card rounded-t-xl shadow-lg" style={{ maxHeight: '75vh' }}>
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
              </div>
              <div className="overflow-y-auto px-4 py-3" style={{ maxHeight: 'calc(75vh - 2rem)' }}>
                <AddRulingInline
                  cardName={modalCard?.name ?? ""}
                  onSaved={() => { refetchRulings(); setAddRulingMode(false); }}
                  onCancel={() => setAddRulingMode(false)}
                />
              </div>
            </div>
          </>
        )}

        {/* Mobile Footer — pinned above bottom nav */}
        <div className="absolute bottom-[calc(3.5rem+env(safe-area-inset-bottom))] left-0 right-0 px-3 py-2.5 border-t border-border bg-card/95 backdrop-blur-sm">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Deck builder: add/remove controls */}
            {onAddCard && onRemoveCard && getCardQuantity && (
              <>
                {/* Main deck group — minus only shows when card is in main */}
                <div className="flex flex-shrink-0">
                  {getCardQuantity(modalCard.name, modalCard.set, false) > 0 && (
                    <button
                      onClick={() => onRemoveCard(modalCard.name, modalCard.set, false)}
                      className="h-10 w-9 flex items-center justify-center rounded-l-lg bg-green-700 active:bg-green-800 text-white"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => onAddCard(modalCard, false)}
                    className={`h-10 px-3 bg-green-600 active:bg-green-700 text-white flex items-center gap-1.5 font-medium text-sm transition-colors ${
                      getCardQuantity(modalCard.name, modalCard.set, false) > 0
                        ? 'rounded-r-lg border-l border-green-500/30'
                        : 'rounded-lg'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Main
                    {(() => {
                      const qty = getCardQuantity(modalCard.name, modalCard.set, false);
                      return qty > 0 ? (
                        <span className="bg-white/25 px-1.5 rounded text-xs font-bold">{qty}</span>
                      ) : null;
                    })()}
                  </button>
                </div>
                {/* Reserve group — minus only shows when card is in reserve */}
                <div className="flex flex-shrink-0">
                  {getCardQuantity(modalCard.name, modalCard.set, true) > 0 && (
                    <button
                      onClick={() => onRemoveCard(modalCard.name, modalCard.set, true)}
                      className="h-10 w-9 flex items-center justify-center rounded-l-lg bg-amber-700 active:bg-amber-800 text-white"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => onAddCard(modalCard, true)}
                    className={`h-10 px-3 bg-amber-600 active:bg-amber-700 text-white flex items-center gap-1.5 font-medium text-sm transition-colors ${
                      getCardQuantity(modalCard.name, modalCard.set, true) > 0
                        ? 'rounded-r-lg border-l border-amber-500/30'
                        : 'rounded-lg'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Rsv
                    {(() => {
                      const qty = getCardQuantity(modalCard.name, modalCard.set, true);
                      return qty > 0 ? (
                        <span className="bg-white/25 px-1.5 rounded text-xs font-bold">{qty}</span>
                      ) : null;
                    })()}
                  </button>
                </div>
              </>
            )}
            {/* Public view: card metadata */}
            {!(onAddCard && onRemoveCard && getCardQuantity) && (
              <div className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-muted-foreground overflow-hidden">
                {modalCard.type && <span className="truncate">{modalCard.type}</span>}
                {modalCard.brigade && (
                  <>
                    <span className="text-border">·</span>
                    <span className="truncate">{modalCard.brigade}</span>
                  </>
                )}
                {modalCard.strength && modalCard.toughness && (
                  <>
                    <span className="text-border">·</span>
                    <span className="flex-shrink-0">{modalCard.strength}/{modalCard.toughness}</span>
                  </>
                )}
                {modalCard.rarity && (
                  <>
                    <span className="text-border">·</span>
                    <span className="flex-shrink-0">{modalCard.rarity}</span>
                  </>
                )}
              </div>
            )}
            {/* Rulings button */}
            {rulings.length > 0 && !addRulingMode && (
              <button
                onClick={() => setRulingsSheetOpen(true)}
                className="h-10 px-3 flex-shrink-0 rounded-lg flex items-center gap-1.5 text-sm font-medium border border-border bg-muted/50 text-foreground active:bg-muted transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
                {rulings.length}
              </button>
            )}
            {/* Admin: add ruling when none exist */}
            {rulings.length === 0 && canManageRulings && !addRulingMode && (
              <button
                onClick={() => setAddRulingMode(true)}
                className="h-10 px-3 flex-shrink-0 rounded-lg flex items-center gap-1 text-xs border border-border bg-muted/50 text-muted-foreground active:bg-muted transition-colors"
              >
                + Ruling
              </button>
            )}
            {/* Spacer — collapses when space is tight */}
            <div className="flex-1 min-w-0" />
            {/* Shop button with price + YTG logo */}
            {(() => {
              const cardKey = `${modalCard.name}|${modalCard.set}|${modalCard.imgFile}`;
              const priceInfo = getPrice(cardKey);
              const productUrl = getProductUrl(cardKey);
              return (
                <button
                  onClick={() => isFundraiser
                    ? window.open('https://cactus-game-design-inc.square.site/s/shop', '_blank')
                    : productUrl
                      ? window.open(productUrl, '_blank', 'noopener,noreferrer')
                      : openYTGSearchPage(modalCard.name)
                  }
                  className="h-10 px-3 flex-shrink-0 rounded-lg flex items-center gap-1.5 font-semibold text-sm border border-green-600/30 dark:border-green-500/25 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 active:translate-y-[1px] transition-all duration-100"
                >
                  <img src="/sponsors/ytg-dark.png" alt="YTG" className="h-4 w-4 object-contain hidden dark:block" />
                  <img src="/sponsors/ytg-light.png" alt="YTG" className="h-4 w-4 object-contain dark:hidden" />
                  {priceInfo ? (
                    <>
                      <span>{isFundraiser ? `$${priceInfo.price.toFixed(0)}` : `$${priceInfo.price.toFixed(2)}`}</span>
                      <svg className="w-3.5 h-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </>
                  ) : (
                    <span>Shop</span>
                  )}
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Desktop: centered modal (unchanged) */}
      <div
        className={`hidden md:flex bg-card text-foreground rounded shadow-lg max-w-4xl w-full h-[80vh] overflow-hidden relative flex-col transition-all duration-200 ${isVisible && !isClosing ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* X close button */}
        <button
          className="absolute top-2 right-2 flex items-center justify-center rounded-full w-9 h-9 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none z-20 transition-all duration-150"
          aria-label="Close modal"
          onClick={() => closeModal()}
        >
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <line x1="10" y1="10" x2="22" y2="22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="22" y1="10" x2="10" y2="22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
        <div className="px-4 pt-4 pb-2 border-b font-semibold text-lg text-center">
          <div className="truncate">{modalCard.name}</div>
          {(() => {
            const cardKey = `${modalCard.name}|${modalCard.set}|${modalCard.imgFile}`;
            const priceInfo = getPrice(cardKey);
            return priceInfo ? (
              <div className="text-sm font-medium text-muted-foreground mt-0.5">
                ${priceInfo.price.toFixed(2)}
              </div>
            ) : null;
          })()}
        </div>
        {addRulingMode ? (
          /* Side-by-side layout: card image left, form right */
          <div className="px-4 py-4 flex gap-6 flex-1 overflow-hidden">
            <div className="w-2/5 flex-shrink-0 flex flex-col items-start overflow-hidden">
              <img
                src={getImageUrl(modalCard.imgFile)}
                alt={modalCard.name}
                className="max-w-full max-h-full object-contain rounded shadow-lg flex-shrink"
              />
              {/* Show ability text below image for reference */}
              {modalCard.ability && (
                <p className="mt-3 text-xs text-muted-foreground leading-relaxed flex-shrink-0">{modalCard.ability}</p>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              <AddRulingInline
                cardName={modalCard?.name ?? ""}
                onSaved={() => { refetchRulings(); setAddRulingMode(false); }}
                onCancel={() => setAddRulingMode(false)}
              />
              {/* Show existing rulings below the form for context */}
              {rulings.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Existing Rulings ({rulings.length})</p>
                  <div className="space-y-2">
                    {rulings.map((ruling) => (
                      <div key={ruling.id} className="text-xs border-l-2 border-muted-foreground/20 pl-2.5">
                        <p className="text-foreground"><span className="font-semibold text-muted-foreground">Q:</span> {ruling.question}</p>
                        <p className="text-muted-foreground mt-0.5"><span className="font-semibold">A:</span> {ruling.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Normal side-by-side layout: image left, details + rulings right */
          <div className="px-4 py-4 flex gap-6 flex-1 overflow-hidden">
            <div className="w-2/5 flex-shrink-0 flex items-start overflow-hidden">
              <img
                src={getImageUrl(modalCard.imgFile)}
                alt={modalCard.name}
                className="max-w-full max-h-full object-contain rounded shadow-lg"
              />
            </div>
            <div className="flex-1 overflow-auto pr-1">
              <div className="space-y-1">
                {Object.entries(modalCard)
                  .filter(([key]) => {
                    if (key === 'isGospel') return modalCard.isGospel === true;
                    return key !== "dataLine" && key !== "imgFile";
                })
                .map(([key, value]) => (
                  <Attribute key={key} label={prettifyFieldName(key)} value={value as string} />
                ))}
              </div>
              {/* Desktop Rulings */}
              {(rulings.length > 0 || canManageRulings) && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                    Rulings {rulings.length > 0 && `(${rulings.length})`}
                  </p>
                  <div className="space-y-2.5">
                    {rulings.map((ruling) => (
                      <div key={ruling.id}>
                        {editingRulingId === ruling.id ? (
                          <EditRulingInline
                            ruling={ruling}
                            onSaved={() => { refetchRulings(); setEditingRulingId(null); }}
                            onCancel={() => setEditingRulingId(null)}
                          />
                        ) : (
                          <div className="group text-sm border-l-2 border-muted-foreground/20 pl-3 relative">
                            <p className="text-foreground">
                              <span className="font-semibold text-muted-foreground">Q:</span> {ruling.question}
                            </p>
                            <p className="text-muted-foreground mt-0.5">
                              <span className="font-semibold">A:</span> {ruling.answer}
                            </p>
                            {ruling.ruling_date && (
                              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{ruling.ruling_date}</p>
                            )}
                            {/* Admin edit/delete — hover-reveal */}
                            {canManageRulings && (
                              <span className="absolute top-0 right-0 hidden group-hover:flex items-center gap-1">
                                <button
                                  onClick={() => setEditingRulingId(ruling.id)}
                                  className="p-1 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
                                  title="Edit ruling"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={async () => {
                                    setDeletingRulingId(ruling.id);
                                    await deleteRuling(ruling.id);
                                    refetchRulings();
                                    setDeletingRulingId(null);
                                  }}
                                  disabled={deletingRulingId === ruling.id}
                                  className="p-1 rounded text-muted-foreground/50 hover:text-red-500 transition-colors disabled:opacity-40"
                                  title="Delete ruling"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                  </svg>
                                </button>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {canManageRulings && (
                      <button
                        onClick={() => setAddRulingMode(true)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        + Add ruling
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="px-4 pb-4 pt-2 border-t bg-muted">
          {hasNavigation && (
            <div className="text-xs text-muted-foreground text-center mb-2">
              Use ← → to navigate{onAddCard && onRemoveCard && ' • ↑ to add • ↓ to remove'} • {currentIndex + 1} of {visibleCards.length}
            </div>
          )}
          <div className="flex items-center gap-2">
            {hasNavigation ? (
              <button
                onClick={() => navigateToCard('left')}
                className="w-10 h-10 shrink-0 text-muted-foreground hover:text-foreground hover:bg-card rounded-lg transition-colors flex items-center justify-center"
                title="Previous card (Left arrow)"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            ) : null}
            <div className="flex-1 flex justify-center gap-2 items-center min-w-0">
            {onAddCard && onRemoveCard && getCardQuantity && (
              <div className="relative">
                <div className="flex gap-0 h-10">
                  {/* Main add button - adds to active tab */}
                  <button
                    onClick={() => {
                      const isReserve = activeDeckTab === "reserve";
                      onAddCard(modalCard, isReserve);
                    }}
                    className="px-4 h-10 bg-green-700 hover:bg-green-800 text-white rounded-l-lg flex items-center gap-1.5 font-semibold transition-colors text-sm whitespace-nowrap"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add to {activeDeckTab === "reserve" ? "Reserve" : activeDeckTab === "main" ? "Main" : "Deck"}
                    {(() => {
                      const isReserve = activeDeckTab === "reserve";
                      const quantity = getCardQuantity(modalCard.name, modalCard.set, isReserve);
                      return quantity > 0 && (
                        <span className="bg-white/20 text-white px-2 py-0.5 rounded-md font-bold text-xs">
                          ×{quantity}
                        </span>
                      );
                    })()}
                  </button>
                  {/* Dropdown toggle button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(!showMenu);
                    }}
                    className="px-2.5 h-10 bg-green-700 hover:bg-green-800 text-white rounded-r-lg border-l border-green-600/30 transition-colors"
                  >
                    <svg className={`w-4 h-4 transition-transform ${showMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {showMenu && (
                  <div className="absolute bottom-full mb-2 left-0 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[200px] z-50">
                    <button
                      onClick={() => {
                        onAddCard(modalCard, false);
                        setShowMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add to Main Deck
                    </button>
                    <button
                      onClick={() => {
                        onAddCard(modalCard, true);
                        setShowMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add to Reserve
                    </button>
                    {(getCardQuantity(modalCard.name, modalCard.set, false) > 0 || getCardQuantity(modalCard.name, modalCard.set, true) > 0) && (
                      <>
                        <div className="border-t border-border my-1"></div>
                        {getCardQuantity(modalCard.name, modalCard.set, false) > 0 && (
                          <button
                            onClick={() => {
                              onRemoveCard(modalCard.name, modalCard.set, false);
                              setShowMenu(false);
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-red-600 dark:text-red-400"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                            </svg>
                            Remove from Main Deck
                          </button>
                        )}
                        {getCardQuantity(modalCard.name, modalCard.set, true) > 0 && (
                          <button
                            onClick={() => {
                              onRemoveCard(modalCard.name, modalCard.set, true);
                              setShowMenu(false);
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-red-600 dark:text-red-400"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                            </svg>
                            Remove from Reserve
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {isFundraiser ? (
              <button
                onClick={() => window.open('https://cactus-game-design-inc.square.site/s/shop', '_blank')}
                className="px-4 h-10 border border-border text-muted-foreground hover:text-foreground hover:bg-card rounded-lg flex items-center gap-1.5 font-medium transition-colors text-sm whitespace-nowrap"
              >
                {(() => {
                  const cardKey = `${modalCard.name}|${modalCard.set}|${modalCard.imgFile}`;
                  const priceInfo = getPrice(cardKey);
                  return priceInfo ? <span>${priceInfo.price.toFixed(0)}</span> : null;
                })()}
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
                </svg>
                Fundraiser
              </button>
            ) : (() => {
              const cardKey = `${modalCard.name}|${modalCard.set}|${modalCard.imgFile}`;
              const priceInfo = getPrice(cardKey);
              const productUrl = getProductUrl(cardKey);
              return (
                <button
                  onClick={() => productUrl
                    ? window.open(productUrl, '_blank', 'noopener,noreferrer')
                    : openYTGSearchPage(modalCard.name)
                  }
                  className="px-4 h-10 border border-emerald-600/30 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-lg flex items-center gap-1.5 font-medium transition-colors text-sm whitespace-nowrap active:translate-y-[1px]"
                >
                  <img src="/sponsors/ytg-dark.png" alt="YTG" className="h-[18px] w-[18px] object-contain hidden dark:block" />
                  <img src="/sponsors/ytg-light.png" alt="YTG" className="h-[18px] w-[18px] object-contain dark:hidden" />
                  {priceInfo ? (
                    <>
                      <span className="font-semibold">${priceInfo.price.toFixed(2)}</span>
                      <svg className="w-3.5 h-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </>
                  ) : (
                    <span>Shop</span>
                  )}
                </button>
              );
            })()}
            <button
              onClick={() => closeModal()}
              className="px-4 h-10 border border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg font-medium transition-colors text-sm whitespace-nowrap"
            >
              Close
            </button>
            </div>
            {hasNavigation ? (
              <button
                onClick={() => navigateToCard('right')}
                className="w-10 h-10 shrink-0 text-muted-foreground hover:text-foreground hover:bg-card rounded-lg transition-colors flex items-center justify-center"
                title="Next card (Right arrow)"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
