# Forge Descope: Raw-Text Cards + Finished-Card Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Descope Forge cards to a name + freeform raw text + two optional private image uploads (artwork + a new "finished card"), stop rendering the structured composite on the studio and display surfaces, and show finished-image → artwork → text-tile instead.

**Architecture:** Add a second private-blob slot (`working_finished_key` on `forge_cards`, `finished_key` frozen into `card_versions`) served only through the existing authed art proxy — mirroring the art pipeline, so blob keys never reach the client. Raw text is a new `rawText` field inside the existing `working_snapshot` jsonb (no migration). A small `ForgeCardFace` component replaces `ForgeCardPreview` on the studio, grids, and playtest reveal. The structured template (`FullModeForm`), composite renderer (`ForgeCardPreview`), and `designCard` schema stay on disk, unused, for recovery.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript (tsconfig `strict:false`), Supabase (Postgres + RLS, SECURITY DEFINER RPCs), Vercel Blob (private store), Vitest. No jsdom/RTL — components are verified by `next build` + the `forge-no-next-image` guardrail, not render tests (matches the existing `ForgeCardPreview`, which has no unit test).

**Spec:** `docs/superpowers/specs/2026-07-03-forge-descope-raw-text-cards-design.md`

## Global Constraints

- **Leak spine (non-negotiable):** blob keys (`working_finished_key` / `finished_key`) must NEVER be selected into client-facing props. Only booleans (`hasFinished` / `hasApprovedFinished`) and the proxy URL cross to the browser. Images are served ONLY through `app/forge/api/art/[cardId]/route.ts` (which does `requireForge` → 404).
- **No `next/image` anywhere under `app/forge/**`** — the `forge-no-next-image` guardrail forbids it. Use plain `<img>`.
- **Every `/forge` page/route/layout calls its own gate** (`requireForge`/`requireElder`) — the `forge-gate-first` guardrail enforces it. This plan adds no new routes, so no new gate.
- **New SECURITY DEFINER RPCs:** `security definer set search_path = ''`, `revoke execute … from public, anon`, `grant execute … to authenticated`, and add to the anon-leak probe list.
- **tsconfig `strict:false`:** discriminated-union narrowing on `{ok:true}|{ok:false}` is broken — use `r.ok === false` (this plan's action returns `{ok:boolean;error?}` loose shapes, so it's a non-issue, but keep it in mind).
- **Prod migration (058) requires explicit user authorization before applying** via the Supabase MCP `apply_migration`.

---

### Task 1: Pure `rawText` field + `cardRawText` fallback helper

**Files:**
- Modify: `app/forge/lib/designCard.ts` (add `rawText?: string` to `DesignCard`; add `cardRawText`)
- Test: `app/forge/lib/__tests__/designCard.test.ts` (add a `describe("cardRawText")` block)

**Interfaces:**
- Produces: `cardRawText(card: DesignCard): string` — returns `card.rawText ?? card.specialAbility ?? ""`. Consumed by `ForgeCardFace` callers (Tasks 6, 7).
- Produces: `DesignCard.rawText?: string` — the descoped freeform body.

- [ ] **Step 1: Write the failing test.** Append to `app/forge/lib/__tests__/designCard.test.ts`:

```ts
import { cardRawText } from "../designCard";

describe("cardRawText", () => {
  it("prefers rawText when present", () => {
    expect(cardRawText({ rawText: "new body", specialAbility: "legacy" })).toBe("new body");
  });
  it("falls back to legacy specialAbility (pre-descope napkin cards)", () => {
    expect(cardRawText({ specialAbility: "legacy" })).toBe("legacy");
  });
  it("returns empty string when neither is set", () => {
    expect(cardRawText({})).toBe("");
  });
});
```

(Note: `designCard.test.ts` already imports some names from `../designCard` on line 2 — add the `cardRawText` import there or as the extra import line shown; duplicate imports from the same module are fine in TS.)

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run app/forge/lib/__tests__/designCard.test.ts -t cardRawText`
Expected: FAIL — `cardRawText is not a function` / not exported.

- [ ] **Step 3: Implement.** In `app/forge/lib/designCard.ts`, add `rawText?: string;` to the `DesignCard` type (put it right after `name?: string;`), and add this exported function at the end of the file:

```ts
/**
 * The descoped raw-text body. Falls back to the legacy napkin `specialAbility`
 * so cards saved before the 2026-07-03 descope don't read blank. Pure.
 */
