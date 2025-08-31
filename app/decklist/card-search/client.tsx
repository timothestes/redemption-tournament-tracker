"use client";
import React, { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ModalWithClose from "./ModalWithClose";
import FilterGrid from "./components/FilterGrid";
import CardImage from "./components/CardImage";
import { CARD_DATA_URL, OT_BOOKS, NT_BOOKS, GOSPEL_BOOKS } from "./constants";
import { 
  Card, 
  categorizeRarity, 
  isNativityReference, 
  iconPredicates, 
  normalizeBrigadeField 
} from "./utils";

export default function CardSearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Collapse state for filter grid
  const [filterGridCollapsed, setFilterGridCollapsed] = useState(false);
  // Query state - each query has its own text and search field
  const [queries, setQueries] = useState<{text: string, field: string}[]>([{text: "", field: "everything"}]);

  // Icon filter mode: AND or OR
  const [iconFilterMode, setIconFilterMode] = useState<'AND'|'OR'>('AND');
  // Strength and toughness filter state
  const [strengthFilter, setStrengthFilter] = useState<number | null>(null);
  const [strengthOp, setStrengthOp] = useState<string>('eq');
  const [toughnessFilter, setToughnessFilter] = useState<number | null>(null);
  const [toughnessOp, setToughnessOp] = useState<string>('eq');
  const [cards, setCards] = useState<Card[]>([]);
  const [selectedIconFilters, setSelectedIconFilters] = useState<string[]>([]);
  // Card legality filter mode: Rotation, Classic (all), Banned, Scrolls (not Rotation or Banned)
  const [legalityMode, setLegalityMode] = useState<'Rotation'|'Classic'|'Banned'|'Scrolls'>('Rotation');
  const [visibleCount, setVisibleCount] = useState(0); // Number of cards to show

  const [modalCard, setModalCard] = useState<Card | null>(null);
  // Alignment filters: Good, Evil, Neutral (multiple selection)
  const [selectedAlignmentFilters, setSelectedAlignmentFilters] = useState<string[]>([]);
  // Rarity filters
  const [selectedRarityFilters, setSelectedRarityFilters] = useState<string[]>([]);
  // Advanced filters
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedTestaments, setSelectedTestaments] = useState<string[]>([]);
  const [isGospel, setIsGospel] = useState(false);
  const [noAltArt, setnoAltArt] = useState(true);
  const [noFirstPrint, setnoFirstPrint] = useState(true);
  const [nativityOnly, setNativityOnly] = useState(false);
  const [hasStarOnly, setHasStarOnly] = useState(false);
  const [cloudOnly, setCloudOnly] = useState(false);
  const [angelOnly, setAngelOnly] = useState(false);
  const [demonOnly, setDemonOnly] = useState(false);
  const [danielOnly, setDanielOnly] = useState(false);
  const [postexilicOnly, setPostexilicOnly] = useState(false);
  const [copyLinkNotification, setCopyLinkNotification] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Helper functions for managing multiple queries
  const updateQuery = (index: number, text: string) => {
    const newQueries = [...queries];
    newQueries[index] = { ...newQueries[index], text };
    setQueries(newQueries);
  };

  const updateQueryField = (index: number, field: string) => {
    const newQueries = [...queries];
    newQueries[index] = { ...newQueries[index], field };
    setQueries(newQueries);
  };

  const addNewQuery = () => {
    setQueries([...queries, {text: "", field: "everything"}]);
  };

  const removeQuery = (index: number) => {
    if (queries.length > 1) {
      const newQueries = queries.filter((_, i) => i !== index);
      setQueries(newQueries);
    }
  };

  // Function to update URL with current filter state
  const updateURL = React.useCallback((filters: Record<string, any>) => {
    const params = new URLSearchParams();
    
    // Only add non-default values to URL
    const activeQueries = filters.queries?.filter(q => q.text.trim()) || [];
    if (activeQueries.length > 0) {
      params.set('q', activeQueries[0].text); // For now, only save first query to URL
      if (activeQueries[0].field !== 'everything') params.set('field', activeQueries[0].field);
    }
    if (filters.legalityMode !== 'Rotation') params.set('legality', filters.legalityMode);
    if (filters.iconFilterMode !== 'AND') params.set('iconMode', filters.iconFilterMode);
    if (filters.selectedIconFilters.length > 0) params.set('icons', filters.selectedIconFilters.join(','));
    if (filters.selectedAlignmentFilters.length > 0) params.set('alignment', filters.selectedAlignmentFilters.join(','));
    if (filters.selectedRarityFilters.length > 0) params.set('rarity', filters.selectedRarityFilters.join(','));
    if (filters.selectedTestaments.length > 0) params.set('testaments', filters.selectedTestaments.join(','));
    if (filters.isGospel) params.set('gospel', 'true');
    if (filters.strengthFilter !== null) {
      params.set('strength', filters.strengthFilter.toString());
      params.set('strengthOp', filters.strengthOp);
    }
    if (filters.toughnessFilter !== null) {
      params.set('toughness', filters.toughnessFilter.toString());
      params.set('toughnessOp', filters.toughnessOp);
    }
    if (!filters.noAltArt) params.set('showAltArt', 'true');
    if (!filters.noFirstPrint) params.set('showFirstPrint', 'true');
    if (filters.nativityOnly) params.set('nativity', 'true');
    if (filters.hasStarOnly) params.set('hasStar', 'true');
    if (filters.cloudOnly) params.set('cloud', 'true');
    if (filters.angelOnly) params.set('angel', 'true');
    if (filters.demonOnly) params.set('demon', 'true');
    if (filters.danielOnly) params.set('daniel', 'true');
    if (filters.postexilicOnly) params.set('postexilic', 'true');

    const url = params.toString() ? `?${params.toString()}` : '';
    router.replace(`/decklist/card-search${url}`, { scroll: false });
  }, [router]);

  // Load state from URL on mount (only once)
  useEffect(() => {
    if (searchParams && !isInitialized) {
      const urlQuery = searchParams.get('q') || '';
      const urlField = searchParams.get('field') || 'everything';
      setQueries(urlQuery ? [{text: urlQuery, field: urlField}] : [{text: "", field: "everything"}]);
      setLegalityMode((searchParams.get('legality') as any) || 'Rotation');
      setIconFilterMode((searchParams.get('iconMode') as any) || 'AND');
      setSelectedIconFilters(searchParams.get('icons')?.split(',').filter(Boolean) || []);
      setSelectedAlignmentFilters(searchParams.get('alignment')?.split(',').filter(Boolean) || []);
      setSelectedRarityFilters(searchParams.get('rarity')?.split(',').filter(Boolean) || []);
      setSelectedTestaments(searchParams.get('testaments')?.split(',').filter(Boolean) || []);
      setIsGospel(searchParams.get('gospel') === 'true');
      
      const strengthParam = searchParams.get('strength');
      if (strengthParam) {
        setStrengthFilter(parseInt(strengthParam, 10));
        setStrengthOp(searchParams.get('strengthOp') || 'eq');
      }
      
      const toughnessParam = searchParams.get('toughness');
      if (toughnessParam) {
        setToughnessFilter(parseInt(toughnessParam, 10));
        setToughnessOp(searchParams.get('toughnessOp') || 'eq');
      }
      
      setnoAltArt(searchParams.get('showAltArt') !== 'true');
      setnoFirstPrint(searchParams.get('showFirstPrint') !== 'true');
      setNativityOnly(searchParams.get('nativity') === 'true');
      setHasStarOnly(searchParams.get('hasStar') === 'true');
      setCloudOnly(searchParams.get('cloud') === 'true');
      setAngelOnly(searchParams.get('angel') === 'true');
      setDemonOnly(searchParams.get('demon') === 'true');
      setDanielOnly(searchParams.get('daniel') === 'true');
      setPostexilicOnly(searchParams.get('postexilic') === 'true');
      
      setIsInitialized(true);
    }
  }, [searchParams, isInitialized]);

  // Update URL whenever filters change
  useEffect(() => {
    const filters = {
      queries,
      legalityMode,
      iconFilterMode,
      selectedIconFilters,
      selectedAlignmentFilters,
      selectedRarityFilters,
      selectedTestaments,
      isGospel,
      strengthFilter,
      strengthOp,
      toughnessFilter,
      toughnessOp,
      noAltArt,
      noFirstPrint,
      nativityOnly,
      hasStarOnly,
      cloudOnly,
      angelOnly,
      demonOnly,
      danielOnly,
      postexilicOnly,
    };
    
    updateURL(filters);
  }, [
    queries, legalityMode, iconFilterMode, selectedIconFilters,
    selectedAlignmentFilters, selectedRarityFilters, selectedTestaments, isGospel, strengthFilter,
    strengthOp, toughnessFilter, toughnessOp, noAltArt, noFirstPrint,
    nativityOnly, hasStarOnly, cloudOnly, angelOnly, demonOnly, danielOnly,
    postexilicOnly, updateURL
  ]);

  // sanitize imgFile to avoid duplicate extensions - now imported from utils

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

  const filtered = useMemo(
    () =>
      cards
        .filter((c) => {
          // Handle multiple queries - all must match (AND logic)
          const activeQueries = queries.filter(q => q.text.trim());
          if (activeQueries.length === 0) return true;
          
          return activeQueries.every(queryObj => {
            const q = queryObj.text.toLowerCase();
            const searchField = queryObj.field;
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
          });
        })
        // Filter out specific unwanted cards
        .filter((c) => {
          // Exclude Lost Soul Token OT [2024 - Nationals]
          return c.name !== "Lost Soul Token OT [2024 - Nationals]";
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
        // Rarity filters (OR across selected filters)
        .filter((c) => {
          if (selectedRarityFilters.length === 0) return true;
          const cardRarityCategory = categorizeRarity(c.rarity, c.officialSet);
          return selectedRarityFilters.includes(cardRarityCategory);
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
        .filter((c) => !hasStarOnly || c.specialAbility.toLowerCase().includes("star:") || c.specialAbility.toLowerCase().includes("(star)"))
        .filter((c) => !angelOnly || (c.type.includes("Hero") && c.brigade.includes("Silver") && !c.identifier.includes("Human") && !c.identifier.includes("Genderless") && c.name !== "Moses in Glory (GoC)" && c.name !== "Noah, the Righteous / Noah (Rest and Comfort) (LoC)" && c.name !== "Daniel (Promo)"))
        .filter((c) => !demonOnly || (c.type.includes("Evil Character") && (c.brigade.includes("Orange") || c.name.toLowerCase().includes("demon") || c.name.toLowerCase().includes("obsidian minion") || c.name === "Foul Spirit (E)" || c.name === "Lying Spirit" || c.name === "Spirit of Doubt" || c.name === "Unclean Spirit (E)" || c.name === "Wandering Spirit (Ap)") && c.name !== "Babylon The Harlot (RoJ)" && c.brigade !== "Black/Brown/Crimson/Evil Gold/Gray/Orange/Pale Green" && !c.identifier.includes("Symbolic") && !c.identifier.includes("Animal") && c.name !== "Sabbath Breaker [Gray/Orange]" && c.name !== "The Divining Damsel (Promo)" && c.name !== "The False Prophet (EC)" && c.name !== "The False Prophet (RoJ)" && c.name !== "The False Prophet (RoJ AB)" && c.name !== "Damsel with Spirit of Divination (TxP)" && c.name !== "Saul/Paul"))
        .filter((c) => !danielOnly || c.reference.toLowerCase().includes("daniel"))
        .filter((c) => {
          if (!postexilicOnly) return true;
          // Check if name contains "postexilic"
          if (c.identifier.toLowerCase().includes("postexilic")) return true;
          // Check if it's one of the specific postexilic cards
          const postexilicCards = [
            "Nehemiah",
            "Eliashib the High Priest",
            "Ezra",
            "Haggai",
            "Haggai (PoC)",
            "Joiada, Son of Eliashib",
            "Joiakim, Son of Joshua",
            "Jonathan, son of Joiada",
            "Joshua the High Priest (PoC)",
            "Joshua the High Priest",
            "Malachi (PoC)",
            "Malachi, the Loved",
            "Malachi",
            "Shelemiah the Priest",
            "Zechariah (Pi)",
            "Zechariah (Pr)",
            "Zechariah (RoA)",
            "Zechariah, the Renewer",
            "Zerubbabel",
            "Foolish Shepherd",
            "Unfaithful Priests"
          ];
          return postexilicCards.includes(c.name);
        }),
    [cards, queries, selectedIconFilters, legalityMode, selectedAlignmentFilters, selectedRarityFilters, selectedTestaments, isGospel, noAltArt, noFirstPrint, nativityOnly, hasStarOnly, cloudOnly, angelOnly, demonOnly, danielOnly, postexilicOnly, strengthFilter, strengthOp, toughnessFilter, toughnessOp, iconFilterMode]
  );

  // Effect to show all cards when any filter is applied
  useEffect(() => {
    // If any meaningful filters are active, show all filtered cards, otherwise show none
    // Note: searchField change alone shouldn't trigger showing cards without a query
    const hasActiveQueries = queries.some(q => q.text.trim());
    const hasActiveFilters = hasActiveQueries || 
      selectedIconFilters.length > 0 || 
      selectedAlignmentFilters.length > 0 || 
      selectedRarityFilters.length > 0 || 
      selectedTestaments.length > 0 || 
      isGospel || 
      strengthFilter !== null || 
      toughnessFilter !== null || 
      !noAltArt || 
      !noFirstPrint || 
      nativityOnly || 
      hasStarOnly || 
      cloudOnly || 
      angelOnly || 
      demonOnly || 
      danielOnly || 
      postexilicOnly ||
      legalityMode !== 'Rotation';
    
    if (hasActiveFilters) {
      setVisibleCount(filtered.length);
    } else {
      setVisibleCount(0);
    }
  }, [filtered.length, queries, legalityMode, selectedIconFilters, selectedAlignmentFilters, selectedRarityFilters, selectedTestaments, isGospel, strengthFilter, toughnessFilter, noAltArt, noFirstPrint, nativityOnly, hasStarOnly, cloudOnly, angelOnly, demonOnly, danielOnly, postexilicOnly]);

  const visibleCards = useMemo(() => {
    return filtered
      .slice(0, visibleCount)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, visibleCount]);

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
  
  // Toggler for rarity filters
  function toggleRarityFilter(value: string) {
    setSelectedRarityFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  // Brigade normalization helpers - now imported from utils

  // Reset filters handler
  function handleResetFilters() {
    setQueries([{text: "", field: "everything"}]);
    setSelectedIconFilters([]);
    setLegalityMode('Rotation');
    setIconFilterMode('AND');
    setSelectedAlignmentFilters([]);
    setSelectedRarityFilters([]);
    setSelectedTestaments([]);
    setIsGospel(false);
    setnoAltArt(true);
    setnoFirstPrint(true);
    setNativityOnly(false);
    setHasStarOnly(false);
    setCloudOnly(false);
    setAngelOnly(false);
    setDemonOnly(false);
    setDanielOnly(false);
    setPostexilicOnly(false);
    setStrengthFilter(null);
    setStrengthOp('eq');
    setToughnessFilter(null);
    setToughnessOp('eq');
    setVisibleCount(0); // Don't show any cards after reset
    
    // Clear URL
    router.replace('/decklist/card-search', { scroll: false });
  }

  // Copy current search URL to clipboard
  function handleCopyLink() {
    const currentUrl = window.location.href;
    navigator.clipboard.writeText(currentUrl).then(() => {
      setCopyLinkNotification(true);
      setTimeout(() => setCopyLinkNotification(false), 2000); // Hide after 2 seconds
    }).catch(err => {
      console.error('Failed to copy link:', err);
    });
  }


  // ...existing code...
  return (
    <div className="bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-white min-h-screen transition-colors duration-200">
      <div className="p-2 flex flex-col items-center sticky top-0 z-40 bg-white text-gray-900 border-b border-gray-200 shadow-sm dark:bg-gray-900 dark:text-white dark:border-gray-800 dark:shadow-lg">
        <div className="relative w-full max-w-xl px-2 flex flex-col sm:flex-row items-center justify-center gap-0">
          <div className="w-full flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center sm:gap-2 text-center">
            <div className="flex flex-col gap-2 w-full sm:w-auto">
              {queries.map((queryObj, index) => (
                <div key={index} className="flex items-center gap-1">
                  <input
                    type="text"
                    placeholder={index === 0 ? "Search" : `Search ${index + 1}`}
                    className="w-full sm:w-auto p-3 pr-10 border rounded text-base focus:ring-2 focus:ring-blue-400 text-gray-900 bg-white dark:text-white dark:bg-gray-900"
                    value={queryObj.text}
                    onChange={(e) => updateQuery(index, e.target.value)}
                    maxLength={64}
                    style={{ minHeight: 48, maxWidth: 180 }}
                  />
                  <select
                    value={queryObj.field}
                    onChange={e => updateQueryField(index, e.target.value)}
                    className="border rounded px-2 py-2 bg-gray-100 text-gray-900 border-gray-300 shadow-sm focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:text-white dark:border-gray-600 text-center text-sm"
                    style={{ minHeight: 48, maxWidth: 120 }}
                  >
                    <option value="everything">All</option>
                    <option value="name">Name</option>
                    <option value="specialAbility">Special Ability</option>
                    <option value="setName">Set Name</option>
                    <option value="identifier">Identifier</option>
                    <option value="reference">Reference</option>
                  </select>
                  {queries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeQuery(index)}
                      className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded transition-colors"
                      title="Remove this query"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              className="px-4 py-2 w-full sm:w-auto rounded bg-gray-200 text-gray-900 hover:bg-gray-400 hover:text-gray-900 border border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent transition font-semibold shadow text-center"
              onClick={handleResetFilters}
              style={{ minHeight: 48 }}
            >
              Reset Filters
            </button>
            <button
              className={`px-4 py-2 w-full sm:w-auto rounded border transition font-semibold shadow text-center relative hidden sm:block ${
                queries.filter(q => q.text.trim()).length > 1
                  ? 'bg-gray-400 text-gray-600 border-gray-500 cursor-not-allowed opacity-50 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-600'
                  : 'bg-gray-200 text-gray-900 hover:bg-gray-400 hover:text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
              }`}
              onClick={queries.filter(q => q.text.trim()).length > 1 ? undefined : handleCopyLink}
              style={{ minHeight: 48 }}
              title={
                queries.filter(q => q.text.trim()).length > 1
                  ? 'Multiple query link sharing sadly not supported'
                  : copyLinkNotification ? 'Link copied!' : 'Copy search link'
              }
              disabled={queries.filter(q => q.text.trim()).length > 1}
            >
              {copyLinkNotification ? '✓' : '🔗'}
            </button>
            <button
              className="px-4 py-2 w-full sm:w-auto rounded bg-green-200 text-green-900 hover:bg-green-400 hover:text-green-900 border border-green-300 dark:bg-green-700 dark:text-white dark:hover:bg-green-600 dark:hover:text-white dark:border-transparent transition font-semibold shadow text-center relative hidden sm:block"
              onClick={addNewQuery}
              style={{ minHeight: 48 }}
              title="Add new query"
            >
              +
            </button>
          </div>
        </div>
      </div>
      {/* Active Filters Summary Bar */}
      <div className="w-full px-4 py-2 flex flex-wrap gap-2 items-center justify-center min-h-[44px] transition-all duration-300 sticky top-[120px] sm:top-[64px] z-30 bg-white text-gray-900 border-b border-gray-200 shadow-sm dark:bg-gray-900 dark:text-white dark:border-gray-900 dark:shadow">
        {/* Collapse/Expand Filter Grid Button */}
        <div className="absolute right-4 top-2">
          <button
            aria-label="Toggle filter grid"
            className={`w-8 h-8 rounded-full flex items-center justify-center border border-gray-400 dark:border-gray-700 shadow transition bg-gray-300 dark:bg-gray-700 ${filterGridCollapsed ? 'ring-2 ring-blue-400' : ''}`}
            style={{ outline: 'none' }}
            onClick={() => setFilterGridCollapsed(v => !v)}
          >
            {/* Use a chevron icon for clarity */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ transition: 'transform 0.2s', transform: filterGridCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <circle cx="12" cy="12" r="11" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="1" />
              <path d="M8 10l4 4 4-4" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {/* Query Pills */}
        {queries.map((queryObj, originalIndex) => {
          if (!queryObj.text.trim()) return null;
          return (
            <span
              key={originalIndex}
              className="bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer"
              onClick={() => updateQuery(originalIndex, "")}
              tabIndex={0}
              role="button"
              aria-label={`Remove Search filter ${originalIndex + 1}`}
            >
              {queryObj.field === 'everything' && `Search: "${queryObj.text}"`}
              {queryObj.field === 'name' && `Name contains: "${queryObj.text}"`}
              {queryObj.field === 'specialAbility' && `Special Ability contains: "${queryObj.text}"`}
              {queryObj.field === 'setName' && `Set Name contains: "${queryObj.text}"`}
              {queryObj.field === 'identifier' && `Identifier contains: "${queryObj.text}"`}
              {queryObj.field === 'reference' && `Reference contains: "${queryObj.text}"`}
              <span className="ml-1 text-blue-900 dark:text-white">×</span>
            </span>
          );
        })}
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
        {/* Rarity */}
        {selectedRarityFilters.map(rarity => (
          <span
            key={rarity}
            className="bg-purple-200 text-purple-900 dark:bg-purple-600 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer"
            onClick={() => setSelectedRarityFilters(selectedRarityFilters.filter(r => r !== rarity))}
            tabIndex={0}
            role="button"
            aria-label={`Remove ${rarity} rarity filter`}
          >
            {rarity}
            <span className="ml-1 text-purple-900 dark:text-white">×</span>
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
        {angelOnly && (
          <span className="bg-gray-100 text-gray-900 dark:bg-gray-300 dark:text-gray-900 px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setAngelOnly(false)} tabIndex={0} role="button" aria-label="Remove Angel filter">
            Angel
            <span className="ml-1 text-gray-900">×</span>
          </span>
        )}
        {demonOnly && (
          <span className="bg-orange-200 text-orange-900 dark:bg-orange-500 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setDemonOnly(false)} tabIndex={0} role="button" aria-label="Remove Demon filter">
            Demon
            <span className="ml-1 text-orange-900 dark:text-white">×</span>
          </span>
        )}
        {danielOnly && (
          <span className="bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setDanielOnly(false)} tabIndex={0} role="button" aria-label="Remove Daniel filter">
            Daniel
            <span className="ml-1 text-blue-900 dark:text-white">×</span>
          </span>
        )}
        {postexilicOnly && (
          <span className="bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-white px-3 py-1 rounded-full text-sm flex items-center gap-1 cursor-pointer" onClick={() => setPostexilicOnly(false)} tabIndex={0} role="button" aria-label="Remove Postexilic filter">
            Postexilic
            <span className="ml-1 text-blue-900 dark:text-white">×</span>
          </span>
        )}
      </div>
      <main className="p-2 overflow-auto bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-white transition-colors duration-200">
        {/* Responsive grid for filters */}
        {!filterGridCollapsed && (
          <FilterGrid
            legalityMode={legalityMode}
            setLegalityMode={setLegalityMode}
            selectedAlignmentFilters={selectedAlignmentFilters}
            toggleAlignmentFilter={toggleAlignmentFilter}
            selectedRarityFilters={selectedRarityFilters}
            toggleRarityFilter={toggleRarityFilter}
            advancedOpen={advancedOpen}
            setAdvancedOpen={setAdvancedOpen}
            selectedTestaments={selectedTestaments}
            setSelectedTestaments={setSelectedTestaments}
            isGospel={isGospel}
            setIsGospel={setIsGospel}
            strengthFilter={strengthFilter}
            setStrengthFilter={setStrengthFilter}
            strengthOp={strengthOp}
            setStrengthOp={setStrengthOp}
            toughnessFilter={toughnessFilter}
            setToughnessFilter={setToughnessFilter}
            toughnessOp={toughnessOp}
            setToughnessOp={setToughnessOp}
            noAltArt={noAltArt}
            setnoAltArt={setnoAltArt}
            noFirstPrint={noFirstPrint}
            setnoFirstPrint={setnoFirstPrint}
            nativityOnly={nativityOnly}
            setNativityOnly={setNativityOnly}
            hasStarOnly={hasStarOnly}
            setHasStarOnly={setHasStarOnly}
            cloudOnly={cloudOnly}
            setCloudOnly={setCloudOnly}
            angelOnly={angelOnly}
            setAngelOnly={setAngelOnly}
            demonOnly={demonOnly}
            setDemonOnly={setDemonOnly}
            danielOnly={danielOnly}
            setDanielOnly={setDanielOnly}
            postexilicOnly={postexilicOnly}
            setPostexilicOnly={setPostexilicOnly}
            selectedIconFilters={selectedIconFilters}
            toggleIconFilter={toggleIconFilter}
            iconFilterMode={iconFilterMode}
            setIconFilterMode={setIconFilterMode}
          />
        )}
        {/* Card grid */}
        {visibleCards.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-4">
            {visibleCards.map((c) => (
              <div key={c.dataLine} className="cursor-pointer" onClick={() => setModalCard(c)}>
                <CardImage
                  imgFile={c.imgFile}
                  alt={c.name}
                  className="rounded shadow hover:shadow-lg transition-shadow"
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw"
                />
                <p className="text-sm mt-1 text-center truncate">{c.name}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center mt-16 mb-16">
            <div className="text-center">
              <p className="text-xl text-gray-500 dark:text-gray-400 mb-2">Ready to filter cards</p>
              <p className="text-sm text-gray-400 dark:text-gray-500">Use the search or filters above to find cards</p>
            </div>
          </div>
        )}
      </main>
      {/* Smaller modal with overlay click to close */}
      {modalCard && (
        <ModalWithClose
          modalCard={modalCard}
          setModalCard={setModalCard}
          visibleCards={visibleCards}
        />
      )}
    </div>
  );
}