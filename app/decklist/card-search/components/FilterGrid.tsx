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
    <div className="flex flex-col gap-2 md:gap-3 mb-4 text-foreground p-3 md:p-4">
      {/* Band 1: Quick text filters — stacked on mobile, inline on desktop */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-1.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-1.5">
          <span className="text-muted-foreground uppercase text-xs font-medium shrink-0">Legality</span>
          <div className="flex flex-wrap gap-1">
            {['Rotation','Classic','Banned','Scrolls','Paragon'].map((mode) => (
              <button
                key={mode}
                className={clsx(
                  'px-2 py-0.5 md:px-3 md:py-1.5 border rounded text-sm font-semibold transition-colors duration-150',
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
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-1.5">
          <span className="text-muted-foreground uppercase text-xs font-medium shrink-0">Alignment</span>
          <div className="flex flex-wrap gap-1">
            {['Good','Evil','Neutral'].map((mode) => (
              <button
                key={mode}
                className={clsx(
                  'px-2 py-0.5 md:px-3 md:py-1.5 border rounded text-sm font-semibold transition-colors duration-150',
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
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-1.5">
          <span className="text-muted-foreground uppercase text-xs font-medium shrink-0">Rarity</span>
          <div className="flex flex-wrap gap-1">
            {['Common','Promo','Rare','Ultra Rare'].map((rarity) => (
              <button
                key={rarity}
                className={clsx(
                  'px-2 py-0.5 md:px-3 md:py-1.5 border rounded text-sm font-semibold transition-colors duration-150',
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
        </div>
        {/* Utility controls — inline with text filter rows */}
        <div className="flex items-center gap-2">
          <span
            className="text-muted-foreground text-sm cursor-help"
            title="Controls how multiple icon filters combine: Click button to cycle through modes"
          >
            Icon Filter Mode:
          </span>
          <button
            className={clsx(
              'px-2 py-0.5 md:px-2 md:py-1.5 border rounded text-sm font-semibold transition',
              'bg-muted text-foreground border-border hover:bg-muted/80'
            )}
            onClick={(e) => {
              e.preventDefault();
              let newMode: 'AND' | 'OR' | 'AND NOT';
              if (iconFilterMode === 'AND') {
                newMode = 'OR';
              } else if (iconFilterMode === 'OR') {
                newMode = 'AND NOT';
              } else {
                newMode = 'AND';
              }
              setIconFilterMode(newMode);
              updateAllIconFilterOperators(newMode);
            }}
            title="Click to cycle: AND → OR → AND NOT (applies to all active filters)"
          >
            {iconFilterMode}
          </button>
          <span className="text-border select-none">|</span>
          <button
            className={clsx(
              'px-2 py-0.5 md:px-2 md:py-1.5 border rounded text-sm transition hover:bg-muted/80',
              'bg-muted text-foreground border-border'
            )}
            onClick={(e) => {
              e.preventDefault();
              router.push('/decklist/card-search/random');
            }}
            title="I'm feeling lucky"
          >
            🎲
          </button>
          <button
            className={clsx(
              'px-2.5 py-0.5 md:px-3 md:py-1.5 border text-sm font-semibold transition-colors',
              advancedOpen
                ? 'bg-destructive text-destructive-foreground border-destructive rounded rounded-b-none'
                : 'bg-muted text-foreground border-border rounded hover:bg-muted/80'
            )}
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            Advanced Filters
            <svg
              className={clsx(
                'inline-block ml-1.5 w-3 h-3 transition-transform duration-200',
                advancedOpen && 'rotate-180'
              )}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 4l4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Advanced Filters panel — full width when open */}
      {advancedOpen && (
        <div className="p-2 border border-destructive rounded rounded-tl-none space-y-2">
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
                    if (!isActive) {
                      setSelectedTestaments(prev => [...prev, t]);
                      setTestamentNots(prev => ({ ...prev, [t]: false }));
                    } else if (isActive && !isNot) {
                      setTestamentNots(prev => ({ ...prev, [t]: true }));
                    } else {
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
                if (!isGospel) {
                  setIsGospel(true);
                  setGospelNot(false);
                } else if (isGospel && !gospelNot) {
                  setGospelNot(true);
                } else {
                  setIsGospel(false);
                  setGospelNot(false);
                }
              }}
              title="Click to cycle: Include → Exclude → Off"
            >
              {gospelNot ? 'NOT ' : ''}Gospel
            </button>
          </div>
          {/* Strength and Toughness Filters */}
          <div className="flex flex-wrap gap-4 mb-2 items-start">
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
                if (!nativityOnly) {
                  setNativityOnly(true);
                  setNativityNot(false);
                } else if (nativityOnly && !nativityNot) {
                  setNativityNot(true);
                } else {
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
                if (!hasStarOnly) {
                  setHasStarOnly(true);
                  setHasStarNot(false);
                } else if (hasStarOnly && !hasStarNot) {
                  setHasStarNot(true);
                } else {
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
                if (!cloudOnly) {
                  setCloudOnly(true);
                  setCloudNot(false);
                } else if (cloudOnly && !cloudNot) {
                  setCloudNot(true);
                } else {
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
                if (!angelOnly) {
                  setAngelOnly(true);
                  setAngelNot(false);
                } else if (angelOnly && !angelNot) {
                  setAngelNot(true);
                } else {
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
                if (!demonOnly) {
                  setDemonOnly(true);
                  setDemonNot(false);
                } else if (demonOnly && !demonNot) {
                  setDemonNot(true);
                } else {
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
                if (!danielOnly) {
                  setDanielOnly(true);
                  setDanielNot(false);
                } else if (danielOnly && !danielNot) {
                  setDanielNot(true);
                } else {
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
                if (!postexilicOnly) {
                  setPostexilicOnly(true);
                  setPostexilicNot(false);
                } else if (postexilicOnly && !postexilicNot) {
                  setPostexilicNot(true);
                } else {
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

      {/* Divider between text and icon bands */}
      <div className="h-px bg-border" />

      {/* Band 2: Icon filters — full width, types + brigades */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        {/* Types */}
        <div>
          <p className="text-muted-foreground uppercase mb-1 text-xs font-medium">Types</p>
          <div className="flex flex-wrap gap-1">
            {typeIcons.map((t) => {
              const src = `/filter-icons/${encodeURIComponent(t)}.png`;
              return (
                <img
                  key={t}
                  src={src}
                  alt={t}
                  className={clsx(
                    'h-8 w-auto md:h-10 cursor-pointer rounded transition-transform duration-150',
                    selectedIconFilters.some(f => f.icon === t)
                      ? 'ring-2 ring-blue-400 scale-110'
                      : 'opacity-80 hover:opacity-100'
                  )}
                  onClick={() => toggleIconFilter(t)}
                  style={{ minWidth: 28, minHeight: 28 }}
                />
              );
            })}
          </div>
        </div>
        {/* Good Brigades */}
        <div>
          <p className="text-muted-foreground uppercase mb-1 text-xs font-medium">Good Brigades</p>
          <div className="flex flex-wrap gap-1">
            {goodBrigadeIcons.map((icon) => (
              <img
                key={icon}
                src={`/filter-icons/Color=${encodeURIComponent(icon)}.png`}
                alt={icon}
                className={clsx(
                  "h-8 w-auto md:h-9 cursor-pointer rounded-md transition-transform duration-150",
                  selectedIconFilters.some(f => f.icon === icon)
                    ? "ring-2 ring-blue-400 scale-110"
                    : "opacity-80 hover:opacity-100"
                )}
                onClick={() => toggleIconFilter(icon)}
                style={{ minWidth: 28, minHeight: 28 }}
              />
            ))}
          </div>
        </div>
        {/* Evil Brigades */}
        <div>
          <p className="text-muted-foreground uppercase mb-1 text-xs font-medium">Evil Brigades</p>
          <div className="flex flex-wrap gap-1">
            {evilBrigadeIcons.map((icon) => (
              <img
                key={icon}
                src={`/filter-icons/Color=${encodeURIComponent(icon)}.png`}
                alt={icon}
                className={clsx(
                  "h-8 w-auto md:h-9 cursor-pointer rounded-md transition-transform duration-150",
                  selectedIconFilters.some(f => f.icon === icon)
                    ? "ring-2 ring-blue-400 scale-110"
                    : "opacity-80 hover:opacity-100"
                )}
                onClick={() => toggleIconFilter(icon)}
                style={{ minWidth: 28, minHeight: 28 }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
