"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { copyPublicDeckAction, updateDeckPreviewCardsAction, renameDeckAction, updateDeckDescriptionAction, DeckCardData } from "../actions";
import ReactMarkdown from "react-markdown";
import { CARD_DATA_URL } from "../card-search/constants";
import { Card } from "../card-search/utils";
import ModalWithClose from "../card-search/ModalWithClose";

interface PublicDeckData {
  id: string;
  name: string;
  description?: string;
  format?: string;
  paragon?: string;
  is_public?: boolean;
  card_count?: number;
  view_count?: number;
  preview_card_1?: string | null;
  preview_card_2?: string | null;
  username?: string | null;
  created_at: string;
  updated_at: string;
  cards: DeckCardData[];
}

interface Props {
  deck: PublicDeckData;
  isOwner: boolean;
}

// Enriched card with full Card data from the card database
interface EnrichedCard extends DeckCardData {
  type: string;
  alignment: string;
  brigade: string;
  fullCard: Card | null;
}

// Prettify raw type abbreviations
function prettifyTypeName(type: string): string {
  const map: Record<string, string> = {
    "GE": "Good Enhancement",
    "EE": "Evil Enhancement",
    "EC": "Evil Character",
    "HC": "Hero Character",
    "GC": "Good Character",
    "LS": "Lost Soul",
    "Dom": "Dominant",
    "Cov": "Covenant",
    "Cur": "Curse",
    "Art": "Artifact",
    "Fort": "Fortress",
    "Hero/GE": "Good Enhancement",
    "Evil Character/EE": "Evil Enhancement",
  };
  return map[type] || type;
}

// Group name used for display — combine small related types
function getGroupKey(type: string): string {
  const pretty = prettifyTypeName(type);
  if (pretty === "Artifact" || pretty === "Covenant" || pretty === "Curse") {
    return "Artifact/Covenant/Curse";
  }
  if (pretty === "Fortress" || pretty === "Site" || pretty === "City") {
    return "Fortress/Site";
  }
  return pretty;
}

// Display-friendly group names (pluralized)
function getGroupDisplayName(group: string): string {
  const map: Record<string, string> = {
    "Hero": "Heroes",
    "Good Enhancement": "Good Enhancements",
    "Evil Character": "Evil Characters",
    "Evil Enhancement": "Evil Enhancements",
    "Dual-Alignment Enhancement": "Dual-Alignment Enhancements",
    "Lost Soul": "Lost Souls",
    "Artifact/Covenant/Curse": "Artifacts / Covenants / Curses",
    "Fortress/Site": "Fortresses / Sites",
    "Dominant": "Dominants",
  };
  return map[group] || group;
}

function formatDeckType(format?: string): string {
  if (!format) return "T1";
  const fmt = format.toLowerCase();
  if (fmt.includes("paragon")) return "Paragon";
  if (fmt.includes("type 2") || fmt.includes("multi") || fmt === "t2") return "T2";
  return "T1";
}

function getDeckTypeBadgeClasses(format?: string): string {
  const deckType = formatDeckType(format);
  if (deckType === "T2") {
    return "px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded-full text-sm font-semibold";
  }
  if (deckType === "Paragon") {
    return "px-3 py-1 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded-full text-sm font-semibold";
  }
  return "px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-semibold";
}

function getImageUrl(imgFile: string): string {
  const sanitized = (imgFile || "").replace(/\.jpe?g$/i, "");
  const baseUrl = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  return `${baseUrl}/card-images/${sanitized}.jpg`;
}

function sanitizeImgFile(imgFile: string): string {
  return (imgFile || "").replace(/\.jpe?g$/i, "");
}

