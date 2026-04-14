"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { MobileDrawer } from "@/components/ui/mobile-drawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { loadPublicDecksAction, type LoadPublicDecksParams } from "@/app/decklist/actions";
import { DeckPickerCard } from "./DeckPickerCard";
import type { DeckOption } from "./DeckPickerCard";

// ─── Constants ────────────────────────────────────────────────────────

const COMMUNITY_PAGE_SIZE = 12;
const MY_DECKS_PAGE_SIZE = 12;

// ─── Props ──────────────────────────────────────────────────────────

interface DeckPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (deck: DeckOption) => void;
  myDecks: DeckOption[];
  selectedDeckId?: string | null;
}

// ─── Skeleton card for loading state ────────────────────────────────

function SkeletonCard() {
  return <div className="animate-pulse rounded-lg bg-muted h-[140px]" />;
}

// ─── Shared inner content ───────────────────────────────────────────

function DeckPickerContent({
  myDecks,
  selectedDeckId,
  onSelect,
}: {
  myDecks: DeckOption[];
  selectedDeckId?: string | null;
  onSelect: (deck: DeckOption) => void;
}) {
  const [activeTab, setActiveTab] = useState<"my" | "community">("my");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // ── My Decks state ──
  const [mySearch, setMySearch] = useState("");
  const [mySort, setMySort] = useState<"latest" | "last_played" | "name">("last_played");
  const [myPage, setMyPage] = useState(1);

  // ── Community state ──
  const [communitySearch, setCommunitySearch] = useState("");
  const [communityFormat, setCommunityFormat] = useState("");
  const [communitySort, setCommunitySort] = useState<"newest" | "most_viewed" | "name">("newest");
  const [communityPage, setCommunityPage] = useState(1);
  const [communityResults, setCommunityResults] = useState<DeckOption[]>([]);
  const [communityTotal, setCommunityTotal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus search on mount
  useEffect(() => {
    const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setCommunityPage(1);
  }, [communitySearch, communityFormat, communitySort]);

  // Community search — debounced, triggers on filter/page changes
  const fetchCommunity = useCallback(async () => {
    setIsSearching(true);
    try {
      const params: LoadPublicDecksParams = {
        page: communityPage,
        pageSize: COMMUNITY_PAGE_SIZE,
        sort: communitySort,
      };
      if (communitySearch.length >= 2) params.search = communitySearch;
      if (communityFormat) params.format = communityFormat;

      const result = await loadPublicDecksAction(params);
      if (result.success) {
        setCommunityResults(
          result.decks.map((d: any) => ({
            id: d.id,
            name: d.name,
            format: d.format,
            card_count: d.card_count,
            username: d.username,
            preview_card_1: d.preview_card_1,
            preview_card_2: d.preview_card_2,
            paragon: d.paragon,
          }))
        );
        setCommunityTotal(result.totalCount);
      }
    } catch {
      setCommunityResults([]);
      setCommunityTotal(0);
    } finally {
      setIsSearching(false);
      setHasSearched(true);
    }
  }, [communityPage, communitySort, communitySearch, communityFormat]);

  // Debounce community search on text input, immediate on filter/page changes
  useEffect(() => {
    if (activeTab !== "community") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchCommunity, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchCommunity, activeTab]);

  // Load community on first tab switch
  useEffect(() => {
    if (activeTab === "community" && !hasSearched) {
      fetchCommunity();
    }
  }, [activeTab, hasSearched, fetchCommunity]);

  // ── My Decks sorting, filtering + pagination ──
  const sortedMyDecks = [...myDecks].sort((a, b) => {
    if (mySort === "last_played") {
      // Decks with last_played_at first, then by date descending
      const aTime = a.last_played_at ? new Date(a.last_played_at).getTime() : 0;
      const bTime = b.last_played_at ? new Date(b.last_played_at).getTime() : 0;
      return bTime - aTime;
    }
    if (mySort === "name") {
      return a.name.localeCompare(b.name);
    }
    return 0; // "latest" — keep server order (updated_at DESC)
  });
  const filteredMyDecks = mySearch.length > 0
    ? sortedMyDecks.filter((d) => d.name.toLowerCase().includes(mySearch.toLowerCase()))
    : sortedMyDecks;
  const myTotalPages = Math.max(1, Math.ceil(filteredMyDecks.length / MY_DECKS_PAGE_SIZE));
  const myPagedDecks = filteredMyDecks.slice(
    (myPage - 1) * MY_DECKS_PAGE_SIZE,
    myPage * MY_DECKS_PAGE_SIZE
  );

  // Reset my decks page when search or sort changes
  useEffect(() => { setMyPage(1); }, [mySearch, mySort]);

  // Scroll grid to top on page change
  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 });
  }, [myPage, communityPage]);

  // ── Community pagination ──
  const communityTotalPages = Math.max(1, Math.ceil(communityTotal / COMMUNITY_PAGE_SIZE));

  // ── Render ──

  const searchValue = activeTab === "my" ? mySearch : communitySearch;
  const setSearchValue = activeTab === "my" ? setMySearch : setCommunitySearch;

  return (
    <div className="flex flex-col gap-2 flex-1 overflow-hidden">
      {/* Tabs */}
      <div className="flex gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab("my")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "my"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          My Decks
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("community")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "community"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          Community
        </button>
      </div>

      {/* Search + filters row */}
      <div className="flex gap-2 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchInputRef}
            placeholder={activeTab === "my" ? "Search your decks..." : "Search decks, players..."}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="pl-9 h-9 text-sm focus-visible:ring-0 focus-visible:border-primary"
          />
        </div>

        {/* My Decks sort */}
        {activeTab === "my" && (
          <select
            value={mySort}
            onChange={(e) => setMySort(e.target.value as any)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            <option value="latest">Latest</option>
            <option value="last_played">Last Played</option>
            <option value="name">Name</option>
          </select>
        )}

        {/* Community-only filters */}
        {activeTab === "community" && (
          <>
            <select
              value={communityFormat}
              onChange={(e) => setCommunityFormat(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="">All Formats</option>
              <option value="Type 1">Type 1</option>
              <option value="Type 2">Type 2</option>
              <option value="Paragon">Paragon</option>
            </select>
            <select
              value={communitySort}
              onChange={(e) => setCommunitySort(e.target.value as any)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="newest">Newest</option>
              <option value="most_viewed">Popular</option>
              <option value="name">Name</option>
            </select>
          </>
        )}
      </div>

      {/* Scrollable grid area — fixed flex so modal doesn't jump between pages */}
      <div ref={gridRef} className="flex-1 overflow-y-auto min-h-0" style={{ minHeight: 0 }}>
        {activeTab === "my" ? (
          // ── My Decks ──
          myDecks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No saved decks yet. Build a deck or try the Community tab.
            </p>
          ) : myPagedDecks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No decks matching &lsquo;{mySearch}&rsquo;
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {myPagedDecks.map((deck) => (
                <DeckPickerCard
                  key={deck.id}
                  deck={deck}
                  onClick={() => onSelect(deck)}
                  selected={selectedDeckId === deck.id}
                />
              ))}
            </div>
          )
        ) : (
          // ── Community ──
          isSearching ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Array.from({ length: COMMUNITY_PAGE_SIZE }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : communityResults.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {hasSearched ? "No community decks found." : "Loading..."}
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {communityResults.map((deck) => (
                <DeckPickerCard
                  key={deck.id}
                  deck={deck}
                  onClick={() => onSelect(deck)}
                  selected={selectedDeckId === deck.id}
                />
              ))}
            </div>
          )
        )}
      </div>

      {/* Pagination */}
      {activeTab === "my" && myTotalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMyPage((p) => Math.max(1, p - 1))}
            disabled={myPage === 1}
            className="h-7 w-7 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {myPage} / {myTotalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMyPage((p) => Math.min(myTotalPages, p + 1))}
            disabled={myPage === myTotalPages}
            className="h-7 w-7 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      {activeTab === "community" && communityTotalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCommunityPage((p) => Math.max(1, p - 1))}
            disabled={communityPage === 1}
            className="h-7 w-7 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {communityPage} / {communityTotalPages}
            {communityTotal > 0 && ` (${communityTotal} decks)`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCommunityPage((p) => Math.min(communityTotalPages, p + 1))}
            disabled={communityPage === communityTotalPages}
            className="h-7 w-7 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main modal component ───────────────────────────────────────────

export function DeckPickerModal({
  open,
  onOpenChange,
  onSelect,
  myDecks,
  selectedDeckId,
}: DeckPickerModalProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const handleSelect = useCallback(
    (deck: DeckOption) => {
      onSelect(deck);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  const content = (
    <DeckPickerContent
      myDecks={myDecks}
      selectedDeckId={selectedDeckId}
      onSelect={handleSelect}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Select a Deck</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex-1 overflow-hidden flex flex-col gap-3 p-4">
            {content}
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <MobileDrawer
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Select a Deck"
    >
      <div className="flex flex-col gap-3 px-4 pb-4 h-full overflow-hidden">
        {content}
      </div>
    </MobileDrawer>
  );
}
