"use client";
import React, { useEffect, useState, useMemo } from "react";
import ModalWithClose from "./ModalWithClose";
import { CARD_DATA_URL, CARD_IMAGE_BASE_URL, OT_BOOKS, NT_BOOKS, GOSPEL_BOOKS, GOOD_BRIGADES, EVIL_BRIGADES } from "./constants";
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
  isGospel: boolean;
}

export default function CardSearchClient() {
  // Search field dropdown state
  const [searchField, setSearchField] = useState<string>('everything');

  // Icon filter mode: AND or OR
  const [iconFilterMode, setIconFilterMode] = useState<'AND'|'OR'>('AND');
  // Strength and toughness filter state
  const [strengthFilter, setStrengthFilter] = useState<number | null>(null);
  const [strengthOp, setStrengthOp] = useState<string>('eq');
  const [toughnessFilter, setToughnessFilter] = useState<number | null>(null);
  const [toughnessOp, setToughnessOp] = useState<string>('eq');
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
  const [isGospel, setIsGospel] = useState(false);
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
    Covenant: (c) => c.type === "Covenant",
    Curse: (c) => c.type === "Curse",
    "Good Dominant": (c) => c.type.includes("Dominant") && (c.alignment.includes("Good") || c.alignment.includes("Neutral")),
    "Evil Dominant": (c) => c.type.includes("Dominant") && (c.alignment.includes("Evil") || c.alignment.includes("Neutral")),
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
          // Enhanced testament and gospel tagging logic
          const reference = cols[12] || "";
          let references: string[] = [];
          for (let refGroup of reference.split(";")) {
            refGroup = refGroup.trim();
            if (refGroup.includes("(") && refGroup.includes(")")) {
              // Extract main reference
              const mainRef = refGroup.split("(")[0].trim();
              if (mainRef) references.push(mainRef);
              // Extract parenthetical references
              const parenContent = refGroup.substring(refGroup.indexOf("(") + 1, refGroup.indexOf(")"));
              const parenRefs = parenContent.split(",").map(pr => pr.trim()).filter(Boolean);
              references.push(...parenRefs);
            } else {
              if (refGroup) references.push(refGroup);
            }
          }
          // Lowercase all references for matching
          const referencesLower = references.map(r => r.toLowerCase());
          // Helper to normalize book names with numbers (e.g., II Samuel -> Samuel)
          function normalizeBookName(ref) {
            // Remove leading roman numerals or numbers (I, II, 1, 2, 3, 4, one, two, three, four)\s+/i, '')
            return ref.replace(/^(i{1,3}|1|2|3|4|one|two|three|four)\s+/i, '').trim();
          }
          // Tagging strategy: collect all matching testaments
          const foundTestaments = new Set<string>();
          for (const ref of referencesLower) {
            // Try both original and normalized book name
            const book = ref.split(' ')[0];
            const normalizedBook = normalizeBookName(ref).split(' ')[0];
            if (NT_BOOKS.some(b => book === b.toLowerCase() || normalizedBook === b.toLowerCase())) foundTestaments.add('NT');
            if (OT_BOOKS.some(b => book === b.toLowerCase() || normalizedBook === b.toLowerCase())) foundTestaments.add('OT');
          }
          let testament: string | string[] = '';
          if (foundTestaments.size === 1) {
            testament = Array.from(foundTestaments)[0];
          } else if (foundTestaments.size > 1) {
            testament = Array.from(foundTestaments);
          }
          // IsGospel: true if any reference starts with a Gospel book name
          const gospelBooksLower = GOSPEL_BOOKS.map(b => b.toLowerCase());
          const isGospel = referencesLower.some(ref => gospelBooksLower.some(b => ref.startsWith(b)));
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
            isGospel,
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
    "Covenant",
    "Curse",
    "Good Fortress",
    "Evil Fortress",
    "Hero",
    "Evil Character",
    "GE",
    "EE",
    "Lost Soul",
    "Territory-Class",
    "Site",
    "City",
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
        .filter((c) => {
          const q = query.toLowerCase();
          if (!q) return true;
          switch (searchField) {
            case 'name':
              return c.name.toLowerCase().includes(q);
            case 'specialAbility':
              return c.specialAbility.toLowerCase().includes(q);
            case 'setName':
              return c.officialSet.toLowerCase().includes(q) || c.set.toLowerCase().includes(q);
            case 'identifier':
              return c.identifier.toLowerCase().includes(q);
            case 'reference':
              return c.reference.toLowerCase().includes(q);
            default:
              return Object.values(c).join(" ").toLowerCase().includes(q);
          }
        })
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
          if (selectedIconFilters.length === 0) return true;
          if (iconFilterMode === 'AND') {
            return selectedIconFilters.every((icon) => {
              const pred = iconPredicates[icon];
              if (pred) return pred(c);
              return c.brigade.toLowerCase().includes(icon.toLowerCase());
            });
          } else {
            return selectedIconFilters.some((icon) => {
              const pred = iconPredicates[icon];
              if (pred) return pred(c);
              return c.brigade.toLowerCase().includes(icon.toLowerCase());
            });
          }
        })
        // Testament filters
        .filter((c) => {
          if (selectedTestaments.length === 0) return true;
          // Helper to check if testament contains NT or OT
          const hasTestament = (testament, test) => {
            if (Array.isArray(testament)) return testament.includes(test);
            if (typeof testament === 'string') return testament === test || testament.includes(test);
            return false;
          };
          // AND logic: require all selected testaments to be present
          const allPresent = selectedTestaments.every(test => hasTestament(c.testament, test) || (test === 'OT' && c.identifier && c.identifier.includes('O.T.')));
          return allPresent;
        })
        // IsGospel filter
        .filter((c) => !isGospel || c.isGospel)
        // Strength filter
        .filter((c) => {
          if (strengthFilter === null) return true;
          const val = parseInt(c.strength, 10);
          if (isNaN(val)) return false;
          switch (strengthOp) {
            case 'lt': return val < strengthFilter;
            case 'lte': return val <= strengthFilter;
            case 'eq': return val === strengthFilter;
            case 'gt': return val > strengthFilter;
            case 'gte': return val >= strengthFilter;
            default: return true;
          }
        })
        // Toughness filter
        .filter((c) => {
          if (toughnessFilter === null) return true;
          const val = parseInt(c.toughness, 10);
          if (isNaN(val)) return false;
          switch (toughnessOp) {
            case 'lt': return val < toughnessFilter;
            case 'lte': return val <= toughnessFilter;
            case 'eq': return val === toughnessFilter;
            case 'gt': return val > toughnessFilter;
            case 'gte': return val >= toughnessFilter;
            default: return true;
          }
        })
        // Misc filters (hide AB Versions, hide 1st Print K/L Starters)
        .filter((c) => !noAltArt || !c.set.includes("AB"))
        .filter((c) => !noFirstPrint || (
          !c.set.includes("K1P") && !c.set.includes("L1P")
        ))
        .filter((c) => !nativityOnly || isNativityReference(c.reference))
        .filter((c) => !cloudOnly || c.class.toLowerCase().includes("cloud"))
        .filter((c) => !hasStarOnly || c.specialAbility.includes("STAR:") || c.specialAbility.includes("(Star)")),
    [cards, query, selectedIconFilters, legalityMode, selectedAlignmentFilters, selectedTestaments, isGospel, noAltArt, noFirstPrint, nativityOnly, hasStarOnly, cloudOnly, strengthFilter, strengthOp, toughnessFilter, toughnessOp, iconFilterMode]
  );

  // Reset visible count when filters change or icon filter mode changes
  useEffect(() => {
    setVisibleCount(50);
  }, [query, selectedIconFilters, legalityMode, selectedAlignmentFilters, selectedTestaments, noAltArt, noFirstPrint, nativityOnly, hasStarOnly, iconFilterMode]);

  // Central logging of all active filters
  useEffect(() => {
    console.log('Active filters:', {
      query,
      legalityMode,
      alignment: selectedAlignmentFilters,
      icons: selectedIconFilters,
      testaments: selectedTestaments,
      isGospel,
      altArt: noAltArt,
      firstPrint: noFirstPrint,
      nativity: nativityOnly,
      star: hasStarOnly,
      cloud: cloudOnly,
    });
  }, [query, legalityMode, selectedAlignmentFilters, selectedIconFilters, selectedTestaments, isGospel, noAltArt, noFirstPrint, nativityOnly, hasStarOnly, cloudOnly]);



  const visibleCards = useMemo(() => {
    return filtered
      .slice(0, visibleCount)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, visibleCount]);

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

  // Reset filters handler
  function handleResetFilters() {
    setQuery("");
    setSelectedIconFilters([]);
    setLegalityMode('Rotation');
    setSelectedAlignmentFilters([]);
    setSelectedTestaments([]);
    setIsGospel(false);
    setnoAltArt(true);
    setnoFirstPrint(true);
    setNativityOnly(false);
    setHasStarOnly(false);
    setCloudOnly(false);
    setStrengthFilter(null);
    setStrengthOp('eq');
    setToughnessFilter(null);
    setToughnessOp('eq');
  }


  // ...existing code...
  return (
    <div className="bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-white min-h-screen transition-colors duration-200">
      <div className="p-2 flex flex-col items-center sticky top-0 z-30 bg-white text-gray-900 border-b border-gray-200 shadow-sm dark:bg-gray-900 dark:text-white dark:border-gray-800 dark:shadow-lg">
        <div className="relative w-full max-w-xl px-2 flex flex-row items-center justify-center gap-1">
          <div className="flex-2 relative mb-4 flex items-center gap-2">
            <input
              type="text"
              placeholder="Search Redemption Cards..."
              className="w-full p-3 pr-10 border rounded text-base focus:ring-2 focus:ring-blue-400 text-gray-900 bg-white dark:text-white dark:bg-gray-900"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={64}
              style={{ minHeight: 48, maxWidth: 220 }}
            />
            <select
              value={searchField}
              onChange={e => {
                console.log("hello;")
                setSearchField(e.target.value);
                setVisibleCount(50);
              }}
              className="border rounded px-2 py-2 bg-gray-100 text-gray-900 border-gray-300 shadow-sm focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:text-white dark:border-gray-600"
              style={{ minHeight: 48 }}
            >
              <option value="everything">Everything</option>
              <option value="name">Name</option>
              <option value="specialAbility">Special Ability</option>
              <option value="setName">Set Name</option>
              <option value="identifier">Identifier</option>
              <option value="reference">Reference</option>
            </select>
          </div>
          <button
            className="mb-4 px-4 py-2 rounded bg-gray-200 text-gray-900 hover:bg-gray-400 hover:text-gray-900 border border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent transition font-semibold shadow"
            onClick={handleResetFilters}
            style={{ minHeight: 48 }}
          >
            Reset Filters
          </button>
        </div>
      </div>
      {/* Active Filters Summary Bar */}
      <div className="w-full px-4 py-2 flex flex-wrap gap-2 items-center justify-center min-h-[44px] transition-all duration-300 sticky top-[64px] z-30 bg-white text-gray-900 border-b border-gray-200 shadow-sm dark:bg-gray-900 dark:text-white dark:border-gray-900 dark:shadow">
        {/* Query */}
        {query && (
          <span
            className="bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer"
            onClick={() => setQuery("")}
            tabIndex={0}
            role="button"
            aria-label="Remove Search filter"
          >
            {searchField === 'everything' && `Search: "${query}"`}
            {searchField === 'name' && `Name contains: "${query}"`}
            {searchField === 'specialAbility' && `Special Ability contains: "${query}"`}
            {searchField === 'setName' && `Set Name contains: "${query}"`}
            {searchField === 'identifier' && `Identifier contains: "${query}"`}
            {searchField === 'reference' && `Reference contains: "${query}"`}
            <span className="ml-1 text-blue-900 dark:text-white">×</span>
          </span>
        )}
        {/* Legality */}
        {legalityMode !== 'Rotation' && (
          <span className="bg-blue-400 text-blue-900 dark:bg-blue-700 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setLegalityMode('Rotation')} tabIndex={0} role="button" aria-label="Remove Legality filter">
            {legalityMode}
            <span className="ml-1 text-blue-900 dark:text-white">×</span>
          </span>
        )}
        {/* Alignment */}
        {selectedAlignmentFilters.map(mode => (
          <span
            key={mode}
            className="bg-blue-100 text-blue-900 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer border border-blue-300 shadow-sm"
            onClick={() => setSelectedAlignmentFilters(selectedAlignmentFilters.filter(m => m !== mode))}
            tabIndex={0}
            role="button"
            aria-label={`Remove ${mode} alignment filter`}
          >
            {mode}
            <span className="ml-1 text-blue-900">×</span>
          </span>
        ))}
        {/* Icon Filters */}
        {selectedIconFilters.map((icon, idx) => {
          // Brigade color mapping
          const brigadeColors = {
            Black: 'bg-black text-white',
            Blue: 'bg-blue-200 text-blue-900 dark:bg-blue-700 dark:text-white',
            Brown: 'bg-yellow-900 text-white',
            Clay: 'bg-orange-100 text-orange-900 dark:bg-orange-200 dark:text-gray-900',
            Crimson: 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-white',
            Gold: 'bg-yellow-200 text-yellow-900 dark:bg-yellow-400 dark:text-gray-900',
            'Good Gold': 'bg-yellow-200 text-yellow-900 dark:bg-yellow-400 dark:text-gray-900',
            'Evil Gold': 'bg-yellow-700 text-white',
            Gray: 'bg-gray-200 text-gray-900 dark:bg-gray-500 dark:text-white',
            Green: 'bg-green-200 text-green-900 dark:bg-green-700 dark:text-white',
            Orange: 'bg-orange-200 text-orange-900 dark:bg-orange-500 dark:text-white',
            'Pale Green': 'bg-green-100 text-green-900 dark:bg-green-200 dark:text-gray-900',
            Purple: 'bg-purple-200 text-purple-900 dark:bg-purple-700 dark:text-white',
            Silver: 'bg-gray-100 text-gray-900 dark:bg-gray-300 dark:text-gray-900',
            White: 'bg-gray-100 text-gray-900 dark:bg-white dark:text-gray-900',
            Red: 'bg-red-200 text-red-900 dark:bg-red-700 dark:text-white',
            Teal: 'bg-teal-100 text-teal-900 dark:bg-teal-600 dark:text-white',
            'Good Multi': 'bg-gradient-to-r from-blue-200 via-green-200 to-red-200 text-gray-900 dark:from-blue-700 dark:via-green-700 dark:to-red-700 dark:text-white',
            'Evil Multi': 'bg-gradient-to-r from-gray-200 via-red-200 to-gray-400 text-gray-900 dark:from-black dark:via-crimson dark:to-gray-700 dark:text-white',
          };
          const pillClass = brigadeColors[icon] ? `${brigadeColors[icon]} px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer` : 'bg-green-200 text-green-900 dark:bg-green-700 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer';
          return (
            <React.Fragment key={icon}>
              <span className={pillClass} onClick={() => setSelectedIconFilters(selectedIconFilters.filter(i => i !== icon))} tabIndex={0} role="button" aria-label={`Remove ${icon} filter`}>
                {icon}
                <span className="ml-1 text-gray-700 dark:text-gray-200">×</span>
              </span>
              {idx < selectedIconFilters.length - 1 && (
                <span className="mx-1 font-bold text-xs text-gray-500 dark:text-gray-400 select-none">
                  {iconFilterMode}
                </span>
              )}
            </React.Fragment>
          );
        })}
        {/* Testament */}
        {selectedTestaments.map(t => (
          <span key={t} className="bg-yellow-200 text-yellow-900 dark:bg-yellow-700 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setSelectedTestaments(selectedTestaments.filter(x => x !== t))} tabIndex={0} role="button" aria-label={`Remove ${t} testament filter`}>
            {t}
            <span className="ml-1 text-yellow-900 dark:text-white">×</span>
          </span>
        ))}
        {/* Gospel */}
        {isGospel && (
          <span className="bg-yellow-300 text-yellow-900 dark:bg-yellow-800 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setIsGospel(false)} tabIndex={0} role="button" aria-label="Remove Gospel filter">
            Gospel
            <span className="ml-1 text-yellow-900 dark:text-white">×</span>
          </span>
        )}
        {/* Strength */}
        {strengthFilter !== null && (
          <span className="bg-red-200 text-red-900 dark:bg-red-700 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setStrengthFilter(null)} tabIndex={0} role="button" aria-label="Remove Strength filter">
            Strength {strengthOp === 'eq' ? '=' : strengthOp === 'lt' ? '<' : strengthOp === 'lte' ? '≤' : strengthOp === 'gt' ? '>' : '≥'} {strengthFilter}
            <span className="ml-1 text-red-900 dark:text-white">×</span>
          </span>
        )}
        {/* Toughness */}
        {toughnessFilter !== null && (
          <span className="bg-red-300 text-red-900 dark:bg-red-800 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setToughnessFilter(null)} tabIndex={0} role="button" aria-label="Remove Toughness filter">
            Toughness {toughnessOp === 'eq' ? '=' : toughnessOp === 'lt' ? '<' : toughnessOp === 'lte' ? '≤' : toughnessOp === 'gt' ? '>' : '≥'} {toughnessFilter}
            <span className="ml-1 text-red-900 dark:text-white">×</span>
          </span>
        )}
        {/* Misc */}
        {noAltArt === false && (
          <span className="bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setnoAltArt(true)} tabIndex={0} role="button" aria-label="Remove AB Versions filter">
            AB Versions
            <span className="ml-1 text-gray-900 dark:text-white">×</span>
          </span>
        )}
        {noFirstPrint === false && (
          <span className="bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setnoFirstPrint(true)} tabIndex={0} role="button" aria-label="Remove 1st Print K/L Starters filter">
            1st Print K/L Starters
            <span className="ml-1 text-gray-900 dark:text-white">×</span>
          </span>
        )}
        {nativityOnly && (
          <span className="bg-pink-200 text-pink-900 dark:bg-pink-700 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setNativityOnly(false)} tabIndex={0} role="button" aria-label="Remove Nativity filter">
            Nativity
            <span className="ml-1 text-pink-900 dark:text-white">×</span>
          </span>
        )}
        {hasStarOnly && (
          <span className="bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setHasStarOnly(false)} tabIndex={0} role="button" aria-label="Remove Has Star filter">
            Has Star
            <span className="ml-1 text-blue-900 dark:text-white">×</span>
          </span>
        )}
        {cloudOnly && (
          <span className="bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setCloudOnly(false)} tabIndex={0} role="button" aria-label="Remove Cloud filter">
            Cloud
            <span className="ml-1 text-blue-900 dark:text-white">×</span>
          </span>
        )}
      </div>
      <main className="p-2 overflow-auto bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-white transition-colors duration-200">
        {/* Responsive grid for filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4 items-start bg-white text-gray-900 border border-gray-200 shadow-sm dark:bg-gray-900 dark:text-white dark:border-gray-900 dark:shadow p-4 rounded-lg">
          {/* Legality & Alignment */}
          <div>
            <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Legality</p>
            <div className="flex flex-col sm:flex-row gap-2 mb-4 flex-wrap">
                    {['Rotation','Classic','Banned','Scrolls'].map((mode) => (
                      <button
                        key={mode}
                        className={clsx(
                          'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                          legalityMode === mode
                            ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                            : 'bg-gray-200 text-gray-900 hover:bg-blue-400 hover:text-blue-900 border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                        )}
                        onClick={() => setLegalityMode(mode as typeof legalityMode)}
                      >
                        {mode}
                      </button>
                    ))}
            </div>
            <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Alignment</p>
            <div className="flex flex-col sm:flex-row gap-2 mb-4 flex-wrap">
              {['Good','Evil','Neutral'].map((mode) => (
                <button
                  key={mode}
                  className={clsx(
                    'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                    selectedAlignmentFilters.includes(mode)
                      ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                      : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
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
                className="px-3 py-2 border rounded text-base mb-2 bg-gray-200 text-gray-900 hover:bg-gray-400 hover:text-gray-900 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-700 dark:hover:text-white font-semibold shadow"
                onClick={() => setAdvancedOpen(!advancedOpen)}
              >
                Advanced Filters {advancedOpen ? '▲' : '▼'}
              </button>
              {advancedOpen && (
                <div className="p-2 border rounded space-y-2">
                  <p className="font-bold text-lg text-gray-900 dark:text-white rounded px-2 py-1 inline-block shadow-none">Testament</p>
                  <div className="flex flex-col sm:flex-row gap-2 mb-2">
                    {['OT','NT'].map((t) => (
                      <button
                        key={t}
                        className={clsx(
                          'px-3 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                          selectedTestaments.includes(t)
                            ? 'bg-yellow-200 text-yellow-900 border-yellow-400 dark:bg-yellow-600 dark:text-white dark:border-transparent'
                            : 'bg-gray-200 text-gray-900 border-gray-300 hover:bg-gray-400 hover:text-gray-900 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                        )}
                        onClick={() => setSelectedTestaments(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev,t])}
                      >
                        {t}
                      </button>
                    ))}
                    <button
                      className={clsx(
                        'px-3 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                        isGospel
                          ? 'bg-yellow-300 text-yellow-900 border-yellow-500 dark:bg-yellow-700 dark:text-white dark:border-transparent'
                          : 'bg-gray-200 text-gray-900 border-gray-300 hover:bg-gray-400 hover:text-gray-900 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                      )}
                      onClick={() => setIsGospel(v => !v)}
                    >
                      Gospel
                    </button>
                  </div>
                  {/* Strength and Toughness Filters - Toughness now under Strength */}
                  <div className="flex flex-col gap-4 mb-2 items-start">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg text-gray-900 dark:text-white rounded px-2 py-1 inline-block shadow-none">Strength</span>
                      <select
                        value={strengthOp}
                        onChange={e => setStrengthOp(e.target.value)}
                        className="border rounded px-2 py-1 bg-gray-100 text-gray-900 border-gray-300 shadow-sm focus:ring-2 focus:ring-gray-400 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                      >
                        <option value="lt">&lt;</option>
                        <option value="lte">&le;</option>
                        <option value="eq">=</option>
                        <option value="gt">&gt;</option>
                        <option value="gte">&ge;</option>
                      </select>
                      <select
                        value={strengthFilter === null ? '' : strengthFilter}
                        onChange={e => setStrengthFilter(e.target.value === '' ? null : Number(e.target.value))}
                        className="border rounded px-2 py-1 bg-gray-100 text-gray-900 border-gray-300 shadow-sm focus:ring-2 focus:ring-gray-400 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                      >
                        <option value="">Any</option>
                        {[...Array(14).keys()].map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg text-gray-900 dark:text-white rounded px-2 py-1 inline-block shadow-none">Toughness</span>
                      <select
                        value={toughnessOp}
                        onChange={e => setToughnessOp(e.target.value)}
                        className="border rounded px-2 py-1 bg-gray-100 text-gray-900 border-gray-300 shadow-sm focus:ring-2 focus:ring-gray-400 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                      >
                        <option value="lt">&lt;</option>
                        <option value="lte">&le;</option>
                        <option value="eq">=</option>
                        <option value="gt">&gt;</option>
                        <option value="gte">&ge;</option>
                      </select>
                      <select
                        value={toughnessFilter === null ? '' : toughnessFilter}
                        onChange={e => setToughnessFilter(e.target.value === '' ? null : Number(e.target.value))}
                        className="border rounded px-2 py-1 bg-gray-100 text-gray-900 border-gray-300 shadow-sm focus:ring-2 focus:ring-gray-400 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                      >
                        <option value="">Any</option>
                        {[...Array(14).keys()].map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="font-bold text-lg rounded px-2 py-1 inline-block shadow-none mt-2 text-gray-900 dark:text-white">Misc</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={clsx(
                        'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                        noAltArt
                          ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                          : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                      )}
                      onClick={() => setnoAltArt(v => !v)}
                    >
                      No AB Versions
                    </button>
                    <button
                      className={clsx(
                        'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                        noFirstPrint
                          ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                          : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                      )}
                      onClick={() => setnoFirstPrint(v => !v)}
                    >
                      No 1st Print K/L Starters
                    </button>
                    <button
                      className={clsx(
                        'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                        nativityOnly
                          ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                          : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                      )}
                      onClick={() => setNativityOnly(v => !v)}
                    >
                      Nativity
                    </button>
                    <button
                      className={clsx(
                        'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                        hasStarOnly
                          ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                          : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                      )}
                      onClick={() => setHasStarOnly(v => !v)}
                    >
                      Has Star
                    </button>
                    <button
                      className={clsx(
                        'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                        cloudOnly
                          ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                          : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                      )}
                      onClick={() => setCloudOnly(v => !v)}
                    >
                      Cloud
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Types */}
        <div>
          <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Types</p>
          <div className="flex flex-wrap gap-2 mb-4 justify-start">
            {typeIcons.map((t) => {
              const src = `/filter-icons/${encodeURIComponent(t)}.png`;
              return (
                <img
                  key={t}
                  src={src}
                  alt={t}
                  className={clsx(
                    'h-10 w-10 sm:h-8 sm:w-auto cursor-pointer',
                    selectedIconFilters.includes(t) && 'ring-2 ring-blue-500 dark:ring-blue-300'
                  )}
                  onClick={() => toggleIconFilter(t)}
                  style={{ minWidth: 40, minHeight: 40 }}
                />
              );
            })}
          </div>
          {/* Icon filter mode toggle moved below types icons */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400 text-sm">Icon Filter Mode:</span>
            <button
              className={clsx(
                'px-2 py-1 border rounded text-sm font-semibold transition',
                iconFilterMode === 'AND'
                  ? 'bg-gray-200 text-gray-900 border-gray-300 dark:bg-gray-900 dark:text-white'
                  : 'bg-blue-200 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white'
              )}
              onClick={() => setIconFilterMode(iconFilterMode === 'AND' ? 'OR' : 'AND')}
              title="Toggle between AND/OR logic for icon filters"
            >
              {iconFilterMode === 'AND' ? 'AND' : 'OR'}
            </button>
          </div>
        </div>
          {/* Brigades */}
          <div>
            <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Good Brigades</p>
            <div className="flex flex-wrap gap-2 mb-2 justify-start">
              {goodBrigadeIcons.map((icon) => (
                <img
                  key={icon}
                  src={`/filter-icons/Color=${encodeURIComponent(icon)}.png`}
                  alt={icon}
                  className={clsx(
                    "h-10 w-10 sm:h-8 sm:w-auto cursor-pointer",
                    selectedIconFilters.includes(icon) && "ring-2 ring-blue-500 dark:ring-blue-300"
                  )}
                  onClick={() => toggleIconFilter(icon)}
                  style={{ minWidth: 40, minHeight: 40 }}
                />
              ))}
            </div>
            <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Evil Brigades</p>
            <div className="flex flex-wrap gap-2 justify-start">
              {evilBrigadeIcons.map((icon) => (
                <img
                  key={icon}
                  src={`/filter-icons/Color=${encodeURIComponent(icon)}.png`}
                  alt={icon}
                  className={clsx(
                    "h-10 w-10 sm:h-8 sm:w-auto cursor-pointer",
                    selectedIconFilters.includes(icon) && "ring-2 ring-blue-500 dark:ring-blue-300"
                  )}
                  onClick={() => toggleIconFilter(icon)}
                  style={{ minWidth: 40, minHeight: 40 }}
                />
              ))}
            </div>
          </div>
        </div>
        {/* Card grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-4">
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
        <ModalWithClose
          modalCard={modalCard}
          setModalCard={setModalCard}
          CARD_IMAGE_BASE_URL={CARD_IMAGE_BASE_URL}
          sanitizeImgFile={sanitizeImgFile}
        />
      )}
    </div>
  );
}