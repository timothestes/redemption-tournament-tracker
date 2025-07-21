"use client";
import React, { useEffect, useState, useMemo } from "react";
import { useTheme } from "next-themes";
import { CARD_DATA_URL, CARD_IMAGE_BASE_URL, OT_BOOKS, NT_BOOKS, GOSPEL_BOOKS, GOOD_BRIGADES, EVIL_BRIGADES } from "./constants";
import { Modal, Button } from "flowbite-react";
import clsx from "clsx";

// Card data structure
interface Card {
  dataLine: string;
  name: string;
  set: string;
  imgFile: string;
  officialSet: string;
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
  // Advanced filters
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedTestaments, setSelectedTestaments] = useState<string[]>([]);
  const [noAltArt, setnoAltArt] = useState(true);
  const [noFirstPrint, setnoFirstPrint] = useState(true);
  const [nativityOnly, setNativityOnly] = useState(false);
  const [hasStarOnly, setHasStarOnly] = useState(false);
  const [cloudOnly, setCloudOnly] = useState(false);

  // sanitize imgFile to avoid duplicate extensions
  const sanitizeImgFile = (f: string) => f.replace(/\.jpe?g$/i, "");
  // Nativity filter helper
  const isNativityReference = (ref: string): boolean => {
    const r = ref.trim();
    try {
      if (r.startsWith("Matthew 1:")) {
        const versePart = r.split("Matthew 1:")[1];
        if (versePart.includes("-")) {
          const [start, end] = versePart.split("-").map(v => parseInt(v, 10));
          return start >= 18 && end <= 25;
        }
        const verse = parseInt(versePart, 10);
        return verse >= 18 && verse <= 25;
      }
      if (r.startsWith("Luke 1:") || r.startsWith("Luke 2:")) {
        const chapter = parseInt(r.split(" ")[1].split(":")[0], 10);
        return chapter === 1 || chapter === 2;
      }
      // Include Matthew chapter 2 verses
      if (r.startsWith("Matthew 2:")) {
        return true;
      }
      // Handle full chapter references
      return r === "Matthew 2" || r === "Luke 1" || r === "Luke 2";
    } catch {
      return false;
    }
  };

  // Define how each icon filter should be applied
  const iconPredicates: Record<string, (c: Card) => boolean> = {
    Artifact: (c) => c.type === "Artifact",
    "Good Dominant": (c) => c.type.includes("Dominant") && c.alignment.includes("Good"),
    "Evil Dominant": (c) => c.type.includes("Dominant") && c.alignment.includes("Evil"),
    "Good Fortress": (c) => c.type.includes("Fortress") && c.alignment.includes("Good"),
    "Evil Fortress": (c) => c.type.includes("Fortress") && c.alignment.includes("Evil"),
    // other icons use existing category filters
    GE: (c) => c.type.includes("GE"),
    "Evil Character": (c) => c.type.includes("Evil Character"),
    Hero: (c) => c.type.includes("Hero"),
    Site: (c) => c.type === "Site",
    EE: (c) => c.type.includes("EE"),
    "Territory-Class": (c) => c.class.includes("Territory"),
    "Warrior-Class": (c) => c.class.includes("Warrior"),
    "Weapon-Class": (c) => c.class.includes("Weapon"),
    // Enhancements by alignment
    "Good Enhancement": (c) => c.type === "Enhancement" && c.alignment.includes("Good"),
    "Evil Enhancement": (c) => c.type === "Enhancement" && c.alignment.includes("Evil"),
    "Lost Soul": (c) => c.type.includes("Lost Soul"),
    "City": (c) => c.type.includes("City"),
    "Good Multi": (c) => {
      const brigades = c.brigade.split("/");
      return GOOD_BRIGADES.every(b => brigades.includes(b));
    },
    "Evil Multi": (c) => {
      const brigades = c.brigade.split("/");
      return EVIL_BRIGADES.every(b => brigades.includes(b));
    },
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
          // Determine testament from reference text
          const reference = cols[12] || "";
          const refLower = reference.toLowerCase();
          let testament = "";
          if (GOSPEL_BOOKS.some((b) => refLower.startsWith(b))) {
            testament = "Gospel";
          } else if (NT_BOOKS.some((b) => refLower.startsWith(b))) {
            testament = "NT";
          } else if (OT_BOOKS.some((b) => refLower.startsWith(b))) {
            testament = "OT";
          }
          // Normalize brigade field
          const rawBrigade = cols[5] || "";
          const alignment = cols[14] || "";
          const cardName = cols[0] || "";
          let normalizedBrigades = [];
          try {
            normalizedBrigades = normalizeBrigadeField(rawBrigade, alignment, cardName);
          } catch (e) {
            // fallback to raw brigade if normalization fails
            normalizedBrigades = rawBrigade ? [rawBrigade] : [];
          }
          const brigade = normalizedBrigades.join("/");
          return {
            dataLine: line,
            name: cols[0] || "",
            set: cols[1] || "",
            imgFile: cols[2] || "",
            officialSet: cols[3] || "",
            type: cols[4] || "",
            brigade,
            strength: cols[6] || "",
            toughness: cols[7] || "",
            class: cols[8] || "",
            identifier: cols[9] || "",
            specialAbility: cols[10] || "",
            rarity: cols[11] || "",
            reference,
            alignment: cols[14] || "",
            legality: cols[15] || "",
            testament,
          } as Card;
        });
        setCards(parsed);
      })
      .catch(console.error);
  }, []);

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
    "Lost Soul",
    "Territory-Class",
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
  const goodBrigadeIcons = [
    "Blue",
    "Clay",
    "Good Gold",
    "Green",
    "Purple",
    "Silver",
    "White",
    "Red",
    "Teal",
    "Good Multi"
  ];
  const evilBrigadeIcons = [
    "Black",
    "Brown",
    "Crimson",
    "Evil Gold",
    "Gray",
    "Orange",
    "Pale Green",
    "Evil Multi"
  ];

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
            // match any part of the brigade string
            return c.brigade.toLowerCase().includes(icon.toLowerCase());
          });
        })
        // Testament filters
        .filter((c) => {
          if (selectedTestaments.length === 0) return true;
          return selectedTestaments.includes(c.testament);
        })
        // Misc filters (hide AB Versions, hide 1st Print K/L Starters)
        .filter((c) => !noAltArt || !c.set.includes("AB"))
        .filter((c) => !noFirstPrint || (
          !c.set.includes("K1P") && !c.set.includes("L1P")
        ))
        .filter((c) => !nativityOnly || isNativityReference(c.reference))
                   .filter((c) => !cloudOnly || c.class.toLowerCase().includes("cloud"))
        .filter((c) => !hasStarOnly || c.specialAbility.includes("STAR:") || c.specialAbility.includes("(Star)")),
    [cards, query, selectedIconFilters, legalityMode, selectedAlignmentFilters, selectedTestaments, noAltArt, noFirstPrint, nativityOnly, hasStarOnly, cloudOnly]
  );

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [query, selectedIconFilters, legalityMode, selectedAlignmentFilters, selectedTestaments, noAltArt, noFirstPrint, nativityOnly, hasStarOnly]);

  // Central logging of all active filters
  useEffect(() => {
    console.log('Active filters:', {
      query,
      legalityMode,
      alignment: selectedAlignmentFilters,
      icons: selectedIconFilters,
      testaments: selectedTestaments,
      altArt: noAltArt,
      firstPrint: noFirstPrint,
      nativity: nativityOnly,
      star: hasStarOnly,
      cloud: cloudOnly,
    });
  }, [query, legalityMode, selectedAlignmentFilters, selectedIconFilters, selectedTestaments, noAltArt, noFirstPrint, nativityOnly, hasStarOnly]);

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
      return next;
    });
  }
  // Toggler for alignment filters
  function toggleAlignmentFilter(value: string) {
    setSelectedAlignmentFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  // Brigade normalization helpers
  function handleSimpleBrigades(brigade) {
    if (!brigade) return [];
    if (brigade.includes("and")) {
      return brigade.split("and")[0].trim().split("/");
    }
    if (brigade.includes("(")) {
      const [mainBrigade, subBrigades] = brigade.split(" (");
      return mainBrigade.trim().split("/").concat(subBrigades.replace(")", "").split("/"));
    }
    if (brigade.includes("/")) {
      return brigade.split("/");
    }
    return [brigade];
  }

  function replaceBrigades(brigades, target, replacement) {
    return brigades.map(b => b === target ? replacement : b);
  }

  function replaceMultiBrigades(brigadesList) {
    let result = [...brigadesList];
    if (result.includes("Good Multi")) {
      result = result.filter(b => b !== "Good Multi");
      result = result.concat(GOOD_BRIGADES);
    }
    if (result.includes("Evil Multi")) {
      result = result.filter(b => b !== "Evil Multi");
      result = result.concat(EVIL_BRIGADES);
    }
    return result;
  }

  function handleGoldBrigade(cardName, alignment, brigadesList) {
    const goldReplacement = {
      "Good": "Good Gold",
      "Evil": "Evil Gold",
      "Neutral": (
        brigadesList[0] === "Gold" || ["First Bowl of Wrath (RoJ)", "Banks of the Nile/Pharaoh's Court"].includes(cardName)
          ? "Good Gold"
          : "Evil Gold"
      ),
      undefined: "Good Gold",
      null: "Good Gold",
    };
    return replaceBrigades(brigadesList, "Gold", goldReplacement[alignment]);
  }

  function normalizeBrigadeField(brigade, alignment, cardName) {
    if (!brigade) return [];
    let brigadesList = handleSimpleBrigades(brigade);
    const multiCount = brigadesList.filter(b => b === "Multi").length;
    if (multiCount > 0) {
      // If two 'Multi', expand to both Good Multi and Evil Multi
      if (multiCount === 2) {
        brigadesList = brigadesList.filter(b => b !== "Multi");
        brigadesList.push("Good Multi", "Evil Multi");
      } else {
        const multiReplacements = {
          "Good": "Good Multi",
          "Evil": "Evil Multi",
          "Neutral": "Good Multi",
        };
        brigadesList = replaceBrigades(
          brigadesList,
          "Multi",
          multiReplacements[cardName] || multiReplacements[alignment]
        );
      }
    }
    if (brigadesList.includes("Gold")) {
      brigadesList = handleGoldBrigade(cardName, alignment, brigadesList);
    }
    brigadesList = replaceMultiBrigades(brigadesList);
    const allowedBrigades = new Set([...GOOD_BRIGADES, ...EVIL_BRIGADES]);
    for (const brigade of brigadesList) {
      if (!allowedBrigades.has(brigade)) {
        throw new Error(`Card ${cardName} has an invalid brigade: ${brigade}.`);
      }
    }
    return brigadesList.sort();
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
        {/* Advanced Filters */}
        <div className="mb-4">
          <button
            className="px-2 py-1 border rounded text-sm mb-2"
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            Advanced Filters {advancedOpen ? '▲' : '▼'}
          </button>
          {advancedOpen && (
            <div className="p-2 border rounded space-y-2">
              <p className="font-semibold">Testament</p>
              <div className="flex gap-2">
                {['OT','NT','Gospel'].map((t) => (
                  <button
                    key={t}
                    className={clsx('px-2 py-1 border rounded text-sm', selectedTestaments.includes(t) ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700')}
                    onClick={() => setSelectedTestaments(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev,t])}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="font-semibold pt-2">Misc</p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={clsx(
                    'px-2 py-1 border rounded text-sm',
                    noAltArt ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700'
                  )}
                  onClick={() => setnoAltArt(v => !v)}
                >
                  No AB Versions
                </button>
                <button
                  className={clsx(
                    'px-2 py-1 border rounded text-sm',
                    noFirstPrint ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700'
                  )}
                  onClick={() => setnoFirstPrint(v => !v)}
                >
                  No 1st Print K/L Starters
                </button>
                <button
                  className={clsx(
                    'px-2 py-1 border rounded text-sm',
                    nativityOnly ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700'
                  )}
                  onClick={() => setNativityOnly(v => !v)}
                >
                  Nativity
                </button>
                <button
                  className={clsx(
                    'px-2 py-1 border rounded text-sm',
                    hasStarOnly ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700'
                  )}
                  onClick={() => setHasStarOnly(v => !v)}
                >
                  Has Star
                </button>
                <button
                  className={clsx(
                    'px-2 py-1 border rounded text-sm',
                    cloudOnly ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700'
                  )}
                  onClick={() => setCloudOnly(v => !v)}
                >
                  Cloud
                </button>
              </div>
            </div>
          )}
        </div>
        {/* Quick icon filters */}
        <div className="mb-4">
          <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Types</p>
          <div className="flex flex-wrap gap-2">
            {typeIcons.map((t) => {
              const src = `/filter-icons/${encodeURIComponent(t)}.png`;
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
      {/* Smaller modal with overlay click to close */}
      {modalCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={() => setModalCard(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded shadow-lg max-w-md w-full max-h-[80vh] overflow-auto relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-2 border-b font-semibold text-lg text-center truncate">{modalCard.name}</div>
            <div className="px-4 py-2">
              <img
                src={`${CARD_IMAGE_BASE_URL}${sanitizeImgFile(modalCard.imgFile)}.jpg`}
                alt={modalCard.name}
                className="w-full h-auto max-h-60 object-contain mx-auto rounded"
              />
              <div className="mt-4 space-y-1">
                {Object.entries(modalCard)
                  .filter(([key]) => key !== "dataLine" && key !== "imgFile")
                  .map(([key, value]) => (
                    <Attribute key={key} label={prettifyFieldName(key)} value={value} />
                  ))}
              </div>
            </div>
            <div className="px-4 pb-4 flex justify-center">
              <Button onClick={() => setModalCard(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper sub-components
function Attribute({ label, value }: { label: string; value: string }) {
  return <p className="text-sm"><strong>{label}:</strong> {value}</p>;
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