export function cardRawText(card: DesignCard): string {
  return card.rawText ?? card.specialAbility ?? "";
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run app/forge/lib/__tests__/designCard.test.ts -t cardRawText`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add app/forge/lib/designCard.ts app/forge/lib/__tests__/designCard.test.ts
git commit -m "Forge descope: add rawText field + cardRawText fallback helper"
```

---

### Task 2: Migration 058 — finished-card columns, RPC, version-freeze on both writers

**Files:**
- Create: `supabase/migrations/058_forge_finished_card.sql`
- Modify: `__tests__/forge-anon-leak.test.ts` (add `forge_set_working_finished` to `FORGE_RPCS`)

**Interfaces:**
- Produces: column `forge_cards.working_finished_key text`, column `card_versions.finished_key text`.
- Produces: RPC `forge_set_working_finished(p_card_id uuid, p_key text) returns void`.
- Produces: `forge_publish_card` and `forge_accept_proposal` now freeze `finished_key`.

- [ ] **Step 1: Guard — confirm the two version writers are still the only ones.**

Run: `grep -rni "insert into public.card_versions" supabase/migrations/`
Expected: exactly two hits — `052_forge_sets_lifecycle.sql` (`forge_publish_card`) and `053_forge_review_layer.sql` (`forge_accept_proposal`). If a third appears, STOP and add `finished_key` to it too.

- [ ] **Step 2: Write the migration.** Create `supabase/migrations/058_forge_finished_card.sql`:

```sql
-- 058_forge_finished_card.sql
-- Forge descope (2026-07-03): a card is raw text + artwork + an optional
-- FINISHED-CARD image. Adds a second private-blob slot mirroring the art pipeline
-- (050/052), frozen into card_versions at BOTH version writers (publish + accept).
-- Single key: finished images are never processed and have no placeholder concept.

-- 1) Columns (idempotent).
alter table public.forge_cards   add column if not exists working_finished_key text;
alter table public.card_versions add column if not exists finished_key         text;

-- 2) Set the current draft finished-card image. Owner / set-elder / superadmin only
--    (copies the 052-tightened forge_set_working_art gate — NOT the 050 gate).
create or replace function public.forge_set_working_finished(
  p_card_id uuid, p_key text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  update public.forge_cards
     set working_finished_key = p_key, updated_at = now()
   where id = p_card_id;
end; $$;

revoke execute on function public.forge_set_working_finished(uuid, text) from public, anon;
grant  execute on function public.forge_set_working_finished(uuid, text) to authenticated;

-- 3) Freeze finished_key at publish (verbatim copy of the 052 body + finished_key).
create or replace function public.forge_publish_card(p_card_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype; v_next int; v_version_id uuid;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to publish this card';
  end if;
  if v_card.set_id is null then raise exception 'only cards in a set can be published'; end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'only a draft or playtesting card can be published';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = p_card_id;
  update public.card_versions set status = 'superseded'
    where card_id = p_card_id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by)
  values
    (p_card_id, v_next, 'published', v_card.working_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid())
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id, status = 'playtesting', updated_at = now()
   where id = p_card_id;
  return v_version_id;
end; $$;

-- 4) Freeze finished_key at review-accept (verbatim copy of the 053 body + finished_key).
create or replace function public.forge_accept_proposal(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prop public.card_proposals%rowtype; v_card public.forge_cards%rowtype;
        v_next int; v_version_id uuid;
begin
  select * into v_prop from public.card_proposals where id = p_proposal_id;
  if not found then raise exception 'proposal not found'; end if;
  select * into v_card from public.forge_cards where id = v_prop.card_id for update;
  if not found then raise exception 'card not found'; end if;
  select * into v_prop from public.card_proposals where id = p_proposal_id for update;
  if v_prop.status <> 'open' then raise exception 'proposal is not open'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to accept proposals on this card';
  end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'unapprove or unarchive this card before accepting changes';
  end if;
  if v_prop.base_version_id is distinct from v_card.published_version_id then
    update public.card_proposals
       set status = 'superseded', closed_at = now(), closed_by = auth.uid()
     where id = p_proposal_id;
    return null;
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = v_card.id;
  update public.card_versions set status = 'superseded'
    where card_id = v_card.id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by)
  values
    (v_card.id, v_next, 'published', v_prop.proposed_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid())
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id,
         working_snapshot = v_prop.proposed_snapshot,
         title = nullif(btrim(coalesce(v_prop.proposed_snapshot->>'name','')), ''),
         status = 'playtesting',
         updated_at = now()
   where id = v_card.id;
  update public.card_proposals
     set status = 'accepted', resulting_version_id = v_version_id, closed_at = now(), closed_by = auth.uid()
   where id = p_proposal_id;
  update public.card_proposals
     set status = 'superseded', closed_at = now(), closed_by = auth.uid()
   where card_id = v_card.id and status = 'open' and id <> p_proposal_id;
  return v_version_id;
end; $$;
```

- [ ] **Step 3: Add the new RPC to the anon-leak probe list.** In `__tests__/forge-anon-leak.test.ts`, inside the `FORGE_RPCS` array (right after the `forge_set_working_art` entry, ~line 54), add:

```ts
    ["forge_set_working_finished", { p_card_id: "00000000-0000-0000-0000-000000000000", p_key: "x" }],
```

- [ ] **Step 4: Verify the migration SQL is internally consistent (no apply yet).**

Run: `grep -c "finished_key" supabase/migrations/058_forge_finished_card.sql`
Expected: `6` (2 column-list mentions + 2 value mentions across the two INSERTs, + the column add + the update in the setter = confirm ≥6; the point is both INSERTs include it). Visually confirm BOTH the `forge_publish_card` and `forge_accept_proposal` INSERT column lists contain `finished_key` and both VALUES contain `v_card.working_finished_key`.

- [ ] **Step 5: Apply the migration to prod — REQUIRES USER AUTHORIZATION.**

STOP and ask the user to authorize applying migration 058 to the live Supabase project. On approval, apply via the Supabase MCP `apply_migration` (name `forge_finished_card`, the SQL above). Do NOT proceed to live `test:security` until applied.

- [ ] **Step 6: Verify guardrails.**

Run: `npm test -- forge-anon-leak` (hermetic; confirms the added probe entry parses/runs)
Then, after the migration is applied: `npm run test:security`
Expected: anon-leak passes, including the new `forge_set_working_finished` anon-cannot-exec probe.

- [ ] **Step 7: Commit.**

```bash
git add supabase/migrations/058_forge_finished_card.sql __tests__/forge-anon-leak.test.ts
git commit -m "Forge descope: migration 058 — finished-card blob slot + version freeze"
```

---

### Task 3: Finished-card upload — blob helper + `cards.ts` action & type (TDD)

**Files:**
- Modify: `app/forge/lib/art.ts` (add `FINISHED_PREFIX`, `uploadForgeFinished`)
- Modify: `app/forge/lib/cards.ts` (add `hasFinished` to `ForgeCardFull`, `CARD_COLS`, `toFull`; add `uploadFinished` action)
- Test: `app/forge/lib/__tests__/cards.test.ts`

**Interfaces:**
- Consumes: `forge_set_working_finished` RPC (Task 2), `validateArtFile` (existing).
- Produces: `uploadForgeFinished(file: File): Promise<string>` (art.ts).
- Produces: `uploadFinished(cardId: string, formData: FormData): Promise<{ ok: boolean; error?: string }>` (cards.ts) — consumed by `StudioEditor` (Task 7).
- Produces: `ForgeCardFull.hasFinished: boolean` — consumed by `ForgeCardGrid` (Task 6) and `StudioEditor` (Task 7).

- [ ] **Step 1: Write the failing tests.** In `app/forge/lib/__tests__/cards.test.ts`: (a) extend the art mock on line 5 to include `uploadForgeFinished`; (b) import `uploadFinished` on line 8; (c) add the tests below.

Change line 5 from:
```ts
vi.mock("@/app/forge/lib/art", () => ({ validateArtFile: vi.fn(), uploadForgeArt: vi.fn() }));
```
to:
```ts
vi.mock("@/app/forge/lib/art", () => ({ validateArtFile: vi.fn(), uploadForgeArt: vi.fn(), uploadForgeFinished: vi.fn() }));
```

Change line 8 to add `uploadFinished`:
```ts
import { saveCard, getCard, listForgeCards, uploadFinished } from "../cards";
```

Add near the top imports:
```ts
import { validateArtFile, uploadForgeFinished } from "@/app/forge/lib/art";
```

Append these tests:
```ts
describe("uploadFinished", () => {
  it("rejects when caller is not an elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await uploadFinished("c1", new FormData());
    expect(r.ok).toBe(false);
  });
  it("uploads and calls forge_set_working_finished with the returned key", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeFinished as any).mockResolvedValue("forge-finished/abc");
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "c.png", { type: "image/png" }));
    const r = await uploadFinished("c1", fd);
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_set_working_finished", { p_card_id: "c1", p_key: "forge-finished/abc" },
    ]);
  });
});

describe("getCard maps hasFinished", () => {
  it("hasFinished true when working_finished_key present", async () => {
    const row = { id: "c1", title: "T", working_snapshot: {}, working_art_key: null, working_art_is_placeholder: false, working_finished_key: "forge-finished/x", status: "draft", updated_at: "t", set_id: null, published_version_id: null, approved_version_id: null };
    (requireForge as any).mockResolvedValue(ctx(undefined, [row]));
    expect((await getCard("c1"))?.hasFinished).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run app/forge/lib/__tests__/cards.test.ts`
Expected: FAIL — `uploadFinished` not exported; `hasFinished` undefined.

- [ ] **Step 3a: Implement the blob helper.** In `app/forge/lib/art.ts`, after the `ART_PREFIX` line add `const FINISHED_PREFIX = "forge-finished/";`, and after `uploadForgeArt` add:

```ts
/** Upload a finished-card image to the PRIVATE store under an unguessable UUID key. */
export async function uploadForgeFinished(file: File): Promise<string> {
  const key = `${FINISHED_PREFIX}${randomUUID()}`;
  const blob = await put(key, file, {
    access: "private",
    addRandomSuffix: false,
    ...forgeAuth,
    contentType: file.type,
  });
  return blob.pathname;
}
```

- [ ] **Step 3b: Implement the action + type.** In `app/forge/lib/cards.ts`:

Update the import on line 5:
```ts
import { validateArtFile, uploadForgeArt, uploadForgeFinished } from "@/app/forge/lib/art";
```

Add `hasFinished: boolean;` to the `ForgeCardFull` type (after `hasArt`).

In `toFull`, add: `hasFinished: !!row.working_finished_key,` (after `hasArt`).

Add `working_finished_key` to `CARD_COLS`:
```ts
const CARD_COLS = "id, title, working_snapshot, working_art_key, working_art_is_placeholder, working_finished_key, status, updated_at, set_id, published_version_id, approved_version_id";
```

Add the action (after `uploadArt`):
```ts
export async function uploadFinished(
  cardId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided" };
  const invalid = validateArtFile(file);
  if (invalid) return { ok: false, error: invalid };

  const key = await uploadForgeFinished(file);
  const { error } = await ctx.supabase.rpc("forge_set_working_finished", {
    p_card_id: cardId,
    p_key: key,
  });
  if (error) return { ok: false, error: "Could not save finished card" };
  revalidatePath("/forge/ideas");
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run app/forge/lib/__tests__/cards.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit.**

```bash
git add app/forge/lib/art.ts app/forge/lib/cards.ts app/forge/lib/__tests__/cards.test.ts
git commit -m "Forge descope: uploadFinished action + hasFinished mapping + blob helper"
```

---

### Task 4: Proxy `?kind=finished` branch

**Files:**
- Modify: `app/forge/api/art/[cardId]/route.ts`

**Interfaces:**
- Consumes: `working_finished_key` (forge_cards), `finished_key` (card_versions) from Task 2.
- Produces: `GET /forge/api/art/{cardId}?kind=finished` (working) and `?v=approved&kind=finished` (frozen) serving the private finished image; 404 on missing. Consumed by Tasks 6 & 7 via URLs.

- [ ] **Step 1: Implement the `kind` branch.** In `app/forge/api/art/[cardId]/route.ts`, after the `wantApproved` line add:

```ts
  const kind = url.searchParams.get("kind") === "finished" ? "finished" : "art";
```

Replace the whole key-selection block (the `if (wantApproved) { … } else { … }` that sets `artKey`, lines ~21–44) with:

```ts
  let artKey: string | null = null;
  if (wantApproved) {
    const { data: card } = await ctx.supabase
      .from("forge_cards")
      .select("approved_version_id, published_version_id")
      .eq("id", cardId)
      .maybeSingle();
    const versionId = card?.approved_version_id ?? card?.published_version_id ?? null;
    if (!versionId) return notFoundResponse();
    if (kind === "finished") {
      const { data: version } = await ctx.supabase
        .from("card_versions")
        .select("finished_key")
        .eq("id", versionId)
        .maybeSingle();
      artKey = version?.finished_key ?? null;
    } else {
      const { data: version } = await ctx.supabase
        .from("card_versions")
        .select("art_original_key, art_key, art_is_placeholder")
        .eq("id", versionId)
        .maybeSingle();
      if (!version || version.art_is_placeholder) return notFoundResponse();
      artKey = version.art_original_key ?? version.art_key ?? null;
    }
  } else {
    const col = kind === "finished" ? "working_finished_key" : "working_art_key";
    const { data: card } = await ctx.supabase
      .from("forge_cards")
      .select(col)
      .eq("id", cardId)
      .maybeSingle();
    artKey = (card as any)?.[col] ?? null;
  }
  if (!artKey) return notFoundResponse();
```

Leave everything else (the `readForgeArt` try/catch, `?download=1` audit, headers, `Response`) unchanged.

- [ ] **Step 2: Verify the build compiles the route.**

Run: `npm run build`
Expected: build succeeds; `/forge/api/art/[cardId]` compiles with no type errors.

- [ ] **Step 3: Verify the gate-first guardrail stays green.**

Run: `npm test -- forge-gate-first`
Expected: PASS (the route still calls `requireForge` first; only the key selection changed).

- [ ] **Step 4: Commit.**

```bash
git add "app/forge/api/art/[cardId]/route.ts"
git commit -m "Forge descope: serve finished-card image via art proxy ?kind=finished"
```

---

### Task 5: `ForgeCardFace` component

**Files:**
- Create: `app/forge/components/ForgeCardFace.tsx`

**Interfaces:**
- Produces: `<ForgeCardFace name rawText finishedUrl artUrl className? />` — priority: finished image → text tile (name + rawText, with art at top if present). Consumed by Tasks 6 & 7.

- [ ] **Step 1: Create the component.** Write `app/forge/components/ForgeCardFace.tsx`:

```tsx
// Descoped card face (2026-07-03): replaces the ForgeCardPreview composite on the
// studio + display surfaces. Priority: finished-card image → text tile (name +
// raw text, with artwork at the top when present). Plain <img> only (never
// next/image — the forge-no-next-image guardrail forbids it; art stays on the
// authed /forge/api/art proxy).

// eslint-disable-next-line @next/next/no-img-element
const Img = (p: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt="" {...p} />;

export default function ForgeCardFace({
  name, rawText, finishedUrl, artUrl, className,
}: {
  name: string | null;
  rawText: string | null;
  finishedUrl: string | null;
  artUrl: string | null;
  className?: string;
}) {
  const box = { aspectRatio: "750 / 1050", width: "100%", containerType: "inline-size" as const };

  if (finishedUrl) {
    return (
      <div className={className} style={box}>
        <Img src={finishedUrl} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "4%" }} />
      </div>
    );
  }

  const text = (rawText ?? "").trim();
  const title = name?.trim() || "Untitled";
  const empty = !name?.trim() && !text && !artUrl;

  return (
    <div
      className={className}
      style={{ ...box, display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: "4%", border: "1px solid rgba(0,0,0,0.15)", background: "rgba(127,127,127,0.06)" }}
    >
      {artUrl && <Img src={artUrl} style={{ width: "100%", height: "48%", objectFit: "cover" }} />}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "6%" }}>
        <p style={{ fontWeight: 700, fontSize: "clamp(11px, 4cqw, 16px)", marginBottom: "3%" }}>{title}</p>
        <p style={{ whiteSpace: "pre-wrap", fontSize: "clamp(10px, 3.4cqw, 14px)", lineHeight: 1.25, opacity: 0.75, overflow: "hidden" }}>
          {empty ? "No content yet" : text}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the no-next-image guardrail + build.**

