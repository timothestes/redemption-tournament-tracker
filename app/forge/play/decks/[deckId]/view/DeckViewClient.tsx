"use client";

// Read-only Forge deck preview — the Forge counterpart of the public
// /decklist/[deckId] page, minus public-only features (tags, prices, exports).
// Plain <img> throughout: next/image is banned under app/forge/**.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link2, Check, Pencil, Copy, Loader2,
  ChevronLeft, ChevronRight, X, LayoutGrid, GalleryVerticalEnd,
} from "lucide-react";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import type { ForgeDeckView } from "@/app/forge/lib/deckTypes";
import { copyForgeDeck, setForgeDeckShared } from "@/app/forge/lib/forgeDecks";
import {
  resolveDeckEntries,
  groupMainItems,
  sortSideItems,
  splitStack,
  countItems,
  getGroupDisplayName,
  prettifyTypeName,
  type DeckGroupBy,
  type ResolvedDeckItem,
} from "@/app/forge/lib/deckView";
import { getPublicImageUrl } from "@/app/decklist/card-search/hooks/useCardImageUrl";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import ForgeShareDeckModal from "@/app/forge/components/ForgeShareDeckModal";

function formatDeckType(format: string): string {
  const fmt = format.toLowerCase();
  if (fmt.includes("paragon")) return "Paragon";
  if (fmt.includes("type 2") || fmt === "t2") return "T2";
  return "T1";
}

function deckTypeBadgeClasses(format: string): string {
  const deckType = formatDeckType(format);
  if (deckType === "T2") {
    return "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200";
  }
  if (deckType === "Paragon") {
    return "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200";
  }
  return "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200";
}

