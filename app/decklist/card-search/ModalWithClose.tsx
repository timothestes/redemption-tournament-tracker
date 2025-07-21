import React from "react";
import { Button } from "flowbite-react";

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

export default function ModalWithClose({ modalCard, setModalCard, CARD_IMAGE_BASE_URL, sanitizeImgFile }) {
  React.useEffect(() => {
    function handleEsc(e) {
      if (e.key === "Escape") {
        setModalCard(null);
      }
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [setModalCard]);

  if (!modalCard) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={() => setModalCard(null)}
    >
      <div
        className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white rounded shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto relative"
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
        <div className="px-4 pt-4 pb-2 border-b font-semibold text-lg text-center truncate">{modalCard.name}</div>
        <div className="px-4 py-2 flex flex-col items-center relative">
          <div className="relative w-full flex justify-center">
            <img
              src={`${CARD_IMAGE_BASE_URL}${sanitizeImgFile(modalCard.imgFile)}.jpg`}
              alt={modalCard.name}
              className="w-full max-w-lg h-auto max-h-[500px] object-contain mx-auto rounded shadow-lg"
            />
          </div>
          <div className="mt-4 space-y-1 w-full">
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
        <div className="px-4 pb-4 flex justify-center">
          <Button onClick={() => setModalCard(null)}>Close</Button>
        </div>
      </div>
    </div>
  );
}