Run: `npm test -- forge-no-next-image`
Expected: PASS (component uses plain `<img>`, imports no `next/image`).

Run: `npm run build`
Expected: compiles (unused until Task 6/7 wire it — that's fine; Next won't error on an unimported component file).

- [ ] **Step 3: Commit.**

```bash
git add app/forge/components/ForgeCardFace.tsx
git commit -m "Forge descope: add ForgeCardFace (finished image / art+text fallback)"
```

---

### Task 6: Wire display surfaces (grids + playtest reveal)

**Files:**
- Modify: `app/forge/components/ForgeCardGrid.tsx`
- Modify: `app/forge/lib/play.ts` (`RevealCard` + select `finished_key`)
- Modify: `app/forge/play/[setId]/page.tsx` (build `finishedUrl`)
- Modify: `app/forge/play/[setId]/RevealGrid.tsx` (`RevealItem` + render `ForgeCardFace`)

**Interfaces:**
- Consumes: `ForgeCardFace` (Task 5), `cardRawText` (Task 1), `hasFinished` (Task 3), `finished_key` (Task 2), proxy URLs (Task 4).
- Produces: `RevealCard.hasApprovedFinished: boolean`; `RevealItem.finishedUrl: string | null`.

- [ ] **Step 1: `ForgeCardGrid`.** Replace `app/forge/components/ForgeCardGrid.tsx` imports + the `ForgeCardPreview` line. New file:

