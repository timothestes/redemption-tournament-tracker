# Forge UI/UX Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the forge lifecycle vocabulary around playtesting outcomes, add filters + bulk actions to the set cards view and ideas library, polish the card detail page, add breadcrumbs, drop the Desk tab for a dashboard landing, and sweep hardcoded colors for theme compatibility.

**Architecture:** Zero migrations, zero new RPCs, zero new routes. All new server behavior is server actions looping existing SECURITY DEFINER RPCs under `requireElder`. Copy and eligibility live in one pure module (`lifecycleCopy.ts`) consumed by every surface. Selection is an optional prop on the existing `ForgeCardGrid`.

**Tech Stack:** Next.js 15 App Router, React 19, Supabase (existing RPCs only), Tailwind + shadcn `Button`/`Badge`/`ConfirmationDialog`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-03-forge-uiux-pass-design.md`

## Global Constraints

- **No new migrations, RPCs, tables, or routes.** Bulk = loops over existing definer RPCs.
- **tsconfig has `strict:false`** → discriminated-union narrowing via `if (r.ok)` is broken; always narrow with `r.ok === false` (see memory/1a.5 gotcha). Only `npm run build` catches this.
- **Every `/forge` page must call `requireForge()` itself** (the `forge-gate-first` test enforces it). No pages are added or removed in this plan; don't remove existing gates.
- **No `next/image` under app/forge** (`forge-no-next-image` guardrail). Plain `<img>` via the authed proxy only.
- **No focus rings** (`focus:ring-2 focus:ring-ring`) on form controls — user rule.
- **Green (`primary`) at rest only for CTAs and selected states** — links at rest are `text-foreground`/`text-muted-foreground` with `hover:text-primary` — user rule.
- **No blob keys or secret data may reach the client** — this plan only threads existing booleans/ids; do not add fields to client payloads beyond what tasks specify.
- Terminology (fixed by spec): release to playtest / release update / mark final / reopen testing / shelve / restore / return to ideas / delete. Status labels: Idea / Draft / In playtest / Final / Shelved.
- Deviations from spec text, decided at planning: (1) selection folded into `ForgeCardGrid` as an optional prop instead of a separate `SelectableCardGrid.tsx` (same reuse, one grid); (2) set-subtree breadcrumb ends at the set name — the tab row itself gains an active state instead of a `› {Tab}` crumb (a server layout can't know the pathname).
- Commit after every task; message prefixes given per task.

---

### Task 1: `lifecycleCopy.ts` — labels + eligibility (pure, TDD)

**Files:**
- Create: `app/forge/lib/lifecycleCopy.ts`
- Test: `app/forge/lib/__tests__/lifecycleCopy.test.ts`

**Interfaces:**
- Produces: `STATUS_LABEL: Record<string,string>`, `STATUS_PATH: readonly ["draft","playtesting","approved"]`, `type LifecycleAction = "release"|"markFinal"|"reopen"|"shelve"|"restore"|"returnToIdeas"|"delete"`, `ACTION_LABEL: Record<LifecycleAction,string>`, `BULK_DONE_VERB: Record<LifecycleAction,string>`, `releaseLabel(status: string): string`, `isEligible(action: LifecycleAction, status: string): boolean`, `CONFIRM_COPY.returnToIdeas/.delete: {title, description, confirmLabel}`.

- [ ] **Step 1: Write the failing test**

```ts
// app/forge/lib/__tests__/lifecycleCopy.test.ts
import { describe, it, expect } from "vitest";
import {
  STATUS_LABEL, ACTION_LABEL, releaseLabel, isEligible, BULK_DONE_VERB,
} from "../lifecycleCopy";

