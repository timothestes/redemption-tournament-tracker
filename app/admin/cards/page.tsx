"use client";

import { useState, useEffect, useCallback, useContext, createContext, Suspense, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import TopNav from "../../../components/top-nav";
import { useIsAdmin } from "../../../hooks/useIsAdmin";
import { useRouter } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import ConfirmationDialog from "../../../components/ui/confirmation-dialog";
import { CARD_DATA_URL } from "../../decklist/card-search/constants";
import {
  getDuplicateGroups,
  getDuplicateGroupStats,
  type DuplicateGroupStats,
  createDuplicateGroup,
  updateDuplicateGroup,
  deleteDuplicateGroup,
  addGroupMember,
  removeGroupMember,
  detectPotentialDuplicates,
  bulkApproveSuggestions,
  type DuplicateGroupRow,
  type DuplicateGroupMemberRow,
  type Suggestion,
  type SuggestedGroup,
  type SuggestedAddition,
} from "./actions";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = "groups" | "add" | "suggestions";

interface CardInfo {
  name: string;
  type: string;
  set: string;
  imgFile: string;
}

/* ------------------------------------------------------------------ */
/*  Shared card data (module-level cache, loaded once)                 */
/* ------------------------------------------------------------------ */

let cardDataPromise: Promise<CardInfo[]> | null = null;
let cardDataCache: CardInfo[] | null = null;

function fetchCardData(): Promise<CardInfo[]> {
  if (cardDataCache) return Promise.resolve(cardDataCache);
  if (!cardDataPromise) {
    cardDataPromise = fetch(CARD_DATA_URL)
      .then((res) => res.text())
      .then((text) => {
        const lines = text.split("\n").slice(1).filter((l) => l.trim());
        const cards: CardInfo[] = [];
        for (const line of lines) {
          const cols = line.split("\t");
          const name = cols[0]?.trim();
          if (!name) continue;
          cards.push({
            name,
            type: cols[4]?.trim() || "",
            set: cols[1]?.trim() || "",
            imgFile: (cols[2] || "").replace(/\.jpe?g$/i, ""),
          });
        }
        cardDataCache = cards;
        return cards;
      });
  }
  return cardDataPromise;
}

function useCardLookup() {
  const [allCards, setAllCards] = useState<CardInfo[]>(cardDataCache || []);
  const [loading, setLoading] = useState(!cardDataCache);

  useEffect(() => {
    if (cardDataCache) return;
    fetchCardData()
      .then((cards) => {
        setAllCards(cards);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const search = useCallback(
    (query: string, limit = 20): CardInfo[] => {
      if (!query.trim() || query.length < 2) return [];
      const q = query.toLowerCase();
      const results: CardInfo[] = [];
      for (const card of allCards) {
        if (card.name.toLowerCase().includes(q)) {
          results.push(card);
          if (results.length >= limit) break;
        }
      }
      return results;
    },
    [allCards]
  );

  // Build a name→CardInfo lookup map for hover previews
  const cardsByName = useMemo(() => {
    const map = new Map<string, CardInfo>();
    for (const card of allCards) {
      const key = card.name.toLowerCase();
      if (!map.has(key)) map.set(key, card);
    }
    return map;
  }, [allCards]);

  return { search, loading, allCards, cardsByName };
}

/* ------------------------------------------------------------------ */
/*  Shared card lookup context                                         */
/* ------------------------------------------------------------------ */

const CardLookupContext = createContext<Map<string, CardInfo>>(new Map());

/* ------------------------------------------------------------------ */
/*  Card image preview                                                 */
/* ------------------------------------------------------------------ */

function CardImagePreview({ imgFile, name }: { imgFile: string; name: string }) {
  const imageUrl = `${process.env.NEXT_PUBLIC_BLOB_BASE_URL}/card-images/${imgFile}.jpg`;
  return (
    <img
      src={imageUrl}
      alt={name}
      className="w-full rounded-md opacity-90 hover:opacity-100 transition-opacity"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Card hover preview (portal-based, follows cursor)                  */
/* ------------------------------------------------------------------ */

function CardHoverPreview({
  cardName,
  anchorRect,
}: {
  cardName: string;
  anchorRect: DOMRect;
}) {
  const cardsByName = useContext(CardLookupContext);
  const card = cardsByName.get(cardName.toLowerCase());

  if (!card) return null;

  const imageUrl = `${process.env.NEXT_PUBLIC_BLOB_BASE_URL}/card-images/${card.imgFile}.jpg`;

  // Position: above the chip if there's room, otherwise below
  const previewWidth = 200;
  const previewHeight = 280;
  const gap = 8;

  let top = anchorRect.top - previewHeight - gap;
  let left = anchorRect.left + anchorRect.width / 2 - previewWidth / 2;

  // If above goes off screen, show below
  if (top < 8) {
    top = anchorRect.bottom + gap;
  }

  // Clamp horizontal
  if (left < 8) left = 8;
  if (left + previewWidth > window.innerWidth - 8) {
    left = window.innerWidth - previewWidth - 8;
  }

  return createPortal(
    <div
      className="fixed z-[100] pointer-events-none"
      style={{ top, left, width: previewWidth }}
    >
      <div className="rounded-lg overflow-hidden bg-popover/95 backdrop-blur-xl shadow-[0px_12px_32px_0px_rgba(0,40,142,0.08)] dark:shadow-[0px_20px_40px_rgba(6,14,32,0.6)]">
        <img
          src={imageUrl}
          alt={card.name}
          className="w-full"
          style={{ height: previewHeight, objectFit: "cover" }}
        />
        <div className="px-2 py-1.5">
          <p className="text-[11px] font-medium text-foreground truncate">{card.name}</p>
          <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{card.type}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/*  Source badge                                                        */
/* ------------------------------------------------------------------ */

function SourceBadge({ source }: { source: string }) {
  const styles =
    source === "ordir"
      ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary"
      : "bg-accent text-accent-foreground";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles}`}
    >
      {source}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Card search typeahead                                              */
/* ------------------------------------------------------------------ */

function CardSearchTypeahead({
  onSelect,
  excludeNames = [],
  placeholder = "Search cards...",
}: {
  onSelect: (card: CardInfo) => void;
  excludeNames?: string[];
  placeholder?: string;
}) {
  const { search } = useCardLookup();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const excludeSet = useMemo(
    () => new Set(excludeNames.map((n) => n.toLowerCase())),
    [excludeNames]
  );

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    const timeout = setTimeout(() => {
      const found = search(query, 30).filter(
        (c) => !excludeSet.has(c.name.toLowerCase())
      );
      setResults(found.slice(0, 12));
      setIsOpen(found.length > 0);
      setActiveIndex(-1);
    }, 150);
    return () => clearTimeout(timeout);
  }, [query, search, excludeSet]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (card: CardInfo) => {
    onSelect(card);
    setQuery("");
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        className="w-full"
      />
      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full rounded-lg bg-popover/95 backdrop-blur-xl shadow-[0px_12px_32px_0px_rgba(0,40,142,0.08)] dark:shadow-[0px_20px_40px_rgba(6,14,32,0.6)] overflow-hidden">
          <div className="max-h-72 overflow-y-auto py-1">
            {results.map((card, i) => (
              <button
                key={`${card.name}-${card.set}`}
                onClick={() => handleSelect(card)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                  i === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/60"
                }`}
              >
                <span className="text-sm font-medium text-foreground truncate flex-1">
                  {card.name}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider flex-shrink-0">
                  {card.type}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Member chip                                                        */
/* ------------------------------------------------------------------ */

function MemberChip({
  member,
  onRemove,
  compact = false,
}: {
  member: DuplicateGroupMemberRow | { card_name: string };
  onRemove?: () => void;
  compact?: boolean;
}) {
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);

  const cardName = "card_name" in member ? member.card_name : "";

  const handleMouseEnter = () => {
    if (chipRef.current) {
      setHoverRect(chipRef.current.getBoundingClientRect());
    }
  };

  const handleMouseLeave = () => {
    setHoverRect(null);
  };

  return (
    <>
      <span
        ref={chipRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`inline-flex items-center gap-1.5 rounded-full bg-secondary text-secondary-foreground cursor-default ${
          compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
        }`}
      >
        <span className="truncate max-w-[200px]">{cardName}</span>
        {"ordir_sets" in member && member.ordir_sets && (
          <span className="text-[9px] text-muted-foreground font-mono uppercase">
            {member.ordir_sets}
          </span>
        )}
        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Remove"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </span>
      {hoverRect && <CardHoverPreview cardName={cardName} anchorRect={hoverRect} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Group row (expandable)                                             */
/* ------------------------------------------------------------------ */

function GroupRow({
  group,
  onDelete,
  onUpdate,
  onMemberAdded,
  onMemberRemoved,
}: {
  group: DuplicateGroupRow;
  onDelete: (id: number) => void;
  onUpdate: (id: number, updates: Partial<DuplicateGroupRow>) => Promise<void>;
  onMemberAdded: () => void;
  onMemberRemoved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [canonicalName, setCanonicalName] = useState(group.canonical_name);
  const [notes, setNotes] = useState(group.notes || "");
  const [cardType, setCardType] = useState(group.card_type || "");
  const [saving, setSaving] = useState(false);
  const [removingMember, setRemovingMember] = useState<number | null>(null);
  const [addingMember, setAddingMember] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(group.id, {
      canonical_name: canonicalName.trim(),
      notes: notes.trim() || null,
      card_type: cardType.trim() || null,
    });
    setEditing(false);
    setSaving(false);
  };

  const handleRemoveMember = async (memberId: number) => {
    setRemovingMember(memberId);
    const result = await removeGroupMember(memberId);
    if (!result.error) {
      onMemberRemoved();
    }
    setRemovingMember(null);
  };

  const handleAddMember = async (card: CardInfo) => {
    setAddingMember(true);
    const result = await addGroupMember(group.id, card.name);
    if (!result.error) {
      onMemberAdded();
    }
    setAddingMember(false);
  };

  return (
    <div className="rounded-lg bg-card transition-colors overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors ${
          expanded ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <svg
          className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>

        <span className="font-semibold text-sm text-foreground flex-1 truncate">
          {group.canonical_name}
        </span>

        <span className="text-xs text-muted-foreground tabular-nums">
          {group.members.length} card{group.members.length !== 1 ? "s" : ""}
        </span>

        {group.card_type && (
          <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
            {group.card_type}
          </span>
        )}

        <SourceBadge source={group.source} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 min-w-0">
          {/* Members */}
          <div className="flex flex-wrap gap-1.5">
            {group.members.map((m) => (
              <MemberChip
                key={m.id}
                member={m}
                onRemove={
                  group.members.length > 1
                    ? () => handleRemoveMember(m.id)
                    : undefined
                }
              />
            ))}
            {removingMember && (
              <span className="text-xs text-muted-foreground self-center animate-pulse">
                Removing...
              </span>
            )}
          </div>

          {/* Add member search */}
          <div className="pt-1">
            <CardSearchTypeahead
              onSelect={handleAddMember}
              excludeNames={group.members.map((m) => m.card_name)}
              placeholder="Add a card to this group..."
            />
            {addingMember && (
              <p className="text-xs text-muted-foreground mt-1 animate-pulse">
                Adding...
              </p>
            )}
          </div>

          {/* Edit / Delete actions */}
          {editing ? (
            <div className="space-y-3 pt-2 bg-muted/30 rounded-lg p-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                  Canonical Name
                </label>
                <Input value={canonicalName} onChange={(e) => setCanonicalName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                  Card Type
                </label>
                <Input
                  value={cardType}
                  onChange={(e) => setCardType(e.target.value)}
                  placeholder="e.g. hero, enhancement, dominant"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes about this group..."
                  className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground resize-y min-h-[60px] border-2 border-input placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCanonicalName(group.canonical_name);
                    setNotes(group.notes || "");
                    setCardType(group.card_type || "");
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Edit details
              </button>
              <span className="text-muted-foreground/30">|</span>
              <button
                onClick={() => onDelete(group.id)}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Delete group
              </button>
              {group.notes && (
                <>
                  <span className="text-muted-foreground/30">|</span>
                  <span className="text-xs text-muted-foreground italic truncate max-w-[300px]">
                    {group.notes}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Group Form                                                     */
/* ------------------------------------------------------------------ */

function AddGroupForm({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const [canonicalName, setCanonicalName] = useState("");
  const [cardType, setCardType] = useState("");
  const [notes, setNotes] = useState("");
  const [members, setMembers] = useState<CardInfo[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Auto-set canonical name from first member
  const handleAddMember = (card: CardInfo) => {
    setMembers((prev) => [...prev, card]);
    if (!canonicalName && members.length === 0) {
      // Strip suffixes for canonical name
      let base = card.name;
      base = base.replace(/\s*\[[^\]]+\]\s*$/, "");
      const parenMatch = base.match(/\s+\(([A-Za-z0-9][A-Za-z0-9 .'\-]*)\)\s*$/);
      if (parenMatch && parenMatch[1].length <= 20) {
        base = base.slice(0, parenMatch.index).trim();
      }
      setCanonicalName(base);
    }
    if (!cardType && card.type) {
      setCardType(card.type.toLowerCase());
    }
    setSuccessMsg(null);
  };

  const handleRemoveMember = (index: number) => {
    setMembers((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!canonicalName.trim() || members.length < 2) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    const result = await createDuplicateGroup({
      canonical_name: canonicalName.trim(),
      notes: notes.trim() || undefined,
      card_type: cardType.trim() || undefined,
      member_names: members.map((m) => m.name),
    });

    if (result.error) {
      setError(result.error);
    } else {
      setSuccessMsg(`Created group "${canonicalName.trim()}" with ${members.length} cards`);
      setCanonicalName("");
      setCardType("");
      setNotes("");
      setMembers([]);
      onCreated();
    }
    setSubmitting(false);
  };

  // Preview card for the most recently added member
  const previewCard = members.length > 0 ? members[members.length - 1] : null;

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="bg-primary/5 dark:bg-primary/10 rounded-lg px-4 py-3 text-sm text-primary">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
        {/* Form */}
        <div className="space-y-5">
          {/* Card search */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
              Add Cards
            </label>
            <CardSearchTypeahead
              onSelect={handleAddMember}
              excludeNames={members.map((m) => m.name)}
              placeholder="Search for a card to add..."
            />
          </div>

          {/* Members */}
          {members.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">
                Members ({members.length})
              </label>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m, i) => (
                  <MemberChip
                    key={`${m.name}-${i}`}
                    member={{ card_name: m.name } as DuplicateGroupMemberRow}
                    onRemove={() => handleRemoveMember(i)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Canonical name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
              Canonical Name
            </label>
            <Input
              value={canonicalName}
              onChange={(e) => setCanonicalName(e.target.value)}
              placeholder="The primary name for this group"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              The shared identity for these cards. Auto-filled from the first card added.
            </p>
          </div>

          {/* Card type */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
              Card Type
            </label>
            <Input
              value={cardType}
              onChange={(e) => setCardType(e.target.value)}
              placeholder="e.g. hero, evil character, enhancement, dominant"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground resize-y min-h-[60px] border-2 border-input placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            onClick={handleSubmit}
            disabled={submitting || !canonicalName.trim() || members.length < 2}
          >
            {submitting ? "Creating..." : "Create Group"}
          </Button>

          {members.length === 1 && (
            <p className="text-xs text-muted-foreground">
              Add at least one more card to create a group.
            </p>
          )}
        </div>

        {/* Sidebar: card preview */}
        <div className="hidden lg:block">
          {previewCard ? (
            <div className="sticky top-24 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Preview
              </p>
              <div className="rounded-lg overflow-hidden bg-card">
                <CardImagePreview imgFile={previewCard.imgFile} name={previewCard.name} />
              </div>
              <p className="text-xs text-muted-foreground text-center">{previewCard.name}</p>
            </div>
          ) : (
            <div className="bg-muted/30 rounded-lg p-6 text-center">
              <p className="text-xs text-muted-foreground">
                Search and add cards to preview them here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Suggestions tab                                                    */
/* ------------------------------------------------------------------ */

function suggestionKey(s: Suggestion): string {
  return s.kind === "new_group" ? `new::${s.baseName}` : `add::${s.groupId}`;
}

function SuggestionsTab({ onGroupCreated }: { onGroupCreated: () => void }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [dismissedSet, setDismissedSet] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState("");

  const handleDetect = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await detectPotentialDuplicates();
    if (result.error) {
      setError(result.error);
    } else {
      setSuggestions(result.suggestions);
    }
    setHasLoaded(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    handleDetect();
  }, [handleDetect]);

  const handleApproveNewGroup = async (s: SuggestedGroup) => {
    const key = suggestionKey(s);
    setProcessingKey(key);
    const result = await createDuplicateGroup({
      canonical_name: s.baseName,
      card_type: s.cardType.toLowerCase() || undefined,
      member_names: s.cardNames,
    });
    if (!result.error) {
      setSuggestions((prev) => prev.filter((x) => suggestionKey(x) !== key));
      onGroupCreated();
    }
    setProcessingKey(null);
  };

  const handleApproveAddition = async (s: SuggestedAddition) => {
    const key = suggestionKey(s);
    setProcessingKey(key);
    for (const cardName of s.cardNames) {
      await addGroupMember(s.groupId, cardName);
    }
    setSuggestions((prev) => prev.filter((x) => suggestionKey(x) !== key));
    onGroupCreated();
    setProcessingKey(null);
  };

  const handleDismiss = (s: Suggestion) => {
    setDismissedSet((prev) => new Set([...prev, suggestionKey(s)]));
  };

  const [approvingAll, setApprovingAll] = useState(false);

  const [bulkError, setBulkError] = useState<string | null>(null);

  const handleApproveAll = async () => {
    setApprovingAll(true);
    setBulkError(null);
    const result = await bulkApproveSuggestions(filtered);
    if (result.error) {
      setBulkError(result.error);
    } else {
      const filteredKeys = new Set(filtered.map(suggestionKey));
      setSuggestions((prev) => prev.filter((s) => !filteredKeys.has(suggestionKey(s))));
      onGroupCreated();
    }
    setApprovingAll(false);
  };

  const filtered = useMemo(() => {
    let items = suggestions.filter((s) => !dismissedSet.has(suggestionKey(s)));
    if (filterType) {
      items = items.filter((s) =>
        s.cardType.toLowerCase().includes(filterType.toLowerCase())
      );
    }
    return items;
  }, [suggestions, dismissedSet, filterType]);

  const missingMembers = filtered.filter((s): s is SuggestedAddition => s.kind === "missing_member");
  const newGroups = filtered.filter((s): s is SuggestedGroup => s.kind === "new_group");

  return (
    <div className="space-y-5">
      {hasLoaded && (
        <div className="flex items-center gap-3 flex-wrap">
          {filtered.length > 0 && (
            <>
              <Button
                onClick={handleApproveAll}
                disabled={approvingAll}
              >
                {approvingAll ? `Approving ${filtered.length}...` : `Approve All (${filtered.length})`}
              </Button>
              <Input
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                placeholder="Filter by card type..."
                className="w-48"
              />
            </>
          )}
          <span className="text-xs text-muted-foreground">
            {filtered.length} suggestion{filtered.length !== 1 ? "s" : ""}
            {missingMembers.length > 0 && newGroups.length > 0 && (
              <> ({missingMembers.length} additions, {newGroups.length} new groups)</>
            )}
          </span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {bulkError && (
        <div className="bg-destructive/10 rounded-lg px-4 py-3 text-sm text-destructive">
          <span className="font-medium">Bulk approve failed:</span> {bulkError}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
        </div>
      )}

      {hasLoaded && !loading && filtered.length === 0 && (
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground">
            {suggestions.length === 0
              ? "No suggestions. All variant cards are already grouped."
              : "All suggestions filtered or dismissed."}
          </p>
        </div>
      )}

      {!loading && missingMembers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Add to existing groups
          </p>
          {missingMembers.map((s) => {
            const key = suggestionKey(s);
            return (
              <div
                key={key}
                className="rounded-lg bg-card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 overflow-hidden"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-semibold text-sm text-foreground">
                      {s.groupName}
                    </span>
                    {s.cardType && (
                      <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                        {s.cardType}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {s.cardNames.map((name) => (
                      <MemberChip
                        key={name}
                        member={{ card_name: name } as DuplicateGroupMemberRow}
                        compact
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    onClick={() => handleApproveAddition(s)}
                    disabled={processingKey === key}
                  >
                    {processingKey === key ? "Adding..." : `Add ${s.cardNames.length}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDismiss(s)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && newGroups.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            New groups
          </p>
          {newGroups.map((s) => {
            const key = suggestionKey(s);
            return (
              <div
                key={key}
                className="rounded-lg bg-card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 overflow-hidden"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-semibold text-sm text-foreground">
                      {s.baseName}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                      {s.cardType}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {s.cardNames.map((name) => (
                      <MemberChip
                        key={name}
                        member={{ card_name: name } as DuplicateGroupMemberRow}
                        compact
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    onClick={() => handleApproveNewGroup(s)}
                    disabled={processingKey === key}
                  >
                    {processingKey === key ? "Creating..." : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDismiss(s)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AdminCardsPage() {
  return (
    <Suspense
      fallback={
        <>
          <TopNav />
          <div className="flex items-center justify-center min-h-screen">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
          </div>
        </>
      }
    >
      <AdminCardsContent />
    </Suspense>
  );
}

function AdminCardsContent() {
  const { isAdmin, permissions, loading: adminLoading } = useIsAdmin();
  const canManageCards = isAdmin && permissions.includes("manage_cards");
  const router = useRouter();
  const { cardsByName } = useCardLookup();

  const [tab, setTab] = useState<Tab>("groups");
  const [groups, setGroups] = useState<DuplicateGroupRow[]>([]);
  const [stats, setStats] = useState<DuplicateGroupStats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Redirect non-admins
  useEffect(() => {
    if (!adminLoading && !canManageCards) {
      router.push("/");
    }
  }, [canManageCards, adminLoading, router]);

  // Load groups
  const loadGroups = useCallback(
    async (search?: string, source?: string) => {
      const result = await getDuplicateGroups(search, source);
      if (!result.error) setGroups(result.groups);
    },
    []
  );

  const loadStats = useCallback(async () => {
    const s = await getDuplicateGroupStats();
    setStats(s);
  }, []);

  useEffect(() => {
    if (!canManageCards) return;
    const load = async () => {
      setLoading(true);
      await Promise.all([loadGroups(), loadStats()]);
      setLoading(false);
    };
    load();
  }, [canManageCards, loadGroups, loadStats]);

  // Debounced search
  useEffect(() => {
    if (tab !== "groups") return;
    const timeout = setTimeout(() => {
      loadGroups(searchQuery || undefined, sourceFilter !== "all" ? sourceFilter : undefined);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, sourceFilter, tab, loadGroups]);

  const handleDeleteGroup = async () => {
    if (!deleteId) return;
    await deleteDuplicateGroup(deleteId);
    setGroups((prev) => prev.filter((g) => g.id !== deleteId));
    setDeleteId(null);
  };

  const handleUpdateGroup = async (id: number, updates: Partial<DuplicateGroupRow>) => {
    await updateDuplicateGroup(id, updates);
    loadGroups(searchQuery || undefined, sourceFilter !== "all" ? sourceFilter : undefined);
  };

  const refreshGroups = () => {
    loadGroups(searchQuery || undefined, sourceFilter !== "all" ? sourceFilter : undefined);
    loadStats();
  };

  if (adminLoading || !canManageCards) {
    return (
      <>
        <TopNav />
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
        </div>
      </>
    );
  }

  const totalGroups = stats?.totalGroups ?? 0;
  const totalCards = stats?.totalCards ?? 0;
  const ordirGroups = stats?.ordirGroups ?? 0;
  const manualGroups = stats?.manualGroups ?? 0;

  return (
    <CardLookupContext.Provider value={cardsByName}>
    <>
      <TopNav />
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Card Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage duplicate card groups and identify card variants across sets.
          </p>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "GROUPS", value: totalGroups },
            { label: "CARDS", value: totalCards },
            { label: "ORDIR", value: ordirGroups },
            { label: "MANUAL", value: manualGroups },
          ].map(({ label, value }) => (
            <div key={label} className="bg-card rounded-lg px-3 py-2.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {label}
              </p>
              <p className="text-lg font-bold text-foreground tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6">
          {(
            [
              { key: "groups" as const, label: "Duplicate Groups" },
              { key: "add" as const, label: "Add Group" },
              { key: "suggestions" as const, label: "Suggestions" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${
                tab === key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
          </div>
        ) : (
          <>
            {/* Groups tab */}
            {tab === "groups" && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by group name..."
                    className="flex-1"
                  />
                  <select
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    className="rounded-md bg-background px-3 py-2 text-sm text-foreground border-2 border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring"
                  >
                    <option value="all">All sources</option>
                    <option value="ordir">ORDIR</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>

                {groups.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-sm text-muted-foreground">
                      {searchQuery
                        ? "No groups match your search."
                        : "No duplicate groups yet."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {groups.map((group) => (
                      <GroupRow
                        key={group.id}
                        group={group}
                        onDelete={setDeleteId}
                        onUpdate={handleUpdateGroup}
                        onMemberAdded={refreshGroups}
                        onMemberRemoved={refreshGroups}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Add Group tab */}
            {tab === "add" && <AddGroupForm onCreated={refreshGroups} />}

            {/* Suggestions tab */}
            {tab === "suggestions" && (
              <SuggestionsTab onGroupCreated={refreshGroups} />
            )}
          </>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmationDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete Group"
        description="This will delete the group and all its member associations. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDeleteGroup}
      />
    </>
    </CardLookupContext.Provider>
  );
}