```tsx
import Link from "next/link";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import { cardRawText } from "@/app/forge/lib/designCard";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

const STATUS_LABEL: Record<string, string> = {
  private_idea: "Idea", draft: "Draft", playtesting: "Playtesting",
  approved: "Approved", archived: "Archived",
};

export default function ForgeCardGrid({ cards, showStatus = false }: { cards: ForgeCardFull[]; showStatus?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((c) => (
        <Link key={c.id} href={`/forge/cards/${c.id}`} className="block transition hover:opacity-90">
          <ForgeCardFace
            name={c.snapshot.name ?? null}
            rawText={cardRawText(c.snapshot)}
            finishedUrl={c.hasFinished ? `/forge/api/art/${c.id}?kind=finished` : null}
            artUrl={c.hasArt ? `/forge/api/art/${c.id}` : null}
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">{c.title ?? "Untitled"}</p>
            {showStatus && (
              <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `play.ts`.** In `app/forge/lib/play.ts`: update the `RevealCard` type and the `card_versions` select + mapping.

Type:
```ts
export type RevealCard = { cardId: string; data: DesignCard; hasApprovedArt: boolean; hasApprovedFinished: boolean };
```

Select (add `finished_key`):
```ts
    .select("id, card_id, data, art_key, art_original_key, art_is_placeholder, finished_key")