describe("lifecycleCopy", () => {
  it("maps every status to its display label", () => {
    expect(STATUS_LABEL).toEqual({
      private_idea: "Idea",
      draft: "Draft",
      playtesting: "In playtest",
      approved: "Final",
      archived: "Shelved",
    });
  });

  it("labels the publish action by where the card is", () => {
    expect(releaseLabel("draft")).toBe("Release to playtest");
    expect(releaseLabel("playtesting")).toBe("Release update");
  });

  it("release admits draft and playtesting only", () => {
    expect(isEligible("release", "draft")).toBe(true);
    expect(isEligible("release", "playtesting")).toBe(true);
    expect(isEligible("release", "approved")).toBe(false);
    expect(isEligible("release", "archived")).toBe(false);
    expect(isEligible("release", "private_idea")).toBe(false);
  });

  it("markFinal admits playtesting only; reopen admits approved only", () => {
    expect(isEligible("markFinal", "playtesting")).toBe(true);
    expect(isEligible("markFinal", "approved")).toBe(false);
    expect(isEligible("reopen", "approved")).toBe(true);
    expect(isEligible("reopen", "playtesting")).toBe(false);
  });

  it("shelve/restore mirror archive/unarchive guards", () => {
    expect(isEligible("shelve", "draft")).toBe(true);
    expect(isEligible("shelve", "archived")).toBe(false);
    expect(isEligible("restore", "archived")).toBe(true);
    expect(isEligible("restore", "draft")).toBe(false);
  });

  it("delete admits every status", () => {
    for (const s of ["private_idea", "draft", "playtesting", "approved", "archived"]) {
      expect(isEligible("delete", s)).toBe(true);
    }
  });

  it("has a past-tense verb for every action", () => {
    for (const a of Object.keys(ACTION_LABEL)) {
      expect(BULK_DONE_VERB[a as keyof typeof BULK_DONE_VERB]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/forge/lib/__tests__/lifecycleCopy.test.ts`
Expected: FAIL — cannot resolve `../lifecycleCopy`.

- [ ] **Step 3: Write the implementation**

```ts
// app/forge/lib/lifecycleCopy.ts
// Single source of truth for forge lifecycle copy + which statuses admit which
// action. Pure and isomorphic — imported by client components and server actions.
// Eligibility mirrors the guards in migration 052's RPCs; keep them in sync.

export const STATUS_LABEL: Record<string, string> = {
  private_idea: "Idea",
  draft: "Draft",
  playtesting: "In playtest",
  approved: "Final",
  archived: "Shelved",
};

export const STATUS_PATH = ["draft", "playtesting", "approved"] as const;

export type LifecycleAction =
  | "release"
  | "markFinal"
  | "reopen"
  | "shelve"
  | "restore"
  | "returnToIdeas"
  | "delete";

export const ACTION_LABEL: Record<LifecycleAction, string> = {
  release: "Release to playtest",
  markFinal: "Mark final",
  reopen: "Reopen testing",
  shelve: "Shelve",
  restore: "Restore",
  returnToIdeas: "Return to ideas",
  delete: "Delete",
};

// Past-tense verbs for bulk-result summaries ("Released 12 · 3 skipped · 0 failed").
export const BULK_DONE_VERB: Record<LifecycleAction, string> = {
  release: "Released",
  markFinal: "Marked final",
  reopen: "Reopened",
  shelve: "Shelved",
  restore: "Restored",
  returnToIdeas: "Returned",
  delete: "Deleted",
};

// A draft gets its first release; a playtesting card gets a new frozen version.
export function releaseLabel(status: string): string {
  return status === "draft" ? ACTION_LABEL.release : "Release update";
}

const ACTION_ELIGIBLE: Record<LifecycleAction, readonly string[]> = {
  release: ["draft", "playtesting"],
  markFinal: ["playtesting"],
  reopen: ["approved"],
  shelve: ["draft", "playtesting", "approved"],
  restore: ["archived"],
  returnToIdeas: ["draft", "playtesting", "approved", "archived"],
  delete: ["private_idea", "draft", "playtesting", "approved", "archived"],
};

export function isEligible(action: LifecycleAction, status: string): boolean {
  return ACTION_ELIGIBLE[action].includes(status);
}

export const CONFIRM_COPY = {
  returnToIdeas: {
    title: "Return to ideas?",
    description:
      "Returns each card to its owner's private ideas. Released versions are retired and playtesters can no longer see the card.",
    confirmLabel: "Return to ideas",
  },
  delete: {
    title: "Delete permanently?",
    description:
      "This permanently removes the card and all of its versions. This cannot be undone.",
    confirmLabel: "Delete",
  },
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/forge/lib/__tests__/lifecycleCopy.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/lifecycleCopy.ts app/forge/lib/__tests__/lifecycleCopy.test.ts
git commit -m "feat(forge): lifecycleCopy — playtest-centric labels + action eligibility"
```

---

### Task 2: Apply terminology to LifecycleControls + grid badges

**Files:**
- Modify: `app/forge/cards/[cardId]/LifecycleControls.tsx` (full rewrite below)
- Modify: `app/forge/components/ForgeCardGrid.tsx:6-9` (STATUS_LABEL import)

**Interfaces:**
- Consumes: Task 1's `STATUS_LABEL`, `STATUS_PATH`, `ACTION_LABEL`, `releaseLabel`, `CONFIRM_COPY`.
- Produces: `LifecycleControls` keeps its existing props (`{ card, sets }`); `ForgeCardGrid` keeps its props (Task 4 extends them).

- [ ] **Step 1: Rewrite `LifecycleControls.tsx`**

Replace the entire file with:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shareToSet, sendToPrivate, publish, approve, unapprove, archive, unarchive, deleteCard } from "@/app/forge/lib/lifecycle";
import { STATUS_PATH, STATUS_LABEL, ACTION_LABEL, releaseLabel, CONFIRM_COPY } from "@/app/forge/lib/lifecycleCopy";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

export default function LifecycleControls({ card, sets }: { card: ForgeCardFull; sets: ForgeSetSummary[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok === false) alert(r.error ?? "Action failed");
      router.refresh();
    });

  // Delete navigates away (the card no longer exists) — refreshing in place would 404.
  const onDelete = () =>
    start(async () => {
      const r = await deleteCard(card.id);
      if (r.ok === false) { alert(r.error ?? "Could not delete card"); return; }
      router.push(card.setId ? `/forge/sets/${card.setId}/cards` : "/forge/ideas");
    });

  const inSet = card.setId !== null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {inSet ? (
        <>
          <ol className="flex items-center gap-1 text-muted-foreground">
            {STATUS_PATH.map((s) => (
              <li key={s} className={card.status === s ? "font-semibold text-foreground" : ""}>
                {STATUS_LABEL[s]}
                {s !== "approved" ? " ›" : ""}
              </li>
            ))}
            {card.status === "archived" && <li className="font-semibold text-foreground">· {STATUS_LABEL.archived}</li>}
          </ol>
          <div className="ml-auto flex flex-wrap gap-2">
            {(card.status === "draft" || card.status === "playtesting") && (
              <Button size="sm" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => publish(card.id))}>
                {releaseLabel(card.status)}
              </Button>
            )}
            {card.status === "playtesting" && (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => approve(card.id))}>
                {ACTION_LABEL.markFinal}
              </Button>
            )}
            {card.status === "approved" && (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => unapprove(card.id))}>
                {ACTION_LABEL.reopen}
              </Button>
            )}
            {card.status === "archived" ? (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => unarchive(card.id))}>
                {ACTION_LABEL.restore}
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => archive(card.id))}>
                {ACTION_LABEL.shelve}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => setConfirmReturn(true)}>
              {ACTION_LABEL.returnToIdeas}
            </Button>
            <Button size="sm" variant="outline" className="h-7 border-destructive/40 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={pending} onClick={() => setConfirmDelete(true)}>
              {ACTION_LABEL.delete}
            </Button>
          </div>
        </>
      ) : (
        <div className="ml-auto">
          {picking ? (
            <select autoFocus disabled={pending} defaultValue="" onChange={(e) => e.target.value && run(() => shareToSet(card.id, e.target.value))} className="rounded-md border bg-background px-2 py-1">
              <option value="" disabled>Share into set…</option>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => setPicking(true)}>Share to a set</Button>
          )}
        </div>
      )}
      <ConfirmationDialog
        open={confirmReturn}
        onOpenChange={setConfirmReturn}
        onConfirm={() => run(() => sendToPrivate(card.id))}
        variant="warning"
        title={CONFIRM_COPY.returnToIdeas.title}
        description={CONFIRM_COPY.returnToIdeas.description}
        confirmLabel={CONFIRM_COPY.returnToIdeas.confirmLabel}
      />
      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={onDelete}
        variant="destructive"
        title="Delete this card?"
        description={CONFIRM_COPY.delete.description}
        confirmLabel="Delete card"
      />
    </div>
  );
}
```

Notes: the `window.confirm` for send-to-private becomes a `ConfirmationDialog` (warning variant); the archived state gets appended to the status path so a shelved card shows where it is.

- [ ] **Step 2: Point `ForgeCardGrid` at the shared labels**

In `app/forge/components/ForgeCardGrid.tsx`, delete the local `STATUS_LABEL` const (lines 6–9) and add:

```tsx
import { STATUS_LABEL } from "@/app/forge/lib/lifecycleCopy";
```

(The render site already reads `STATUS_LABEL[c.status]` — no other change.)

- [ ] **Step 3: Verify build + tests**

Run: `npx vitest run app/forge && npm run build`
Expected: forge tests pass; build clean (catches any `r.ok` narrowing mistakes).

- [ ] **Step 4: Commit**

```bash
git add app/forge/cards/\[cardId\]/LifecycleControls.tsx app/forge/components/ForgeCardGrid.tsx
git commit -m "feat(forge): playtest-centric lifecycle labels on card controls + grid badges"
```

---

### Task 3: Bulk server actions (TDD)

**Files:**
- Modify: `app/forge/lib/lifecycle.ts` (append; existing exports unchanged)
- Test: `app/forge/lib/__tests__/lifecycle.test.ts` (append describe block)

**Interfaces:**
- Consumes: Task 1's `isEligible`, `LifecycleAction`.
- Produces: `bulkLifecycle(action: LifecycleAction, cardIds: string[]): Promise<BulkResult>` and `bulkShareToSet(setId: string, cardIds: string[]): Promise<BulkResult>`, where `type BulkResult = { ok: true; done: number; skipped: number; failed: number } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `app/forge/lib/__tests__/lifecycle.test.ts` (mock style matches the existing file — `requireElder` and `next/cache` are already mocked at the top):

```ts
import { bulkLifecycle, bulkShareToSet } from "../lifecycle";

function bulkCtx(rows: { id: string; status: string }[], rpcError: any = null) {
  const rpc = vi.fn(async () => ({ data: null, error: rpcError }));
  const supabase = {
    rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(async () => ({ data: rows, error: null })),
      })),
    })),
  };
  return { role: "elder", user: { id: "u1" }, supabase };
}

describe("bulkLifecycle", () => {
  it("rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await bulkLifecycle("release", ["c1"])).ok).toBe(false);
  });

  it("runs eligible cards, skips ineligible ones", async () => {
    const c = bulkCtx([
      { id: "c1", status: "draft" },
      { id: "c2", status: "approved" },   // not eligible for release
      { id: "c3", status: "playtesting" },
    ]);
    (requireElder as any).mockResolvedValue(c);
    const r = await bulkLifecycle("release", ["c1", "c2", "c3"]);
    expect(r).toEqual({ ok: true, done: 2, skipped: 1, failed: 0 });
    expect((c.supabase.rpc as any).mock.calls.map((x: any) => x[1].p_card_id)).toEqual(["c1", "c3"]);
    expect((c.supabase.rpc as any).mock.calls[0][0]).toBe("forge_publish_card");
  });

  it("counts unknown ids (RLS-hidden) as skipped", async () => {
    const c = bulkCtx([{ id: "c1", status: "draft" }]);
    (requireElder as any).mockResolvedValue(c);
    const r = await bulkLifecycle("release", ["c1", "ghost"]);
    expect(r).toEqual({ ok: true, done: 1, skipped: 1, failed: 0 });
  });

  it("counts RPC errors as failed, keeps going", async () => {
    const c = bulkCtx(
      [{ id: "c1", status: "draft" }, { id: "c2", status: "draft" }],
      { message: "boom" },
    );
    (requireElder as any).mockResolvedValue(c);
    const r = await bulkLifecycle("release", ["c1", "c2"]);
    expect(r).toEqual({ ok: true, done: 0, skipped: 0, failed: 2 });
  });

  it("rejects more than 500 ids", async () => {
    (requireElder as any).mockResolvedValue(bulkCtx([]));
    const r = await bulkLifecycle("release", Array.from({ length: 501 }, (_, i) => `c${i}`));
    expect(r.ok).toBe(false);
  });
});

