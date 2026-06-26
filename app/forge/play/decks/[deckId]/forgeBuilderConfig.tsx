"use client";

// Builds the DeckBuilderConfig that makes the main player-facing deck builder
// (CardSearchClient) behave as the Forge builder: a mixed forge+public pool,
// forge-aware image rendering (composite preview, NEVER next/image — this file
// lives under app/forge/** where next/image is banned), forge_decks persistence,
// and the public-only features hard-disabled.
//
// Forge identity round-trip: a forge card's `forge:<id>` dataLine is dropped at
// the save boundary (DeckCardData carries no dataLine), so we stamp the dataLine
// into `imgFile` instead and key the image + persistence seams on `imgFile`.

import type { Card } from "@/app/decklist/card-search/utils";
import type {
  DeckBuilderConfig,
  DeckBuilderPersistence,
  CardImageResolution,
} from "@/app/decklist/card-search/builderConfig";
import type { DeckCardData, SaveDeckParams, saveDeckAction } from "@/app/decklist/actions";

type SaveDeckResult = Awaited<ReturnType<typeof saveDeckAction>>;
import { ALL_CARDS } from "@/app/decklist/card-search/data/cardIndex";
import { getPublicImageUrl } from "@/app/decklist/card-search/hooks/useCardImageUrl";
import type { DesignCard } from "@/app/forge/lib/designCard";
import {
  designCardToCard,
  forgeDataLine,
  isForgeDataLine,
  cardIdFromDataLine,
} from "@/app/forge/lib/deckAdapter";
import type { ForgeDeckEntry } from "@/app/forge/lib/deckTypes";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import { saveForgeDeck, getForgeDeck } from "@/app/forge/lib/forgeDecks";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";

export function makeForgeBuilderConfig(granted: GrantedForgeCard[]): DeckBuilderConfig {
  // Forge cards → Card[], with imgFile stamped to the forge dataLine so the cardId
  // survives a save (which keeps card_img_file but drops dataLine).
  const forgeData = new Map<string, DesignCard>();
  const forgeById = new Map<string, Card>();
  const forgeArtIds = new Set<string>();
  const forgeCards: Card[] = granted.map((g) => {
    const card: Card = { ...designCardToCard(g.data, g.cardId, g.setName), imgFile: forgeDataLine(g.cardId) };
    forgeData.set(g.cardId, g.data);
    forgeById.set(g.cardId, card);
    if (g.hasApprovedArt) forgeArtIds.add(g.cardId);
    return card;
  });

  const publicByKey = new Map<string, Card>();
  for (const c of ALL_CARDS) publicByKey.set(`${c.name}|${c.set}`, c);

  const pool: Card[] = [...forgeCards, ...ALL_CARDS];

  // --- image seam (keyed on imgFile so loaded/saved forge cards still render) ---
  const resolveCardImage = (card: Card): CardImageResolution => {
    if (isForgeDataLine(card.imgFile)) {
      const id = cardIdFromDataLine(card.imgFile);
      const data = forgeData.get(id);
      const artUrl = data && forgeArtIds.has(id) ? `/forge/api/art/${id}?v=approved` : null;
      return {
        kind: "element",
        node: data ? <ForgeCardPreview card={data} artUrl={artUrl} className="w-full rounded-md" /> : null,
      };
    }
    return { kind: "url", url: getPublicImageUrl(card.imgFile) };
  };

  const renderThumb: DeckBuilderConfig["renderThumb"] = (card, opts) => {
    const r = resolveCardImage(card);
    if (r.kind === "element") return r.node;
    // Plain <img> — CardImage/next/image is banned under app/forge/**.
    return <img src={r.url} alt={opts.alt} className={opts.className} sizes={opts.sizes} onClick={opts.onClick} />;
  };

  // --- persistence seam (forge_decks) ---
  const save: DeckBuilderPersistence["save"] = async (params: SaveDeckParams) => {
    const entries: ForgeDeckEntry[] = params.cards.map((c: DeckCardData) => {
      const img = c.card_img_file ?? "";
      return isForgeDataLine(img)
        ? { source: "forge", cardId: cardIdFromDataLine(img), qty: c.quantity, zone: c.zone }
        : { source: "public", name: c.card_name, set: c.card_set ?? "", qty: c.quantity, zone: c.zone };
    });
    const res = await saveForgeDeck({
      id: params.deckId,
      name: params.name,
      format: params.format ?? "Type 1",
      paragon: params.paragon ?? null,
      entries,
    });
    // `=== false` narrowing: tsconfig strict:false breaks `res.ok ? … : …` union
    // narrowing. Cast the shape to the public action's return — the forge deck
    // runs no public deckcheck, so deckCheckResult is null.
    if (res.ok === false) {
      return { success: false, error: res.error } as SaveDeckResult;
    }
    return { success: true, deckId: res.id, message: "Saved", deckCheckResult: null } as SaveDeckResult;
  };

  const loadById: DeckBuilderPersistence["loadById"] = async (deckId: string) => {
    const detail = await getForgeDeck(deckId);
    if (!detail) return { success: false as const, error: "Deck not found", deck: null };

    // Map stored entries → the db-card-row shape useDeckState's dbCardToDeckCard reads.
    // Forge rows carry the dataLine in card_img_file (so they re-save and render);
    // public rows carry the real imgFile so the catalog lookup resolves full data.
    const cards = detail.entries.map((e) => {
      if (e.source === "forge") {
        const c = forgeById.get(e.cardId);
        return {
          card_name: c?.name ?? "Forge card",
          card_set: c?.set ?? "Forge",
          card_img_file: forgeDataLine(e.cardId),
          quantity: e.qty,
          zone: e.zone,
        };
      }
      const pc = publicByKey.get(`${e.name}|${e.set}`);
      return {
        card_name: e.name,
        card_set: e.set,
        card_img_file: pc?.imgFile ?? "",
        quantity: e.qty,
        zone: e.zone,
      };
    });

    const now = new Date().toISOString();
    return {
      success: true as const,
      isOwner: true, // RLS already guarantees the caller owns it; keeps the id so saves update in place.
      deck: {
        id: detail.id,
        name: detail.name,
        description: "",
        format: detail.format,
        paragon: detail.paragon,
        folder_id: null,
        is_public: false,
        visibility: "private",
        preview_card_1: null,
        preview_card_2: null,
        cards,
        created_at: now,
        updated_at: now,
      },
    };
  };

  return {
    pool,
    resolveCardImage,
    renderThumb,
    persistence: { save, loadById },
    features: {
      localStoragePersist: false,
      syncFiltersToUrl: false,
      enableSharing: false,
      enableDeckDelete: false,
    },
  };
}