```

Mapping (add the boolean — `finished_key` itself must NOT enter the returned object):
```ts
  return (versions ?? []).map((v: any): RevealCard => ({
    cardId: v.card_id as string,
    data: (v.data ?? {}) as DesignCard,
    hasApprovedArt: !!(v.art_original_key ?? v.art_key) && !v.art_is_placeholder,
    hasApprovedFinished: !!v.finished_key,
  }));
```

- [ ] **Step 3: `play/[setId]/page.tsx`.** Update the `RevealItem` build to include `finishedUrl`:

```ts
  const items: RevealItem[] = cards.map((c) => ({
    cardId: c.cardId,
    data: c.data,
    artUrl: c.hasApprovedArt ? `/forge/api/art/${c.cardId}?v=approved` : null,
    finishedUrl: c.hasApprovedFinished ? `/forge/api/art/${c.cardId}?v=approved&kind=finished` : null,
  }));
```

- [ ] **Step 4: `RevealGrid.tsx`.** Replace `app/forge/play/[setId]/RevealGrid.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { cardRawText } from "@/app/forge/lib/designCard";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";

export type RevealItem = { cardId: string; data: DesignCard; artUrl: string | null; finishedUrl: string | null };

export default function RevealGrid({ items }: { items: RevealItem[] }) {
  const [active, setActive] = useState<RevealItem | null>(null);

  if (items.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground">No approved cards in this set yet.</p>;
  }

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((it) => (
          <button key={it.cardId} onClick={() => setActive(it)} className="block w-full text-left">
            <ForgeCardFace name={it.data.name ?? null} rawText={cardRawText(it.data)} finishedUrl={it.finishedUrl} artUrl={it.artUrl} className="w-full rounded-md" />
          </button>
        ))}
      </div>
      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setActive(null)}>
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <ForgeCardFace name={active.data.name ?? null} rawText={cardRawText(active.data)} finishedUrl={active.finishedUrl} artUrl={active.artUrl} className="w-full" />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Verify build + guardrails.**