describe("bulkShareToSet", () => {
  it("shares only private ideas, passes the set id", async () => {
    const c = bulkCtx([
      { id: "c1", status: "private_idea" },
      { id: "c2", status: "draft" },      // already in a set — skipped
    ]);
    (requireElder as any).mockResolvedValue(c);
    const r = await bulkShareToSet("s1", ["c1", "c2"]);
    expect(r).toEqual({ ok: true, done: 1, skipped: 1, failed: 0 });
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_share_card_to_set", { p_card_id: "c1", p_set_id: "s1" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/forge/lib/__tests__/lifecycle.test.ts`
Expected: FAIL — `bulkLifecycle` is not exported.

- [ ] **Step 3: Implement in `app/forge/lib/lifecycle.ts`**

Append (below `deleteCard`):

```ts
import { isEligible, type LifecycleAction } from "@/app/forge/lib/lifecycleCopy";

export type BulkResult =
  | { ok: true; done: number; skipped: number; failed: number }
  | { ok: false; error: string };

const BULK_RPC: Record<LifecycleAction, string> = {
  release: "forge_publish_card",
  markFinal: "forge_approve_card",
  reopen: "forge_unapprove_card",
  shelve: "forge_archive_card",
  restore: "forge_unarchive_card",
  returnToIdeas: "forge_send_card_to_private",
  delete: "forge_delete_card",
};

// Statuses are read once up front (RLS-scoped) and ineligible cards are skipped
// deterministically — no Postgres error-string parsing. Ids RLS hides are skipped too.
async function runBulk(
  cardIds: string[],
  eligible: (status: string) => boolean,
  call: (supabase: any, id: string) => Promise<{ error: any }>,
): Promise<BulkResult> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (cardIds.length === 0) return { ok: true, done: 0, skipped: 0, failed: 0 };
  if (cardIds.length > 500) return { ok: false, error: "Too many cards selected" };

  const { data: rows, error: readErr } = await ctx.supabase
    .from("forge_cards")
    .select("id, status")
    .in("id", cardIds);
  if (readErr) return { ok: false, error: "Could not read cards" };
  const byId = new Map((rows ?? []).map((r: any) => [r.id as string, r.status as string]));

  let done = 0, skipped = 0, failed = 0;
  for (const id of cardIds) {
    const status = byId.get(id);
    if (!status || !eligible(status)) { skipped++; continue; }
    const { error } = await call(ctx.supabase, id);
    if (error) failed++; else done++;
  }
  revalidatePath("/forge", "layout");
  return { ok: true, done, skipped, failed };
}

export async function bulkLifecycle(action: LifecycleAction, cardIds: string[]): Promise<BulkResult> {
  const fn = BULK_RPC[action];
  if (!fn) return { ok: false, error: "Unknown action" };
  return runBulk(
    cardIds,
    (status) => isEligible(action, status),
    (supabase, id) => supabase.rpc(fn, { p_card_id: id }),
  );
}

export async function bulkShareToSet(setId: string, cardIds: string[]): Promise<BulkResult> {
  return runBulk(
    cardIds,
    (status) => status === "private_idea",
    (supabase, id) => supabase.rpc("forge_share_card_to_set", { p_card_id: id, p_set_id: setId }),
  );
}
```

Note: `lifecycle.ts` is a `"use server"` module — exported async functions only; `BULK_RPC`/`runBulk` are module-private (not exported), which is allowed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/forge/lib/__tests__/lifecycle.test.ts`
Expected: PASS (existing 5 + new 6).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/lifecycle.ts app/forge/lib/__tests__/lifecycle.test.ts
git commit -m "feat(forge): bulkLifecycle + bulkShareToSet server actions with skip/fail classification"
```

---

### Task 4: Selection support in `ForgeCardGrid`

**Files:**
- Modify: `app/forge/components/ForgeCardGrid.tsx` (full rewrite below)

**Interfaces:**
- Produces: `ForgeCardGrid({ cards, showStatus?, selection? })` where `selection?: { active: boolean; selected: ReadonlySet<string>; onToggle: (id: string) => void }`. When `selection.active`, cards toggle instead of navigating and show a check indicator. Existing call sites need no change.

- [ ] **Step 1: Rewrite the component**

```tsx
import Link from "next/link";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import { cardRawText } from "@/app/forge/lib/designCard";
import { STATUS_LABEL } from "@/app/forge/lib/lifecycleCopy";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

export type GridSelection = {
  active: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
};

export default function ForgeCardGrid({
  cards, showStatus = false, selection,
}: {
  cards: ForgeCardFull[];
  showStatus?: boolean;
  selection?: GridSelection;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((c) => {
        const t = Date.parse(c.updatedAt) || 0;
        const inner = (
          <>
            <ForgeCardFace
              name={c.snapshot.name ?? null}
              rawText={cardRawText(c.snapshot)}
              finishedUrl={c.hasFinished ? `/forge/api/art/${c.id}?kind=finished&t=${t}` : null}
              artUrl={c.hasArt ? `/forge/api/art/${c.id}?t=${t}` : null}
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="truncate text-xs text-muted-foreground">{c.title ?? "Untitled"}</p>
              {showStatus && (
                <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              )}
            </div>
          </>
        );
        if (selection?.active) {
          const isSel = selection.selected.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => selection.onToggle(c.id)}
              aria-pressed={isSel}
              className="relative block text-left transition hover:opacity-90"
            >
              <span
                aria-hidden
                className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border text-xs ${
                  isSel ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
                }`}
              >
                {isSel ? "✓" : ""}
              </span>
              {isSel && (
                <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-lg border-2 border-primary/60" />
              )}
              {inner}
            </button>
          );
        }
        return (
          <Link key={c.id} href={`/forge/cards/${c.id}`} className="block transition hover:opacity-90">
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean — existing call sites (`IdeasLibrary`, set cards page) compile unchanged.

- [ ] **Step 3: Commit**

```bash
git add app/forge/components/ForgeCardGrid.tsx
git commit -m "feat(forge): optional selection mode on ForgeCardGrid"
```

---

### Task 5: SetCardsBrowser — filters + bulk bar

**Files:**
- Create: `app/forge/sets/[setId]/cards/SetCardsBrowser.tsx`
- Modify: `app/forge/sets/[setId]/cards/page.tsx`

**Interfaces:**
- Consumes: Task 3's `bulkLifecycle`/`BulkResult`, Task 4's `GridSelection`, Task 1's labels/`isEligible`.
- Produces: `SetCardsBrowser({ cards }: { cards: ForgeCardFull[] })` client component.

- [ ] **Step 1: Create `SetCardsBrowser.tsx`**

```tsx
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
```

- [ ] **Step 2: Wire the page**

Replace the `return <ForgeCardGrid cards={cards} showStatus />;` line in `app/forge/sets/[setId]/cards/page.tsx` with `return <SetCardsBrowser cards={cards} />;` and swap the import of `ForgeCardGrid` for:

```tsx
import SetCardsBrowser from "./SetCardsBrowser";
```

(The empty-state early return stays exactly as is.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/forge/sets/\[setId\]/cards/
git commit -m "feat(forge): set cards view — search/status/type/brigade filters + bulk lifecycle bar"
```

---

### Task 6: Ideas — selection + bulk send-to-set / delete

**Files:**
- Modify: `app/forge/ideas/IdeasLibrary.tsx`
- Modify: `app/forge/ideas/page.tsx`

**Interfaces:**
- Consumes: Task 3's `bulkShareToSet`/`bulkLifecycle`, Task 4's selection prop, `ForgeSetSummary` from sets.ts.
- Produces: `IdeasLibrary({ cards, canCreate, sets })` — new required `sets: ForgeSetSummary[]` prop.

- [ ] **Step 1: Update `page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listForgeCards } from "@/app/forge/lib/cards";
import { listSets } from "@/app/forge/lib/sets";
import IdeasLibrary from "./IdeasLibrary";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const [cards, sets] = await Promise.all([listForgeCards(), listSets()]);
  return <IdeasLibrary cards={cards} canCreate={ctx.role === "elder" || ctx.role === "superadmin"} sets={sets} />;
}
```

- [ ] **Step 2: Rewrite `IdeasLibrary.tsx`**

Replace the entire file with (filters and `onNew` preserved from the current version):

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createCard, type ForgeCardFull } from "@/app/forge/lib/cards";
import { bulkShareToSet, bulkLifecycle, type BulkResult } from "@/app/forge/lib/lifecycle";
import { BULK_DONE_VERB, CONFIRM_COPY } from "@/app/forge/lib/lifecycleCopy";
import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";
import { CARD_TYPES, BRIGADES, type CardType, type Brigade } from "@/app/forge/lib/designCard";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

export default function IdeasLibrary({ cards, canCreate, sets }: { cards: ForgeCardFull[]; canCreate: boolean; sets: ForgeSetSummary[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState<CardType | "">("");
  const [brigade, setBrigade] = useState<Brigade | "">("");
  const [creating, setCreating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [targetSet, setTargetSet] = useState("");

  const filtered = useMemo(() => cards.filter((c) => {
    const s = c.snapshot ?? {};
    if (q && !(c.title ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    if (type && !(s.cardType ?? []).includes(type)) return false;
    if (brigade && !(s.brigades ?? []).includes(brigade)) return false;
    return true;
  }), [cards, q, type, brigade]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  async function onNew() {
    setCreating(true);
    const r = await createCard("");
    setCreating(false);
    if (r.ok) router.push(`/forge/cards/${r.id}`);
  }

  async function onBulkSend() {
    setBusy(true); setSummary(null);
    const r: BulkResult = await bulkShareToSet(targetSet, [...selected]);
    setBusy(false);
    if (r.ok === false) { setSummary(r.error); return; }
    setSummary(`Sent ${r.done} · ${r.skipped} skipped · ${r.failed} failed`);
    setSelected(new Set());
    router.refresh();
  }

  async function onBulkDelete() {
    setBusy(true); setSummary(null);
    const r: BulkResult = await bulkLifecycle("delete", [...selected]);
    setBusy(false);
    if (r.ok === false) { setSummary(r.error); return; }
    setSummary(`${BULK_DONE_VERB.delete} ${r.done} · ${r.failed} failed`);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl p-4 pb-20">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Ideas</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
          className="rounded-md border bg-background px-3 py-1.5 text-sm" />
        <select value={type} onChange={(e) => setType(e.target.value as CardType | "")} className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="">All types</option>
          {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={brigade} onChange={(e) => setBrigade(e.target.value as Brigade | "")} className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="">All brigades</option>
          {BRIGADES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <Button size="sm" variant={selecting ? "secondary" : "outline"} className="h-8"
          onClick={() => { setSelecting(!selecting); setSelected(new Set()); setSummary(null); }}>
          {selecting ? "Done selecting" : "Select"}
        </Button>
        {canCreate && (
          <Button size="sm" className="h-8" onClick={onNew} disabled={creating}>New card</Button>
        )}
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

      {filtered.length === 0 ? (
        <div className="mx-auto mt-16 max-w-xs text-center">
          <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
          <p className="mb-3 text-sm text-muted-foreground">No ideas yet. Start with a name and a thought.</p>
          {canCreate && <Button onClick={onNew} disabled={creating}>Jot an idea</Button>}
        </div>
      ) : (
        <ForgeCardGrid cards={filtered} selection={{ active: selecting, selected, onToggle: toggle }} />
      )}

      {selecting && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center justify-center gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
          <select value={targetSet} onChange={(e) => setTargetSet(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm" aria-label="Destination set">
            <option value="">Send to set…</option>
            {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button size="sm" className="h-8 text-xs" disabled={busy || !targetSet} onClick={onBulkSend}>
            {busy ? "Working…" : `Send ${selected.size} to set`}
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      )}

      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={onBulkDelete}
        variant="destructive"
        title={CONFIRM_COPY.delete.title}
        description={`${CONFIRM_COPY.delete.description} (${selected.size} cards)`}
        confirmLabel={CONFIRM_COPY.delete.confirmLabel}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify build + a quick manual render**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/forge/ideas/
git commit -m "feat(forge): ideas library — bulk send-to-set and bulk delete"
```

---

### Task 7: Breadcrumbs + active set tabs

**Files:**
- Create: `app/forge/components/ForgeBreadcrumbs.tsx`
- Create: `app/forge/sets/[setId]/SetTabs.tsx`
- Modify: `app/forge/sets/[setId]/layout.tsx`
- Modify: `app/forge/cards/[cardId]/page.tsx` + `app/forge/cards/[cardId]/StudioEditor.tsx` (back-link row → breadcrumbs)
- Modify: `app/forge/play/[setId]/page.tsx`

**Interfaces:**
- Produces: `ForgeBreadcrumbs({ items }: { items: { label: string; href?: string }[] })` (server-safe, no "use client"); `SetTabs({ setId }: { setId: string })` (client). StudioEditor gains a `setName: string | null` prop.

- [ ] **Step 1: Create `ForgeBreadcrumbs.tsx`**

```tsx
import Link from "next/link";

export type Crumb = { label: string; href?: string };

export default function ForgeBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>›</span>}
            {it.href ? (
              <Link href={it.href} className="hover:text-foreground hover:underline">{it.label}</Link>
            ) : (
              <span aria-current="page" className="font-medium text-foreground">{it.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 2: Create `SetTabs.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SetTabs({ setId }: { setId: string }) {
  const pathname = usePathname() ?? "";
  const tabs = [
    { href: `/forge/sets/${setId}/cards`, label: "Cards" },
    { href: `/forge/sets/${setId}/notes`, label: "Notes" },
    { href: `/forge/sets/${setId}/progress`, label: "Progress" },
    { href: `/forge/sets/${setId}/review`, label: "Review" },
  ];
  return (
    <nav className="mt-2 flex gap-1 text-sm">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: Update the set layout**

In `app/forge/sets/[setId]/layout.tsx`, replace the header block (the `<Link>← Sets</Link>`, `<h1>`, and inline `tabs` nav) with:

```tsx
<div className="mb-4">
  <ForgeBreadcrumbs items={[
    { label: "The Forge", href: "/forge" },
    { label: "Sets", href: "/forge/sets" },
    { label: set.name },
  ]} />
  <h1 className="text-lg font-semibold">{set.name}</h1>
  <SetTabs setId={setId} />
</div>
```

adding imports `ForgeBreadcrumbs` and `SetTabs`, and deleting the now-unused `tabs` array and `Link` import.

- [ ] **Step 4: Card page breadcrumbs**

In `app/forge/cards/[cardId]/page.tsx`: after `const card = await getCard(cardId)`, fetch the set name when the card is in one:

```tsx
const set = card.setId ? await getSet(card.setId) : null;
```

(import `getSet` from `@/app/forge/lib/sets`) and pass `setName={set?.name ?? null}` to `<StudioEditor …>`.

In `StudioEditor.tsx`: add `setName: string | null` to props; replace the back link (`<Link …>← {card.setId ? "Set" : "Ideas"}</Link>`) with:

```tsx
<ForgeBreadcrumbs items={
  card.setId
    ? [
        { label: "The Forge", href: "/forge" },
        { label: "Sets", href: "/forge/sets" },
        { label: setName ?? "Set", href: `/forge/sets/${card.setId}/cards` },
        { label: card.title?.trim() || "Untitled" },
      ]
    : [
        { label: "The Forge", href: "/forge" },
        { label: "Ideas", href: "/forge/ideas" },
        { label: card.title?.trim() || "Untitled" },
      ]
} />
```

keeping the save-status span in the same flex row (breadcrumb left, status right). Remove the now-unused `Link` import if nothing else uses it.

- [ ] **Step 5: Playtester reveal breadcrumbs**

In `app/forge/play/[setId]/page.tsx`, above the `<h1>`:

```tsx
<ForgeBreadcrumbs items={[
  { label: "The Forge", href: "/forge" },
  { label: "Sets", href: "/forge/play" },
  { label: set.name },
]} />
```

- [ ] **Step 6: Verify build + commit**

Run: `npm run build` — expected clean. Then:

```bash
git add app/forge/components/ForgeBreadcrumbs.tsx app/forge/sets/\[setId\]/ app/forge/cards/\[cardId\]/ app/forge/play/\[setId\]/page.tsx
git commit -m "feat(forge): shared breadcrumbs + active-state set tabs, replace ad-hoc back links"
```

---

### Task 8: Nav (drop Desk) + dashboard landing

**Files:**
- Modify: `app/forge/components/ForgeNav.tsx` (remove Desk items)
- Modify: `app/forge/lib/sets.ts` (`listSets` gains `statusCounts`)
- Modify: `app/forge/lib/cards.ts` (add `listRecentCards`)
- Modify: `app/forge/page.tsx` (dashboard)
- Test: extend `app/forge/lib/__tests__/sets.test.ts` if it covers `listSets`' shape (check first; if it asserts the returned keys, add `statusCounts`)

**Interfaces:**
- Consumes: `STATUS_LABEL` (Task 1), `ForgeCardGrid` (unchanged call), existing `listSets`.
- Produces: `ForgeSetSummary` gains `statusCounts: Record<string, number>` (counts of non-archived cards by status). `listRecentCards(limit?: number): Promise<ForgeCardFull[]>`.

- [ ] **Step 1: Remove Desk from `ForgeNav.tsx`**

Delete the `{ href: "/forge", label: "Desk", … }` item from BOTH role arrays (lines 18 and 23). No other change — the wordmark link stays.

- [ ] **Step 2: Extend `listSets` in `sets.ts`**

The function already fetches `forge_cards.select("set_id, status")`. Build per-status counts in the same loop:

```ts
const counts = new Map<string, number>();
const statusCounts = new Map<string, Record<string, number>>();
for (const c of cards ?? []) {
  if (!c.set_id) continue;
  if (c.status !== "archived") counts.set(c.set_id, (counts.get(c.set_id) ?? 0) + 1);
  const m = statusCounts.get(c.set_id) ?? {};
  m[c.status] = (m[c.status] ?? 0) + 1;
  statusCounts.set(c.set_id, m);
}
return (sets ?? []).map((s: any) => ({
  id: s.id, name: s.name, slug: s.slug, status: s.status,
  total: counts.get(s.id) ?? 0,
  targetTotal: (s.target_counts?.total as number) ?? 0,
  statusCounts: statusCounts.get(s.id) ?? {},
}));
```

and add `statusCounts: Record<string, number>` to `ForgeSetSummary`.

- [ ] **Step 3: Add `listRecentCards` to `cards.ts`**

```ts
// Most recently edited cards the caller can see (RLS scopes this to own ideas +
// set-elder cards; for playtesters, granted playtesting/approved cards).
export async function listRecentCards(limit = 6): Promise<ForgeCardFull[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select(CARD_COLS)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(toFull);
}
```

- [ ] **Step 4: Rewrite `app/forge/page.tsx` as the dashboard**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "./lib/auth";
import { listSets } from "./lib/sets";
import { listRecentCards } from "./lib/cards";
import { STATUS_LABEL } from "./lib/lifecycleCopy";
import ForgeCardGrid from "./components/ForgeCardGrid";

export const dynamic = "force-dynamic";

const MIX_ORDER = ["draft", "playtesting", "approved"] as const;

export default async function ForgeHomePage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const isPlaytester = ctx.role === "playtester";
  const [sets, recent] = await Promise.all([listSets(), isPlaytester ? Promise.resolve([]) : listRecentCards(6)]);

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>The Forge</h1>

      {isPlaytester ? (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Your sets</h2>
            {sets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sets shared with you yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sets.map((s) => (
                  <li key={s.id}>
                    <Link href={`/forge/play/${s.id}`} className="flex items-center justify-between p-3 hover:bg-muted/50">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-sm text-muted-foreground">{s.total} cards</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <Link href="/forge/play/decks" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Build a deck</div>
              <div className="text-sm text-muted-foreground">Mix the cards shared with you and the full pool.</div>
            </Link>
            <div className="rounded-lg border border-dashed p-4 opacity-60" aria-disabled="true">
              <div className="font-medium">Find a game</div>
              <div className="text-sm text-muted-foreground">Coming soon.</div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="flex flex-wrap gap-3">
            <Link href="/forge/ideas" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">New idea</div>
              <div className="text-sm text-muted-foreground">Sketch a card in your private ideas.</div>
            </Link>
            <Link href="/forge/import" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Import a set</div>
              <div className="text-sm text-muted-foreground">Bring in a LackeyCCG plugin zip.</div>
            </Link>
            <Link href="/forge/sets" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">New set</div>
              <div className="text-sm text-muted-foreground">Gather cards toward print.</div>
            </Link>
            {ctx.role === "superadmin" && (
              <Link href="/forge/admin" className="rounded-lg border p-4 hover:bg-muted/50">
                <div className="font-medium">Admin</div>
                <div className="text-sm text-muted-foreground">Invites & roles.</div>
              </Link>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Your sets</h2>
            {sets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sets yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sets.map((s) => {
                  const mix = MIX_ORDER
                    .filter((k) => (s.statusCounts[k] ?? 0) > 0)
                    .map((k) => `${s.statusCounts[k]} ${STATUS_LABEL[k].toLowerCase()}`)
                    .join(" · ");
                  return (
                    <li key={s.id}>
                      <Link href={`/forge/sets/${s.id}/cards`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted/50">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-right text-sm text-muted-foreground">
                          {s.total}{s.targetTotal ? ` / ${s.targetTotal}` : ""} cards
                          {mix ? <span className="block text-xs">{mix}</span> : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {recent.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Recently edited</h2>
              <ForgeCardGrid cards={recent} showStatus />
            </section>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Signed in as {ctx.user.email ?? ctx.user.id} · {ctx.role}
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Verify tests + build**

Run: `npx vitest run app/forge && npm run build`
Expected: pass/clean. If `sets.test.ts` asserts the exact `ForgeSetSummary` keys, extend its fixture with `statusCounts`.

- [ ] **Step 6: Commit**

```bash
git add app/forge/components/ForgeNav.tsx app/forge/lib/sets.ts app/forge/lib/cards.ts app/forge/page.tsx app/forge/lib/__tests__/sets.test.ts
git commit -m "feat(forge): drop Desk tab, dashboard landing with sets/status mix/recent cards"
```

---

### Task 9: Studio polish (layout, modal confirm, upload busy state, tokens)

**Files:**
- Modify: `app/forge/cards/[cardId]/StudioEditor.tsx`

**Interfaces:**
- Consumes: `ConfirmationDialog`, `Button`, Task 7's breadcrumb row (already in place).
- Produces: no API change beyond Task 7's `setName` prop.

- [ ] **Step 1: Apply the following changes to `StudioEditor.tsx`**

1. **Upload busy state.** Add `const [uploading, setUploading] = useState<"art" | "finished" | null>(null);` and wrap `onUpload`:

```tsx
async function onUpload(file: File, kind: "art" | "finished") {
  setErr(null);
  setUploading(kind);
  try {
    const fd = new FormData();
    fd.set("file", file);
    const r = kind === "art" ? await uploadArt(card.id, fd) : await uploadFinished(card.id, fd);
    if (r.ok === false) setErr(r.error ?? "Upload failed");
    else router.refresh();
  } finally {
    setUploading(null);
  }
}
```

Each file input gets `disabled={uploading !== null}`, and next to each legend render `{uploading === "art" && <span className="ml-2 text-xs text-muted-foreground">Uploading…</span>}` (respectively `"finished"`).

2. **Finished-replace confirm → modal.** Delete the inline `role="alertdialog"` amber box entirely. Add at the bottom of the component:

```tsx
<ConfirmationDialog
  open={pendingFinished !== null}
  onOpenChange={(o) => { if (!o) setPendingFinished(null); }}
  onConfirm={() => { const f = pendingFinished; setPendingFinished(null); if (f) onUpload(f, "finished"); }}
  variant="warning"
  title="Replace image without updating the card fields?"
  description="You're replacing the finished card image but haven't changed any card fields this session. If the new image changed the ability text, update the fields to match."
  confirmLabel="Replace anyway"
/>
```

(import `ConfirmationDialog` from `@/components/ui/confirmation-dialog`).

3. **Proposal row.** Replace the emerald submit button with `<Button size="sm" className="h-7 px-3 text-xs" disabled={proposeBusy || !proposeSummary.trim()} onClick={submitProposal}>Submit proposal</Button>` and the cancel button with `<Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setProposing(false)}>Cancel</Button>`; the "Propose changes for review" toggle likewise becomes `<Button size="sm" variant="outline" className="h-7 self-start px-3 text-xs" onClick={() => setProposing(true)}>Propose changes for review</Button>` (import `Button`).

4. **Tokens.** `text-red-500` error → `text-destructive`. Both "Download original" / "Download finished card" links: `text-emerald-600 hover:underline` → `font-medium text-foreground underline-offset-2 hover:text-primary hover:underline`.

5. **Fieldsets.** Both fieldsets: `className="rounded-md border p-3"` → `className="rounded-lg border bg-card p-4"`; legends get `className="px-1 text-sm font-medium"`.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/forge/cards/\[cardId\]/StudioEditor.tsx
git commit -m "feat(forge): studio polish — modal replace-confirm, upload busy state, semantic tokens"
```

---

### Task 10: Theme sweep (remaining hardcoded colors)

**Files:**
- Modify: `app/forge/import/ImportWizard.tsx:312,388,407,417`
- Modify: `app/forge/cards/[cardId]/CommentThread.tsx:77,152`
- Modify: `app/forge/cards/[cardId]/ProposalDiff.tsx:49,89`
- Modify: `app/forge/sets/[setId]/progress/ProgressDashboard.tsx:10,13-16`
- Modify: `app/forge/components/ForgeCardFace.tsx:38`

**Interfaces:** none (class-only changes).

- [ ] **Step 1: Exact replacements**

| File:line | From | To |
|---|---|---|
| ImportWizard:312 | `border-emerald-600 bg-emerald-600/10` | `border-primary bg-primary/10` |
| ImportWizard:388 | `bg-emerald-600 px-4 py-2 text-sm font-medium text-white` | `bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90` |
| ImportWizard:407 | `text-emerald-600 hover:underline` | `font-medium text-primary hover:underline` (post-import CTA — green OK) |
| ImportWizard:417 | `"text-emerald-600"` | `"text-primary"` |
| CommentThread:77 | `text-emerald-700 hover:underline` | `text-foreground underline-offset-2 hover:text-primary hover:underline` |
| CommentThread:152 | `bg-emerald-600 px-3 py-1 text-sm font-medium text-white` | `bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90` |
| ProposalDiff:49 | `bg-emerald-600 px-3 py-1 font-medium text-white` | `bg-primary px-3 py-1 font-medium text-primary-foreground hover:bg-primary/90` |
| ProposalDiff:89 | `text-emerald-700` | `text-primary` (diff "after" value — semantic added-color) |
| ProgressDashboard:10 | `draft: "bg-zinc-400", playtesting: "bg-amber-500", approved: "bg-emerald-600"` | `draft: "bg-muted-foreground/40", playtesting: "bg-amber-500", approved: "bg-primary"` |
| ProgressDashboard:13 | `bg-emerald-50 dark:bg-emerald-950` | `bg-primary/10` |
| ProgressDashboard:14 | `bg-emerald-200 dark:bg-emerald-900` | `bg-primary/25` |
| ForgeCardFace:38 | inline `border: "1px solid rgba(0,0,0,0.15)", background: "rgba(127,127,127,0.06)"` | remove from `style`; change the div to `className={\`overflow-hidden rounded-[4%] border bg-muted/30 ${className ?? ""}\`}` and keep the remaining style props (`box`, flex column) |

`ForgeCardPreview.tsx` is explicitly untouched (descoped legacy).

- [ ] **Step 2: Grep check (spec success criterion 5)**

Run:
```bash
grep -rn "emerald-\|zinc-\|red-600" app/forge --include='*.tsx' --include='*.ts' | grep -v ForgeCardPreview
```
Expected: no output.

- [ ] **Step 3: Verify build + commit**

Run: `npm run build` — expected clean. Then:

```bash
git add app/forge
git commit -m "fix(forge): replace hardcoded emerald/zinc/red with semantic tokens for theme compat"
```

---

### Task 11: E2E — bulk release flow + theme screenshots

**Files:**
- Create: `e2e/forge/uiux.spec.ts`

**Interfaces:**
- Consumes: `seedForgeMember`/`cleanupForgeMember`/`adminAvailable` from `e2e/forge/forgeSeed`, `buildFixtureZip` from `e2e/forge/lackeyFixture` (all exist; see `e2e/forge/import.spec.ts` for usage).

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from "@playwright/test";
import { adminAvailable, seedForgeMember, cleanupForgeMember, type SeededForgeMember } from "./forgeSeed";
import { buildFixtureZip } from "./lackeyFixture";

test.describe("forge uiux pass", () => {
  test.skip(!adminAvailable, "requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL");

  async function signIn(page: Page, seed: SeededForgeMember) {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(seed.email);
    await page.getByLabel(/password/i).fill(seed.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15_000 });
    await page.waitForLoadState("load");
  }

  async function gotoSettled(page: Page, path: string) {
    try { await page.goto(path); } catch { await page.goto(path); }
  }

  test("nav has no Desk tab; landing shows dashboard", async ({ page }) => {
    const seed = await seedForgeMember("elder");
    try {
      await signIn(page, seed);
      await gotoSettled(page, "/forge");
      await expect(page.getByRole("link", { name: "Ideas" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Desk" })).toHaveCount(0);
      await expect(page.getByText("Your sets")).toBeVisible();
    } finally {
      await cleanupForgeMember(seed);
    }
  });

  test("import → bulk release → badges flip → re-run skips", async ({ page }) => {
    test.setTimeout(180_000);
    const seed = await seedForgeMember("elder");
    try {
      await signIn(page, seed);
      // Import the 3-card TST fixture into a fresh set.
      await gotoSettled(page, "/forge/import");
      await page.getByLabel("Lackey zip file").setInputFiles({
        name: "Test Plugin V1.zip", mimeType: "application/zip", buffer: buildFixtureZip(),
      });
      await page.getByLabel("Set filter").fill("TST");
      await expect(page.getByText("3 cards match")).toBeVisible();
      const setName = `E2E UIUX ${Date.now()}`;
      await page.getByLabel("New set name").fill(setName);
      await page.getByRole("button", { name: "Import 3 cards" }).click();
      await expect(page.getByText("Imported 3 · Skipped 0 · Failed 0")).toBeVisible({ timeout: 120_000 });
      await page.getByRole("link", { name: "View set →" }).click();

      // Breadcrumb present on the set cards page.
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Sets");

      // Bulk release all three drafts.
      await page.getByRole("button", { name: "Select" }).click();
      await page.getByRole("button", { name: /^Select all/ }).click();
      await page.getByRole("button", { name: /^Release to playtest/ }).click();
      await expect(page.getByText("Released 3 · 0 skipped · 0 failed")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("text=In playtest").first()).toBeVisible();

      // Mark final all three, then re-run: everything skips (eligibility filter).
      await page.getByRole("button", { name: /^Select all/ }).click();
      await page.getByRole("button", { name: /^Mark final/ }).click();
      await expect(page.getByText("Marked final 3 · 0 skipped · 0 failed")).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: /^Select all/ }).click();
      // All cards are now Final — Mark final has 0 eligible and must be disabled.
      await expect(page.getByRole("button", { name: /^Mark final/ })).toBeDisabled();
    } finally {
      await cleanupForgeMember(seed);
    }
  });
});
```

Note: after each bulk run the selection clears; "Select all" re-selects the (refreshed) grid. The final assertion checks the eligibility-count disable behavior rather than a skip summary — the button is disabled when nothing is eligible.

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/forge/uiux.spec.ts --project=chromium`
Expected: 2 passed (needs `.env.local` with `SUPABASE_SERVICE_ROLE_KEY`; dev server per `playwright.config.ts`).

- [ ] **Step 3: Run the existing import spec (regression)**

Run: `npx playwright test e2e/forge/import.spec.ts --project=chromium`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add e2e/forge/uiux.spec.ts
git commit -m "test(forge): e2e — dashboard nav, breadcrumbs, bulk release/mark-final flow"
```

---

### Task 12: Full verification + theme screenshots

**Files:** none committed (screenshots go to the session scratchpad).

- [ ] **Step 1: Full gates**

```bash
npm run build          # clean; catches strict:false narrowing bugs
npx vitest run         # forge suites green (pre-existing unrelated failures OK)
npx playwright test e2e/forge --project=chromium
```

- [ ] **Step 2: Theme screenshots**

With the dev server running and a seeded elder signed in (reuse the e2e storage state or sign in manually via Playwright MCP), capture light/dark/jayden (set `localStorage.theme` to each value, reload) on: `/forge` (landing), `/forge/sets/<id>/cards` (selection mode open, bulk bar visible), `/forge/cards/<id>` (studio), `/forge/ideas`. Save 12 screenshots to the scratchpad; review for contrast/regressions (especially the jayden gradient behind `bg-background/95` sticky elements).

- [ ] **Step 3: Grep re-check**

```bash
grep -rn "emerald-\|zinc-\|red-600" app/forge --include='*.tsx' --include='*.ts' | grep -v ForgeCardPreview
```
Expected: empty.
