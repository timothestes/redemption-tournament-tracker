"use client";

import { useMemo, useState } from "react";
import TopNav from "../../../components/top-nav";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { CARDS, type CardData } from "@/lib/cards/lookup";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import { EDITABLE_FIELDS, type EditableField } from "./lib/editorShared";
import { diffPending, type BundledOverlay, type PendingItem } from "./lib/pendingDiff";
import {
  saveOverride,
  deleteOverride,
  type OverrideRow,
  type ImageVersionRow,
} from "./actions";
import bundledOverlay from "@/scripts/data/card-overrides.json";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type Tab = "edit" | "pending";

const FIELD_LABELS: Record<EditableField, string> = {
  officialSet: "Official Set",
  type: "Type",
  brigade: "Brigade",
  strength: "Strength",
  toughness: "Toughness",
  class: "Class",
  identifier: "Identifier",
  specialAbility: "Special Ability",
  rarity: "Rarity",
  reference: "Reference",
  alignment: "Alignment",
  legality: "Legality",
};

const MULTILINE_FIELDS: ReadonlySet<EditableField> = new Set(["specialAbility", "identifier"]);

const SEARCH_MIN_CHARS = 2;
const SEARCH_MAX_RESULTS = 30;

/* ------------------------------------------------------------------ */
/*  Small presentational bits                                          */
/* ------------------------------------------------------------------ */

function LockIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 10-8 0v4h8z"
      />
    </svg>
  );
}

