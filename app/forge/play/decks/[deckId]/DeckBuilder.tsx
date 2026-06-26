"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DeckCard, DeckZone } from "@/app/decklist/card-search/types/deck";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { ALL_CARDS } from "@/app/decklist/card-search/data/cardIndex";
import { validateDeck } from "@/app/decklist/card-search/utils/deckValidation";
import { designCardToCard } from "@/app/forge/lib/deckAdapter";
import { entriesFromDeckCards, hydrateEntries, toValidatableDeck } from "@/app/forge/lib/deckSerialize";
import { useForgeDeckState } from "@/app/forge/play/decks/useForgeDeckState";
import { saveForgeDeck } from "@/app/forge/lib/forgeDecks";
import type { ForgeDeckEntry } from "@/app/forge/lib/deckTypes";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import PoolSearch from "./PoolSearch";
import DeckPanel from "./DeckPanel";

const FORMATS = ["Type 1", "Type 2", "Paragon", "Classic"];

export default function DeckBuilder({
  deckId, initialName, initialFormat, initialEntries, granted,
}: {
  deckId: string | null;          // null = new deck
  initialName: string;
  initialFormat: string;
  initialEntries: ForgeDeckEntry[];
  granted: GrantedForgeCard[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [format, setFormat] = useState(initialFormat);

  // Forge cards → Card[], a cardId→DesignCard map for thumbnail rendering, and the
  // set of cardIds that have approved art (so art-less cards skip the proxy request).
  const { forgeCards, forgeData, forgeById, forgeArtIds } = useMemo(() => {
    const forgeData = new Map<string, DesignCard>();
    const forgeById = new Map<string, Card>();
    const forgeArtIds = new Set<string>();
    const forgeCards = granted.map((g) => {
      const card = designCardToCard(g.data, g.cardId, g.setName);
      forgeData.set(g.cardId, g.data);
      forgeById.set(g.cardId, card);
      if (g.hasApprovedArt) forgeArtIds.add(g.cardId);
      return card;
    });
    return { forgeCards, forgeData, forgeById, forgeArtIds };
  }, [granted]);

  // Public lookup by name|set for hydration.
  const publicByKey = useMemo(() => {
    const m = new Map<string, Card>();
    for (const c of ALL_CARDS) m.set(`${c.name}|${c.set}`, c);
    return m;
  }, []);

  const pool = useMemo(() => [...forgeCards, ...ALL_CARDS], [forgeCards]);

  const initialCards = useMemo(
    () => hydrateEntries(initialEntries, (id) => forgeById.get(id), (n, s) => publicByKey.get(`${n}|${s}`)).cards,
    [initialEntries, forgeById, publicByKey],
  );

  const { cards, addCard, removeCard, setQuantity } = useForgeDeckState(initialCards);

  const validation = useMemo(() => validateDeck(toValidatableDeck(cards, name, format)), [cards, name, format]);

  const moveZone = (dataLine: string, from: DeckZone, to: DeckZone) => {
    const dc = cards.find((c) => c.card.dataLine === dataLine && c.zone === from);
    if (!dc) return;
    for (let i = 0; i < dc.quantity; i++) addCard(dc.card, to);
    setQuantity(dataLine, from, 0);
  };

  const onSave = () => {
    startTransition(async () => {
      const res = await saveForgeDeck({
        id: deckId ?? undefined,
        name,
        format,
        paragon: null,
        entries: entriesFromDeckCards(cards),
      });
      if (res.ok === false) { alert(res.error); return; }
      if (!deckId) router.replace(`/forge/play/decks/${res.id}`);
      else router.refresh();
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deck name"
          className="flex-1 rounded-md border bg-background text-foreground px-3 py-2 text-sm" />
        <select value={format} onChange={(e) => setFormat(e.target.value)} className="rounded-md border bg-background text-foreground px-2 py-2 text-sm">
          {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button onClick={onSave} disabled={pending}
          className="rounded-md border bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <PoolSearch pool={pool} forgeData={forgeData} forgeArtIds={forgeArtIds} onAdd={(c) => addCard(c, "main")} />
        <DeckPanel
          cards={cards} validation={validation}
          onAdd={(dataLine, zone) => { const dc = cards.find((c) => c.card.dataLine === dataLine && c.zone === zone); if (dc) addCard(dc.card, zone); }}
          onRemove={removeCard}
          onZone={moveZone}
        />
      </div>
    </div>
  );
}
