"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import TopNav from "../../../components/top-nav";
import { useIsAdmin } from "../../../hooks/useIsAdmin";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import ConfirmationDialog from "../../../components/ui/confirmation-dialog";
import { CARDS } from "@/lib/cards/lookup";
import {
  getRulings,
  createRuling,
  updateRuling,
  deleteRuling,
  searchDiscordMessages,
  getDiscordContext,
  type CardRuling,
} from "./actions";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type Tab = "rulings" | "add" | "discord";

type DiscordMsg = { id: string; author_name: string | null; content: string; message_date: string };

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Ruling Row                                                         */
/* ------------------------------------------------------------------ */

function RulingRow({
  ruling,
  onDelete,
  onUpdate,
}: {
  ruling: CardRuling;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<CardRuling>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [cardName, setCardName] = useState(ruling.card_name);
  const [question, setQuestion] = useState(ruling.question);
  const [answer, setAnswer] = useState(ruling.answer);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(ruling.id, {
      card_name: cardName.trim(),
      question: question.trim(),
      answer: answer.trim(),
    });
    setEditing(false);
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Card Name</label>
          <Input value={cardName} onChange={(e) => setCardName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Question</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground resize-y min-h-[60px]"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Answer</label>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground resize-y min-h-[80px]"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCardName(ruling.card_name);
              setQuestion(ruling.question);
              setAnswer(ruling.answer);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-semibold text-sm">{ruling.card_name}</span>
            <Badge variant="outline" className="text-[10px]">
              {ruling.source}
            </Badge>
            {ruling.ruling_date && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {ruling.ruling_date}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-1">
            <span className="font-medium text-foreground">Q:</span> {ruling.question}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">A:</span> {ruling.answer}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(ruling.id)}
            className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Card Preview (shows card image + ability text while adding ruling) */
/* ------------------------------------------------------------------ */

interface CardInfo {
  name: string;
  imgFile: string;
  specialAbility: string;
  type: string;
  identifier: string;
  set: string;
}

const CARD_MAP_BY_LC_NAME: ReadonlyMap<string, CardInfo[]> = (() => {
  const map = new Map<string, CardInfo[]>();
  for (const c of CARDS) {
    if (!c.name) continue;
    const info: CardInfo = {
      name: c.name,
      imgFile: c.imgFile,
      specialAbility: c.specialAbility,
      type: c.type,
      identifier: c.identifier,
      set: c.set,
    };
    const key = c.name.toLowerCase();
    const bucket = map.get(key);
    if (bucket) bucket.push(info);
    else map.set(key, [info]);
  }
  return map;
})();

const ALL_CARD_NAMES: readonly string[] = (() => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const c of CARDS) {
    const key = c.name.toLowerCase();
    if (c.name && !seen.has(key)) {
      seen.add(key);
      names.push(c.name);
    }
  }
  return names;
})();

function useCardLookup() {
  return useCallback((name: string): CardInfo | null => {
    if (!name.trim()) return null;
    const exact = CARD_MAP_BY_LC_NAME.get(name.trim().toLowerCase());
    return exact && exact.length > 0 ? exact[0] : null;
  }, []);
}

/* ------------------------------------------------------------------ */
/*  Card name typeahead                                                */
/* ------------------------------------------------------------------ */

function CardNameTypeahead({
  value,
  onChange,
  placeholder = "e.g. Son of God",
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [results, setResults] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    const timeout = setTimeout(() => {
      const q = value.toLowerCase();
      const found: string[] = [];
      for (const name of ALL_CARD_NAMES) {
        if (name.toLowerCase().includes(q)) {
          found.push(name);
          if (found.length >= 12) break;
        }
      }
      setResults(found);
      setIsOpen(found.length > 0);
      setActiveIndex(-1);
    }, 100);
    return () => clearTimeout(timeout);
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (name: string) => {
    onChange(name);
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
      />
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-lg bg-popover/95 backdrop-blur-xl shadow-[0px_12px_32px_0px_rgba(0,40,142,0.08)] dark:shadow-[0px_20px_40px_rgba(6,14,32,0.6)] overflow-hidden">
          <div className="max-h-60 overflow-y-auto py-1">
            {results.map((name, i) => (
              <button
                key={name}
                onClick={() => handleSelect(name)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  i === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-muted/60"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CardPreview({ cardName }: { cardName: string }) {
  const lookupCard = useCardLookup();
  const card = lookupCard(cardName);

  if (!card) {
    if (cardName.trim().length >= 2) {
      return (
        <div className="text-xs text-muted-foreground text-center py-4">
          No card found for &ldquo;{cardName}&rdquo;
        </div>
      );
    }
    return (
      <div className="text-xs text-muted-foreground text-center py-4">
        Type a card name to preview
      </div>
    );
  }

  const imageUrl = `${process.env.NEXT_PUBLIC_BLOB_BASE_URL}/card-images/${card.imgFile}.jpg`;

  return (
    <div className="space-y-2">
      <img
        src={imageUrl}
        alt={card.name}
        className="w-full rounded shadow-md"
      />
      {card.specialAbility && (
        <div className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Ability:</span>{" "}
          {card.specialAbility}
        </div>
      )}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{card.type}</span>
        {card.identifier && <span>&middot; {card.identifier}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Discord message with expandable context                            */
/* ------------------------------------------------------------------ */

function DiscordMessageRow({
  msg,
  isHighlighted = false,
  compact = false,
}: {
  msg: DiscordMsg;
  isHighlighted?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? "px-3 py-1.5" : "px-4 py-2"} ${isHighlighted ? "bg-primary/5 dark:bg-primary/10" : ""}`}>
      <div className="flex items-center gap-2 mb-0.5">
        {msg.author_name && (
          <span className={`font-medium text-foreground ${compact ? "text-[11px]" : "text-xs"}`}>
            {msg.author_name}
          </span>
        )}
        <span className={`text-muted-foreground font-mono ${compact ? "text-[10px]" : "text-xs"}`}>
          {formatDate(msg.message_date)}
        </span>
      </div>
      <p className={`text-muted-foreground whitespace-pre-wrap leading-relaxed ${compact ? "text-xs" : "text-sm"}`}>
        {msg.content}
      </p>
    </div>
  );
}

function DiscordThread({
  message,
  compact = false,
}: {
  message: DiscordMsg;
  compact?: boolean;
}) {
  const [beforeMsgs, setBeforeMsgs] = useState<DiscordMsg[]>([]);
  const [afterMsgs, setAfterMsgs] = useState<DiscordMsg[]>([]);
  const [loadingBefore, setLoadingBefore] = useState(false);
  const [loadingAfter, setLoadingAfter] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hasMoreBefore, setHasMoreBefore] = useState(true);
  const [hasMoreAfter, setHasMoreAfter] = useState(true);

  const loadBefore = async () => {
    setLoadingBefore(true);
    const earliest = beforeMsgs.length > 0 ? beforeMsgs[0].message_date : message.message_date;
    const result = await getDiscordContext(earliest, "before", 10);
    if (result.messages.length < 10) setHasMoreBefore(false);
    if (result.messages.length > 0) {
      setBeforeMsgs((prev) => [...result.messages, ...prev]);
    } else {
      setHasMoreBefore(false);
    }
    setLoadingBefore(false);
  };

  const loadAfter = async () => {
    setLoadingAfter(true);
    const latest = afterMsgs.length > 0 ? afterMsgs[afterMsgs.length - 1].message_date : message.message_date;
    const result = await getDiscordContext(latest, "after", 10);
    if (result.messages.length < 10) setHasMoreAfter(false);
    if (result.messages.length > 0) {
      setAfterMsgs((prev) => [...prev, ...result.messages]);
    } else {
      setHasMoreAfter(false);
    }
    setLoadingAfter(false);
  };

  const handleExpand = async () => {
    if (!expanded) {
      setExpanded(true);
      // Load initial context in both directions
      const [before, after] = await Promise.all([
        getDiscordContext(message.message_date, "before", 5),
        getDiscordContext(message.message_date, "after", 5),
      ]);
      setBeforeMsgs(before.messages);
      setAfterMsgs(after.messages);
      if (before.messages.length < 5) setHasMoreBefore(false);
      if (after.messages.length < 5) setHasMoreAfter(false);
    } else {
      setExpanded(false);
      setBeforeMsgs([]);
      setAfterMsgs([]);
      setHasMoreBefore(true);
      setHasMoreAfter(true);
    }
  };

  if (!expanded) {
    return (
      <div>
        <DiscordMessageRow msg={message} compact={compact} />
        <div className={compact ? "px-3 pb-1.5" : "px-4 pb-2"}>
          <button
            onClick={handleExpand}
            className="text-[11px] text-primary hover:text-primary/80 transition-colors"
          >
            Show context
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Load more before */}
      {hasMoreBefore && (
        <div className={compact ? "px-3 py-1" : "px-4 py-1.5"}>
          <button
            onClick={loadBefore}
            disabled={loadingBefore}
            className="text-[11px] text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
          >
            {loadingBefore ? "Loading..." : "Load older messages"}
          </button>
        </div>
      )}

      {/* Before messages */}
      {beforeMsgs.map((msg) => (
        <DiscordMessageRow key={msg.id} msg={msg} compact={compact} />
      ))}

      {/* The matched message (highlighted) */}
      <DiscordMessageRow msg={message} isHighlighted compact={compact} />

      {/* After messages */}
      {afterMsgs.map((msg) => (
        <DiscordMessageRow key={msg.id} msg={msg} compact={compact} />
      ))}

      {/* Load more after */}
      {hasMoreAfter && (
        <div className={compact ? "px-3 py-1" : "px-4 py-1.5"}>
          <button
            onClick={loadAfter}
            disabled={loadingAfter}
            className="text-[11px] text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
          >
            {loadingAfter ? "Loading..." : "Load newer messages"}
          </button>
        </div>
      )}

      {/* Collapse */}
      <div className={compact ? "px-3 pb-1.5" : "px-4 pb-2"}>
        <button
          onClick={handleExpand}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Hide context
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Discord Reference (inside Add form)                         */
/* ------------------------------------------------------------------ */

function DiscordReference() {
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<{ id: string; author_name: string | null; content: string; message_date: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (search.trim().length < 2) {
      setMessages([]);
      setHasSearched(false);
      return;
    }
    const timeout = setTimeout(async () => {
      setLoading(true);
      setHasSearched(true);
      const result = await searchDiscordMessages(search);
      setMessages(result.messages);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-muted/50 border-b border-border">
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Discord Reference</p>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Discord for context..."
          className="h-8 text-xs"
        />
      </div>
      {loading && (
        <div className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-foreground" />
        </div>
      )}
      {!loading && hasSearched && messages.length === 0 && (
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">No messages found.</div>
      )}
      {!loading && messages.length > 0 && (
        <div className="max-h-80 overflow-y-auto divide-y divide-border">
          {messages.map((msg) => (
            <DiscordThread key={msg.id} message={msg} compact />
          ))}
          {messages.length >= 50 && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground text-center">
              Showing first 50 results. Try a more specific search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Ruling Form                                                    */
/* ------------------------------------------------------------------ */

function AddRulingForm({
  onCreated,
  existingRulings,
  initialCardName = "",
}: {
  onCreated: (cardName: string) => void;
  existingRulings: CardRuling[];
  initialCardName?: string;
}) {
  const [cardName, setCardName] = useState(initialCardName);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [source, setSource] = useState("manual");
  const [rulingDate, setRulingDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Show related existing rulings as you type the card name
  const relatedRulings = cardName.trim().length >= 2
    ? existingRulings.filter(
        (r) => r.card_name.toLowerCase().includes(cardName.trim().toLowerCase())
      ).slice(0, 5)
    : [];

  const handleSubmit = async () => {
    if (!cardName.trim() || !question.trim() || !answer.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    const savedCardName = cardName.trim();
    const result = await createRuling({
      card_name: savedCardName,
      question: question.trim(),
      answer: answer.trim(),
      source,
      ruling_date: rulingDate || undefined,
    });

    if (result.error) {
      setError(result.error);
    } else {
      setQuestion("");
      setAnswer("");
      setRulingDate("");
      setSuccessMsg(`Ruling added for "${savedCardName}"`);
      onCreated(savedCardName);
      // Keep card name so admin can add multiple rulings for the same card
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      {successMsg && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 text-sm text-green-700 dark:text-green-400">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Card Name</label>
            <CardNameTypeahead
              value={cardName}
              onChange={(name) => { setCardName(name); setSuccessMsg(null); }}
            />
          </div>

          {/* Show existing rulings for this card inline */}
          {relatedRulings.length > 0 && (
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Existing rulings matching &ldquo;{cardName}&rdquo;
              </p>
              {relatedRulings.map((r) => (
                <div key={r.id} className="text-xs text-muted-foreground mb-2 last:mb-0 border-l-2 border-border pl-2">
                  <span className="font-semibold text-foreground">{r.card_name}</span>
                  <br />
                  <span className="font-medium">Q:</span> {r.question}
                  <br />
                  <span className="font-medium">A:</span> {r.answer}
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Question / Scenario</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What is the question or scenario this ruling addresses?"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground resize-y min-h-[80px]"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Answer / Ruling</label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="The official ruling or answer"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground resize-y min-h-[100px]"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground mb-1.5 block">Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground"
              >
                <option value="manual">Manual Entry</option>
                <option value="discord">Discord</option>
                <option value="official_faq">Official FAQ</option>
                <option value="reg">REG Document</option>
                <option value="ordir">ORDIR Document</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground mb-1.5 block">Ruling Date</label>
              <Input
                type="date"
                value={rulingDate}
                onChange={(e) => setRulingDate(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={submitting || !cardName.trim() || !question.trim() || !answer.trim()}
          >
            {submitting ? "Saving..." : "Add Ruling"}
          </Button>
        </div>

        {/* Sidebar: card preview + Discord reference */}
        <div className="hidden lg:flex lg:flex-col gap-4">
          <div className="border border-border rounded-lg p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Card Preview</p>
            <CardPreview cardName={cardName} />
          </div>
          <DiscordReference />
        </div>
      </div>

      {/* Mobile: card preview + Discord reference below form */}
      <div className="lg:hidden space-y-4">
        {cardName.trim().length >= 2 && (
          <div className="border border-border rounded-lg p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Card Preview</p>
            <CardPreview cardName={cardName} />
          </div>
        )}
        <DiscordReference />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Standalone Discord Archive tab                                     */
/* ------------------------------------------------------------------ */

function DiscordArchive() {
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<{ id: string; author_name: string | null; content: string; message_date: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (search.trim().length < 2) {
      setMessages([]);
      setHasSearched(false);
      return;
    }
    const timeout = setTimeout(async () => {
      setLoading(true);
      setHasSearched(true);
      const result = await searchDiscordMessages(search);
      setMessages(result.messages);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search Discord rulings channel by keyword..."
        className="w-full"
      />

      <div className="min-h-[200px]">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
          </div>
        )}

        {!loading && !hasSearched && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">Search the Discord rulings channel archive for context when adding rulings.</p>
          </div>
        )}

        {!loading && hasSearched && messages.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium mb-1">No messages found</p>
            <p className="text-sm">Try a different search term.</p>
          </div>
        )}

        {!loading && messages.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{messages.length} result{messages.length !== 1 ? "s" : ""}</p>
            {messages.map((msg) => (
              <div key={msg.id} className="border border-border rounded-lg overflow-hidden">
                <DiscordThread message={msg} />
              </div>
            ))}
            {messages.length >= 50 && (
              <p className="text-xs text-muted-foreground text-center">
                Showing first 50 results. Try a more specific search.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AdminRulingsPage() {
  return (
    <Suspense fallback={
      <>
        <TopNav />
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
        </div>
      </>
    }>
      <AdminRulingsContent />
    </Suspense>
  );
}

function AdminRulingsContent() {
  const { isAdmin, permissions, loading: adminLoading } = useIsAdmin();
  const canManageRulings = isAdmin && permissions.includes('manage_rulings');
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlTab = searchParams.get("tab");
  const urlCard = searchParams.get("card") || "";

  const [tab, setTab] = useState<Tab>(
    urlTab === "add" || urlTab === "discord" ? urlTab : "rulings"
  );
  const [rulings, setRulings] = useState<CardRuling[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Redirect users without manage_rulings permission
  useEffect(() => {
    if (!adminLoading && !canManageRulings) {
      router.push("/");
    }
  }, [canManageRulings, adminLoading, router]);

  // Load data
  const loadRulings = useCallback(async (search?: string) => {
    const result = await getRulings(search);
    if (!result.error) setRulings(result.rulings);
  }, []);

  useEffect(() => {
    if (!canManageRulings) return;
    const load = async () => {
      setLoading(true);
      await loadRulings();
      setLoading(false);
    };
    load();
  }, [canManageRulings, loadRulings]);

  // Search handler with debounce
  useEffect(() => {
    if (tab !== "rulings") return;
    const timeout = setTimeout(() => {
      loadRulings(searchQuery || undefined);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, tab, loadRulings]);

  const handleDeleteRuling = async () => {
    if (!deleteId) return;
    await deleteRuling(deleteId);
    setRulings((prev) => prev.filter((r) => r.id !== deleteId));
    setDeleteId(null);
  };

  const handleUpdateRuling = async (id: string, updates: Partial<CardRuling>) => {
    await updateRuling(id, updates);
    loadRulings(searchQuery || undefined);
  };

  if (adminLoading || !canManageRulings) {
    return (
      <>
        <TopNav />
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
        </div>
      </>
    );
  }

  return (
    <>
      <TopNav />
      <div className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-6">Card Rulings</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-border">
          {([
            { key: "rulings" as const, label: "All Rulings" },
            { key: "add" as const, label: "Add New" },
            { key: "discord" as const, label: "Discord Archive" },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              {key === "rulings" && rulings.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">({rulings.length})</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
          </div>
        ) : (
          <>
            {/* All Rulings Tab */}
            {tab === "rulings" && (
              <div className="space-y-4">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search rulings by card name, question, or answer..."
                  className="w-full"
                />
                {rulings.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg font-medium mb-1">
                      {searchQuery ? "No rulings found" : "No rulings yet"}
                    </p>
                    <p className="text-sm">
                      {searchQuery
                        ? "Try a different search term."
                        : "Add your first ruling from the Add New tab."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rulings.map((ruling) => (
                      <RulingRow
                        key={ruling.id}
                        ruling={ruling}
                        onDelete={setDeleteId}
                        onUpdate={handleUpdateRuling}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Add New Tab */}
            {tab === "add" && (
              <AddRulingForm
                onCreated={() => loadRulings()}
                existingRulings={rulings}
                initialCardName={urlCard}
              />
            )}

            {/* Discord Archive Tab */}
            {tab === "discord" && <DiscordArchive />}
          </>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmationDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete Ruling"
        description="Are you sure you want to delete this ruling? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDeleteRuling}
      />
    </>
  );
}
