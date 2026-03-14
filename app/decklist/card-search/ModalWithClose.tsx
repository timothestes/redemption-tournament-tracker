import React from "react";

import { openYTGSearchPage } from "./ytgUtils";
import { useCardImageUrl } from "./hooks/useCardImageUrl";
import { useCardPrices } from "./hooks/useCardPrices";

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
  const [showMenu, setShowMenu] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(false);
  const [isClosing, setIsClosing] = React.useState(false);

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
          className="flex-1 overflow-hidden relative bg-black/5 dark:bg-black/20 touch-pan-y pb-12"
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
        className={`hidden md:flex bg-card text-foreground rounded shadow-lg max-w-2xl w-full max-h-[90vh] overflow-hidden relative flex-col transition-all duration-200 ${isVisible && !isClosing ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
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
        <div className="px-4 py-2 flex flex-col items-center relative flex-1 overflow-hidden">
          <div className="relative w-full flex justify-center mb-4">
            <img
              src={getImageUrl(modalCard.imgFile)}
              alt={modalCard.name}
              className="w-full max-w-md h-auto max-h-[60vh] object-contain mx-auto rounded shadow-lg"
            />
          </div>
          <div className="w-full flex-1 overflow-auto px-2">
            <div className="space-y-1">
              {Object.entries(modalCard)
                .filter(([key, value]) => {
                  // Only render 'Is Gospel' if isGospel is true
                  if (key === 'isGospel') return modalCard.isGospel === true;
                  // Always render other fields except dataLine and imgFile
                  return key !== "dataLine" && key !== "imgFile";
              })
              .map(([key, value]) => (
                <Attribute key={key} label={prettifyFieldName(key)} value={value as string} />
              ))}
            </div>
          </div>
        </div>
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
