"use client";

import { useMemo, useState } from "react";
import type { TournamentBreakdown } from "@/lib/tournament/breakdown";
import { topCutSize } from "@/lib/tournament/topCut";
import StatStrip from "./StatStrip";
import CardFrequencyTable from "./CardFrequencyTable";
import StaplesScatter from "./StaplesScatter";
import DistributionPanels from "./DistributionPanels";
import DeckDna from "./DeckDna";

export type ViewKey = "cards" | "meta" | "decks";

const VIEWS: { key: ViewKey; label: string; blurb: string }[] = [
  { key: "cards", label: "Cards", blurb: "What the field played" },
  { key: "meta", label: "Metagame", blurb: "What separated the top tables" },
  { key: "decks", label: "Decks", blurb: "How the lists relate to each other" },
];

/**
 * A card's identity plus the figures every view needs, computed once.
 *
 * `topCutDecks` is the only figure that moves with the cut control, so it lives
 * here and is recomputed when that changes rather than being shipped per cut.
 */
export interface DerivedCard {
  key: string;
  name: string;
  type: string;
  brigade: string;
  alignment: string;
  imgFile: string;
  decks: number;
  fieldRate: number;
  copies: number;
  mainCopies: number;
  reserveCopies: number;
  reserveDecks: number;
  printings: string[];
  deckIndexes: number[];
  topCutDecks: number;
  topCutRate: number;
  /** Top-cut rate minus field rate, in points. Positive = over-represented. */
  delta: number;
}

export default function BreakdownClient({
  breakdown,
  fieldSize,
}: {
  breakdown: TournamentBreakdown;
  fieldSize: number;
}) {
  const [view, setView] = useState<ViewKey>("cards");
  const [topCut, setTopCut] = useState<number>(8);

  // Decks that actually carry a placement — a deck with no recorded finish can
  // never be "in the cut", and counting it would deflate every cut rate.
  const rankedDeckIndexes = useMemo(() => {
    return breakdown.decks
      .map((deck, index) => ({ place: deck.place, index }))
      .filter((d): d is { place: number; index: number } => typeof d.place === "number")
      .sort((a, b) => a.place - b.place)
      .map((d) => d.index);
  }, [breakdown.decks]);

  const cutSize = topCutSize(rankedDeckIndexes.length, topCut);
  const cutSet = useMemo(
    () => new Set(rankedDeckIndexes.slice(0, cutSize)),
    [rankedDeckIndexes, cutSize],
  );

  const cards: DerivedCard[] = useMemo(() => {
    return breakdown.cards.map((card) => {
      let topCutDecks = 0;
      for (const deckIndex of card.deckIndexes) if (cutSet.has(deckIndex)) topCutDecks += 1;
      const fieldRate = breakdown.deckCount === 0 ? 0 : card.deckIndexes.length / breakdown.deckCount;
      const topCutRate = cutSet.size === 0 ? 0 : topCutDecks / cutSet.size;
      return {
        key: card.key,
        name: card.name,
        type: card.type,
        brigade: card.brigade,
        alignment: card.alignment,
        imgFile: card.imgFile,
        decks: card.deckIndexes.length,
        fieldRate,
        copies: card.copies,
        mainCopies: card.mainCopies,
        reserveCopies: card.reserveCopies,
        reserveDecks: card.reserveDecks,
        printings: card.printings,
        deckIndexes: card.deckIndexes,
        topCutDecks,
        topCutRate,
        delta: topCutRate - fieldRate,
      };
    });
  }, [breakdown.cards, breakdown.deckCount, cutSet]);

  return (
    <div className="space-y-8">
      <StatStrip breakdown={breakdown} fieldSize={fieldSize} />

      <div>
        <div
          role="tablist"
          aria-label="Breakdown views"
          className="flex w-full gap-1 rounded-lg bg-muted/50 p-1"
        >
          {VIEWS.map((entry) => {
            const isActive = entry.key === view;
            return (
              <button
                key={entry.key}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => setView(entry.key)}
                className={`flex-1 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-card font-semibold text-foreground shadow-sm"
                    : "font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          {VIEWS.find((v) => v.key === view)?.blurb}
        </p>
      </div>

      {view === "cards" && (
        <CardFrequencyTable
          cards={cards}
          deckCount={breakdown.deckCount}
          decks={breakdown.decks}
          cutSize={cutSet.size}
          topCut={topCut}
          onTopCutChange={setTopCut}
          rankedDeckCount={rankedDeckIndexes.length}
        />
      )}

      {view === "meta" && (
        <div className="space-y-8">
          <StaplesScatter
            cards={cards}
            deckCount={breakdown.deckCount}
            cutSize={cutSet.size}
            topCut={topCut}
            onTopCutChange={setTopCut}
            rankedDeckCount={rankedDeckIndexes.length}
          />
          <DistributionPanels breakdown={breakdown} cards={cards} />
        </div>
      )}

      {view === "decks" && <DeckDna breakdown={breakdown} />}
    </div>
  );
}
