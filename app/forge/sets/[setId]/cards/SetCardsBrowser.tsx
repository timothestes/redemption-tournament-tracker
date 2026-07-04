"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";
import { bulkLifecycle, type BulkResult } from "@/app/forge/lib/lifecycle";
import {
  STATUS_LABEL, ACTION_LABEL, BULK_DONE_VERB, CONFIRM_COPY, isEligible, type LifecycleAction,
} from "@/app/forge/lib/lifecycleCopy";
import { cardRawText, CARD_TYPES, BRIGADES, type CardType, type Brigade } from "@/app/forge/lib/designCard";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

const SET_STATUSES = ["draft", "playtesting", "approved", "archived"] as const;
const BULK_ACTIONS: LifecycleAction[] = ["release", "markFinal", "shelve", "restore", "returnToIdeas", "delete"];
const selectClass = "rounded-md border bg-background px-2 py-1.5 text-sm";

export default function SetCardsBrowser({ cards }: { cards: ForgeCardFull[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState<CardType | "">("");
  const [brigade, setBrigade] = useState<Brigade | "">("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<LifecycleAction | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"returnToIdeas" | "delete" | null>(null);

  const filtered = useMemo(() => cards.filter((c) => {
    const s = c.snapshot ?? {};
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${c.title ?? ""}\n${cardRawText(s)}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (status && c.status !== status) return false;
    if (type && !(s.cardType ?? []).includes(type)) return false;
    if (brigade && !(s.brigades ?? []).includes(brigade)) return false;
    return true;
  }), [cards, q, status, type, brigade]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const ids = [...selected];
  // How many selected cards each action would actually touch — shown on the button.
  const eligibleCount = (a: LifecycleAction) =>
    ids.filter((id) => { const c = byId.get(id); return c && isEligible(a, c.status); }).length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  async function runBulk(action: LifecycleAction) {
    setBusy(action);
    setSummary(null);
    const r: BulkResult = await bulkLifecycle(action, ids);
    setBusy(null);
    if (r.ok === false) { setSummary(r.error); return; }
    setSummary(`${BULK_DONE_VERB[action]} ${r.done} · ${r.skipped} skipped · ${r.failed} failed`);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="relative pb-20">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or text…"
          className="rounded-md border bg-background px-3 py-1.5 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass} aria-label="Filter by status">
          <option value="">All statuses</option>
          {SET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as CardType | "")} className={selectClass} aria-label="Filter by type">
          <option value="">All types</option>
          {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={brigade} onChange={(e) => setBrigade(e.target.value as Brigade | "")} className={selectClass} aria-label="Filter by brigade">
          <option value="">All brigades</option>
          {BRIGADES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} of {cards.length}</span>
        <Button
          size="sm" variant={selecting ? "secondary" : "outline"} className="ml-auto h-8"
          onClick={() => { setSelecting(!selecting); setSelected(new Set()); setSummary(null); }}
        >
          {selecting ? "Done selecting" : "Select"}
        </Button>
      </div>

      {selecting && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{selected.size} selected</span>
          <button type="button" className="hover:text-foreground hover:underline"
            onClick={() => setSelected(new Set(filtered.map((c) => c.id)))}>
            Select all ({filtered.length})
          </button>
          <button type="button" className="hover:text-foreground hover:underline" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          {summary && <span aria-live="polite" className="text-foreground">{summary}</span>}
        </div>
      )}

      <ForgeCardGrid cards={filtered} showStatus selection={{ active: selecting, selected, onToggle: toggle }} />

      {selecting && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center justify-center gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
          {BULK_ACTIONS.map((a) => {
            const n = eligibleCount(a);
            const danger = a === "delete";
            const label = busy === a ? "Working…" : `${ACTION_LABEL[a]}${n ? ` (${n})` : ""}`;
            return (
              <Button
                key={a}
                size="sm"
                variant={a === "release" ? "default" : "outline"}
                className={`h-8 text-xs ${danger ? "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" : ""}`}
                disabled={busy !== null || n === 0}
                onClick={() => (a === "delete" || a === "returnToIdeas") ? setConfirming(a) : runBulk(a)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      )}

      <ConfirmationDialog
        open={confirming !== null}
        onOpenChange={(o) => { if (!o) setConfirming(null); }}
        onConfirm={() => { const a = confirming; setConfirming(null); if (a) runBulk(a); }}
        variant={confirming === "delete" ? "destructive" : "warning"}
        title={confirming === "delete" ? CONFIRM_COPY.delete.title : CONFIRM_COPY.returnToIdeas.title}
        description={`${confirming === "delete" ? CONFIRM_COPY.delete.description : CONFIRM_COPY.returnToIdeas.description} (${eligibleCount(confirming ?? "delete")} cards)`}
        confirmLabel={confirming === "delete" ? CONFIRM_COPY.delete.confirmLabel : CONFIRM_COPY.returnToIdeas.confirmLabel}
      />
    </div>
  );
}
