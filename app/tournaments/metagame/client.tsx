"use client";

import { useMemo, useState } from "react";
import type { TournamentBreakdown } from "@/lib/tournament/breakdown";
import { cutIndexesByEvent, rankedDeckCount } from "@/lib/tournament/topCut";
import { deriveCards } from "@/lib/tournament/derive";
import StatStrip from "@/components/metagame/StatStrip";
import CardFrequencyTable from "@/components/metagame/CardFrequencyTable";
import StaplesScatter from "@/components/metagame/StaplesScatter";
import DistributionPanels from "@/components/metagame/DistributionPanels";
import DeckDna from "@/components/metagame/DeckDna";
import { CROSS_EVENT_CUTS } from "@/components/metagame/TopCutControl";

type ViewKey = "cards" | "meta" | "decks";

const VIEWS: { key: ViewKey; label: string; blurb: string }[] = [
  { key: "cards", label: "Cards", blurb: "What the format plays" },
  { key: "meta", label: "Performance", blurb: "What the winning decks played differently" },
  { key: "decks", label: "Decks", blurb: "How the lists relate to each other" },
];

/**
 * The pooled view. Identical to the single-event breakdown but for the cut:
 * across events it is drawn inside each field and then pooled, so a small
 * event's leaderboard cannot outweigh a large one's. See `cutIndexesByEvent`.
 */
export default function MetagameClient({
  breakdown,
  fieldSize,
}: {
  breakdown: TournamentBreakdown;
  fieldSize: number;
}) {
  const [view, setView] = useState<ViewKey>("cards");
  const [topCut, setTopCut] = useState<number>(0.25);

  const cutSet = useMemo(
    () => cutIndexesByEvent(breakdown.decks, topCut),
    [breakdown.decks, topCut],
  );
  const rankedCount = useMemo(() => rankedDeckCount(breakdown.decks), [breakdown.decks]);

  const cards = useMemo(
    () => deriveCards(breakdown.cards, breakdown.deckCount, cutSet),
    [breakdown.cards, breakdown.deckCount, cutSet],
  );

  return (
    <div className="space-y-8">
      <StatStrip breakdown={breakdown} fieldSize={fieldSize} />

      <div>
        <div
          role="tablist"
          aria-label="Metagame views"
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
          rankedDeckCount={rankedCount}
          cutOptions={CROSS_EVENT_CUTS}
          perEventCut
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
            rankedDeckCount={rankedCount}
            cutOptions={CROSS_EVENT_CUTS}
            perEventCut
          />
          <DistributionPanels breakdown={breakdown} cards={cards} />
        </div>
      )}

      {view === "decks" && <DeckDna breakdown={breakdown} />}
    </div>
  );
}
