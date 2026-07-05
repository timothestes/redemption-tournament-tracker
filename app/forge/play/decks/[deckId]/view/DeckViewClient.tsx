"use client";

// Read-only Forge deck preview — the Forge counterpart of the public
// /decklist/[deckId] page, minus public-only features (tags, prices, exports).
// Plain <img> throughout: next/image is banned under app/forge/**.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Link2, Check, Pencil, Copy, Loader2 } from "lucide-react";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import type { ForgeDeckView } from "@/app/forge/lib/deckTypes";
import { copyForgeDeck, setForgeDeckShared } from "@/app/forge/lib/forgeDecks";
import {
  resolveDeckEntries,
  groupMainItems,
  sortSideItems,
  countItems,
  getGroupDisplayName,
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

export default function DeckViewClient({ deck, granted }: { deck: ForgeDeckView; granted: GrantedForgeCard[] }) {
  const router = useRouter();
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [isShared, setIsShared] = useState(deck.isShared);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState<ResolvedDeckItem | "paragon" | null>(null);

  const items = useMemo(() => resolveDeckEntries(granted, deck.entries), [granted, deck.entries]);
  const mainItems = useMemo(() => items.filter((i) => i.zone === "main"), [items]);
  const mainGroups = useMemo(() => groupMainItems(mainItems), [mainItems]);
  const reserveItems = useMemo(() => sortSideItems(items.filter((i) => i.zone === "reserve")), [items]);
  const maybeItems = useMemo(() => sortSideItems(items.filter((i) => i.zone === "maybeboard")), [items]);
  const mainCount = countItems(mainItems);
  const reserveCount = countItems(reserveItems);

  const isParagon = formatDeckType(deck.format) === "Paragon";

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
      {/* Enlarged card modal */}
      {enlarged !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setEnlarged(null)}
        >
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            {enlarged === "paragon" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/paragons/Paragon ${deck.paragon}.png`}
                alt={deck.paragon ?? "Paragon"}
                className="w-full rounded-lg shadow-2xl"
              />
            ) : (
              <CardFace item={enlarged} />
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

      {/* Main deck */}
      <section className="mt-8">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
          Main Deck
          <span className="text-sm font-normal text-muted-foreground">({mainCount} cards)</span>
        </h2>
        {mainItems.length === 0 ? (
          <p className="italic text-muted-foreground">No cards in main deck.</p>
        ) : (
          <div className="space-y-4">
            {mainGroups.map(([groupName, groupItems]) => (
              <div key={groupName}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {getGroupDisplayName(groupName)}
                  <span className="ml-1.5 font-normal">({countItems(groupItems)})</span>
                </h3>
                <CardGrid items={groupItems} onSelect={setEnlarged} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reserve */}
      {reserveItems.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
            Reserve
            <span className="text-sm font-normal text-muted-foreground">({reserveCount} cards)</span>
          </h2>
          <CardGrid items={reserveItems} onSelect={setEnlarged} />
        </section>
      )}

      {/* Maybeboard — a scratchpad, not part of the deck */}
      {maybeItems.length > 0 && (
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