function PendingKindBadge({ kind }: { kind: PendingItem["kind"] }) {
  const styles: Record<PendingItem["kind"], string> = {
    "override-new": "bg-secondary text-secondary-foreground",
    "override-changed": "bg-accent text-accent-foreground",
    "override-removed": "bg-destructive/10 text-destructive",
    "image-bump": "bg-secondary text-secondary-foreground",
  };
  const labels: Record<PendingItem["kind"], string> = {
    "override-new": "New",
    "override-changed": "Changed",
    "override-removed": "Removed",
    "image-bump": "Image",
  };
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[kind]}`}
    >
      {labels[kind]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CatalogClient({
  initial,
}: {
  initial: { overrides: OverrideRow[]; imageVersions: ImageVersionRow[] };
}) {
  const [tab, setTab] = useState<Tab>("edit");
  const [dbOverrides, setDbOverrides] = useState<OverrideRow[]>(initial.overrides);
  const [dbImageVersions] = useState<ImageVersionRow[]>(initial.imageVersions);

  // Search (edit tab)
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);

  // Editor state — override state is EXPLICIT per field (spec F9): a key's
  // presence in this object is what makes it "overridden", never a value
  // comparison against the live card. An override equal to the live value
  // must be storable.
  const [overrides, setOverrides] = useState<Partial<Record<EditableField, string>>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < SEARCH_MIN_CHARS) return [];
    const found: CardData[] = [];
    for (const c of CARDS) {
      if (!c.name) continue;
      if (c.name.toLowerCase().includes(q)) {
        found.push(c);
        if (found.length >= SEARCH_MAX_RESULTS) break;
      }
    }
    return found;
  }, [query]);

  const existingRow = useMemo(() => {
    if (!selectedCard) return null;
    return (
      dbOverrides.find(
        (o) => o.card_name === selectedCard.name && o.set_code === selectedCard.set
      ) ?? null
    );
  }, [dbOverrides, selectedCard]);

  const pending = useMemo(
    () =>
      diffPending(
        {
          overrides: dbOverrides.map((o) => ({
            card_name: o.card_name,
            set_code: o.set_code,
            fields: o.fields,
          })),
          imageVersions: Object.fromEntries(dbImageVersions.map((r) => [r.img_file, r.version])),
        },
        bundledOverlay as BundledOverlay
      ),
    [dbOverrides, dbImageVersions]
  );

  function selectCard(card: CardData) {
    setSelectedCard(card);
    setError(null);
    const row = dbOverrides.find((o) => o.card_name === card.name && o.set_code === card.set);
    setOverrides(row ? { ...(row.fields as Partial<Record<EditableField, string>>) } : {});
    setNote(row?.note ?? "");
  }

  function applyOverride(field: EditableField) {
    if (!selectedCard) return;
    setOverrides((prev) => ({ ...prev, [field]: selectedCard[field] }));
  }

  function revertOverride(field: EditableField) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  const hasOverrides = Object.keys(overrides).length > 0;

  async function handleSave() {
    if (!selectedCard) return;
    if (hasOverrides && !note.trim()) {
      setError("A note is required — future-you wants the why.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveOverride(selectedCard.name, selectedCard.set, overrides, note);
    if (res.ok === false) {
      setError(res.error);
      setSaving(false);
      return;
    }
    const key = `${selectedCard.name}|${selectedCard.set}`;
    setDbOverrides((prev) => {
      const filtered = prev.filter((o) => `${o.card_name}|${o.set_code}` !== key);
      if (res.deleted) return filtered;
      return [
        ...filtered,
        {
          card_name: selectedCard.name,
          set_code: selectedCard.set,
          fields: overrides as Record<string, string>,
          note: note.trim(),
          updated_at: new Date().toISOString(),
        },
      ];
    });
    if (res.deleted) setNote("");
    setSaving(false);
  }

  async function handleDeleteOverride() {
    if (!selectedCard) return;
    if (!window.confirm(`Delete the saved override for ${selectedCard.name} (${selectedCard.set})?`)) return;
    setSaving(true);
    setError(null);
    const res = await deleteOverride(selectedCard.name, selectedCard.set);
    if (res.ok === false) {
      setError(res.error);
      setSaving(false);
      return;
    }
    const key = `${selectedCard.name}|${selectedCard.set}`;
    setDbOverrides((prev) => prev.filter((o) => `${o.card_name}|${o.set_code}` !== key));
    setOverrides({});
    setNote("");
    setSaving(false);
  }

  return (
    <>
      <TopNav />
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Catalog</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Override card metadata and track what has not yet been deployed.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6">
          {(
            [
              { key: "edit" as const, label: "Edit" },
              { key: "pending" as const, label: `Pending${pending.length > 0 ? ` (${pending.length})` : ""}` },
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

        {/* Edit tab */}
        {tab === "edit" && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
            {/* Search + results */}
            <div className="space-y-3">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search cards..."
                className="w-full"
              />
              <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                {results.map((c) => {
                  const selected =
                    selectedCard?.name === c.name && selectedCard?.set === c.set;
                  return (
                    <button
                      key={`${c.name}|${c.set}|${c.imgFile}`}
                      onClick={() => selectCard(c)}
                      className={`w-full text-left px-2.5 py-2 flex items-center gap-2.5 rounded-md transition-colors ${
                        selected ? "bg-muted border border-border" : "hover:bg-muted/50"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getCardImageUrl(c.imgFile)}
                        alt=""
                        className="w-8 h-11 object-cover rounded-sm flex-shrink-0 bg-muted"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground truncate">
                          {c.name}
                        </span>
                        <span className="block text-[11px] text-muted-foreground truncate">
                          {c.set} &middot; {c.type}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {query.trim().length >= SEARCH_MIN_CHARS && results.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2.5 py-2">No cards match.</p>
                )}
              </div>
            </div>

            {/* Editor */}
            <div>
              {!selectedCard ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    Search and select a card to edit its catalog metadata.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-6">
                  {/* Field grid — Task 11 slots an image panel in as a sibling here. */}
                  <div className="space-y-4 min-w-0">
                    {/* Identity strip */}
                    <div
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2"
                      title="Identity fields are immutable — decks reference cards by name|set"
                    >
                      <LockIcon />
                      <span className="text-sm font-medium text-foreground">
                        {selectedCard.name}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {selectedCard.set}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono truncate">
                        {selectedCard.imgFile}
                      </span>
                    </div>

                    {/* Field rows */}
                    <div className="rounded-lg border border-border divide-y divide-border/60">
                      {EDITABLE_FIELDS.map((field) => {
                        const overridden = field in overrides;
                        const liveValue = selectedCard[field];
                        return (
                          <div
                            key={field}
                            className={`grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] items-start gap-2 sm:gap-3 px-3 py-2.5 ${
                              overridden ? "border-l-2 border-foreground/40" : ""
                            }`}
                          >
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">
                              {FIELD_LABELS[field]}
                            </label>
                            <div className="min-w-0">
                              {overridden ? (
                                MULTILINE_FIELDS.has(field) ? (
                                  <textarea
                                    rows={2}
                                    value={overrides[field] ?? ""}
                                    onChange={(e) =>
                                      setOverrides((prev) => ({ ...prev, [field]: e.target.value }))
                                    }
                                    className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground resize-y border-2 border-input placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40"
                                  />
                                ) : (
                                  <Input
                                    value={overrides[field] ?? ""}
                                    onChange={(e) =>
                                      setOverrides((prev) => ({ ...prev, [field]: e.target.value }))
                                    }
                                  />
                                )
                              ) : (
                                <p className="text-sm text-muted-foreground pt-2 truncate">
                                  {liveValue || "—"}
                                </p>
                              )}
                            </div>
                            <div className="pt-1">
                              {overridden ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => revertOverride(field)}
                                >
                                  Revert
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => applyOverride(field)}
                                >
                                  Override
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {/* Note + Save */}
                    <div className="space-y-2">
                      <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                          hasOverrides
                            ? "Why this override? (required)"
                            : "Note (only needed with an override)"
                        }
                      />
                      <div className="flex items-center gap-3">
                        <Button onClick={handleSave} disabled={saving}>
                          {saving ? "Saving..." : "Save"}
                        </Button>
                        {existingRow && (
                          <button
                            onClick={handleDeleteOverride}
                            disabled={saving}
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          >
                            Delete override
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending tab */}
        {tab === "pending" && (
          <div className="space-y-4">
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-16">
                Everything here is deployed.
              </p>
            ) : (
              <>
                <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  Run <code className="font-mono text-xs">make pull-card-overrides</code>, commit
                  the overlay + regenerated files, PR, deploy.
                </div>
                <ul className="space-y-1.5">
                  {pending.map((item) => (
                    <li
                      key={`${item.kind}-${item.key}`}
                      className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
                    >
                      <PendingKindBadge kind={item.kind} />
                      <span className="text-sm text-foreground">{item.detail}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
