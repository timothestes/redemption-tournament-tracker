"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { loadPublicDecksAction, loadGlobalTagsAction, copyPublicDeckAction, loadPublicDeckAction, LoadPublicDecksParams } from "../actions";
import { GoldfishButton } from "../../goldfish/components/GoldfishButton";
import GeneratePDFModal from "../card-search/components/GeneratePDFModal";
import GenerateDeckImageModal from "../card-search/components/GenerateDeckImageModal";
import { Deck } from "../card-search/types/deck";
import { Card } from "../card-search/utils";

interface DeckTag { id: string; name: string; color: string; }

interface TournamentInfo {
  tournament_name: string;
  placement: number | null;
  deck_format: string | null;
  participant_count: number;
}

interface PublicDeck {
  id: string;
  name: string;
  description?: string;
  format?: string;
  paragon?: string;
  card_count?: number;
  view_count?: number;
  preview_card_1?: string | null;
  preview_card_2?: string | null;
  user_id?: string;
  username?: string | null;
  created_at: string;
  updated_at: string;
  tags?: DeckTag[];
  total_price?: number | null;
  budget_price?: number | null;
  tournament?: TournamentInfo | null;
  is_legal?: boolean | null;
}

function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#1f2937" : "#ffffff";
}

function formatDeckType(format?: string): string {
  if (!format) return "T1";
  const fmt = format.toLowerCase();
  if (fmt.includes("paragon")) return "Paragon";
  if (fmt.includes("type 2") || fmt === "t2") return "T2";
  return "T1";
}

function getDeckTypeBadgeClasses(format?: string): string {
  const deckType = formatDeckType(format);
  if (deckType === "T2") {
    return "px-2 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs font-semibold";
  }
  if (deckType === "Paragon") {
    return "px-2 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded text-xs font-semibold";
  }
  return "px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs font-semibold";
}

function timeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  const weeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  const months = Math.floor(diffDays / 30);
  if (diffDays < 365) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(diffDays / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function getPlacementLabel(place: number): string {
  if (place === 1) return "1st Place";
  if (place === 2) return "2nd Place";
  if (place === 3) return "3rd Place";
  return `${place}th Place`;
}

function TrophyIcon({ place, className }: { place: number; className?: string }) {
  const colors = place === 1
    ? { fill: "#FFD700", stroke: "#B8860B" }
    : place === 2
      ? { fill: "#C0C0C0", stroke: "#808080" }
      : place === 3
        ? { fill: "#CD7F32", stroke: "#8B5A2B" }
        : null;

  if (!colors) return null;

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cup bowl */}
      <path d="M7 3h10v5c0 2.76-2.24 5-5 5s-5-2.24-5-5V3z" fill={colors.fill} stroke={colors.stroke} strokeWidth="1.2"/>
      {/* Left handle */}
      <path d="M7 5H5.5C4.12 5 3 6.12 3 7.5S4.12 10 5.5 10H7" stroke={colors.stroke} strokeWidth="1.2" fill="none"/>
      {/* Right handle */}
      <path d="M17 5h1.5C19.88 5 21 6.12 21 7.5S19.88 10 18.5 10H17" stroke={colors.stroke} strokeWidth="1.2" fill="none"/>
      {/* Stem */}
      <path d="M11 13h2v4h-2z" fill={colors.stroke}/>
      {/* Base */}
      <path d="M8 17h8v1.5a1 1 0 01-1 1H9a1 1 0 01-1-1V17z" fill={colors.fill} stroke={colors.stroke} strokeWidth="1"/>
      {/* Base plate */}
      <rect x="7" y="20" width="10" height="1.5" rx="0.5" fill={colors.stroke}/>
    </svg>
  );
}

const PAGE_SIZE = 24;

interface Props {
  initialDecks: PublicDeck[];
  initialCount: number;
  currentUserId?: string;
}