Run: `npm run build`
Expected: compiles. (Note: `app/forge/lib/deckPool.ts` also consumes `listSetApprovedCards` — the new `hasApprovedFinished` field is additive and won't break it.)

Run: `npm test -- forge-no-next-image forge-gate-first`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/forge/components/ForgeCardGrid.tsx app/forge/lib/play.ts "app/forge/play/[setId]/page.tsx" "app/forge/play/[setId]/RevealGrid.tsx"
git commit -m "Forge descope: grids + playtest reveal use ForgeCardFace"
```

---

### Task 7: Studio editor descope (raw text + two uploads, no template/composite)

**Files:**
- Modify: `app/forge/cards/[cardId]/StudioEditor.tsx` (full replacement below)
- `app/forge/cards/[cardId]/FullModeForm.tsx` — left on disk, now unused (recoverable). Do NOT delete.

**Interfaces:**
- Consumes: `ForgeCardFace` (Task 5), `cardRawText` (Task 1), `uploadArt`/`uploadFinished`/`setPlaceholder`/`saveCard`/`ForgeCardFull` (Task 3 + existing), `hasFinished` (Task 3).

- [ ] **Step 1: Replace `StudioEditor.tsx`.** Overwrite `app/forge/cards/[cardId]/StudioEditor.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import { saveCard, uploadArt, uploadFinished, setPlaceholder, type ForgeCardFull } from "@/app/forge/lib/cards";
import { createProposal } from "@/app/forge/lib/proposals";
import { cardRawText, type DesignCard } from "@/app/forge/lib/designCard";
import LifecycleControls from "./LifecycleControls";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import { forgeCardTopic } from "@/app/forge/lib/realtime";
import { useForgeCardChannel } from "@/app/forge/lib/useForgeRealtime";
import PresenceBar from "./PresenceBar";

// DESCOPE (2026-07-03): the structured template (FullModeForm) and the composite
// renderer (ForgeCardPreview) were removed from the studio. A card is now a name +
// raw text + optional artwork + optional finished-card image. Both files remain on
// disk (unused here) for recovery.

export default function StudioEditor({
  card, sets, currentUser, setId,
}: {
  card: ForgeCardFull;
  sets: ForgeSetSummary[];
  currentUser: { userId: string; displayName: string | null };
  setId: string | null;
}) {
  const [snapshot, setSnapshot] = useState<DesignCard>(card.snapshot ?? {});
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);
  const router = useRouter();

  const { others, setEditing } = useForgeCardChannel(
    setId ? forgeCardTopic(card.id) : null,
    { userId: currentUser.userId, displayName: currentUser.displayName, editing: false },
  );

  // Debounced autosave — fires only after the user edits (skips mount).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      const r = await saveCard(card.id, snapshot);
      setSaved(r.ok ? "saved" : "error");
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [snapshot, card.id]);

  const update = (patch: Partial<DesignCard>) => setSnapshot((s) => ({ ...s, ...patch }));

  async function onUpload(file: File, kind: "art" | "finished") {
    setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = kind === "art" ? await uploadArt(card.id, fd) : await uploadFinished(card.id, fd);
    if (!r.ok) setErr(r.error ?? "Upload failed");
    else router.refresh();
  }

  const [proposing, setProposing] = useState(false);
  const [proposeSummary, setProposeSummary] = useState("");
  const [proposeBusy, setProposeBusy] = useState(false);
  const submitProposal = async () => {
    if (!proposeSummary.trim()) return;
    setProposeBusy(true);
    const r = await createProposal(card.id, snapshot, proposeSummary);
    setProposeBusy(false);
    if (r.ok === false) { alert(r.error); return; }
    setProposing(false);
    setProposeSummary("");
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-5xl p-4">
      <PresenceBar others={others} />
      <div className="mb-3 flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <Link href={card.setId ? `/forge/sets/${card.setId}/cards` : "/forge/ideas"} className="text-muted-foreground hover:underline">
            ← {card.setId ? "Set" : "Ideas"}
          </Link>
          <span className="text-xs text-muted-foreground">
            {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Save failed" : ""}
          </span>
        </div>
        <LifecycleControls card={card} sets={sets} />
        {card.setId &&
          (proposing ? (
            <div className="flex items-center gap-1 text-xs">
              <input autoFocus value={proposeSummary} onChange={(e) => setProposeSummary(e.target.value)}
                placeholder="Summarize your proposed change…" className="flex-1 rounded-md border bg-background px-2 py-1" />
              <button disabled={proposeBusy || !proposeSummary.trim()} onClick={submitProposal}
                className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50">
                Submit proposal
              </button>
              <button onClick={() => setProposing(false)} className="rounded-md border px-2 py-1">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setProposing(true)} className="self-start rounded-md border px-3 py-1 text-xs">
              Propose changes for review
            </button>
          ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
        {/* Face — sticky on desktop, top on mobile */}
        <div className="md:sticky md:top-4 md:self-start">
          <ForgeCardFace
            name={snapshot.name ?? null}
            rawText={cardRawText(snapshot)}
            finishedUrl={card.hasFinished ? `/forge/api/art/${card.id}?kind=finished` : null}
            artUrl={card.hasArt ? `/forge/api/art/${card.id}` : null}
          />
        </div>

        {/* Form */}
        <div className="space-y-4" onFocusCapture={() => setEditing(true)} onBlurCapture={() => setEditing(false)}>
          {err && <p className="text-sm text-red-500">{err}</p>}

          <input autoFocus value={snapshot.name ?? ""} onChange={(e) => update({ name: e.target.value })}
            placeholder="Name your card…" className="w-full rounded-md border bg-background px-3 py-2 text-lg" />

          <textarea value={snapshot.rawText ?? ""} onChange={(e) => update({ rawText: e.target.value })}
            placeholder="Type the card — type, brigade, stats, ability, reference, flavor… Freeform; not rendered."
            className="h-64 w-full rounded-md border bg-background px-3 py-2 text-sm" />

          {/* Artwork (illustration) */}
          <fieldset className="rounded-md border p-3">
            <legend className="px-1 font-medium">Artwork (illustration)</legend>
            <input type="file" accept="image/jpeg,image/png,image/webp"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f, "art"); e.target.value = ""; }}
              className="block w-full text-xs" />
            <label className="mt-3 flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={!!card.isPlaceholder}
                onChange={async () => { await setPlaceholder(card.id, !card.isPlaceholder); router.refresh(); }} />
              <span>
                <span className="font-medium">Temporary / placeholder art</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Placeholder art isn’t shown in playtests — upload final art and uncheck when it’s ready.
                </span>
              </span>
            </label>
            {card.hasArt && (
              <a href={`/forge/api/art/${card.id}?download=1`} className="mt-2 inline-block text-emerald-600 hover:underline">
                Download original
              </a>
            )}
          </fieldset>

          {/* Finished card (full composed image) */}
          <fieldset className="rounded-md border p-3">
            <legend className="px-1 font-medium">Finished card (full composed image)</legend>
            <input type="file" accept="image/jpeg,image/png,image/webp"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f, "finished"); e.target.value = ""; }}
              className="block w-full text-xs" />
            <p className="mt-2 text-xs text-muted-foreground">
              A finished card image made elsewhere. When present, it’s shown everywhere instead of the artwork.
            </p>
            {card.hasFinished && (
              <a href={`/forge/api/art/${card.id}?kind=finished&download=1`} className="mt-2 inline-block text-emerald-600 hover:underline">
                Download finished card
              </a>
            )}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + guardrails.**

