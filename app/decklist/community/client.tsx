"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { loadPublicDecksAction, copyPublicDeckAction, LoadPublicDecksParams } from "../actions";

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
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
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

  const loadDecks = useCallback(async () => {
    setLoading(true);
    const params: LoadPublicDecksParams = {
      page,
      pageSize: PAGE_SIZE,
      sort,
      format: format || undefined,
      search: search || undefined,
      username: usernameFilter || undefined,
    };
    const result = await loadPublicDecksAction(params);
    if (result.success) {
      setDecks(result.decks);
      setTotalCount(result.totalCount);
    }
    setLoading(false);
  }, [page, sort, format, search, usernameFilter]);

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
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
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
            className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 transition-colors"
          >
            Search
          </button>
          {search && (
            <button
              onClick={handleClearSearch}
              className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              Clear
            </button>
          )}
        </div>

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
      </div>

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
      <Link href={`/decklist/${deck.id}`} className="flex-1 block">
        {/* Card preview */}
        {formatDeckType(deck.format) === "Paragon" && deck.paragon ? (
          <div className="h-36 overflow-hidden">
            <img src={`/paragons/Paragon ${deck.paragon}.png`} alt={deck.paragon} className="w-full h-full object-cover object-top" />
          </div>
        ) : hasPreview ? (
          <div className="h-36 overflow-hidden bg-gray-100 dark:bg-gray-900 flex items-center justify-center gap-1 px-2 py-2">
            {img1 && <img src={img1} alt="" className="h-full object-contain rounded" />}
            {img2 && <img src={img2} alt="" className="h-full object-contain rounded" />}
          </div>
        ) : (
          <div className="h-36 bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
        )}

        <div className="p-4">
          <h3 className="font-semibold text-lg truncate mb-1">{deck.name}</h3>
          {deck.username && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
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

          <div className="flex items-center gap-3 text-sm mb-3">
            <span className={getDeckTypeBadgeClasses(deck.format)}>{formatDeckType(deck.format)}</span>
            <span className="text-gray-600 dark:text-gray-400">{deck.card_count || 0} cards</span>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500">
            <span>Updated {timeAgo(deck.updated_at)}</span>
            {(deck.view_count ?? 0) > 0 && <span>{deck.view_count} views</span>}
          </div>
        </div>
      </Link>

      {/* Action buttons */}
      <div className="flex gap-2 px-4 pb-4">
        <Link
          href={`/decklist/${deck.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          View
        </Link>

        {isOwner ? (
          <Link
            href={`/decklist/card-search?deckId=${deck.id}`}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </Link>
        ) : (
          <button
            onClick={handleCopyAndEdit}
            disabled={copying}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-60"
          >
            {copying ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
            )}
            {copying ? "Copying…" : "Copy & Edit"}
          </button>
        )}
      </div>
    </div>
  );
}