export default function CommunityClient({ initialDecks, initialCount, currentUserId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialUsername = searchParams.get("username") || "";

  const [decks, setDecks] = useState<PublicDeck[]>(initialUsername ? [] : initialDecks);
  const [loading, setLoading] = useState(!!initialUsername);
  const [totalCount, setTotalCount] = useState(initialUsername ? 0 : initialCount);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"newest" | "most_viewed" | "name">("newest");
  const [format, setFormat] = useState<string>("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [usernameFilter, setUsernameFilter] = useState(initialUsername);
  const [tournamentOnly, setTournamentOnly] = useState(false);
  const [excludeFullSize, setExcludeFullSize] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [globalTags, setGlobalTags] = useState<DeckTag[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagFilterInput, setTagFilterInput] = useState("");
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (!tagDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
        setTagFilterInput("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tagDropdownOpen]);

  // Sync usernameFilter state with URL param on client-side navigation
  useEffect(() => {
    const urlUsername = searchParams.get("username") || "";
    setUsernameFilter(urlUsername);
    setPage(1);
  }, [searchParams]);

  // Load global tags for the filter row
  useEffect(() => {
    loadGlobalTagsAction().then((res) => {
      if (res.success) setGlobalTags(res.tags);
    });
  }, []);

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
    setPage(1);
  }

  const loadDecks = useCallback(async () => {
    setLoading(true);
    const params: LoadPublicDecksParams = {
      page,
      pageSize: PAGE_SIZE,
      sort,
      format: format || undefined,
      search: search || undefined,
      username: usernameFilter || undefined,
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      tournamentOnly: tournamentOnly || undefined,
      excludeFullSize: excludeFullSize || undefined,
    };
    const result = await loadPublicDecksAction(params);
    if (result.success) {
      setDecks(result.decks);
      setTotalCount(result.totalCount);
    }
    setLoading(false);
  }, [page, sort, format, search, usernameFilter, selectedTagIds, tournamentOnly, excludeFullSize]);

  useEffect(() => {
    // Skip the initial fetch if we already have server-provided data (no username filter)
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (!initialUsername) return;
    }
    loadDecks();
  }, [loadDecks]);

  // Reset to page 1 when filters change
  function handleSortChange(newSort: typeof sort) {
    setSort(newSort);
    setPage(1);
  }

  function handleFormatChange(newFormat: string) {
    setFormat(newFormat);
    setPage(1);
  }

  function handleSearch() {
    setSearch(searchInput);
    setPage(1);
  }

  function handleClearSearch() {
    setSearchInput("");
    setSearch("");
    setPage(1);
  }

  function handleClearUsername() {
    setUsernameFilter("");
    setPage(1);
    router.replace("/decklist/community");
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="w-full max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-8 overflow-x-hidden">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Community Decks</h1>
        <p className="text-muted-foreground">
          Browse public decks shared by the community.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 mb-6">
        {/* Row 1: Search */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search decks, players, or tournaments..."
            className="flex-1 min-w-0 px-3 py-2 border border-border rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex-shrink-0"
          >
            Search
          </button>
          {search && (
            <button
              onClick={handleClearSearch}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground flex-shrink-0"
            >
              Clear
            </button>
          )}
        </div>

        {/* Row 2: Format / Sort / Tags */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Format filter */}
          <select
            value={format}
            onChange={(e) => handleFormatChange(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-card text-sm"
          >
            <option value="">All Formats</option>
            <option value="Type 1">Type 1</option>
            <option value="Type 2">Type 2</option>
            <option value="Paragon">Paragon</option>
          </select>

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => handleSortChange(e.target.value as typeof sort)}
            className="px-3 py-2 border border-border rounded-lg bg-card text-sm"
          >
            <option value="newest">Newest</option>
            <option value="most_viewed">Most Viewed</option>
            <option value="name">Name A-Z</option>
          </select>

          {/* Tournament Results toggle */}
          <button
            onClick={() => { setTournamentOnly((v) => !v); setPage(1); }}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors ${
              tournamentOnly
                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            <TrophyIcon place={1} className="w-3.5 h-3.5" />
            Tournament Results
          </button>

          {/* Exclude 100-card decks toggle */}
          <button
            onClick={() => { setExcludeFullSize((v) => !v); setPage(1); }}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors ${
              excludeFullSize
                ? "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Hide 100-Card
          </button>

          {/* Tags dropdown */}
          {globalTags.length > 0 && (
            <div className="relative" ref={tagDropdownRef}>
              <button
                onClick={() => { setTagDropdownOpen((o) => !o); setTagFilterInput(""); }}
                className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors ${
                  selectedTagIds.length > 0
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
                </svg>
                Tags
                {selectedTagIds.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-primary text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <svg className={`w-3.5 h-3.5 transition-transform ${tagDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {tagDropdownOpen && (
                <div className="absolute z-50 top-full mt-1.5 left-0 w-64 max-w-[calc(100vw-2rem)] bg-background border border-border rounded-xl shadow-xl">
                {/* Filter input */}
                <div className="px-3 pt-3 pb-2 border-b border-border">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Filter tags…"
                    value={tagFilterInput}
                    onChange={(e) => setTagFilterInput(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* Tag list */}
                <div className="max-h-64 overflow-y-auto">
                  {globalTags.filter((t) => t.name.toLowerCase().includes(tagFilterInput.toLowerCase())).length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No matches</p>
                  ) : (
                    globalTags
                      .filter((t) => t.name.toLowerCase().includes(tagFilterInput.toLowerCase()))
                      .map((tag) => {
                        const active = selectedTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTagFilter(tag.id)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted transition-colors text-left"
                          >
                            <span className="w-4 flex-shrink-0 flex items-center justify-center">
                              {active && (
                                <svg className="w-3.5 h-3.5 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            <span className="w-3 h-3 rounded-full flex-shrink-0 border border-black/10" style={{ backgroundColor: tag.color }} />
                            <span className="text-sm text-foreground">{tag.name}</span>
                          </button>
                        );
                      })
                  )}
                </div>

                {/* Footer: clear all */}
                {selectedTagIds.length > 0 && (
                  <div className="border-t border-border">
                    <button
                      onClick={() => { setSelectedTagIds([]); setPage(1); }}
                      className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-left"
                    >
                      Clear all tags
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>{/* end Row 2 */}
      </div>{/* end Controls */}

      {/* Active tag pills banner */}
      {selectedTagIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-muted-foreground">Filtered by:</span>
          {selectedTagIds.map((id) => {
            const tag = globalTags.find((t) => t.id === id);
            if (!tag) return null;
            return (
              <button
                key={id}
                onClick={() => toggleTagFilter(id)}
                className="flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
              >
                {tag.name}
                <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            );
          })}
        </div>
      )}

      {/* Username filter banner */}
      {usernameFilter && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg text-sm">
          <span className="text-primary">
            Showing decks by <strong>{usernameFilter}</strong>
          </span>
          <button
            onClick={handleClearUsername}
            className="ml-auto text-primary hover:text-primary/80 font-medium"
          >
            Show all decks
          </button>
        </div>
      )}

      {/* Results count */}
      {!loading && (
        <p className="text-sm text-muted-foreground mb-4">
          {totalCount} {totalCount === 1 ? "deck" : "decks"} found
          {search && ` for "${search}"`}
          {format && ` in ${format}`}
          {selectedTagIds.length > 0 && ` · ${selectedTagIds.length} tag${selectedTagIds.length > 1 ? "s" : ""} selected`}
        </p>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-foreground mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading decks...</p>
          </div>
        </div>
      ) : decks.length === 0 ? (
        <div className="text-center py-16">
          <svg className="mx-auto h-16 w-16 text-muted-foreground mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-medium mb-2">No public decks found</h3>
          <p className="text-muted-foreground">
            {search || format
              ? "Try adjusting your search or filters."
              : "Be the first to share a deck! Go to My Decks and make one public."}
          </p>
        </div>
      ) : (
        <>
          {/* Deck grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {decks.map((deck) => (
              <DeckCard key={deck.id} deck={deck} currentUserId={currentUserId} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-40 hover:bg-muted transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground px-4">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-40 hover:bg-muted transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function getCardImageUrl(imgFile: string | null | undefined): string | null {
  if (!imgFile) return null;
  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!blobBase) return null;
  const sanitized = imgFile.replace(/\.jpe?g$/i, "");
  return `${blobBase}/card-images/${sanitized}.jpg`;
}

function getPreviewImages(deck: PublicDeck): [string | null, string | null] {
  return [getCardImageUrl(deck.preview_card_1), getCardImageUrl(deck.preview_card_2)];
}

function DeckCard({ deck, currentUserId }: { deck: PublicDeck; currentUserId?: string }) {
  const router = useRouter();
  const [img1, img2] = getPreviewImages(deck);
  const hasPreview = img1 || img2;
  const isOwner = !!currentUserId && deck.user_id === currentUserId;
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [generateDeck, setGenerateDeck] = useState<Deck | null>(null);
  const [generateMode, setGenerateMode] = useState<"pdf" | "image" | null>(null);
  const [loadingGenerate, setLoadingGenerate] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    setDownloading(true);
    const result = await loadPublicDeckAction(deck.id);
    setDownloading(false);
    if (!result.success || !result.deck) return;
    const cards = (result.deck as any).cards as { card_name: string; quantity: number; is_reserve: boolean }[];
    const main = cards.filter((c) => !c.is_reserve).sort((a, b) => a.card_name.localeCompare(b.card_name));
    const reserve = cards.filter((c) => c.is_reserve).sort((a, b) => a.card_name.localeCompare(b.card_name));
    const lines: string[] = [];
    main.forEach((c) => lines.push(`${c.quantity}\t${c.card_name}`));
    if (reserve.length > 0) {
      lines.push("");
      lines.push("Reserve:");
      reserve.forEach((c) => lines.push(`${c.quantity}\t${c.card_name}`));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${deck.name.replace(/\s+/g, "_")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleCopyAndEdit(e: React.MouseEvent) {
    e.preventDefault();
    setCopying(true);
    const result = await copyPublicDeckAction(deck.id);
    if (result.success && (result as any).deckId) {
      router.push(`/decklist/card-search?deckId=${(result as any).deckId}`);
    } else {
      // Not logged in or error — send to sign-in
      router.push("/sign-in");
    }
    setCopying(false);
  }

  async function handleGenerate(mode: "pdf" | "image") {
    setLoadingGenerate(true);
    const result = await loadPublicDeckAction(deck.id);
    setLoadingGenerate(false);
    if (!result.success || !result.deck) return;
    const cloudDeck = result.deck as any;
    const deckForModal: Deck = {
      id: cloudDeck.id,
      name: cloudDeck.name || deck.name,
      description: cloudDeck.description || "",
      format: cloudDeck.format || deck.format,
      cards: (cloudDeck.cards || []).map((c: any) => ({
        card: {
          name: c.card_name,
          set: c.card_set || "",
          imgFile: c.card_img_file || "",
          dataLine: "", officialSet: "", type: "", brigade: "",
          strength: "", toughness: "", class: "", identifier: "",
          specialAbility: "", rarity: "", reference: "", alignment: "",
          legality: "", testament: "", isGospel: false,
        } as Card,
        quantity: c.quantity,
        isReserve: c.is_reserve,
      })),
      createdAt: new Date(cloudDeck.created_at || deck.created_at),
      updatedAt: new Date(cloudDeck.updated_at || deck.updated_at),
    };
    setGenerateDeck(deckForModal);
    setGenerateMode(mode);
  }

  return (
    <div className="flex flex-col bg-card rounded-lg border border-border hover:shadow-lg transition-shadow overflow-hidden jayden-gradient-bg">
      {/* Clickable preview area */}
      <Link href={`/decklist/${deck.id}`} className="flex-1 block group">
        {/* Card preview */}
        {formatDeckType(deck.format) === "Paragon" && deck.paragon ? (
          <div className="h-36 overflow-hidden">
            <Image src={`/paragons/Paragon ${deck.paragon}.png`} alt={deck.paragon} width={400} height={560} className="w-full h-full object-cover object-top group-hover:brightness-90 transition-[filter]" />
          </div>
        ) : hasPreview ? (
          <div className="h-36 overflow-hidden bg-muted flex items-center justify-center gap-1 px-2 py-2 group-hover:bg-muted/80 transition-colors">
            {img1 && <img src={img1} alt="" className="h-full object-contain rounded group-hover:brightness-90 transition-[filter]" />}
            {img2 && <img src={img2} alt="" className="h-full object-contain rounded group-hover:brightness-90 transition-[filter]" />}
          </div>
        ) : (
          <div className="h-36 bg-muted flex items-center justify-center group-hover:bg-muted/80 transition-colors">
            <svg className="w-12 h-12 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
        )}

        <div className="p-4">
          <h3 className="font-semibold text-lg truncate mb-1">{deck.name}</h3>

          {/* Tournament placement badge */}
          {deck.tournament && deck.tournament.placement != null && (
            <div className={`flex items-center gap-1.5 mb-2 px-2.5 py-1.5 rounded text-xs border ${
              deck.tournament.placement === 1
                ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700/60"
                : deck.tournament.placement === 2
                ? "bg-gray-50 dark:bg-gray-700/30 border-border"
                : deck.tournament.placement === 3
                ? "bg-orange-50 dark:bg-orange-900/15 border-orange-300 dark:border-orange-800/50"
                : "bg-muted border-border"
            }`}>
              {deck.tournament.placement <= 3 && (
                <TrophyIcon place={deck.tournament.placement} className="w-4 h-4 flex-shrink-0" />
              )}
              <span className={`font-semibold ${
                deck.tournament.placement === 1
                  ? "text-yellow-700 dark:text-yellow-300"
                  : deck.tournament.placement === 2
                  ? "text-gray-600 dark:text-gray-300"
                  : deck.tournament.placement === 3
                  ? "text-orange-700 dark:text-orange-300"
                  : "text-muted-foreground"
              }`}>
                {getPlacementLabel(deck.tournament.placement)}
              </span>
              <span className="text-muted-foreground truncate">
                {deck.tournament.tournament_name}
                {deck.tournament.participant_count > 0 && (
                  <> ({deck.tournament.participant_count} players)</>
                )}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between mb-2">
            {deck.username && (
              <p className="text-sm text-muted-foreground">
                by{" "}
                <span
                  role="link"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    router.push(`/decklist/community?username=${encodeURIComponent(deck.username!)}`);
                  }}
                  className="text-muted-foreground underline hover:text-foreground cursor-pointer"
                >
                  {deck.username}
                </span>
              </p>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {(deck.view_count ?? 0) > 0 && <span>{deck.view_count} views</span>}
              <span>{timeAgo(deck.updated_at)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm mb-3">
            <span className={getDeckTypeBadgeClasses(deck.format)}>{formatDeckType(deck.format)}</span>
            <span className="text-muted-foreground">{deck.card_count || 0} cards</span>
            {deck.is_legal === false && (
              <span className="text-[10px] font-medium text-red-600 dark:text-red-400">Not Legal</span>
            )}
            {deck.total_price != null && deck.total_price > 0 && (
              <span className="text-green-600 dark:text-green-400">${deck.total_price.toFixed(2)}</span>
            )}
            {deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
              <span className="text-[10px] text-muted-foreground" title={`Minimum price using cheapest available printings: $${deck.budget_price.toFixed(2)}`}>
                min ${deck.budget_price.toFixed(2)}
              </span>
            )}
          </div>

          {deck.tags && deck.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {deck.tags.slice(0, 6).map((tag) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </Link>

      {/* Action buttons */}
      <div className="flex gap-2 px-4 pb-4">
        <Link
          href={`/decklist/${deck.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors font-medium"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          View
        </Link>

        {currentUserId && (isOwner ? (
          <Link
            href={`/decklist/card-search?deckId=${deck.id}`}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors font-medium"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </Link>
        ) : (
          <button
            onClick={handleCopyAndEdit}
            disabled={copying}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors font-medium disabled:opacity-60 whitespace-nowrap"
          >
            {copying ? (
              <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            )}
            {copying ? "Copying…" : "Copy"}
          </button>
        ))}

        <GoldfishButton deckId={deck.id} deckName={deck.name} format={deck.format} iconOnly />

        {/* Export dropdown — PDF, Image, Download */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            title="Export"
            className="flex items-center justify-center px-2.5 h-full border border-border rounded-lg hover:bg-muted transition-colors"
          >
            {loadingGenerate || downloading ? (
              <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            )}
          </button>
          {showExportMenu && (
            <div className="absolute right-0 bottom-full mb-1 bg-card border border-border rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
              <button
                onClick={() => { handleGenerate("pdf"); setShowExportMenu(false); }}
                disabled={loadingGenerate}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Generate PDF
              </button>
              <button
                onClick={() => { handleGenerate("image"); setShowExportMenu(false); }}
                disabled={loadingGenerate}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Generate Image
              </button>
              <button
                onClick={() => { handleDownload(new MouseEvent("click") as any); setShowExportMenu(false); }}
                disabled={downloading}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download .txt
              </button>
            </div>
          )}
        </div>
      </div>

      {generateDeck && generateMode === "pdf" && (
        <GeneratePDFModal
          deck={generateDeck}
          onClose={() => { setGenerateDeck(null); setGenerateMode(null); }}
          isLegal={deck.is_legal ?? null}
        />
      )}
      {generateDeck && generateMode === "image" && (
        <GenerateDeckImageModal
          deck={generateDeck}
          onClose={() => { setGenerateDeck(null); setGenerateMode(null); }}
          isLegal={deck.is_legal ?? null}
        />
      )}
    </div>
  );
}
