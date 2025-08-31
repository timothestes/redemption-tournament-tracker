"use client";
import React from "react";
import clsx from "clsx";

interface FilterGridProps {
  // Legality & Alignment
  legalityMode: 'Rotation' | 'Classic' | 'Banned' | 'Scrolls';
  setLegalityMode: (mode: 'Rotation' | 'Classic' | 'Banned' | 'Scrolls') => void;
  selectedAlignmentFilters: string[];
  toggleAlignmentFilter: (value: string) => void;
  selectedRarityFilters: string[];
  toggleRarityFilter: (value: string) => void;
  
  // Advanced filters
  advancedOpen: boolean;
  setAdvancedOpen: (open: boolean) => void;
  selectedTestaments: string[];
  setSelectedTestaments: (testaments: string[] | ((prev: string[]) => string[])) => void;
  isGospel: boolean;
  setIsGospel: (gospel: boolean | ((prev: boolean) => boolean)) => void;
  strengthFilter: number | null;
  setStrengthFilter: (strength: number | null) => void;
  strengthOp: string;
  setStrengthOp: (op: string) => void;
  toughnessFilter: number | null;
  setToughnessFilter: (toughness: number | null) => void;
  toughnessOp: string;
  setToughnessOp: (op: string) => void;
  noAltArt: boolean;
  setnoAltArt: (value: boolean | ((prev: boolean) => boolean)) => void;
  noFirstPrint: boolean;
  setnoFirstPrint: (value: boolean | ((prev: boolean) => boolean)) => void;
  nativityOnly: boolean;
  setNativityOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  hasStarOnly: boolean;
  setHasStarOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  cloudOnly: boolean;
  setCloudOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  angelOnly: boolean;
  setAngelOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  demonOnly: boolean;
  setDemonOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  danielOnly: boolean;
  setDanielOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  postexilicOnly: boolean;
  setPostexilicOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  
  // Icon filters
  selectedIconFilters: string[];
  toggleIconFilter: (value: string) => void;
  iconFilterMode: 'AND' | 'OR';
  setIconFilterMode: (mode: 'AND' | 'OR') => void;
}

export default function FilterGrid({
  legalityMode,
  setLegalityMode,
  selectedAlignmentFilters,
  toggleAlignmentFilter,
  selectedRarityFilters,
  toggleRarityFilter,
  advancedOpen,
  setAdvancedOpen,
  selectedTestaments,
  setSelectedTestaments,
  isGospel,
  setIsGospel,
  strengthFilter,
  setStrengthFilter,
  strengthOp,
  setStrengthOp,
  toughnessFilter,
  setToughnessFilter,
  toughnessOp,
  setToughnessOp,
  noAltArt,
  setnoAltArt,
  noFirstPrint,
  setnoFirstPrint,
  nativityOnly,
  setNativityOnly,
  hasStarOnly,
  setHasStarOnly,
  cloudOnly,
  setCloudOnly,
  angelOnly,
  setAngelOnly,
  demonOnly,
  setDemonOnly,
  danielOnly,
  setDanielOnly,
  postexilicOnly,
  setPostexilicOnly,
  selectedIconFilters,
  toggleIconFilter,
  iconFilterMode,
  setIconFilterMode,
}: FilterGridProps) {
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

  return (
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
        <p className="text-gray-500 dark:text-gray-400 uppercase mb-1 text-sm">Rarity</p>
        <div className="flex flex-col sm:flex-row gap-2 mb-4 flex-wrap">
          {['Common','Promo','Rare','Ultra Rare'].map((rarity) => (
            <button
              key={rarity}
              className={clsx(
                'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                selectedRarityFilters.includes(rarity)
                  ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                  : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
              )}
              onClick={() => toggleRarityFilter(rarity)}
            >
              {rarity}
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
                <button
                  className={clsx(
                    'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                    angelOnly
                      ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                      : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                  )}
                  onClick={() => setAngelOnly(v => !v)}
                >
                  Angel
                </button>
                <button
                  className={clsx(
                    'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                    demonOnly
                      ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                      : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                  )}
                  onClick={() => setDemonOnly(v => !v)}
                >
                  Demon
                </button>
                <button
                  className={clsx(
                    'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                    danielOnly
                      ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                      : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                  )}
                  onClick={() => setDanielOnly(v => !v)}
                >
                  Daniel
                </button>
                <button
                  className={clsx(
                    'px-4 py-2 border rounded text-base font-semibold shadow transition-colors duration-150',
                    postexilicOnly
                      ? 'bg-blue-300 text-blue-900 border-blue-300 dark:bg-blue-800 dark:text-white dark:border-transparent'
                      : 'bg-gray-200 text-gray-900 hover:bg-blue-700 hover:text-white border-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-blue-700 dark:hover:text-white dark:border-transparent'
                  )}
                  onClick={() => setPostexilicOnly(v => !v)}
                >
                  Postexilic
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
  );
}