export default function PublicDeckClient({ deck, isOwner }: Props) {
  const router = useRouter();
  const [linkCopied, setLinkCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<{ success: boolean; message: string } | null>(null);
  const [cardDatabase, setCardDatabase] = useState<Map<string, Card> | null>(null);
  const [modalCard, setModalCard] = useState<Card | null>(null);
  const [viewMode, setViewMode] = useState<"normal" | "stacked">("stacked");
  const [groupBy, setGroupBy] = useState<"type" | "alignment" | "none">("type");

  // Inline name editing (owner only)
  const [deckName, setDeckName] = useState(deck.name);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(deck.name);

  async function handleNameSubmit() {
    const trimmed = nameInput.trim();
    setEditingName(false);
    if (!trimmed || trimmed === deckName) { setNameInput(deckName); return; }
    setDeckName(trimmed);
    const result = await renameDeckAction(deck.id, trimmed);
    if (!result.success) setDeckName(deckName); // revert on failure
  }

  // Description editing (owner only)
  const [description, setDescription] = useState(deck.description || "");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState(deck.description || "");
  const [savingDescription, setSavingDescription] = useState(false);

  async function handleDescriptionSubmit() {
    setEditingDescription(false);
    if (descriptionInput === description) return;
    setSavingDescription(true);
    setDescription(descriptionInput);
    const result = await updateDeckDescriptionAction(deck.id, descriptionInput);
    setSavingDescription(false);
    if (!result.success) setDescription(description); // revert on failure
  }

  // Cover card editor (owner only)
  const [previewCard1, setPreviewCard1] = useState<string | null>(deck.preview_card_1 ?? null);
  const [previewCard2, setPreviewCard2] = useState<string | null>(deck.preview_card_2 ?? null);
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);
  const [coverPickerSlot, setCoverPickerSlot] = useState<1 | 2 | null>(null);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverSaved, setCoverSaved] = useState(false);

  useEffect(() => {
    if (!coverEditorOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setCoverEditorOpen(false); setCoverPickerSlot(null); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [coverEditorOpen]);

  // Fetch card database to get full card info
  useEffect(() => {
    fetch(CARD_DATA_URL)
      .then((res) => res.text())
      .then((text) => {
        const lines = text.split("\n");
        const dataLines = lines.slice(1).filter((l) => l.trim());
        const db = new Map<string, Card>();
        dataLines.forEach((line) => {
          const cols = line.split("\t");
          const name = cols[0] || "";
          const set = cols[1] || "";
          const imgFile = sanitizeImgFile(cols[2] || "");
          const key = `${name}|${set}|${imgFile}`;
          db.set(key, {
            dataLine: line,
            name,
            set,
            imgFile,
            officialSet: cols[3] || "",
            type: cols[4] || "",
            brigade: cols[5] || "",
            strength: cols[6] || "",
            toughness: cols[7] || "",
            class: cols[8] || "",
            identifier: cols[9] || "",
            specialAbility: cols[10] || "",
            rarity: cols[11] || "",
            reference: cols[12] || "",
            alignment: cols[14] || "",
            legality: cols[15] || "",
            testament: "",
            isGospel: false,
          });
        });
        setCardDatabase(db);
      })
      .catch(console.error);
  }, []);

  // Enrich cards with full card data
  const enrichedCards = useMemo<EnrichedCard[]>(() => {
    return deck.cards.map((card) => {
      if (!cardDatabase) {
        return { ...card, type: "", alignment: "", brigade: "", fullCard: null };
      }
      const key = `${card.card_name}|${card.card_set}|${sanitizeImgFile(card.card_img_file || "")}`;
      const fullCard = cardDatabase.get(key) || null;
      return {
        ...card,
        type: fullCard?.type || "",
        alignment: fullCard?.alignment || "",
        brigade: fullCard?.brigade || "",
        fullCard,
      };
    });
  }, [deck.cards, cardDatabase]);

  const mainCards = enrichedCards.filter((c) => !c.is_reserve);
  const reserveCards = enrichedCards.filter((c) => c.is_reserve);
  const mainDeckCount = mainCards.reduce((sum, c) => sum + c.quantity, 0);
  const reserveCount = reserveCards.reduce((sum, c) => sum + c.quantity, 0);

  // Group and sort cards based on current groupBy setting
  const groupedMainCards = useMemo(() => {
    return groupAndSortCards(mainCards, groupBy);
  }, [mainCards, groupBy]);

  const sortedReserveCards = useMemo(() => {
    return [...reserveCards].sort((a, b) => {
      const typeA = prettifyTypeName(a.type);
      const typeB = prettifyTypeName(b.type);
      if (typeA !== typeB) return typeA.localeCompare(typeB);
      return a.card_name.localeCompare(b.card_name);
    });
  }, [reserveCards]);

  // Build flat list of Card objects for modal navigation (all main + reserve)
  const allCardsForNav = useMemo<Card[]>(() => {
    const allEnriched = [
      ...Object.values(groupedMainCards).flat(),
      ...sortedReserveCards,
    ];
    return allEnriched
      .filter((c) => c.fullCard)
      .map((c) => c.fullCard!);
  }, [groupedMainCards, sortedReserveCards]);

  async function handleCopyLink() {
    const url = `${window.location.origin}/decklist/${deck.id}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handleCopyToLibrary() {
    setCopying(true);
    setCopyResult(null);
    const result = await copyPublicDeckAction(deck.id);
    setCopying(false);
    if (result.success) {
      setCopyResult({ success: true, message: "Deck copied to your library!" });
    } else {
      setCopyResult({
        success: false,
        message: result.error === "You must be logged in to copy a deck"
          ? "Sign in to copy this deck to your library"
          : result.error || "Failed to copy deck",
      });
    }
  }

  function handleOpenInBuilder() {
    router.push(`/decklist/card-search?deckId=${deck.id}`);
  }

  return (
    <div className={`w-full mx-auto py-8 ${viewMode === "stacked" ? "max-w-full px-2" : "max-w-7xl px-4"}`}>
      {/* Card detail modal — no add/remove buttons */}
      {modalCard && (
        <ModalWithClose
          modalCard={modalCard}
          setModalCard={setModalCard}
          visibleCards={allCardsForNav}
          onAddCard={null}
          onRemoveCard={null}
          getCardQuantity={null}
        />
      )}

      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <a href="/decklist/community" className="hover:text-gray-800 dark:hover:text-gray-200 transition-colors">
          Community Decks
        </a>
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-800 dark:text-gray-200 truncate">{deckName}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {isOwner && editingName ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={handleNameSubmit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNameSubmit();
                  if (e.key === "Escape") { setNameInput(deckName); setEditingName(false); }
                }}
                className="text-3xl font-bold bg-transparent border-b-2 border-blue-500 outline-none w-full min-w-0 mb-3"
              />
            ) : (
              <h1
                className={`text-3xl font-bold mb-3 ${isOwner ? "cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 transition-colors" : ""}`}
                onClick={isOwner ? () => { setNameInput(deckName); setEditingName(true); } : undefined}
                title={isOwner ? "Click to rename" : undefined}
              >
                {deckName}
              </h1>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <span className={getDeckTypeBadgeClasses(deck.format)}>
                {formatDeckType(deck.format)}
              </span>
              {deck.paragon && formatDeckType(deck.format) === "Paragon" && (
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Paragon: <strong>{deck.paragon}</strong>
                </span>
              )}
              {deck.username && (
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  by{" "}
                  <Link
                    href={`/decklist/community?username=${encodeURIComponent(deck.username)}`}
                    className="font-medium text-gray-600 dark:text-gray-400 underline hover:text-gray-900 dark:hover:text-gray-200"
                  >
                    {deck.username}
                  </Link>
                </span>
              )}
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {mainDeckCount} cards{reserveCount > 0 && ` + ${reserveCount} reserve`}
              </span>
              <span className="text-sm text-gray-400 dark:text-gray-500">
                Created {new Date(deck.created_at).toLocaleDateString()}
              </span>
              <span className="text-sm text-gray-400 dark:text-gray-500">
                Updated {new Date(deck.updated_at).toLocaleDateString()}
              </span>
              {(deck.view_count ?? 0) > 0 && (
                <span className="text-sm text-gray-400 dark:text-gray-500">{deck.view_count} views</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleCopyLink}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
            >
              {linkCopied ? (
                <>
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </>
              )}
            </button>

            {!isOwner && (
              <button
                onClick={handleCopyToLibrary}
                disabled={copying}
                className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {copying ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Copying...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                    </svg>
                    Copy to My Library
                  </>
                )}
              </button>
            )}

            {isOwner && (
              <>
                <button
                  onClick={() => { setCoverEditorOpen(true); setCoverPickerSlot(1); }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
                  title="Edit cover cards"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Cover
                </button>
                <button
                  onClick={handleOpenInBuilder}
                  className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit in Builder
                </button>
              </>
            )}
          </div>
        </div>

        {/* Copy result notification */}
        {copyResult && (
          <div
            className={`mt-4 px-4 py-3 rounded-lg text-sm ${
              copyResult.success
                ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800"
            }`}
          >
            {copyResult.message}
            {!copyResult.success && copyResult.message.includes("Sign in") && (
              <a href="/sign-in" className="ml-2 underline font-medium">
                Sign in
              </a>
            )}
          </div>
        )}
      </div>

      {/* Cover card editor modal — owner only */}
      {isOwner && coverEditorOpen && (() => {
        const mainCards = deck.cards.filter(c => !c.is_reserve);
        const close = () => { setCoverEditorOpen(false); setCoverPickerSlot(null); };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={close}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div>
                  <h2 className="text-lg font-semibold">Cover Cards</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">These two cards appear as the thumbnail on the Community Decks page.</p>
                </div>
                <button onClick={close} className="ml-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-6 py-5 flex-shrink-0">
                {/* Two card slots */}
                <div className="flex gap-6 justify-center mb-2">
                  {([1, 2] as const).map((slot) => {
                    const imgFile = slot === 1 ? previewCard1 : previewCard2;
                    const imgUrl = imgFile ? getImageUrl(imgFile) : null;
                    const isActive = coverPickerSlot === slot;
                    return (
                      <div key={slot} className="flex flex-col items-center gap-2">
                        <button
                          onClick={() => setCoverPickerSlot(slot)}
                          className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                            isActive
                              ? "border-blue-500 ring-4 ring-blue-200 dark:ring-blue-800 scale-105"
                              : "border-gray-300 dark:border-gray-600 hover:border-green-600 hover:scale-102"
                          } bg-gray-100 dark:bg-gray-800`}
                          style={{ width: 130, aspectRatio: "2.5/3.5" }}
                          title={`Set cover card ${slot}`}
                        >
                          {imgUrl ? (
                            <img src={imgUrl} alt={`Cover ${slot}`} className="w-full h-full object-cover" />
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                              <svg className="w-8 h-8 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                              </svg>
                              <span className="text-sm">Empty</span>
                            </div>
                          )}
                          {isActive && (
                            <div className="absolute inset-0 bg-green-600/10 flex items-end justify-center pb-2">
                              <span className="bg-green-700 text-white text-xs font-semibold px-2 py-0.5 rounded-full">Selecting</span>
                            </div>
                          )}
                        </button>
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Card {slot}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Instruction */}
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                  {coverPickerSlot
                    ? `Click a card below to set it as cover card ${coverPickerSlot}`
                    : "Click a slot above to start"}
                </p>
              </div>

              {/* Card grid — scrollable */}
              <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
                <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                  {mainCards.map((card) => (
                    <button
                      key={`${card.card_name}|${card.card_set}`}
                      onClick={async () => {
                        if (!coverPickerSlot) return;
                        const imgFile = card.card_img_file || "";
                        const c1 = coverPickerSlot === 1 ? imgFile : previewCard1;
                        const c2 = coverPickerSlot === 2 ? imgFile : previewCard2;
                        if (coverPickerSlot === 1) setPreviewCard1(imgFile);
                        else setPreviewCard2(imgFile);
                        // Advance to next slot if slot 1 was just filled and slot 2 is empty
                        const nextSlot = coverPickerSlot === 1 && !previewCard2 ? 2 : null;
                        setCoverPickerSlot(nextSlot);
                        setCoverSaving(true);
                        const result = await updateDeckPreviewCardsAction(deck.id, c1, c2);
                        setCoverSaving(false);
                        if (result.success) {
                          setCoverSaved(true);
                          setTimeout(() => setCoverSaved(false), 2000);
                        }
                      }}
                      disabled={!coverPickerSlot}
                      className={`relative rounded-lg overflow-hidden border transition-all ${
                        coverPickerSlot
                          ? "border-gray-200 dark:border-gray-600 hover:border-blue-500 hover:scale-105 cursor-pointer"
                          : "border-gray-200 dark:border-gray-700 opacity-50 cursor-default"
                      }`}
                      style={{ aspectRatio: "2.5/3.5" }}
                      title={card.card_name}
                    >
                      <img src={getImageUrl(card.card_img_file || "")} alt={card.card_name} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Footer status */}
              <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 h-12 flex items-center justify-center">
                {coverSaving && <p className="text-sm text-gray-500 dark:text-gray-400">Saving…</p>}
                {coverSaved && <p className="text-sm text-green-600 dark:text-green-400 font-medium">Saved!</p>}
              </div>

            </div>
          </div>
        );
      })()}

      {/* Paragon image */}
      {deck.paragon && formatDeckType(deck.format) === "Paragon" && (
        <div className="mb-8 max-w-xs">
          <img
            src={`/paragons/Paragon ${deck.paragon}.png`}
            alt={deck.paragon}
            className="w-full rounded-lg shadow-md"
          />
        </div>
      )}

      {/* View Controls */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => setViewMode(viewMode === "normal" ? "stacked" : "normal")}
          className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {viewMode === "normal" ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            )}
          </svg>
          {viewMode === "normal" ? "Normal" : "Stacked"}
        </button>

        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as "type" | "alignment" | "none")}
          className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
        >
          <option value="type">Group by Type</option>
          <option value="alignment">Group by Alignment</option>
          <option value="none">No Grouping</option>
        </select>
      </div>

      {/* Loading state while card database fetches */}
      {!cardDatabase && deck.cards.length > 0 && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-400 mx-auto"></div>
            <p className="mt-4 text-gray-500 dark:text-gray-400 text-sm">Loading deck...</p>
          </div>
        </div>
      )}

      {/* Deck cards — only render after card database is loaded */}
      {cardDatabase && <><div className="mb-8">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          Main Deck
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
            ({mainDeckCount} cards)
          </span>
        </h2>

        {mainCards.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 italic">No cards in main deck.</p>
        ) : viewMode === "stacked" ? (
          /* Stacked view — matches FullDeckView layout exactly */
          <div className="flex gap-4 items-start flex-wrap">
            {Object.entries(groupedMainCards).flatMap(([groupName, cards]) => {
              const columns = splitGroup(cards);
              return columns.map((col, colIndex) => (
                <div key={`${groupName}-${colIndex}`} className="flex flex-col">
                  {groupBy === "alignment" && colIndex === 0 && (
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-400">{groupName}</h3>
                      <span className="text-xs text-gray-500">({cards.reduce((s, c) => s + c.quantity, 0)})</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 items-center">
                    {col.flatMap((card) =>
                      Array.from({ length: card.quantity }, (_, i) => (
                        <div
                          key={`${card.card_name}-${card.card_set}-${colIndex}-${i}`}
                          className="group relative w-28 flex-shrink-0 cursor-pointer transition-all hover:z-20 -mb-32 last:mb-0"
                          onClick={() => card.fullCard && setModalCard(card.fullCard)}
                        >
                          <div className="relative aspect-[2.5/3.5] rounded-md overflow-hidden bg-gray-800 border border-gray-700 hover:border-blue-500 transition-all cursor-pointer hover:scale-105 hover:z-10 shadow-md hover:shadow-xl">
                            <img
                              src={getImageUrl(card.card_img_file || "")}
                              alt={card.card_name}
                              className="w-full h-full object-cover"
                              loading="eager"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end">
                              <div className="w-full p-1.5 text-white">
                                <p className="text-xs font-semibold leading-tight truncate">{card.card_name}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ));
            })}

            {/* Reserve columns */}
            {sortedReserveCards.length > 0 && splitGroup(sortedReserveCards).map((col, colIndex) => (
              <div key={`reserve-col-${colIndex}`} className="flex flex-col ml-4">
                {colIndex === 0 && (
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-purple-400">Reserve</h3>
                    <span className="text-xs text-gray-500">({reserveCount})</span>
                  </div>
                )}
                <div className="flex flex-col gap-2 items-center">
                  {col.flatMap((card) =>
                    Array.from({ length: card.quantity }, (_, i) => (
                      <div
                        key={`reserve-${card.card_name}-${card.card_set}-${colIndex}-${i}`}
                        className="group relative w-28 flex-shrink-0 cursor-pointer transition-all hover:z-20 -mb-32 last:mb-0"
                        onClick={() => card.fullCard && setModalCard(card.fullCard)}
                      >
                        <div className="relative aspect-[2.5/3.5] rounded-md overflow-hidden bg-gray-800 border border-gray-700 hover:border-blue-500 transition-all cursor-pointer hover:scale-105 hover:z-10 shadow-md hover:shadow-xl">
                          <img
                            src={getImageUrl(card.card_img_file || "")}
                            alt={card.card_name}
                            className="w-full h-full object-cover"
                            loading="eager"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end">
                            <div className="w-full p-1.5 text-white">
                              <p className="text-xs font-semibold leading-tight truncate">{card.card_name}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Normal view: compact grid with type group headers */
          <div className="space-y-3">
            {Object.entries(groupedMainCards).map(([groupName, cards]) => {
              const groupCount = cards.reduce((sum, c) => sum + c.quantity, 0);
              return (
                <div key={groupName}>
                  {groupBy !== "none" && (
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                      {getGroupDisplayName(groupName)}
                      <span className="ml-1.5 font-normal">({groupCount})</span>
                    </h3>
                  )}
                  <div className="flex flex-wrap gap-x-1.5">
                    {cards.map((card, index) => (
                      <CardTile
                        key={`main-${card.card_name}-${card.card_set}-${index}`}
                        card={card}
                        onClick={() => card.fullCard && setModalCard(card.fullCard)}
                        compact
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reserve (normal view only — stacked view renders reserve inline above) */}
      {viewMode === "normal" && sortedReserveCards.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            Reserve
            <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
              ({reserveCount} cards)
            </span>
          </h2>
          <div className="flex flex-wrap gap-x-1.5">
            {sortedReserveCards.map((card, index) => (
              <CardTile
                key={`reserve-${card.card_name}-${card.card_set}-${index}`}
                card={card}
                onClick={() => card.fullCard && setModalCard(card.fullCard)}
                compact
              />
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {(description || isOwner) && (
        <div className="mt-8 mb-8">
          {isOwner && editingDescription ? (
            <div>
              <textarea
                autoFocus
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setDescriptionInput(description); setEditingDescription(false); }
                }}
                rows={6}
                placeholder="Write a description for your deck... (Markdown supported)"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handleDescriptionSubmit}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-green-700 hover:bg-green-800 rounded-lg transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => { setDescriptionInput(description); setEditingDescription(false); }}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">Markdown supported</span>
              </div>
            </div>
          ) : description ? (
            <div
              className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3 ${isOwner ? "cursor-pointer hover:border-blue-300 dark:hover:border-green-700 transition-colors" : ""}`}
              onClick={isOwner ? () => { setDescriptionInput(description); setEditingDescription(true); } : undefined}
              title={isOwner ? "Click to edit description" : undefined}
            >
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Description</h3>
              <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300">
                <ReactMarkdown>{description}</ReactMarkdown>
              </div>
            </div>
          ) : isOwner ? (
            <button
              onClick={() => setEditingDescription(true)}
              className="w-full rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-400 dark:text-gray-500 hover:border-green-600 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors text-left"
            >
              + Add a description...
            </button>
          ) : null}
        </div>
      )}
      </>}

    </div>
  );
}

/**
 * Group cards and sort within each group.
 * Supports grouping by type, alignment, or no grouping.
 */
/**
 * Split a group of cards into multiple columns when it exceeds maxPerColumn.
 * Matches FullDeckView splitTypeGroup logic.
 */
function splitGroup(cards: EnrichedCard[], maxPerColumn = 17): EnrichedCard[][] {
  const totalCards = cards.reduce((sum, c) => sum + c.quantity, 0);
  if (totalCards <= maxPerColumn) return [cards];

  const numColumns = Math.ceil(totalCards / maxPerColumn);
  const targetPerColumn = Math.ceil(totalCards / numColumns);

  const columns: EnrichedCard[][] = [];
  let currentColumn: EnrichedCard[] = [];
  let currentCount = 0;

  for (const card of cards) {
    if (currentCount + card.quantity > targetPerColumn && currentColumn.length > 0) {
      const distWithout = Math.abs(currentCount - targetPerColumn);
      const distWith = Math.abs(currentCount + card.quantity - targetPerColumn);
      if (distWith > distWithout) {
        columns.push(currentColumn);
        currentColumn = [card];
        currentCount = card.quantity;
        continue;
      }
    }
    currentColumn.push(card);
    currentCount += card.quantity;
  }

  if (currentColumn.length > 0) columns.push(currentColumn);
  return columns;
}

function groupAndSortCards(
  cards: EnrichedCard[],
  groupByMode: "type" | "alignment" | "none" = "type"
): Record<string, EnrichedCard[]> {
  const grouped: Record<string, EnrichedCard[]> = {};

  for (const card of cards) {
    let key: string;
    if (groupByMode === "alignment") {
      key = card.alignment || "Neutral";
    } else if (groupByMode === "type") {
      key = getGroupKey(card.type);
    } else {
      key = "All Cards";
    }
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(card);
  }

  // Sort within each group: alignment (Good > Evil > Neutral), then brigade, then name
  const alignmentOrder = ["Good", "Evil", "Neutral"];
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => {
      const aIdx = alignmentOrder.indexOf(a.alignment);
      const bIdx = alignmentOrder.indexOf(b.alignment);
      const aOrder = aIdx === -1 ? 999 : aIdx;
      const bOrder = bIdx === -1 ? 999 : bIdx;
      if (aOrder !== bOrder) return aOrder - bOrder;
      if (a.brigade !== b.brigade) return a.brigade.localeCompare(b.brigade);
      return a.card_name.localeCompare(b.card_name);
    });
  }

  // Order the groups
  const ordered: Record<string, EnrichedCard[]> = {};
  if (groupByMode === "alignment") {
    ["Good", "Evil", "Neutral"].forEach((a) => {
      if (grouped[a]) ordered[a] = grouped[a];
    });
    // Any remaining
    Object.keys(grouped).forEach((k) => {
      if (!ordered[k]) ordered[k] = grouped[k];
    });
  } else {
    Object.keys(grouped)
      .sort((a, b) => a.localeCompare(b))
      .forEach((key) => {
        ordered[key] = grouped[key];
      });
  }

  return ordered;
}

function CardTile({ card, onClick, compact }: { card: EnrichedCard | DeckCardData; onClick?: () => void; compact?: boolean }) {
  const [imgError, setImgError] = useState(false);
  const src = getImageUrl(card.card_img_file || "");

  return (
    <div className={`relative group cursor-pointer ${compact ? "w-[calc(100%/12-4px)] min-w-[70px] -mb-6 last:mb-0 hover:z-20" : ""}`} onClick={onClick}>
      <div className="relative w-full aspect-[2.5/3.5] bg-gray-100 dark:bg-gray-800 rounded-md overflow-hidden shadow-sm hover:shadow-md transition-all hover:scale-105 hover:z-10">
        {imgError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 text-xs p-1">
            <div className="text-center font-medium text-[10px] leading-tight">{card.card_name}</div>
          </div>
        ) : (
          <Image
            src={src}
            alt={card.card_name}
            fill
            className="object-contain"
            sizes={compact ? "(max-width: 640px) 25vw, (max-width: 1024px) 12.5vw, 8vw" : "(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw"}
            loading="lazy"
            onError={() => setImgError(true)}
          />
        )}

        {/* Quantity badge */}
        {card.quantity > 1 && (
          <div className={`absolute top-0.5 right-0.5 bg-black/75 backdrop-blur-sm text-white rounded font-bold shadow-lg ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-sm rounded-md"}`}>
            ×{card.quantity}
          </div>
        )}

        {/* Hover overlay with card name */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end">
          <div className="w-full p-1 text-white">
            <p className="text-[10px] font-semibold leading-tight truncate">{card.card_name}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
