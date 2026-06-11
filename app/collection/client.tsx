"use client";

import React, { useMemo, useState } from "react";
import { ALL_CARDS, CARD_BY_FULL_KEY } from "../decklist/card-search/data/cardIndex";
import { categorizeRarity, type Card } from "../decklist/card-search/utils";
import { GOOD_BRIGADES, EVIL_BRIGADES } from "../decklist/card-search/constants";
import CardImage from "../decklist/card-search/components/CardImage";
import { useCardPrices } from "../decklist/card-search/hooks/useCardPrices";
import { useCollectionState, cardFullKey } from "./hooks/useCollectionState";
import { downloadCollectionCsv } from "./utils/collectionCsv";
import ImportCsvModal from "./components/ImportCsvModal";

const BATCH_SIZE = 60;
const RARITY_OPTIONS = ["Common", "Rare", "Ultra Rare", "Promo"];
const ALIGNMENT_OPTIONS = ["Good", "Evil", "Neutral"];

const SET_OPTIONS: string[] = Array.from(
  new Set(ALL_CARDS.map((c) => c.officialSet).filter(Boolean))
).sort();

const TYPE_OPTIONS: string[] = Array.from(
  new Set(ALL_CARDS.map((c) => c.type).filter(Boolean))
).sort();

export default function CollectionClient() {
  const {
    quantities,
    isLoading,
    isSaving,
    syncError,
    setQuantity,
    adjustQuantity,
    importRows,
    clearCollection,
  } = useCollectionState();

  const [search, setSearch] = useState("");
  const [setFilter, setSetFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [brigadeFilter, setBrigadeFilter] = useState("");
  const [alignmentFilter, setAlignmentFilter] = useState("");
  const [rarityFilter, setRarityFilter] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [showPrices, setShowPrices] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("collection-show-prices") === "1"
  );
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const [modalCard, setModalCard] = useState<Card | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showSetStats, setShowSetStats] = useState(false);

  const { getPrice } = useCardPrices();

  const toggleShowPrices = (checked: boolean) => {
    setShowPrices(checked);
    localStorage.setItem("collection-show-prices", checked ? "1" : "0");
  };

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ALL_CARDS.filter((card) => {
      if (ownedOnly && !quantities.has(cardFullKey(card))) return false;
      if (setFilter && card.officialSet !== setFilter) return false;
      if (typeFilter && card.type !== typeFilter) return false;
      if (alignmentFilter && card.alignment !== alignmentFilter) return false;
      if (brigadeFilter && !card.brigade.split("/").includes(brigadeFilter)) return false;
      if (rarityFilter && categorizeRarity(card.rarity, card.officialSet) !== rarityFilter)
        return false;
      if (q) {
        const haystack =
          `${card.name} ${card.specialAbility} ${card.identifier}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name) || a.set.localeCompare(b.set));
  }, [search, setFilter, typeFilter, brigadeFilter, alignmentFilter, rarityFilter, ownedOnly, quantities]);

  // Reset pagination whenever the filter result changes identity
  const filterKey = `${search}|${setFilter}|${typeFilter}|${brigadeFilter}|${alignmentFilter}|${rarityFilter}|${ownedOnly}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setVisibleCount(BATCH_SIZE);
  }

  const stats = useMemo(() => {
    let totalCopies = 0;
    for (const qty of quantities.values()) totalCopies += qty;
    return { uniqueOwned: quantities.size, totalCopies };
  }, [quantities]);

  const collectionValue = useMemo(() => {
    if (!showPrices) return null;
    let total = 0;
    let unpriced = 0;
    for (const [key, qty] of quantities) {
      const info = getPrice(key);
      if (info) total += info.price * qty;
      else unpriced += qty;
    }
    return { total, unpriced };
  }, [showPrices, quantities, getPrice]);

  const setCompletion = useMemo(() => {
    const totals = new Map<string, number>();
    const owned = new Map<string, number>();
    for (const card of ALL_CARDS) {
      if (!card.officialSet) continue;
      totals.set(card.officialSet, (totals.get(card.officialSet) || 0) + 1);
      if (quantities.has(cardFullKey(card))) {
        owned.set(card.officialSet, (owned.get(card.officialSet) || 0) + 1);
      }
    }
    return Array.from(totals.entries())
      .map(([set, total]) => ({ set, total, owned: owned.get(set) || 0 }))
      .sort((a, b) => b.owned / b.total - a.owned / a.total || a.set.localeCompare(b.set));
  }, [quantities]);

  const ownedEntries = useMemo(() => {
    const entries: { card: Card; quantity: number }[] = [];
    for (const [key, quantity] of quantities) {
      const card = CARD_BY_FULL_KEY.get(key);
      if (card) {
        entries.push({ card, quantity });
      } else {
        // Card no longer in the catalog — preserve it on export anyway
        const [name, set, imgFile] = key.split("|");
        entries.push({ card: { name, set, imgFile } as Card, quantity });
      }
    }
    return entries;
  }, [quantities]);

  const visibleCards = filteredCards.slice(0, visibleCount);

  return (
    <div className="w-full max-w-screen-2xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <h1 className="text-2xl font-bold">My Collection</h1>
        <span className="text-sm text-muted-foreground">
          {stats.uniqueOwned.toLocaleString()} unique ·{" "}
          {stats.totalCopies.toLocaleString()} total cards
        </span>
        {collectionValue && (
          <span
            className="text-sm font-medium text-green-600 dark:text-green-400"
            title={
              collectionValue.unpriced > 0
                ? `${collectionValue.unpriced.toLocaleString()} cop${collectionValue.unpriced === 1 ? "y" : "ies"} have no YTG price and aren't counted`
                : undefined
            }
          >
            ≈ ${collectionValue.total.toFixed(2)} YTG value
            {collectionValue.unpriced > 0 && "*"}
          </span>
        )}
        <span className="text-xs text-muted-foreground min-w-[80px]">
          {isSaving ? "Saving…" : syncError ? (
            <span className="text-red-600 dark:text-red-400">{syncError}</span>
          ) : null}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setShowSetStats((v) => !v)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
          >
            Set completion
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
          >
            Import CSV
          </button>
          <button
            onClick={() => downloadCollectionCsv(ownedEntries)}
            disabled={ownedEntries.length === 0}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={ownedEntries.length === 0}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted text-red-600 dark:text-red-400 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Set completion panel */}
      {showSetStats && (
        <div className="mb-4 rounded-lg border border-border p-3 sm:p-4">
          <h2 className="text-sm font-semibold mb-2">Set completion (unique cards)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 max-h-72 overflow-y-auto">
            {setCompletion.map(({ set, owned, total }) => (
              <div key={set} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate" title={set}>{set}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {owned}/{total}
                </span>
                <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.round((owned / total) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, ability, identifier…"
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <select
          value={setFilter}
          onChange={(e) => setSetFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">All sets</option>
          {SET_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={brigadeFilter}
          onChange={(e) => setBrigadeFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">All brigades</option>
          <optgroup label="Good">
            {GOOD_BRIGADES.map((b: string) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </optgroup>
          <optgroup label="Evil">
            {EVIL_BRIGADES.map((b: string) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </optgroup>
        </select>
        <select
          value={alignmentFilter}
          onChange={(e) => setAlignmentFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">All alignments</option>
          {ALIGNMENT_OPTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={rarityFilter}
          onChange={(e) => setRarityFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">All rarities</option>
          {RARITY_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm px-2 py-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ownedOnly}
            onChange={(e) => setOwnedOnly(e.target.checked)}
          />
          Owned only
        </label>
        <label className="flex items-center gap-1.5 text-sm px-2 py-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showPrices}
            onChange={(e) => toggleShowPrices(e.target.checked)}
          />
          Show prices
        </label>
      </div>

      {/* Result count */}
      <p className="text-xs text-muted-foreground mb-3">
        {isLoading
          ? "Loading your collection…"
          : `${filteredCards.length.toLocaleString()} card${filteredCards.length === 1 ? "" : "s"}`}
      </p>

      {/* Empty states */}
      {!isLoading && ownedOnly && filteredCards.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="mb-2 font-medium">No owned cards match these filters.</p>
          <p className="text-sm">
            Turn off “Owned only” to browse all cards and tap <span className="font-semibold">Add</span> to
            start tracking your collection.
          </p>
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {visibleCards.map((card) => {
          const qty = quantities.get(cardFullKey(card)) || 0;
          return (
            <div
              key={card.dataLine}
              className={`rounded-lg border p-1.5 flex flex-col gap-1.5 ${
                qty > 0 ? "border-primary/60" : "border-border"
              }`}
            >
              <div className="relative cursor-pointer" onClick={() => setModalCard(card)}>
                <CardImage
                  imgFile={card.imgFile}
                  alt={card.name}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
                />
                {qty > 0 && (
                  <span className="absolute top-1 right-1 min-w-[1.5rem] text-center px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow">
                    ×{qty}
                  </span>
                )}
              </div>
              <div className="px-0.5">
                <p className="text-xs font-medium truncate" title={card.name}>
                  {card.name}
                </p>
                <div className="flex items-baseline justify-between gap-1">
                  <p className="text-[10px] text-muted-foreground truncate">
                    {card.officialSet || card.set}
                  </p>
                  {showPrices && (
                    <span className="text-[10px] tabular-nums shrink-0 text-green-600 dark:text-green-400">
                      {(() => {
                        const info = getPrice(cardFullKey(card));
                        return info ? `$${info.price.toFixed(2)}` : "—";
                      })()}
                    </span>
                  )}
                </div>
              </div>
              {qty === 0 ? (
                <button
                  onClick={() => setQuantity(card, 1)}
                  className="w-full py-1.5 text-sm font-medium border border-border rounded-md hover:bg-muted"
                >
                  + Add
                </button>
              ) : (
                <div className="flex items-stretch gap-1">
                  <button
                    onClick={() => adjustQuantity(card, -1)}
                    className="flex-1 py-1.5 text-sm border border-border rounded-md hover:bg-muted"
                    aria-label={`Remove one ${card.name}`}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    value={qty}
                    onChange={(e) => setQuantity(card, parseInt(e.target.value, 10) || 0)}
                    className="w-12 text-center text-sm rounded-md border border-border bg-background [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    aria-label={`${card.name} quantity`}
                  />
                  <button
                    onClick={() => adjustQuantity(card, 1)}
                    className="flex-1 py-1.5 text-sm border border-border rounded-md hover:bg-muted"
                    aria-label={`Add one ${card.name}`}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Load more */}
      {visibleCount < filteredCards.length && (
        <div className="text-center mt-6">
          <button
            onClick={() => setVisibleCount((c) => c + BATCH_SIZE)}
            className="px-6 py-2 border border-border rounded-lg hover:bg-muted text-sm font-medium"
          >
            Show more ({(filteredCards.length - visibleCount).toLocaleString()} remaining)
          </button>
        </div>
      )}

      {/* Card detail modal */}
      {modalCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setModalCard(null)}
        >
          <div
            className="w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <CardImage imgFile={modalCard.imgFile} alt={modalCard.name} sizes="384px" priority />
            <div className="mt-2 flex items-center justify-between gap-2 bg-background border border-border rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{modalCard.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {modalCard.officialSet || modalCard.set}
                  {showPrices && (() => {
                    const info = getPrice(cardFullKey(modalCard));
                    return info ? (
                      <span className="text-green-600 dark:text-green-400"> · ${info.price.toFixed(2)}</span>
                    ) : null;
                  })()}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => adjustQuantity(modalCard, -1)}
                  className="w-9 h-9 text-base border border-border rounded-md hover:bg-muted"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums">
                  {quantities.get(cardFullKey(modalCard)) || 0}
                </span>
                <button
                  onClick={() => adjustQuantity(modalCard, 1)}
                  className="w-9 h-9 text-base border border-border rounded-md hover:bg-muted"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <ImportCsvModal
          allCards={ALL_CARDS}
          onClose={() => setShowImport(false)}
          onImport={importRows}
        />
      )}

      {/* Clear confirm */}
      {showClearConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            className="bg-background border border-border rounded-xl w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-2">Clear collection?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              This removes all {stats.uniqueOwned.toLocaleString()} cards from your
              collection. Consider exporting a CSV first — this cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await clearCollection();
                  setShowClearConfirm(false);
                }}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Clear everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
