import React from "react";
import { Button } from "flowbite-react";

function Attribute({ label, value }: { label: string; value: string }) {
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
  return <p className="text-sm"><strong>{label}:</strong> {displayValue}</p>;
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
        className="bg-white dark:bg-gray-900 rounded shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto relative"
        onClick={e => e.stopPropagation()}
      >
        {/* X close button */}
        <button
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-700 dark:hover:text-white text-2xl font-bold focus:outline-none z-10"
          aria-label="Close modal"
          onClick={() => setModalCard(null)}
        >
          ×
        </button>
        <div className="px-4 pt-4 pb-2 border-b font-semibold text-lg text-center truncate">{modalCard.name}</div>
        <div className="px-4 py-2 flex flex-col items-center relative">
          <div className="relative w-full flex justify-center">
            <img
              src={`${CARD_IMAGE_BASE_URL}${sanitizeImgFile(modalCard.imgFile)}.jpg`}
              alt={modalCard.name}
              className="w-full max-w-lg h-auto max-h-[500px] object-contain mx-auto rounded shadow-lg"
            />
            {/* Copy icon */}
            <button
              className="absolute top-2 right-2 bg-transparent p-1 rounded hover:bg-gray-200/50"
              style={{ zIndex: 20 }}
              title="Copy image to clipboard"
              onClick={async () => {
                try {
                  const imgUrl = `${CARD_IMAGE_BASE_URL}${sanitizeImgFile(modalCard.imgFile)}.jpg`;
                  const response = await fetch(imgUrl);
                  const blob = await response.blob();
                  await navigator.clipboard.write([
                    new window.ClipboardItem({ [blob.type]: blob })
                  ]);
                  alert("Image copied to clipboard!");
                } catch (err) {
                  alert("Failed to copy image.");
                }
              }}
            >
              {/* SVG copy icon, transparent */}
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 opacity-70 hover:opacity-100">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <rect x="3" y="3" width="13" height="13" rx="2" ry="2"></rect>
              </svg>
            </button>
          </div>
          <div className="mt-4 space-y-1 w-full">
            {Object.entries(modalCard)
              .filter(([key]) => key !== "dataLine" && key !== "imgFile")
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
