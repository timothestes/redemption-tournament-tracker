"use client";
import React from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

interface FilterGridProps {
  // Legality & Alignment
  legalityMode: 'Rotation' | 'Classic' | 'Banned' | 'Scrolls' | 'Paragon';
  setLegalityMode: (mode: 'Rotation' | 'Classic' | 'Banned' | 'Scrolls' | 'Paragon') => void;
  selectedAlignmentFilters: string[];
  toggleAlignmentFilter: (value: string) => void;
  selectedRarityFilters: string[];
  toggleRarityFilter: (value: string) => void;
  
  // Advanced filters
  advancedOpen: boolean;
  setAdvancedOpen: (open: boolean) => void;
  selectedTestaments: string[];
  setSelectedTestaments: (testaments: string[] | ((prev: string[]) => string[])) => void;
  testamentNots: Record<string, boolean>;
  setTestamentNots: (nots: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  isGospel: boolean;
  setIsGospel: (gospel: boolean | ((prev: boolean) => boolean)) => void;
  gospelNot: boolean;
  setGospelNot: (not: boolean | ((prev: boolean) => boolean)) => void;
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
  nativityNot: boolean;
  setNativityNot: (value: boolean | ((prev: boolean) => boolean)) => void;
  hasStarOnly: boolean;
  setHasStarOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  hasStarNot: boolean;
  setHasStarNot: (value: boolean | ((prev: boolean) => boolean)) => void;
  cloudOnly: boolean;
  setCloudOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  cloudNot: boolean;
  setCloudNot: (value: boolean | ((prev: boolean) => boolean)) => void;
  angelOnly: boolean;
  setAngelOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  angelNot: boolean;
  setAngelNot: (value: boolean | ((prev: boolean) => boolean)) => void;
  demonOnly: boolean;
  setDemonOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  demonNot: boolean;
  setDemonNot: (value: boolean | ((prev: boolean) => boolean)) => void;
  danielOnly: boolean;
  setDanielOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  danielNot: boolean;
  setDanielNot: (value: boolean | ((prev: boolean) => boolean)) => void;
  postexilicOnly: boolean;
  setPostexilicOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  postexilicNot: boolean;
  setPostexilicNot: (value: boolean | ((prev: boolean) => boolean)) => void;
  
  // Icon filters
  selectedIconFilters: Array<{ icon: string; operator: 'AND' | 'OR' | 'AND NOT' }>;
  toggleIconFilter: (value: string) => void;
  updateIconFilterOperator: (icon: string, operator: 'AND' | 'OR' | 'AND NOT') => void;
  iconFilterMode: 'AND' | 'OR' | 'AND NOT';
  setIconFilterMode: (mode: 'AND' | 'OR' | 'AND NOT') => void;
  updateAllIconFilterOperators: (operator: 'AND' | 'OR' | 'AND NOT') => void;
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
  testamentNots,
  setTestamentNots,
  isGospel,
  setIsGospel,
  gospelNot,
  setGospelNot,
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
  nativityNot,
  setNativityNot,
  hasStarOnly,
  setHasStarOnly,
  hasStarNot,
  setHasStarNot,
  cloudOnly,
  setCloudOnly,
  cloudNot,
  setCloudNot,
  angelOnly,
  setAngelOnly,
  angelNot,
  setAngelNot,
  demonOnly,
  setDemonOnly,
  demonNot,
  setDemonNot,
  danielOnly,
  setDanielOnly,
  danielNot,
  setDanielNot,
  postexilicOnly,
  setPostexilicOnly,
  postexilicNot,
  setPostexilicNot,
  selectedIconFilters,
  toggleIconFilter,
  updateIconFilterOperator,
  iconFilterMode,
  setIconFilterMode,
  updateAllIconFilterOperators,
}: FilterGridProps) {
  const router = useRouter();
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
    "Warrior-Class",
    "Weapon-Class",
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
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-4 items-start text-foreground p-3 md:p-4">
      {/* Legality & Alignment — spans full width on mobile so Types/Brigades get their own column */}
      <div className="col-span-2 md:col-span-1">
        <p className="text-muted-foreground uppercase mb-1 text-sm">Legality</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {['Rotation','Classic','Banned','Scrolls','Paragon'].map((mode) => (
            <button
              key={mode}
              className={clsx(
                'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                legalityMode === mode
                  ? 'bg-primary/20 text-primary border-primary/30'
                  : 'bg-muted text-foreground hover:bg-muted/80 border-border'
              )}
              onClick={() => setLegalityMode(mode as typeof legalityMode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground uppercase mb-1 text-sm">Alignment</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {['Good','Evil','Neutral'].map((mode) => (
            <button
              key={mode}
              className={clsx(
                'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                selectedAlignmentFilters.includes(mode)
                  ? 'bg-primary/20 text-primary border-primary/30'
                  : 'bg-muted text-foreground hover:bg-muted/80 border-border'
              )}
              onClick={() => toggleAlignmentFilter(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground uppercase mb-1 text-sm">Rarity</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {['Common','Promo','Rare','Ultra Rare'].map((rarity) => (
            <button
              key={rarity}
              className={clsx(
                'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                selectedRarityFilters.includes(rarity)
                  ? 'bg-primary/20 text-primary border-primary/30'
                  : 'bg-muted text-foreground hover:bg-muted/80 border-border'
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
            className="px-2.5 py-1 md:px-3 md:py-2 border rounded text-sm md:text-base mb-2 bg-muted text-foreground hover:bg-muted/80 font-semibold shadow"
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            Advanced Filters {advancedOpen ? '▲' : '▼'}
          </button>
          {advancedOpen && (
            <div className="p-2 border rounded space-y-2">
              <p className="font-bold text-base md:text-lg text-foreground rounded px-2 py-1 inline-block shadow-none">Testament</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {['OT','NT'].map((t) => {
                  const isActive = selectedTestaments.includes(t);
                  const isNot = testamentNots[t] || false;
                  return (
                    <button
                      key={t}
                      className={clsx(
                        'px-2.5 py-1 md:px-3 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                        isActive && !isNot && 'bg-primary/20 text-primary border-primary/30',
                        isActive && isNot && 'bg-destructive/20 text-destructive border-destructive/30',
                        !isActive && 'bg-muted text-foreground hover:bg-muted/80 border-border'
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        // Cycle through: OFF → ON (include) → NOT (exclude) → OFF
                        if (!isActive) {
                          // OFF → ON (include)
                          setSelectedTestaments(prev => [...prev, t]);
                          setTestamentNots(prev => ({ ...prev, [t]: false }));
                        } else if (isActive && !isNot) {
                          // ON (include) → NOT (exclude)
                          setTestamentNots(prev => ({ ...prev, [t]: true }));
                        } else {
                          // NOT (exclude) → OFF
                          setSelectedTestaments(prev => prev.filter(x => x !== t));
                          setTestamentNots(prev => {
                            const newNots = { ...prev };
                            delete newNots[t];
                            return newNots;
                          });
                        }
                      }}
                      title="Click to cycle: Include → Exclude → Off"
                    >
                      {isNot ? 'NOT ' : ''}{t}
                    </button>
                  );
                })}
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-3 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    isGospel && !gospelNot && 'bg-primary/20 text-primary border-primary/30',
                    isGospel && gospelNot && 'bg-destructive/20 text-destructive border-destructive/30',
                    !isGospel && 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    // Cycle through: OFF → ON (include) → NOT (exclude) → OFF
                    if (!isGospel) {
                      // OFF → ON (include)
                      setIsGospel(true);
                      setGospelNot(false);
                    } else if (isGospel && !gospelNot) {
                      // ON (include) → NOT (exclude)
                      setGospelNot(true);
                    } else {
                      // NOT (exclude) → OFF
                      setIsGospel(false);
                      setGospelNot(false);
                    }
                  }}
                  title="Click to cycle: Include → Exclude → Off"
                >
                  {gospelNot ? 'NOT ' : ''}Gospel
                </button>
              </div>
              {/* Strength and Toughness Filters - Toughness now under Strength */}
              <div className="flex flex-col gap-4 mb-2 items-start">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg text-foreground rounded px-2 py-1 inline-block shadow-none">Strength</span>
                  <select
                    value={strengthOp}
                    onChange={e => setStrengthOp(e.target.value)}
                    className="border rounded px-2 py-1 bg-muted text-foreground border-border shadow-sm focus:ring-2 focus:ring-ring"
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
                    className="border rounded px-2 py-1 bg-muted text-foreground border-border shadow-sm focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Any</option>
                    {[...Array(14).keys()].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg text-foreground rounded px-2 py-1 inline-block shadow-none">Toughness</span>
                  <select
                    value={toughnessOp}
                    onChange={e => setToughnessOp(e.target.value)}
                    className="border rounded px-2 py-1 bg-muted text-foreground border-border shadow-sm focus:ring-2 focus:ring-ring"
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
                    className="border rounded px-2 py-1 bg-muted text-foreground border-border shadow-sm focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Any</option>
                    {[...Array(14).keys()].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="font-bold text-lg rounded px-2 py-1 inline-block shadow-none mt-2 text-foreground">Misc</p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    noAltArt
                      ? 'bg-primary/20 text-primary border-primary/30'
                      : 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={() => setnoAltArt(v => !v)}
                >
                  No AB Versions
                </button>
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    noFirstPrint
                      ? 'bg-primary/20 text-primary border-primary/30'
                      : 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={() => setnoFirstPrint(v => !v)}
                >
                  No 1st Print K/L Starters
                </button>
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    nativityOnly && !nativityNot && 'bg-primary/20 text-primary border-primary/30',
                    nativityOnly && nativityNot && 'bg-destructive/20 text-destructive border-destructive/30',
                    !nativityOnly && 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    // Cycle through: OFF → ON (include) → NOT (exclude) → OFF
                    if (!nativityOnly) {
                      // OFF → ON (include)
                      setNativityOnly(true);
                      setNativityNot(false);
                    } else if (nativityOnly && !nativityNot) {
                      // ON (include) → NOT (exclude)
                      setNativityNot(true);
                    } else {
                      // NOT (exclude) → OFF
                      setNativityOnly(false);
                      setNativityNot(false);
                    }
                  }}
                  title="Click to cycle: Include → Exclude → Off"
                >
                  {nativityOnly && nativityNot ? 'NOT ' : ''}Nativity
                </button>
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    hasStarOnly && !hasStarNot && 'bg-primary/20 text-primary border-primary/30',
                    hasStarOnly && hasStarNot && 'bg-destructive/20 text-destructive border-destructive/30',
                    !hasStarOnly && 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    // Cycle through: OFF → ON (include) → NOT (exclude) → OFF
                    if (!hasStarOnly) {
                      // OFF → ON (include)
                      setHasStarOnly(true);
                      setHasStarNot(false);
                    } else if (hasStarOnly && !hasStarNot) {
                      // ON (include) → NOT (exclude)
                      setHasStarNot(true);
                    } else {
                      // NOT (exclude) → OFF
                      setHasStarOnly(false);
                      setHasStarNot(false);
                    }
                  }}
                  title="Click to cycle: Include → Exclude → Off"
                >
                  {hasStarOnly && hasStarNot ? 'NOT ' : ''}Has Star
                </button>
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    cloudOnly && !cloudNot && 'bg-primary/20 text-primary border-primary/30',
                    cloudOnly && cloudNot && 'bg-destructive/20 text-destructive border-destructive/30',
                    !cloudOnly && 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    // Cycle through: OFF → ON (include) → NOT (exclude) → OFF
                    if (!cloudOnly) {
                      // OFF → ON (include)
                      setCloudOnly(true);
                      setCloudNot(false);
                    } else if (cloudOnly && !cloudNot) {
                      // ON (include) → NOT (exclude)
                      setCloudNot(true);
                    } else {
                      // NOT (exclude) → OFF
                      setCloudOnly(false);
                      setCloudNot(false);
                    }
                  }}
                  title="Click to cycle: Include → Exclude → Off"
                >
                  {cloudOnly && cloudNot ? 'NOT ' : ''}Cloud
                </button>
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    angelOnly && !angelNot && 'bg-primary/20 text-primary border-primary/30',
                    angelOnly && angelNot && 'bg-destructive/20 text-destructive border-destructive/30',
                    !angelOnly && 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    // Cycle through: OFF → ON (include) → NOT (exclude) → OFF
                    if (!angelOnly) {
                      // OFF → ON (include)
                      setAngelOnly(true);
                      setAngelNot(false);
                    } else if (angelOnly && !angelNot) {
                      // ON (include) → NOT (exclude)
                      setAngelNot(true);
                    } else {
                      // NOT (exclude) → OFF
                      setAngelOnly(false);
                      setAngelNot(false);
                    }
                  }}
                  title="Click to cycle: Include → Exclude → Off"
                >
                  {angelOnly && angelNot ? 'NOT ' : ''}Angel
                </button>
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    demonOnly && !demonNot && 'bg-primary/20 text-primary border-primary/30',
                    demonOnly && demonNot && 'bg-destructive/20 text-destructive border-destructive/30',
                    !demonOnly && 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    // Cycle through: OFF → ON (include) → NOT (exclude) → OFF
                    if (!demonOnly) {
                      // OFF → ON (include)
                      setDemonOnly(true);
                      setDemonNot(false);
                    } else if (demonOnly && !demonNot) {
                      // ON (include) → NOT (exclude)
                      setDemonNot(true);
                    } else {
                      // NOT (exclude) → OFF
                      setDemonOnly(false);
                      setDemonNot(false);
                    }
                  }}
                  title="Click to cycle: Include → Exclude → Off"
                >
                  {demonOnly && demonNot ? 'NOT ' : ''}Demon
                </button>
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    danielOnly && !danielNot && 'bg-primary/20 text-primary border-primary/30',
                    danielOnly && danielNot && 'bg-destructive/20 text-destructive border-destructive/30',
                    !danielOnly && 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    // Cycle through: OFF → ON (include) → NOT (exclude) → OFF
                    if (!danielOnly) {
                      // OFF → ON (include)
                      setDanielOnly(true);
                      setDanielNot(false);
                    } else if (danielOnly && !danielNot) {
                      // ON (include) → NOT (exclude)
                      setDanielNot(true);
                    } else {
                      // NOT (exclude) → OFF
                      setDanielOnly(false);
                      setDanielNot(false);
                    }
                  }}
                  title="Click to cycle: Include → Exclude → Off"
                >
                  {danielOnly && danielNot ? 'NOT ' : ''}Daniel
                </button>
                <button
                  className={clsx(
                    'px-2.5 py-1 md:px-4 md:py-2 border rounded text-sm md:text-base font-semibold shadow transition-colors duration-150',
                    postexilicOnly && !postexilicNot && 'bg-primary/20 text-primary border-primary/30',
                    postexilicOnly && postexilicNot && 'bg-destructive/20 text-destructive border-destructive/30',
                    !postexilicOnly && 'bg-muted text-foreground hover:bg-muted/80 border-border'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    // Cycle through: OFF → ON (include) → NOT (exclude) → OFF
                    if (!postexilicOnly) {
                      // OFF → ON (include)
                      setPostexilicOnly(true);
                      setPostexilicNot(false);
                    } else if (postexilicOnly && !postexilicNot) {
                      // ON (include) → NOT (exclude)
                      setPostexilicNot(true);
                    } else {
                      // NOT (exclude) → OFF
                      setPostexilicOnly(false);
                      setPostexilicNot(false);
                    }
                  }}
                  title="Click to cycle: Include → Exclude → Off"
                >
                  {postexilicOnly && postexilicNot ? 'NOT ' : ''}Postexilic
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Types */}
      <div>
        <p className="text-muted-foreground uppercase mb-1 text-sm">Types</p>
        <div className="flex flex-wrap gap-2 mb-4 justify-start">
          {typeIcons.map((t) => {
            const src = `/filter-icons/${encodeURIComponent(t)}.png`;
            return (
              <img
                key={t}
                src={src}
                alt={t}
                className={clsx(
                  'h-8 w-8 md:h-10 md:w-auto cursor-pointer',
                  selectedIconFilters.some(f => f.icon === t) && 'ring-2 ring-primary'
                )}
                onClick={() => toggleIconFilter(t)}
                style={{ minWidth: 32, minHeight: 32 }}
              />
            );
          })}
        </div>
        {/* Icon filter mode toggle moved below types icons */}
        <div className="mb-2 flex items-center gap-2">
          <span 
            className="text-muted-foreground text-sm cursor-help" 
            title="Controls how multiple icon filters combine: Click button to cycle through modes"
          >
            Icon Filter Mode:
          </span>
          <button
            className={clsx(
              'px-2 py-1 border rounded text-sm font-semibold transition',
              'bg-muted text-foreground border-border hover:bg-muted/80'
            )}
            onClick={(e) => {
              e.preventDefault();
              // Click: cycle through AND → OR → AND NOT → AND
              let newMode: 'AND' | 'OR' | 'AND NOT';
              if (iconFilterMode === 'AND') {
                newMode = 'OR';
              } else if (iconFilterMode === 'OR') {
                newMode = 'AND NOT';
              } else {
                newMode = 'AND';
              }
              setIconFilterMode(newMode);
              // Update all currently active icon filters to the new mode
              updateAllIconFilterOperators(newMode);
            }}
            title="Click to cycle: AND → OR → AND NOT (applies to all active filters)"
          >
            {iconFilterMode}
          </button>
          <button
            className={clsx(
              'px-2 py-1 border rounded text-sm transition opacity-70 hover:opacity-100',
              'bg-muted text-muted-foreground border-border hover:bg-muted/80'
            )}
            onClick={(e) => {
              e.preventDefault();
              router.push('/decklist/card-search/random');
            }}
            title="I'm feeling lucky"
          >
            🎲
          </button>
        </div>
      </div>
      {/* Brigades */}
      <div>
        <p className="text-muted-foreground uppercase mb-1 text-sm">Good Brigades</p>
        <div className="flex flex-wrap gap-2 mb-2 justify-start">
          {goodBrigadeIcons.map((icon) => (
            <img
              key={icon}
              src={`/filter-icons/Color=${encodeURIComponent(icon)}.png`}
              alt={icon}
              className={clsx(
                "h-10 w-10 sm:h-8 sm:w-auto cursor-pointer",
                selectedIconFilters.some(f => f.icon === icon) && "ring-2 ring-primary"
              )}
              onClick={() => toggleIconFilter(icon)}
              style={{ minWidth: 32, minHeight: 32 }}
            />
          ))}
        </div>
        <p className="text-muted-foreground uppercase mb-1 text-sm">Evil Brigades</p>
        <div className="flex flex-wrap gap-2 justify-start">
          {evilBrigadeIcons.map((icon) => (
            <img
              key={icon}
              src={`/filter-icons/Color=${encodeURIComponent(icon)}.png`}
              alt={icon}
              className={clsx(
                "h-10 w-10 sm:h-8 sm:w-auto cursor-pointer",
                selectedIconFilters.some(f => f.icon === icon) && "ring-2 ring-primary"
              )}
              onClick={() => toggleIconFilter(icon)}
              style={{ minWidth: 32, minHeight: 32 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
