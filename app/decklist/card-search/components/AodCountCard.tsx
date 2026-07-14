"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "framer-motion";
import { GiLion } from "react-icons/gi";
import { Deck } from "../types/deck";
import { generateDeckText } from "../utils/deckImportExport";

interface AodCountCardProps {
  deck: Deck;
  deckType: "T1" | "T2" | "Paragon";
}

type Status = "idle" | "loading" | "done" | "error";

const DECKLIST_TYPE: Record<AodCountCardProps["deckType"], string> = {
  T1: "type_1",
  T2: "type_2",
  Paragon: "paragon",
};

const AOD_TOOLTIP =
  "Top-9 draw stats over a 10,000-iteration Monte Carlo. Non-Soul: avg non-soul " +
  "Daniel cards in the top 9. Soul: avg Daniel Lost Souls (they trigger the chain " +
  "but don't add to the count). Whiff: % of draws with no Daniel in the top 3.";

// One labeled figure within the revealed breakdown row.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wide opacity-70 leading-tight truncate">
        {label}
      </div>
    </div>
  );
}

export default function AodCountCard({ deck, deckType }: AodCountCardProps) {
  const [status, setStatus] = useState<Status>("idle");
  // Animated display values for the three breakdown figures.
  const [nonSoul, setNonSoul] = useState(0);
  const [soul, setSoul] = useState(0);
  const [whiff, setWhiff] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // Number of cards in the main deck — the endpoint returns 0 when < 9.
  const mainDeckCount = useMemo(
    () =>
      deck.cards
        .filter((dc) => dc.zone === "main")
        .reduce((sum, dc) => sum + dc.quantity, 0),
    [deck.cards]
  );

  // Signature of the main-deck composition. When it changes, any computed
  // count is stale, so we reset back to the idle "tap to reveal" state.
  const mainSignature = useMemo(
    () =>
      deck.cards
        .filter((dc) => dc.zone === "main")
        .map((dc) => `${dc.card.dataLine}:${dc.quantity}`)
        .sort()
        .join("|"),
    [deck.cards]
  );

  useEffect(() => {
    // Invalidate the previous result whenever the deck changes.
    requestId.current += 1;
    setStatus("idle");
    setNonSoul(0);
    setSoul(0);
    setWhiff(0);
    setError(null);
  }, [mainSignature]);

  const calculate = async () => {
    const id = ++requestId.current;
    setStatus("loading");
    setError(null);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT}/v1/aod-count`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decklist: generateDeckText(deck),
            decklist_type: DECKLIST_TYPE[deckType],
            include_breakdown: true,
          }),
        }
      );

      const data = await res.json().catch(() => null);
      if (id !== requestId.current) return; // a newer request superseded this one

      if (!res.ok || data?.status === "error") {
        throw new Error(data?.message || "Couldn't calculate AoD count");
      }

      const nonSoulValue = Number(data?.data?.aod_count ?? 0);
      const soulValue = Number(data?.data?.soul_aod_count ?? 0);
      const whiffValue = Number(data?.data?.whiff_percentage ?? 0);
      setStatus("done");
      const opts = { duration: 0.9, ease: "easeOut" } as const;
      animate(0, nonSoulValue, { ...opts, onUpdate: (v) => setNonSoul(v) });
      animate(0, soulValue, { ...opts, onUpdate: (v) => setSoul(v) });
      animate(0, whiffValue, { ...opts, onUpdate: (v) => setWhiff(v) });
    } catch (err) {
      if (id !== requestId.current) return;
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't calculate AoD count");
    }
  };

  const lionTheme =
    "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300";

  // Revealed result — mirrors the alignment cells' label + big-number layout.
  if (status === "done") {
    const tooFewCards = mainDeckCount < 9;
    return (
      <button
        type="button"
        onClick={calculate}
        title="Tap to recalculate"
        className={`group p-3 rounded-lg border-2 text-left transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 ${lionTheme}`}
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-1.5">
          <GiLion className="w-4 h-4 shrink-0" />
          <span>AoD Count</span>
          <span title={AOD_TOOLTIP} className="cursor-help opacity-60 leading-none">
            &#9432;
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Stat label="Non-Soul" value={nonSoul.toFixed(2)} />
          <Stat label="Soul" value={soul.toFixed(2)} />
          <Stat label="Whiff" value={`${whiff.toFixed(1)}%`} />
        </div>
        {tooFewCards && (
          <div className="text-[10px] mt-1 opacity-70">Needs 9+ main cards</div>
        )}
      </button>
    );
  }

  // Idle / loading / error all share the same cell footprint as a call to action.
  return (
    <button
      type="button"
      onClick={calculate}
      disabled={status === "loading"}
      title={status === "error" ? error ?? undefined : AOD_TOOLTIP}
      className={`group p-3 rounded-lg border-2 text-left transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-wait ${lionTheme}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-1">
        <GiLion
          className={`w-4 h-4 shrink-0 ${status === "loading" ? "animate-pulse" : "transition-transform group-hover:scale-110"}`}
        />
        <span>AoD Count</span>
      </div>
      {status === "loading" ? (
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Calculating…
        </div>
      ) : status === "error" ? (
        <div className="text-sm font-medium">Tap to retry</div>
      ) : (
        <div className="text-sm font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
          Tap to reveal
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
        </div>
      )}
    </button>
  );
}