Run: `npm run build`
Expected: compiles. `FullModeForm` and `ForgeCardPreview` are no longer imported here; `ForgeCardPreview` is still imported by `ProposalDiff.tsx` + `forgeBuilderConfig.tsx` (unchanged), so no orphan/unused-file breakage.

Run: `npm test -- forge-no-next-image forge-gate-first`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add "app/forge/cards/[cardId]/StudioEditor.tsx"
git commit -m "Forge descope: studio = name + raw text + artwork + finished-card upload"
```

---

### Task 8: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full hermetic test suite.**

Run: `npm test`
Expected: all Forge tests pass. (A pre-existing unrelated `store-route.test.ts` / `threshingfloor` failure may exist per project history — confirm any failure is that known one, not from this change.)

- [ ] **Step 2: Production build.**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Live security test (after migration 058 applied).**

Run: `npm run test:security`
Expected: anon-leak passes incl. the `forge_set_working_finished` anon-cannot-exec probe; anon still sees zero rows.

- [ ] **Step 4: Manual smoke (signed-in — needs Forge elder creds; ask the user to run if the session has none).**

  1. `/forge/ideas` → open/create a card. Studio shows: name + raw-text textarea + Artwork upload + Finished-card upload. NO structured template, NO composite.
  2. Type raw text → autosave "Saved".
  3. Upload artwork → face shows art + name + text.
  4. Upload a finished card → face switches to the finished image (studio hero + ideas grid).
  5. Remove finished (upload nothing / it stays) — verify fallback order by testing a card with only art, and a card with only text.
  6. Share into a set → publish → `/forge/play/[setId]` reveal shows the frozen finished image (or art/text fallback).
  7. Confirm `/forge/api/art/{id}?kind=finished` 404s when signed out.

- [ ] **Step 5: Final commit (if any smoke fixes).** Otherwise the branch `forge-descope-raw-text-cards` is ready for PR.

---

## Self-Review (completed by plan author)

- **Spec coverage:** §3.1 raw text → Task 1. §3.2 migration (columns/RPC/both freezes) → Task 2. §4 art helper + §6 action/type → Task 3. §5 proxy → Task 4. §7 ForgeCardFace → Task 5. §8 display wiring (grid/play.ts/page/RevealGrid + deckPool note) → Task 6. §9 studio → Task 7. §10 guardrails/tests → Tasks 2,4,5,6,7,8. All finding fixes (#1 accept-proposal freeze, #3 rawText fallback, #5 052-gate, #8 lift art UI) are in Tasks 2/1/2/7 respectively.
- **Placeholder scan:** none — every step has exact code/paths/commands.
- **Type consistency:** `cardRawText`, `uploadForgeFinished`, `uploadFinished`, `hasFinished`, `hasApprovedFinished`, `finishedUrl`, `working_finished_key`/`finished_key` used consistently across tasks and match the spec.
```
