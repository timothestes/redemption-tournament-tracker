"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CARD_DATA_URL, CARD_IMAGE_PROXY_URL } from "../constants";
import { Card, sanitizeImgFile, normalizeBrigadeField } from "../utils";

export default function RandomCardClient() {
  const router = useRouter();
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    fetchRandomCard();
  }, []);

  const fetchRandomCard = async () => {
    // Don't show loading state if we already have a card - just transition
    if (card) {
      setIsTransitioning(true);
    } else {
      setLoading(true);
    }
    setError(null);
    
    try {
      const response = await fetch(CARD_DATA_URL);
      const text = await response.text();
      const lines = text.split("\n");
      const dataLines = lines.slice(1).filter((l) => l.trim());
      
      if (dataLines.length === 0) {
        setError("No cards found in database");
        setLoading(false);
        return;
      }

      // Get random card
      const randomIndex = Math.floor(Math.random() * dataLines.length);
      const line = dataLines[randomIndex];
      const cols = line.split("\t");
      
      // Parse card data (same logic as in card-search/client.tsx)
      const cardName = cols[0] || "";
      const cardSet = cols[1] || "";
      const imgFile = sanitizeImgFile(cols[2] || "");
      const reference = cols[12] || "";
      const alignment = cols[14] || "";
      const rawBrigade = cols[5] || "";
      
      // Parse testament
      let references: string[] = [];
      for (let refGroup of reference.split(";")) {
        refGroup = refGroup.trim();
        if (refGroup.includes("(") && refGroup.includes(")")) {
          const mainRef = refGroup.split("(")[0].trim();
          if (mainRef) references.push(mainRef);
          const parenContent = refGroup.substring(refGroup.indexOf("(") + 1, refGroup.indexOf(")"));
          const parenRefs = parenContent.split(",").map(pr => pr.trim()).filter(Boolean);
          references.push(...parenRefs);
        } else {
          if (refGroup) references.push(refGroup);
        }
      }

      const referencesLower = references.map(r => r.toLowerCase());
      const gospelBooksLower = ['matthew', 'mark', 'luke', 'john'];
      const isGospel = referencesLower.some(ref => gospelBooksLower.some(b => ref.startsWith(b)));

      const foundTestaments = new Set<string>();
      const OT_BOOKS = ['genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy', 'joshua', 'judges', 'ruth', 'samuel', 'kings', 'chronicles', 'ezra', 'nehemiah', 'esther', 'job', 'psalms', 'proverbs', 'ecclesiastes', 'song of solomon', 'isaiah', 'jeremiah', 'lamentations', 'ezekiel', 'daniel', 'hosea', 'joel', 'amos', 'obadiah', 'jonah', 'micah', 'nahum', 'habakkuk', 'zephaniah', 'haggai', 'zechariah', 'malachi'];
      const NT_BOOKS = ['matthew', 'mark', 'luke', 'john', 'acts', 'romans', 'corinthians', 'galatians', 'ephesians', 'philippians', 'colossians', 'thessalonians', 'timothy', 'titus', 'philemon', 'hebrews', 'james', 'peter', 'john', 'jude', 'revelation'];

      const normalizeBookName = (ref: string) => ref.replace(/^(i{1,3}|1|2|3|4|one|two|three|four)\s+/i, '').trim();

      for (const ref of referencesLower) {
        const book = ref.split(' ')[0];
        const normalizedBook = normalizeBookName(ref).split(' ')[0];
        if (NT_BOOKS.some(b => book === b.toLowerCase() || normalizedBook === b.toLowerCase())) foundTestaments.add('NT');
        if (OT_BOOKS.some(b => book === b.toLowerCase() || normalizedBook === b.toLowerCase())) foundTestaments.add('OT');
      }

      let testament: string | string[] = '';
      if (foundTestaments.size === 1) {
        testament = Array.from(foundTestaments)[0];
      } else if (foundTestaments.size > 1) {
        testament = Array.from(foundTestaments);
      }

      let normalizedBrigades: string[] = [];
      try {
        normalizedBrigades = normalizeBrigadeField(rawBrigade, alignment, cardName);
      } catch (e) {
        normalizedBrigades = rawBrigade ? [rawBrigade] : [];
      }

      const randomCard: Card = {
        dataLine: line,
        name: cardName,
        set: cardSet,
        imgFile: imgFile,
        officialSet: cols[3] || "",
        type: cols[4] || "",
        brigade: normalizedBrigades.join("/"),
        strength: cols[6] || "",
        toughness: cols[7] || "",
        class: cols[8] || "",
        identifier: cols[9] || "",
        specialAbility: cols[10] || "",
        rarity: cols[11] || "",
        reference: reference,
        alignment: alignment,
        legality: cols[15] || "",
        testament: Array.isArray(testament) ? testament.join("/") : testament,
        isGospel: isGospel,
      };

      setIsTransitioning(false);
      setCard(randomCard);
    } catch (err) {
      setError("Failed to fetch random card");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-700 dark:text-gray-300">Loading random card...</p>
        </div>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error || "No card found"}</p>
          <button
            onClick={fetchRandomCard}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className={`bg-white dark:bg-gray-900 text-gray-900 dark:text-white rounded-lg shadow-2xl max-w-lg w-full h-[75vh] overflow-hidden relative flex flex-col transition-opacity duration-300 ${isTransitioning ? 'opacity-50' : 'opacity-100'}`}>
        {/* Header with card name */}
        <div className="px-2 pt-2 pb-1.5 border-b border-gray-200 dark:border-gray-800 font-semibold text-sm text-center">
          <div className="truncate">{card.name}</div>
        </div>

        {/* Main content area */}
        <div className="px-2 py-1.5 flex flex-col items-center relative flex-1 overflow-hidden">
          {/* Card Image */}
          <div className="relative w-full flex justify-center mb-2">
            <img
              src={`${CARD_IMAGE_PROXY_URL}${encodeURIComponent(card.imgFile)}.jpg`}
              alt={card.name}
              className="w-full max-w-[280px] h-auto max-h-[45vh] object-contain mx-auto rounded shadow-lg"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='280'%3E%3Crect width='200' height='280' fill='%23ddd'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23666'%3ENo Image%3C/text%3E%3C/svg%3E";
              }}
            />
          </div>

          {/* Card Details */}
          <div className="w-full flex-1 overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent">
            <div className="space-y-0.5 pb-1">
              <p className="text-xs text-gray-900 dark:text-white">
                <strong>Set:</strong> {card.set}
              </p>
              {card.officialSet && card.officialSet !== card.set && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Official Set:</strong> {card.officialSet}
                </p>
              )}
              {card.type && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Type:</strong> {card.type}
                </p>
              )}
              {card.brigade && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Brigade:</strong> {card.brigade}
                </p>
              )}
              {card.alignment && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Alignment:</strong> {card.alignment}
                </p>
              )}
              {(card.strength || card.toughness) && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Strength:</strong> {card.strength || "-"}
                </p>
              )}
              {(card.strength || card.toughness) && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Toughness:</strong> {card.toughness || "-"}
                </p>
              )}
              {card.class && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Class:</strong> {card.class}
                </p>
              )}
              {card.specialAbility && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Special Ability:</strong> {card.specialAbility}
                </p>
              )}
              {card.rarity && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Rarity:</strong> {card.rarity}
                </p>
              )}
              {card.reference && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Reference:</strong> {card.reference}
                </p>
              )}
              {card.testament && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Testament:</strong> {card.testament}
                </p>
              )}
              {card.legality && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Legality:</strong> {card.legality}
                </p>
              )}
              {card.identifier && (
                <p className="text-xs text-gray-900 dark:text-white">
                  <strong>Identifier:</strong> {card.identifier}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer with buttons */}
        <div className="px-2 pb-2 pt-1.5 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
          <div className="flex justify-center gap-1.5 items-center flex-wrap">
            <button
              onClick={() => router.push("/decklist/card-search")}
              className="px-2 h-7 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 rounded font-medium transition-colors text-xs whitespace-nowrap"
            >
              ← Back
            </button>
            <button
              onClick={fetchRandomCard}
              className="px-2 h-7 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 rounded flex items-center gap-1 font-medium transition-colors text-xs whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isTransitioning}
            >
              <span className="text-xs">🎲</span>
              {isTransitioning ? 'Loading...' : 'Random'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
