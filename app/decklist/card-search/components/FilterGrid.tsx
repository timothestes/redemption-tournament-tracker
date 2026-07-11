"use client";
import React from "react";
import clsx from "clsx";
import type { AltArtMode } from "../stickyFilters";

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
  altArtMode: AltArtMode;
  setAltArtMode: (mode: AltArtMode) => void;
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
  altArtMode,
  setAltArtMode,
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
  // Quick icon filters for type-based icons (reordered) and color-coded brigades
  const typeIcons: Array<{ id: string; label: string }> = [
    { id: "Good Dominant", label: "G Dom" },
    { id: "Evil Dominant", label: "E Dom" },
    { id: "Artifact", label: "Artifact" },
    { id: "Covenant", label: "Covenant" },
    { id: "Curse", label: "Curse" },
    { id: "Good Fortress", label: "G Fort" },
    { id: "Evil Fortress", label: "E Fort" },
    { id: "Hero", label: "Hero" },
    { id: "Evil Character", label: "EC" },
    { id: "GE", label: "GE" },
    { id: "EE", label: "EE" },
    { id: "Lost Soul", label: "Lost Soul" },
    { id: "Territory-Class", label: "Territory" },
    { id: "Site", label: "Site" },
    { id: "City", label: "City" },
    { id: "Warrior-Class", label: "Warrior" },
    { id: "Weapon-Class", label: "Weapon" },
  ];

  // Grouped color icons by brigade alignment
  const goodBrigadeIcons: Array<{ id: string; label: string }> = [
    { id: "Blue", label: "Blue" },
    { id: "Clay", label: "Clay" },
    { id: "Good Gold", label: "Gold" },
    { id: "Green", label: "Green" },
    { id: "Purple", label: "Purple" },
    { id: "Silver", label: "Silver" },
    { id: "White", label: "White" },
    { id: "Red", label: "Red" },
    { id: "Teal", label: "Teal" },
    { id: "Good Multi", label: "Multi" },
  ];
  const evilBrigadeIcons: Array<{ id: string; label: string }> = [
    { id: "Black", label: "Black" },
    { id: "Brown", label: "Brown" },
    { id: "Crimson", label: "Crimson" },
    { id: "Evil Gold", label: "Gold" },
    { id: "Gray", label: "Gray" },
    { id: "Orange", label: "Orange" },
    { id: "Pale Green", label: "Pale Grn" },
    { id: "Evil Multi", label: "Multi" },
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
                  'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                  'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                  'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
            className="text-muted-foreground uppercase text-xs font-medium cursor-help"
            title="Controls how multiple icon filters combine: Click button to cycle through modes"
          >
            Icon Mode
          </span>
          <button
            className={clsx(
              'px-2 py-1 border rounded text-xs font-semibold transition',
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
          <button
            className={clsx(
              'px-2 py-1 border text-xs font-semibold transition-colors rounded',
              advancedOpen
                ? 'bg-primary/15 text-primary border-primary/40'
                : 'bg-muted text-foreground border-border hover:bg-muted/80'
            )}
            aria-expanded={advancedOpen}
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
        <div className="p-3 border border-primary/30 rounded bg-primary/[0.03] flex flex-col gap-2">
          <section className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <span className="text-muted-foreground uppercase text-xs font-medium shrink-0 sm:w-[88px]">Testament</span>
          <div className="flex flex-wrap gap-1">
            {['OT','NT'].map((t) => {
              const isActive = selectedTestaments.includes(t);
              const isNot = testamentNots[t] || false;
              return (
                <button
                  key={t}
                  className={clsx(
                    'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
          </section>
          {/* Strength and Toughness Filters */}
          <section className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
            <span className="text-muted-foreground uppercase text-xs font-medium shrink-0 sm:w-[88px]">Stats</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-foreground">Strength</span>
                <select
                  value={strengthOp}
                  onChange={e => setStrengthOp(e.target.value)}
                  className="border rounded px-1.5 py-0.5 bg-muted text-foreground border-border text-xs focus:outline-none"
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
                  className="border rounded px-1.5 py-0.5 bg-muted text-foreground border-border text-xs focus:outline-none"
                >
                  <option value="">Any</option>
                  {[...Array(14).keys()].map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-foreground">Toughness</span>
                <select
                  value={toughnessOp}
                  onChange={e => setToughnessOp(e.target.value)}
                  className="border rounded px-1.5 py-0.5 bg-muted text-foreground border-border text-xs focus:outline-none"
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
                  className="border rounded px-1.5 py-0.5 bg-muted text-foreground border-border text-xs focus:outline-none"
                >
                  <option value="">Any</option>
                  {[...Array(14).keys()].map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
          <section className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <span className="text-muted-foreground uppercase text-xs font-medium shrink-0 sm:w-[88px]">Misc</span>
          <div className="flex flex-wrap gap-1">
            <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label="AB versions">
              {([
                ['hide', 'Hide AB', 'Hide all AB (alternate-art) versions'],
                ['all', 'Show AB', 'Show AB versions alongside the standard printings'],
                ['prefer', 'Prefer AB', 'Show the AB version of any card that has one; standard printing otherwise'],
              ] as const).map(([mode, label, title], i) => (
                <button
                  key={mode}
                  type="button"
                  title={title}
                  aria-pressed={altArtMode === mode}
                  className={clsx(
                    'px-2 py-1 text-xs font-semibold transition-colors duration-150',
                    i > 0 && 'border-l border-border',
                    altArtMode === mode
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  )}
                  onClick={() => setAltArtMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className={clsx(
                'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
                'px-2 py-1 border rounded text-xs font-semibold transition-colors duration-150',
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
          </section>
        </div>
      )}

      {/* Divider between text and icon bands */}
      <div className="h-px bg-border" />

      {/* Band 2: Icon filters — section labels on the left (matching Band 1) so each row is one line on desktop.
          Tiles are compact: small icon + small label, unified active state. */}
      <div className="flex flex-col gap-1.5">
        {/* Types */}
        <section className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <span className="text-muted-foreground uppercase text-xs font-medium shrink-0 sm:w-[88px]">Types</span>
          <div className="flex flex-wrap gap-1">
            {typeIcons.map((t) => {
              const isActive = selectedIconFilters.some(f => f.icon === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleIconFilter(t.id)}
                  aria-pressed={isActive}
                  title={t.id}
                  className={clsx(
                    'flex flex-col items-center justify-end gap-0.5 px-1.5 sm:px-1 py-1 sm:py-0.5 rounded border transition-colors w-[56px] sm:w-[44px]',
                    isActive
                      ? 'bg-primary/15 border-primary/40'
                      : 'bg-muted/40 border-transparent hover:bg-muted hover:border-border'
                  )}
                >
                  <img
                    src={`/filter-icons/${encodeURIComponent(t.id)}.png`}
                    alt=""
                    aria-hidden="true"
                    className="h-8 sm:h-6 w-auto"
                  />
                  <span className={clsx(
                    'text-[10px] sm:text-[9px] font-medium leading-none whitespace-nowrap',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        {/* Good Brigades */}
        <section className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <span className="text-muted-foreground uppercase text-xs font-medium shrink-0 sm:w-[88px]">Good Brig.</span>
          <div className="flex flex-wrap gap-1">
            {goodBrigadeIcons.map((b) => {
              const isActive = selectedIconFilters.some(f => f.icon === b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => toggleIconFilter(b.id)}
                  aria-pressed={isActive}
                  title={b.id}
                  className={clsx(
                    'flex flex-col items-center justify-end gap-0.5 px-1.5 sm:px-1 py-1 sm:py-0.5 rounded border transition-colors w-[56px] sm:w-[44px]',
                    isActive
                      ? 'bg-primary/15 border-primary/40'
                      : 'bg-muted/40 border-transparent hover:bg-muted hover:border-border'
                  )}
                >
                  <img
                    src={`/filter-icons/Color=${encodeURIComponent(b.id)}.png`}
                    alt=""
                    aria-hidden="true"
                    className="h-8 sm:h-6 w-auto"
                  />
                  <span className={clsx(
                    'text-[10px] sm:text-[9px] font-medium leading-none whitespace-nowrap',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}>
                    {b.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        {/* Evil Brigades */}
        <section className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <span className="text-muted-foreground uppercase text-xs font-medium shrink-0 sm:w-[88px]">Evil Brig.</span>
          <div className="flex flex-wrap gap-1">
            {evilBrigadeIcons.map((b) => {
              const isActive = selectedIconFilters.some(f => f.icon === b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => toggleIconFilter(b.id)}
                  aria-pressed={isActive}
                  title={b.id}
                  className={clsx(
                    'flex flex-col items-center justify-end gap-0.5 px-1.5 sm:px-1 py-1 sm:py-0.5 rounded border transition-colors w-[56px] sm:w-[44px]',
                    isActive
                      ? 'bg-primary/15 border-primary/40'
                      : 'bg-muted/40 border-transparent hover:bg-muted hover:border-border'
                  )}
                >
                  <img
                    src={`/filter-icons/Color=${encodeURIComponent(b.id)}.png`}
                    alt=""
                    aria-hidden="true"
                    className="h-8 sm:h-6 w-auto"
                  />
                  <span className={clsx(
                    'text-[10px] sm:text-[9px] font-medium leading-none whitespace-nowrap',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}>
                    {b.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
