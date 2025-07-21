"use client";
import React, { useEffect, useState, useMemo } from "react";
import { useTheme } from "next-themes";
import { CARD_DATA_URL, CARD_IMAGE_BASE_URL, OT_BOOKS, NT_BOOKS, GOSPEL_BOOKS } from "./constants";
import { Modal, Button } from "flowbite-react";
import clsx from "clsx";

// Card data structure
interface Card {
  dataLine: string;
  name: string;
  set: string;
  imgFile: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  class: string;
  identifier: string;
  specialAbility: string;
  rarity: string;
  reference: string;
  alignment: string;
  legality: string;
  testament: string;
}

export default function CardSearchClient() {
  const [cards, setCards] = useState<Card[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIconFilters, setSelectedIconFilters] = useState<string[]>([]);
  // Card legality filter mode: Rotation, Classic (all), Banned, Scrolls (not Rotation or Banned)
  const [legalityMode, setLegalityMode] = useState<'Rotation'|'Classic'|'Banned'|'Scrolls'>('Rotation');
  const [visibleCount, setVisibleCount] = useState(50); // Number of cards to show

  const [modalCard, setModalCard] = useState<Card | null>(null);
  // Alignment filters: Good, Evil, Neutral (multiple selection)
  const [selectedAlignmentFilters, setSelectedAlignmentFilters] = useState<string[]>([]);
  // sanitize imgFile to avoid duplicate extensions
  const sanitizeImgFile = (f: string) => f.replace(/\.jpe?g$/i, "");
  // theme for dark/light Lost Soul icon
  const { theme, systemTheme } = useTheme();
  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  // Define how each icon filter should be applied
  const iconPredicates: Record<string, (c: Card) => boolean> = {
    Artifact: (c) => c.type === "Artifact",
    "Good Dominant": (c) => c.type === "Dominant" && c.alignment.includes("Good"),
    "Evil Dominant": (c) => c.type === "Dominant" && c.alignment.includes("Evil"),
    "Good Fortress": (c) => c.type === "Fortress" && c.alignment.includes("Good"),
    "Evil Fortress": (c) => c.type === "Fortress" && c.alignment.includes("Evil"),
    // other icons use existing category filters
    GE: (c) => c.type.includes("GE"),
    "Evil Character": (c) => c.type === "Evil Character",
    Hero: (c) => c.type === "Hero",
    Site: (c) => c.type === "Site",
    EE: (c) => c.type.includes("EE"),
    "Territory-Class": (c) => c.class === "Territory",
    "Warrior-Class": (c) => c.class === "Warrior",
    "Weapon-Class": (c) => c.class === "Weapon",
    // Enhancements by alignment
    "Good Enhancement": (c) => c.type === "Enhancement" && c.alignment.includes("Good"),
    "Evil Enhancement": (c) => c.type === "Enhancement" && c.alignment.includes("Evil"),
    "Lost Soul": (c) => c.type === "Lost Soul",
    "City": (c) => c.type === "City",
  };

  // Adjust parsing to skip header row
  useEffect(() => {
    fetch(CARD_DATA_URL)
      .then((res) => res.text())
      .then((text) => {
        const lines = text.split("\n");
        const dataLines = lines.slice(1).filter((l) => l.trim());
        const parsed = dataLines.map((line) => {
          const cols = line.split("\t");
          return {
            dataLine: line,
            name: cols[0] || "",
            set: cols[1] || "",
            imgFile: cols[2] || "",
            type: cols[4] || "",
            brigade: cols[5] || "",
            strength: cols[6] || "",
            toughness: cols[7] || "",
            class: cols[8] || "",
            identifier: cols[9] || "",
            specialAbility: cols[10] || "",
            rarity: cols[11] || "",
            reference: cols[12] || "",
            alignment: cols[14] || "",
            legality: cols[15] || "",
            testament: "",
          } as Card;
        });
        setCards(parsed);
      })
      .catch(console.error);
  }, []);

  const brigades = useMemo(() => Array.from(new Set(cards.map((c) => c.brigade))).filter(Boolean), [cards]);
  const types = useMemo(() => Array.from(new Set(cards.map((c) => c.type))).filter(Boolean), [cards]);
  const rarities = useMemo(() => Array.from(new Set(cards.map((c) => c.rarity))).filter(Boolean), [cards]);

  // Quick icon filters for type-based icons (reordered) and color-coded brigades
  const typeIcons = [
    "Good Dominant",
    "Evil Dominant",
    "Artifact",
    "Site",
    "Good Fortress",
    "Evil Fortress",
    "Hero",
    "Evil Character",
    "GE",
    "EE",
    "Lost Soul"
  ];
  const colorIcons = [
    "Black",
    "Blue",
    "Brown",
    "Clay",
    "Crimson",
    "Gold",
    "Gray",
    "Green",
    "Orange",
    "Pale Green",
    "Purple",
    "Silver",
    "White",
    "Red",
    "Teal",
  ];
  // Grouped color icons by brigade alignment
  const goodBrigadeIcons = ["Blue","Clay","Gold","Green","Purple","Silver","White","Red","Teal"];
  const evilBrigadeIcons = ["Black","Brown","Crimson","Gold","Gray","Orange","Pale Green"];

  const filtered = useMemo(
    () =>
      cards
        .filter((c) => Object.values(c).join(" ").toLowerCase().includes(query.toLowerCase()))
        // Legality mode filter
        .filter((c) => {
          if (legalityMode === 'Classic') return true;
          if (legalityMode === 'Scrolls') return c.legality !== 'Rotation' && c.legality !== 'Banned';
          return c.legality === legalityMode;
        })
        // Alignment filters (OR across selected filters)
        .filter((c) => {
          if (selectedAlignmentFilters.length === 0) return true;
          return selectedAlignmentFilters.some((mode) => {
            if (mode === 'Neutral') {
              return !c.alignment.includes('Good') && !c.alignment.includes('Evil');
            }
            return c.alignment.includes(mode);
          });
        })
        .filter((c) => {
          // icon filters (AND mode)
          if (selectedIconFilters.length === 0) return true;
          return selectedIconFilters.every((icon) => {
            const pred = iconPredicates[icon];
            if (pred) return pred(c);
            return c.brigade.toLowerCase().includes(icon.toLowerCase());
          });
        }),
    [cards, query, selectedIconFilters, legalityMode, selectedAlignmentFilters]
  );

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [query, selectedIconFilters, legalityMode, selectedAlignmentFilters]);

  const visibleCards = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Infinite scroll effect
  useEffect(() => {
    const handleScroll = () => {
      // Add a buffer to trigger loading before reaching the absolute bottom
      if (
        window.innerHeight + document.documentElement.scrollTop <
        document.documentElement.offsetHeight - 100
      ) {
        return;
      }
      if (filtered.length > visibleCount) {
        setVisibleCount((prevCount) => prevCount + 50); // Load 50 more cards
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [filtered.length, visibleCount]);

  // Toggler for icon filters
  function toggleIconFilter(value: string) {
    setSelectedIconFilters((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      console.log(`Icon filter toggled: ${value}, selectedIconFilters=`, next);
      return next;
    });
  }
  // Toggler for alignment filters
  function toggleAlignmentFilter(value: string) {
    setSelectedAlignmentFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  return (
    <div>
      <div className="p-4 border-b">
        <input
          type="text"
          placeholder="Search cards..."
          className="w-full mb-4 p-2 border rounded"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <main className="p-4 overflow-auto">
        <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Legality</p>
        {/* Legality mode toggles */}
        <div className="flex gap-2 mb-4">
          {['Rotation','Classic','Banned','Scrolls'].map((mode) => (
            <button
              key={mode}
              className={clsx(
                'px-3 py-1 border rounded text-sm',
                legalityMode === mode
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700'
              )}
              onClick={() => setLegalityMode(mode as typeof legalityMode)}
            >
              {mode}
            </button>
          ))}
        </div>
        {/* Alignment filters */}
        <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Alignment</p>
        <div className="flex gap-2 mb-4">
          {['Good','Evil','Neutral'].map((mode) => (
            <button
              key={mode}
              className={clsx(
                'px-3 py-1 border rounded text-sm',
                selectedAlignmentFilters.includes(mode)
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700'
              )}
              onClick={() => toggleAlignmentFilter(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        {/* Quick icon filters with AND/OR toggle */}
        <div className="mb-4">
          <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Types</p>
          <div className="flex flex-wrap gap-2">
            {typeIcons.map((t) => {
              // use static Lost Soul icon
              const src =
                t === 'Lost Soul'
                  ? '/filter-icons/Lost%20Soul.png'
                  : t === 'Hero'
                  ? '/filter-icons/hero.png'
                  : `/filter-icons/${encodeURIComponent(t)}.png`;
              return (
                <img
                  key={t}
                  src={src}
                  alt={t}
                  className={clsx(
                    'h-8 w-auto cursor-pointer',
                    selectedIconFilters.includes(t) && 'ring-2 ring-blue-500'
                  )}
                  onClick={() => toggleIconFilter(t)}
                />
              );
            })}
          </div>
          {/* Good Brigades */}
          <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Good Brigades</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {goodBrigadeIcons.map((icon) => (
              <img
                key={icon}
                src={`/filter-icons/Color=${encodeURIComponent(icon)}.png`}
                alt={icon}
                className={clsx(
                  "h-8 w-auto cursor-pointer",
                  selectedIconFilters.includes(icon) && "ring-2 ring-blue-500"
                )}
                onClick={() => toggleIconFilter(icon)}
              />
            ))}
          </div>
          {/* Evil Brigades */}
          <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Evil Brigades</p>
          <div className="flex flex-wrap gap-2">
            {evilBrigadeIcons.map((icon) => (
              <img
                key={icon}
                src={`/filter-icons/Color=${encodeURIComponent(icon)}.png`}
                alt={icon}
                className={clsx(
                  "h-8 w-auto cursor-pointer",
                  selectedIconFilters.includes(icon) && "ring-2 ring-blue-500"
                )}
                onClick={() => toggleIconFilter(icon)}
              />
            ))}
          </div>  
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {visibleCards.map((c) => (
            <div key={c.dataLine} className="cursor-pointer" onClick={() => setModalCard(c)}>
              <img src={`${CARD_IMAGE_BASE_URL}${sanitizeImgFile(c.imgFile)}.jpg`} alt={c.name} className="w-full h-auto rounded shadow" />
              <p className="text-sm mt-1 text-center truncate">{c.name}</p>
            </div>
          ))}
        </div>
      </main>
      {/* Popup modal that closes on outside click, with responsive image */}
      {modalCard && (
        <Modal show={!!modalCard} popup onClose={() => setModalCard(null)}>
          <Modal.Header>{modalCard.name}</Modal.Header>
          <Modal.Body>
            <img
              src={`${CARD_IMAGE_BASE_URL}${sanitizeImgFile(modalCard.imgFile)}.jpg`}
              alt={modalCard.name}
              className="w-full h-auto max-h-[90vh] object-contain"
            />
            <Attribute label="Type" value={modalCard.type} />
            <Attribute label="Brigade" value={modalCard.brigade} />
            <Attribute label="Rarity" value={modalCard.rarity} />
            <Attribute label="Ability" value={modalCard.specialAbility} />
          </Modal.Body>
          <Modal.Footer>
            <Button onClick={() => setModalCard(null)}>Close</Button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}

// Helper sub-components
function Attribute({ label, value }: { label: string; value: string }) {
  return <p className="text-sm"><strong>{label}:</strong> {value}</p>;
}