// The card face for one resolved item, in priority order: approved finished
// upload → composite preview → public card image → name-only tile. Dangling
// forge refs get an explicit placeholder so counts stay honest.
function CardFace({ item }: { item: ResolvedDeckItem }) {
  if (item.forge) {
    const { cardId, data, hasArt, hasFinished } = item.forge;
    if (!data) {
      return (
        <div className="flex aspect-[2.5/3.5] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted p-2 text-center">
          <span className="text-xs font-medium text-muted-foreground">Forge card</span>
          <span className="text-[10px] text-muted-foreground">Not shared with you</span>
        </div>
      );
    }
    if (hasFinished) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/forge/api/art/${cardId}?v=approved&kind=finished`}
          alt={data.name ?? "Forge card"}
          loading="lazy"
          decoding="async"
          className="w-full rounded-md"
          style={{ aspectRatio: "750 / 1050", objectFit: "contain" }}
        />
      );
    }
    return (
      <ForgeCardPreview
        card={data}
        artUrl={hasArt ? `/forge/api/art/${cardId}?v=approved` : null}
        className="w-full rounded-md"
      />
    );
  }
  if (!item.imgFile) {
    return (
      <div className="flex aspect-[2.5/3.5] w-full items-center justify-center rounded-md border bg-muted p-1 text-center">
        <span className="text-[10px] font-medium leading-tight text-muted-foreground">{item.name}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getPublicImageUrl(item.imgFile)}
      alt={item.name}
      loading="lazy"
      decoding="async"
      className="aspect-[2.5/3.5] w-full rounded-md object-contain"
    />
  );
}

function CardTile({ item, onClick }: { item: ResolvedDeckItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-md bg-muted shadow-sm transition-all hover:shadow-md hover:ring-2 hover:ring-primary"
      title={item.name}
    >
      <CardFace item={item} />
      {item.qty > 1 && (
        <span className="absolute right-0.5 top-0.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-lg backdrop-blur-sm">
          ×{item.qty}
        </span>
      )}
      <span className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="w-full truncate p-1 text-left text-[10px] font-semibold leading-tight text-white">
          {item.name}
        </span>
      </span>
    </button>
  );
}

function CardGrid({ items, onSelect }: { items: ResolvedDeckItem[]; onSelect: (item: ResolvedDeckItem) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
      {items.map((item) => (
        <CardTile key={item.key} item={item} onClick={() => onSelect(item)} />
      ))}
    </div>
  );
}

// One physical copy in the stacked view — copies overlap so only a name strip
// of each card shows until the last one in the column.
function StackedCard({ item, onClick }: { item: ResolvedDeckItem; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group relative -mb-32 w-28 flex-shrink-0 last:mb-0" title={item.name}>
      <div className="relative overflow-hidden rounded-md bg-muted shadow-md transition-all hover:ring-2 hover:ring-primary">
        <CardFace item={item} />
        <span className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="w-full truncate p-1.5 text-left text-xs font-semibold leading-tight text-white">
            {item.name}
          </span>
        </span>
      </div>
    </button>
  );
}

// Expand a column's items into one StackedCard per physical copy.
function StackedColumn({ column, onSelect }: { column: ResolvedDeckItem[]; onSelect: (item: ResolvedDeckItem) => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {column.flatMap((item) =>
        Array.from({ length: item.qty }, (_, i) => (
          <StackedCard key={`${item.key}-${i}`} item={item} onClick={() => onSelect(item)} />
        ))
      )}
    </div>
  );
}

export default function DeckViewClient({ deck, granted }: { deck: ForgeDeckView; granted: GrantedForgeCard[] }) {
  const router = useRouter();
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [isShared, setIsShared] = useState(deck.isShared);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState<ResolvedDeckItem | "paragon" | null>(null);
  const [viewMode, setViewMode] = useState<"normal" | "stacked">("normal");
  const [groupBy, setGroupBy] = useState<DeckGroupBy>("type");

  const items = useMemo(() => resolveDeckEntries(granted, deck.entries), [granted, deck.entries]);
  const mainItems = useMemo(() => items.filter((i) => i.zone === "main"), [items]);
  const mainGroups = useMemo(() => groupMainItems(mainItems, groupBy), [mainItems, groupBy]);
  const reserveItems = useMemo(() => sortSideItems(items.filter((i) => i.zone === "reserve")), [items]);
  const maybeItems = useMemo(() => sortSideItems(items.filter((i) => i.zone === "maybeboard")), [items]);
  const mainCount = countItems(mainItems);
  const reserveCount = countItems(reserveItems);

  const isParagon = formatDeckType(deck.format) === "Paragon";

  // Flat list in display order (main groups → reserve → considering) that the
  // preview modal's prev/next arrows cycle through.
  const navItems = useMemo(
    () => [...mainGroups.flatMap(([, g]) => g), ...reserveItems, ...maybeItems],
    [mainGroups, reserveItems, maybeItems],
  );
  const enlargedIndex =
    enlarged !== null && enlarged !== "paragon" ? navItems.findIndex((i) => i.key === enlarged.key) : -1;
  const hasNav = enlargedIndex !== -1 && navItems.length > 1;

  const navigate = useCallback(
    (delta: number) => {
      setEnlarged((cur) => {
        if (cur === null || cur === "paragon" || navItems.length < 2) return cur;
        const idx = navItems.findIndex((i) => i.key === cur.key);
        if (idx === -1) return cur;
        return navItems[(idx + delta + navItems.length) % navItems.length];
      });
    },
    [navItems],
  );

  useEffect(() => {
    if (enlarged === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setEnlarged(null);
      else if (e.key === "ArrowLeft") navigate(-1);
      else if (e.key === "ArrowRight") navigate(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enlarged, navigate]);

  const touchStartX = useRef<number | null>(null);

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/forge/play/decks/${deck.id}/view`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function applyShare(shared: boolean) {
    const res = await setForgeDeckShared(deck.id, shared);
    if (res.ok) setIsShared(shared);
  }

  async function copyToMyDecks() {
    setCopying(true);
    setCopyError(null);
    const res = await copyForgeDeck(deck.id);
    setCopying(false);
    // `=== false` narrowing: tsconfig strict:false breaks `res.ok ? … : …`.
    if (res.ok === false) {
      setCopyError(res.error);
      return;
    }
    router.push(`/forge/play/decks/${res.id}`);
  }

  return (
    <div className="mt-4">
      {/* Enlarged card modal — arrows/keyboard/swipe cycle through the deck */}
      {enlarged !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setEnlarged(null)}
        >
          <button
            onClick={() => setEnlarged(null)}
            className="absolute right-4 top-4 rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
          <div
            className="flex w-full max-w-lg items-center justify-center gap-2 sm:gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {hasNav && (
              <button
                onClick={() => navigate(-1)}
                className="hidden flex-shrink-0 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25 sm:block"
                aria-label="Previous card"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            <div
              className="w-full max-w-sm"
              onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                const start = touchStartX.current;
                touchStartX.current = null;
                if (start === null) return;
                const dx = e.changedTouches[0].clientX - start;
                if (Math.abs(dx) > 48) navigate(dx > 0 ? -1 : 1);
              }}
            >
              {enlarged === "paragon" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/paragons/Paragon ${deck.paragon}.png`}
                  alt={deck.paragon ?? "Paragon"}
                  className="w-full rounded-lg shadow-2xl"
                />
              ) : (
                <>
                  <CardFace item={enlarged} />
                  <div className="mt-3 text-center">
                    <p className="text-sm font-semibold text-white">
                      {enlarged.name}
                      {enlarged.qty > 1 && <span className="font-normal text-white/70"> ×{enlarged.qty}</span>}
                    </p>
                    <p className="text-xs text-white/70">
                      {enlarged.type && `${prettifyTypeName(enlarged.type)}`}
                      {hasNav && `${enlarged.type ? " · " : ""}${enlargedIndex + 1} of ${navItems.length}`}
                    </p>
                  </div>
                </>
              )}
            </div>
            {hasNav && (
              <button
                onClick={() => navigate(1)}
                className="hidden flex-shrink-0 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25 sm:block"
                aria-label="Next card"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl" style={{ fontFamily: "Cinzel, serif" }}>{deck.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${deckTypeBadgeClasses(deck.format)}`}>
              {formatDeckType(deck.format)}
            </span>
            {isParagon && deck.paragon && (
              <span className="text-sm text-muted-foreground">
                Paragon: <strong>{deck.paragon}</strong>
              </span>
            )}
            <span className="text-sm text-muted-foreground">by {deck.ownerName}</span>
            <span className="text-sm text-muted-foreground">
              {mainCount} cards{reserveCount > 0 ? ` + ${reserveCount} reserve` : ""}
            </span>
            <span className="text-sm text-muted-foreground">
              Updated {new Date(deck.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={copyLink}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            {linkCopied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
            {linkCopied ? "Copied!" : "Copy link"}
          </button>
          {deck.isOwner ? (
            <>
              <button
                onClick={() => setShareOpen(true)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                {isShared ? "Shared with the Forge" : "Private"}
              </button>
              <Link
                href={`/forge/play/decks/${deck.id}`}
                className="flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-800"
              >
                <Pencil className="h-4 w-4" />
                Edit in builder
              </Link>
            </>
          ) : (
            <button
              onClick={copyToMyDecks}
              disabled={copying}
              className="flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-800 disabled:opacity-50"
            >
              {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              {copying ? "Copying…" : "Copy to my decks"}
            </button>
          )}
        </div>
      </div>

      {copyError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {copyError}
        </div>
      )}

      {/* Paragon card */}
      {isParagon && deck.paragon && (
        <div className="mt-6 max-w-[180px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/paragons/Paragon ${deck.paragon}.png`}
            alt={deck.paragon}
            className="w-full cursor-pointer rounded-lg shadow-md transition-all hover:shadow-xl"
            onClick={() => setEnlarged("paragon")}
            title="Click to view full size"
          />
        </div>
      )}

      {/* View controls */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setViewMode(viewMode === "normal" ? "stacked" : "normal")}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
        >
          {viewMode === "normal" ? (
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          ) : (
            <GalleryVerticalEnd className="h-4 w-4 text-muted-foreground" />
          )}
          {viewMode === "normal" ? "Normal" : "Stacked"}
        </button>
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as DeckGroupBy)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
        >
          <option value="type">Group by Type</option>
          <option value="alignment">Group by Alignment</option>
          <option value="none">No Grouping</option>
        </select>
      </div>

      {/* Main deck */}
      <section className="mt-6">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
          Main Deck
          <span className="text-sm font-normal text-muted-foreground">({mainCount} cards)</span>
        </h2>
        {mainItems.length === 0 ? (
          <p className="italic text-muted-foreground">No cards in main deck.</p>
        ) : viewMode === "stacked" ? (
          /* Stacked view — reserve and considering render inline as columns */
          <div className="flex flex-wrap items-start gap-4">
            {mainGroups.flatMap(([groupName, groupItems]) =>
              splitStack(groupItems).map((column, colIndex) => (
                <div key={`${groupName}-${colIndex}`} className="flex flex-col">
                  {groupBy === "alignment" && colIndex === 0 && (
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-muted-foreground">{groupName}</h3>
                      <span className="text-xs text-muted-foreground">({countItems(groupItems)})</span>
                    </div>
                  )}
                  <StackedColumn column={column} onSelect={setEnlarged} />
                </div>
              ))
            )}
            {reserveItems.length > 0 &&
              splitStack(reserveItems).map((column, colIndex) => (
                <div key={`reserve-${colIndex}`} className="ml-4 flex flex-col">
                  {colIndex === 0 && (
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-purple-400">Reserve</h3>
                      <span className="text-xs text-muted-foreground">({reserveCount})</span>
                    </div>
                  )}
                  <StackedColumn column={column} onSelect={setEnlarged} />
                </div>
              ))}
            {maybeItems.length > 0 &&
              splitStack(maybeItems).map((column, colIndex) => (
                <div key={`maybe-${colIndex}`} className="ml-4 flex flex-col opacity-75">
                  {colIndex === 0 && (
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-lg font-semibold italic text-muted-foreground">Considering</h3>
                      <span className="text-xs text-muted-foreground">({countItems(maybeItems)})</span>
                    </div>
                  )}
                  <StackedColumn column={column} onSelect={setEnlarged} />
                </div>
              ))}
          </div>
        ) : (
          <div className="space-y-4">
            {mainGroups.map(([groupName, groupItems]) => (
              <div key={groupName}>
                {groupBy !== "none" && (
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {getGroupDisplayName(groupName)}
                    <span className="ml-1.5 font-normal">({countItems(groupItems)})</span>
                  </h3>
                )}
                <CardGrid items={groupItems} onSelect={setEnlarged} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reserve (normal view only — stacked renders it inline above) */}
      {viewMode === "normal" && reserveItems.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
            Reserve
            <span className="text-sm font-normal text-muted-foreground">({reserveCount} cards)</span>
          </h2>
          <CardGrid items={reserveItems} onSelect={setEnlarged} />
        </section>
      )}

      {/* Maybeboard — a scratchpad, not part of the deck */}
      {viewMode === "normal" && maybeItems.length > 0 && (
        <section className="mt-8 opacity-80">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold italic text-muted-foreground">
            Considering
            <span className="text-sm font-normal not-italic">({countItems(maybeItems)} cards)</span>
          </h2>
          <CardGrid items={maybeItems} onSelect={setEnlarged} />
        </section>
      )}

      {deck.isOwner && (
        <ForgeShareDeckModal
          open={shareOpen}
          onOpenChange={setShareOpen}
          deckId={deck.id}
          deckName={deck.name}
          isShared={isShared}
          onSetShared={applyShare}
        />
      )}
    </div>
  );
}
