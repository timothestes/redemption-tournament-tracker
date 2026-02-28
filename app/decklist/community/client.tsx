"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { loadPublicDecksAction, loadGlobalTagsAction, copyPublicDeckAction, loadPublicDeckAction, LoadPublicDecksParams } from "../actions";
import { GoldfishButton } from "../../goldfish/components/GoldfishButton";

interface DeckTag { id: string; name: string; color: string; }

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
  if (fmt.includes("type 2") || fmt.includes("multi") || fmt === "t2") return "T2";
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
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [globalTags, setGlobalTags] = useState<DeckTag[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagFilterInput, setTagFilterInput] = useState("");
  const tagDropdownRef = useRef<HTMLDivElement>(null);

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
    };
    const result = await loadPublicDecksAction(params);
    if (result.success) {
      setDecks(result.decks);
      setTotalCount(result.totalCount);
    }
    setLoading(false);
  }, [page, sort, format, search, usernameFilter, selectedTagIds]);

  useEffect(() => {
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
    <div className="w-full max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Community Decks</h1>
        <p className="text-gray-600 dark:text-gray-400">
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
            placeholder="Search by deck name or username..."
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 transition-colors flex-shrink-0"
          >
            Search
          </button>
          {search && (
            <button
              onClick={handleClearSearch}
              className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex-shrink-0"
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
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
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
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
          >
            <option value="newest">Newest</option>
            <option value="most_viewed">Most Viewed</option>
            <option value="name">Name A-Z</option>
          </select>

          {/* Tags dropdown */}
          {globalTags.length > 0 && (
            <div className="relative" ref={tagDropdownRef}>
              <button
                onClick={() => { setTagDropdownOpen((o) => !o); setTagFilterInput(""); }}
                className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors ${
                  selectedTagIds.length > 0
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                    : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
                </svg>
                Tags
                {selectedTagIds.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-blue-600 text-white">
                    {selectedTagIds.length}
                  </span>
                )}
                <svg className={`w-3.5 h-3.5 transition-transform ${tagDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {tagDropdownOpen && (
                <div className="absolute z-50 top-full mt-1.5 left-0 w-64 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl">
                {/* Filter input */}
                <div className="px-3 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Filter tags…"
                    value={tagFilterInput}
                    onChange={(e) => setTagFilterInput(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Tag list */}
                <div className="max-h-64 overflow-y-auto">
                  {globalTags.filter((t) => t.name.toLowerCase().includes(tagFilterInput.toLowerCase())).length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No matches</p>
                  ) : (
                    globalTags
                      .filter((t) => t.name.toLowerCase().includes(tagFilterInput.toLowerCase()))
                      .map((tag) => {
                        const active = selectedTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTagFilter(tag.id)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                          >
                            <span className="w-4 flex-shrink-0 flex items-center justify-center">
                              {active && (
                                <svg className="w-3.5 h-3.5 text-gray-700 dark:text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            <span className="w-3 h-3 rounded-full flex-shrink-0 border border-black/10" style={{ backgroundColor: tag.color }} />
                            <span className="text-sm text-gray-800 dark:text-gray-200">{tag.name}</span>
                          </button>
                        );
                      })
                  )}
                </div>

                {/* Footer: clear all */}
                {selectedTagIds.length > 0 && (
                  <div className="border-t border-gray-100 dark:border-gray-800">
                    <button
                      onClick={() => { setSelectedTagIds([]); setPage(1); }}
                      className="w-full px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
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
          <span className="text-xs text-gray-500 dark:text-gray-400">Filtered by:</span>
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
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
          <span className="text-blue-800 dark:text-blue-200">
            Showing decks by <strong>{usernameFilter}</strong>
          </span>
          <button
            onClick={handleClearUsername}
            className="ml-auto text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
          >
            Show all decks
          </button>
        </div>
      )}

      {/* Results count */}
      {!loading && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
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
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900 dark:border-gray-100 mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading decks...</p>
          </div>
        </div>
      ) : decks.length === 0 ? (
        <div className="text-center py-16">
          <svg className="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-medium mb-2">No public decks found</h3>
          <p className="text-gray-600 dark:text-gray-400">
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
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400 px-4">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
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

  return (
    <div className="flex flex-col bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow overflow-hidden">
      {/* Clickable preview area */}
      <Link href={`/decklist/${deck.id}`} className="flex-1 block group">
        {/* Card preview */}
        {formatDeckType(deck.format) === "Paragon" && deck.paragon ? (
          <div className="h-36 overflow-hidden">
            <img src={`/paragons/Paragon ${deck.paragon}.png`} alt={deck.paragon} className="w-full h-full object-cover object-top group-hover:brightness-90 transition-[filter]" />
          </div>
        ) : hasPreview ? (
          <div className="h-36 overflow-hidden bg-gray-100 dark:bg-gray-900 flex items-center justify-center gap-1 px-2 py-2 group-hover:bg-gray-200 dark:group-hover:bg-gray-800 transition-colors">
            {img1 && <img src={img1} alt="" className="h-full object-contain rounded group-hover:brightness-90 transition-[filter]" />}
            {img2 && <img src={img2} alt="" className="h-full object-contain rounded group-hover:brightness-90 transition-[filter]" />}
          </div>
        ) : (
          <div className="h-36 bg-gray-100 dark:bg-gray-900 flex items-center justify-center group-hover:bg-gray-200 dark:group-hover:bg-gray-800 transition-colors">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
        )}

        <div className="p-4">
          <h3 className="font-semibold text-lg truncate mb-1">{deck.name}</h3>
          <div className="flex items-center justify-between mb-2">
            {deck.username && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                by{" "}
                <span
                  role="link"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    router.push(`/decklist/community?username=${encodeURIComponent(deck.username!)}`);
                  }}
                  className="text-gray-600 dark:text-gray-400 underline hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer"
                >
                  {deck.username}
                </span>
              </p>
            )}
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-500">
              {(deck.view_count ?? 0) > 0 && <span>{deck.view_count} views</span>}
              <span>{timeAgo(deck.updated_at)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm mb-3">
            <span className={getDeckTypeBadgeClasses(deck.format)}>{formatDeckType(deck.format)}</span>
            <span className="text-gray-600 dark:text-gray-400">{deck.card_count || 0} cards</span>
          </div>

          <div className="flex flex-wrap gap-1">
            {deck.tags && deck.tags.length > 0 ? (
              deck.tags.slice(0, 6).map((tag) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                >
                  {tag.name}
                </span>
              ))
            ) : (
              <span className="text-xs text-gray-400 dark:text-gray-500 italic">No tags yet</span>
            )}
          </div>
        </div>
      </Link>

      {/* Action buttons */}
      <div className="flex gap-2 px-4 pb-4">
        <Link
          href={`/decklist/${deck.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
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
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
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
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-60 whitespace-nowrap"
          >
            {copying ? (
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            )}
            {copying ? "Copying…" : "Copy"}
          </button>
        ))}

        <GoldfishButton deckId={deck.id} deckName={deck.name} format={deck.format} iconOnly />

        <button
          onClick={handleDownload}
          disabled={downloading}
          title="Download .txt"
          className="flex items-center justify-center px-2.5 self-stretch border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {downloading ? (
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
