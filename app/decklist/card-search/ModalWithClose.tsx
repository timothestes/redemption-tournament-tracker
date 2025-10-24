import React from "react";
import { Button } from "flowbite-react";
import { openYTGSearchPage } from "./ytgUtils";
import { useCardImageUrl } from "./hooks/useCardImageUrl";

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
  return <p className="text-sm text-gray-900 dark:text-white"><strong>{label}:</strong> {displayValue}</p>;
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
  const [showMenu, setShowMenu] = React.useState(false);
  
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
          setModalCard(null);
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
        // Only handle up/down if we have deck management functions
        if (!onAddCard || !onRemoveCard) return;
        
        if (e.key === "ArrowUp") {
          // Up arrow adds to the active tab (main or reserve)
          const isReserve = activeDeckTab === "reserve";
          onAddCard(modalCard, isReserve);
        } else {
          // Down arrow removes from the active tab
          const isReserve = activeDeckTab === "reserve";
          onRemoveCard(modalCard.name, modalCard.set, isReserve);
        }
      }
    }
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setModalCard, modalCard, visibleCards, showMenu, onAddCard, onRemoveCard, activeDeckTab]);

  if (!modalCard) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={() => setModalCard(null)}
    >
      <div
        className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white rounded shadow-lg max-w-2xl w-full max-h-[90vh] overflow-hidden relative flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* X close button */}
        <button
          className="absolute top-2 right-2 flex items-center justify-center bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 shadow-lg rounded-full w-14 h-14 border-4 border-white dark:border-gray-900 focus:outline-none z-20 transition-all duration-150"
          aria-label="Close modal"
          onClick={() => setModalCard(null)}
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="16" fill="none" />
            <line x1="10" y1="10" x2="22" y2="22" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="22" y1="10" x2="10" y2="22" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
          </svg>
        </button>
        <div className="px-4 pt-4 pb-2 border-b font-semibold text-lg text-center truncate">
          <div className="truncate">{modalCard.name}</div>
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
        <div className="px-4 pb-4 pt-2 border-t bg-gray-50 dark:bg-gray-800">
          {visibleCards && visibleCards.length > 1 && (
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center mb-2">
              Use ← → to navigate{onAddCard && onRemoveCard && ' • ↑ to add • ↓ to remove'} • {visibleCards.findIndex(card => card.dataLine === modalCard.dataLine) + 1} of {visibleCards.length}
            </div>
          )}
          <div className="flex justify-center gap-2 items-center">
            {visibleCards && visibleCards.length > 1 && (
              <button
                onClick={() => {
                  const currentIndex = visibleCards.findIndex(card => card.dataLine === modalCard.dataLine);
                  const prevIndex = currentIndex === 0 ? visibleCards.length - 1 : currentIndex - 1;
                  setModalCard(visibleCards[prevIndex]);
                }}
                className="px-3 h-10 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors flex items-center"
                title="Previous card (Left arrow)"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            {onAddCard && onRemoveCard && getCardQuantity && (
              <div className="relative hidden md:block">
                <div className="flex gap-0 h-10">
                  {/* Main add button - adds to active tab */}
                  <button
                    onClick={() => {
                      const isReserve = activeDeckTab === "reserve";
                      onAddCard(modalCard, isReserve);
                    }}
                    className="px-4 h-10 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-l-lg flex items-center gap-1.5 font-medium transition-colors text-sm whitespace-nowrap"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add to {activeDeckTab === "reserve" ? "Reserve" : activeDeckTab === "main" ? "Main" : "Deck"}
                    {(() => {
                      const isReserve = activeDeckTab === "reserve";
                      const quantity = getCardQuantity(modalCard.name, modalCard.set, isReserve);
                      return quantity > 0 && (
                        <span className="bg-black/75 backdrop-blur-sm text-white px-2.5 py-1 rounded-md font-bold text-sm shadow-lg">
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
                    className="px-2.5 h-10 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-r-lg border-l border-gray-300 dark:border-gray-600 transition-colors"
                  >
                    <svg className={`w-4 h-4 transition-transform ${showMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {showMenu && (
                  <div className="absolute bottom-full mb-2 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[200px] z-50">
                    <button
                      onClick={() => {
                        onAddCard(modalCard, false);
                        setShowMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white"
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
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-900 dark:text-white"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add to Reserve
                    </button>
                    {(getCardQuantity(modalCard.name, modalCard.set, false) > 0 || getCardQuantity(modalCard.name, modalCard.set, true) > 0) && (
                      <>
                        <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                        {getCardQuantity(modalCard.name, modalCard.set, false) > 0 && (
                          <button
                            onClick={() => {
                              onRemoveCard(modalCard.name, modalCard.set, false);
                              setShowMenu(false);
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-red-600 dark:text-red-400"
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
                            className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-red-600 dark:text-red-400"
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
            {(() => {
              // Check if card is a fundraiser card
              const isFundraiser = modalCard.set === "Fund" || modalCard.officialSet === "Fundraiser";
              
              if (isFundraiser) {
                return (
                  <Button 
                    onClick={() => window.open('https://cactus-game-design-inc.square.site/s/shop', '_blank')}
                    className="px-4 h-10 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg flex items-center gap-1.5 font-semibold transition-colors text-sm whitespace-nowrap"
                    size="sm"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
                    </svg>
                    Shop Fundraiser
                  </Button>
                );
              }
              
              return (
                <Button 
                  onClick={() => openYTGSearchPage(modalCard.name)}
                  className="px-4 h-10 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg flex items-center gap-1.5 font-semibold transition-colors text-sm whitespace-nowrap"
                  size="sm"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                  </svg>
                  Search YTG
                </Button>
              );
            })()}
            <Button 
              onClick={() => setModalCard(null)} 
              className="px-4 h-10 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900 dark:hover:text-red-300 rounded-lg font-medium transition-colors text-sm whitespace-nowrap"
              size="sm"
            >
              Close
            </Button>
            {visibleCards && visibleCards.length > 1 && (
              <button
                onClick={() => {
                  const currentIndex = visibleCards.findIndex(card => card.dataLine === modalCard.dataLine);
                  const nextIndex = currentIndex === visibleCards.length - 1 ? 0 : currentIndex + 1;
                  setModalCard(visibleCards[nextIndex]);
                }}
                className="px-3 h-10 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors flex items-center"
                title="Next card (Right arrow)"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
