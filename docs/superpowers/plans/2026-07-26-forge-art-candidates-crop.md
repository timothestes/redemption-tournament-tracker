# Forge Art Candidates + Crop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let forge card designers upload multiple candidate art images per card and crop one into the card's active artwork, with the uncropped original preserved.

**Architecture:** New `forge_card_art_candidates` table + three RPCs (migration 082). Candidates flow through the existing normalize→private-blob pipeline; a crop is applied server-side with sharp from a 0–1 fractional rect and saved via the existing `forge_set_working_art(croppedKey, candidateKey)` — so every other surface (grids, playtests, versions) is untouched. Studio UI grows a candidate gallery and a `react-easy-crop` modal with a live CSS-math preview.

**Tech Stack:** Next.js 15 App Router, Supabase (RLS + plpgsql RPCs), Vercel Blob (private store), sharp, react-easy-crop, vitest.

**Spec:** `docs/superpowers/specs/2026-07-26-forge-art-candidates-crop-design.md` — read it first.

## Global Constraints

- **Worktree isolation (CLAUDE.md):** all work happens in the worktree at `/Users/timestes/projects/rtt-art-candidates` on branch `feature/forge-art-candidates` (created off `origin/main`). Use **absolute paths** for every file operation and run every command with `cd /Users/timestes/projects/rtt-art-candidates` or `git -C`. **Never** touch `/Users/timestes/projects/redemption-tournament-tracker` (a sibling agent may own it). Never `git add -A`/`.` — stage only your own files by name.
- **Never redefine an existing SQL function or policy** — migration 082 creates only new objects (`reference_rpc_redefine_use_latest`).
- **Blob keys never reach the client.** Server actions and page props expose candidate `id`s only; images go through `/forge/api/art/[cardId]`.
- **No `next/image` for forge art** — plain `<img>` via the authed proxy (guardrail in `ForgeCardFace`).
- **tsconfig has `strict: false`:** union narrowing via `if (r.ok)` / `else` does NOT work — always compare `r.ok === false` explicitly.
- **Styling:** no `focus:ring-2 focus:ring-ring` on controls; primary green only for hover/active/CTA, not resting accents.
- Constants (from spec): candidate cap **12**; crop frame aspect **750:504**; min crop output **32 px** per axis; JPEG **q85 mozjpeg**; height cap **1050 px**.
- Commit after each task with a conventional-commits message; do not push until the final task.

## File Structure

| File | Role |
|---|---|
| `supabase/migrations/082_forge_art_candidates.sql` | Create: table, RLS, 3 RPCs |
| `__tests__/forge-anon-leak.test.ts` | Modify: add new table + RPCs to the leak lists |
| `app/forge/lib/cropPreview.ts` | Create: shared `CropRect` type + pure CSS-preview math (client-safe) |
| `app/forge/lib/imageCrop.ts` | Create: server-only `clampCropRect` + `cropCardImage` (sharp) |
| `app/forge/lib/art.ts` | Modify: add `uploadForgeArtRaw` (put a processed buffer, no re-normalize) |
| `app/forge/lib/artCandidates.ts` | Create: `"use server"` actions — list/add/delete/activate/applyCrop |
| `app/forge/api/art/[cardId]/route.ts` | Modify: `candidate=<id>` param → `forge_candidate_art_key` |
| `app/forge/components/FilePicker.tsx` | Modify: optional `multiple` + `onFiles` |
| `app/forge/components/ArtCandidatesPanel.tsx` | Create: gallery grid + uploads + delete + modal launcher |
| `app/forge/components/CropCandidateModal.tsx` | Create: react-easy-crop modal + live preview |
| `app/forge/cards/[cardId]/StudioEditor.tsx` | Modify: swap single art FilePicker for the panel |
| `app/forge/cards/[cardId]/page.tsx` | Modify: fetch candidates, pass to StudioEditor |
| Tests | `app/forge/lib/__tests__/{cropPreview,imageCrop,artCandidates}.test.ts`, extend `art.test.ts` + route test |

---

### Task 0: Worktree setup (orchestrator, before dispatching)

- [ ] **Step 1:** From the main checkout (read-only git commands are fine):

```bash
git -C /Users/timestes/projects/redemption-tournament-tracker fetch origin
git -C /Users/timestes/projects/redemption-tournament-tracker worktree add /Users/timestes/projects/rtt-art-candidates -b feature/forge-art-candidates origin/main
```

- [ ] **Step 2:** Install deps in the worktree: `cd /Users/timestes/projects/rtt-art-candidates && npm install`
- [ ] **Step 3:** Copy the spec + this plan into the worktree (they're untracked in the main checkout):

```bash
mkdir -p /Users/timestes/projects/rtt-art-candidates/docs/superpowers/specs /Users/timestes/projects/rtt-art-candidates/docs/superpowers/plans
cp /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/specs/2026-07-26-forge-art-candidates-crop-design.md /Users/timestes/projects/rtt-art-candidates/docs/superpowers/specs/
cp /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/plans/2026-07-26-forge-art-candidates-crop.md /Users/timestes/projects/rtt-art-candidates/docs/superpowers/plans/
git -C /Users/timestes/projects/rtt-art-candidates add docs/superpowers/specs/2026-07-26-forge-art-candidates-crop-design.md docs/superpowers/plans/2026-07-26-forge-art-candidates-crop.md
git -C /Users/timestes/projects/rtt-art-candidates commit -m "docs: spec + plan for forge art candidates + crop"
```

---

### Task 1: Migration 082 + anon-leak list extension

**Files:**
- Create: `supabase/migrations/082_forge_art_candidates.sql`
- Modify: `__tests__/forge-anon-leak.test.ts` (extend `FORGE_TABLES` ~line 16 and `FORGE_RPCS` ~line 40)

**Interfaces:**
- Produces: table `forge_card_art_candidates(id, card_id, key, created_at)`; RPCs `forge_add_art_candidate(p_card_id, p_key) → uuid`, `forge_delete_art_candidate(p_candidate_id) → void`, `forge_candidate_art_key(p_card_id, p_candidate_id) → text`. Task 3's actions and Task 4's route call these by exactly these names.
- **NOTE:** the migration is NOT applied by this task — the orchestrator applies it via the Supabase MCP after review. Write the file only.

- [ ] **Step 1: Write the migration** — exact content:

```sql
-- 082_forge_art_candidates.sql
-- Multi-image art candidates for the card studio (spec:
-- docs/superpowers/specs/2026-07-26-forge-art-candidates-crop-design.md).
-- A candidate is one uploaded image in a card's designer-side gallery; the
-- active artwork stays on forge_cards (working_art_key = crop derivative,
-- working_art_original_key = source candidate's key). ADDITIVE ONLY — new
-- table + new functions; nothing existing is redefined (cf. 066 lesson).

-- 1) Candidates. Keys are private-blob PATHNAMES (forge-art/<uuid>), never URLs.
create table if not exists public.forge_card_art_candidates (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.forge_cards(id) on delete cascade,
  key        text not null,
  created_at timestamptz not null default now()
);

create index if not exists forge_card_art_candidates_card_idx
  on public.forge_card_art_candidates (card_id, created_at);

alter table public.forge_card_art_candidates enable row level security;

-- 2) RLS: candidates are a DESIGNER workspace — owner or elder/superadmin only
--    (playtesters never see them; the active art they do see lives on
--    forge_cards). No direct write policy — writes go through the SECURITY
--    DEFINER RPCs below (cf. 050).
drop policy if exists "forge_card_art_candidates_select" on public.forge_card_art_candidates;
create policy "forge_card_art_candidates_select" on public.forge_card_art_candidates
  for select to authenticated
  using (exists (
    select 1 from public.forge_cards c
    where c.id = card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ));

revoke all on public.forge_card_art_candidates from anon;
grant select on public.forge_card_art_candidates to authenticated;

-- 3) Add a candidate (owner or elder; hard cap 12 per card).
create or replace function public.forge_add_art_candidate(p_card_id uuid, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  if (select count(*) from public.forge_card_art_candidates a where a.card_id = p_card_id) >= 12 then
    raise exception 'candidate limit reached (12)';
  end if;
  insert into public.forge_card_art_candidates (card_id, key)
  values (p_card_id, p_key)
  returning id into v_id;
  return v_id;
end; $$;

-- 4) Delete a candidate ROW (the blob stays; dangling private+UUID blobs are
--    harmless — cf. app/forge/lib/art.ts). Refuses when the candidate is the
--    source of the current artwork, so re-crop and download-original keep working.
create or replace function public.forge_delete_art_candidate(p_candidate_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card_id uuid; v_key text;
begin
  select a.card_id, a.key into v_card_id, v_key
    from public.forge_card_art_candidates a where a.id = p_candidate_id;
  if v_card_id is null then
    raise exception 'no such candidate';
  end if;
  if not exists (
    select 1 from public.forge_cards c
    where c.id = v_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  if exists (
    select 1 from public.forge_cards c
    where c.id = v_card_id and c.working_art_original_key = v_key
  ) then
    raise exception 'candidate is the source of the current artwork';
  end if;
  delete from public.forge_card_art_candidates where id = p_candidate_id;
end; $$;

-- 5) Key lookup for the /forge/api/art proxy. SECURITY INVOKER on purpose:
--    the select is subject to the policy above, so this cannot return anything
--    the caller couldn't already SELECT (cf. 066).
create or replace function public.forge_candidate_art_key(p_card_id uuid, p_candidate_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select a.key from public.forge_card_art_candidates a
  where a.id = p_candidate_id and a.card_id = p_card_id;
$$;

-- 6) Lock down execute: strip anon (Supabase default-grants it), grant authenticated.
revoke execute on function public.forge_add_art_candidate(uuid, text) from public, anon;
revoke execute on function public.forge_delete_art_candidate(uuid) from public, anon;
revoke execute on function public.forge_candidate_art_key(uuid, uuid) from public, anon;

grant execute on function public.forge_add_art_candidate(uuid, text) to authenticated;
grant execute on function public.forge_delete_art_candidate(uuid) to authenticated;
grant execute on function public.forge_candidate_art_key(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Extend the anon-leak guardrail.** In `__tests__/forge-anon-leak.test.ts`, add `"forge_card_art_candidates"` to the `FORGE_TABLES` array, and add these three entries to `FORGE_RPCS`:

```ts
    ["forge_add_art_candidate", { p_card_id: "00000000-0000-0000-0000-000000000000", p_key: "x" }],
    ["forge_delete_art_candidate", { p_candidate_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_candidate_art_key", { p_card_id: "00000000-0000-0000-0000-000000000000", p_candidate_id: "00000000-0000-0000-0000-000000000000" }],
```

- [ ] **Step 3: Verify the default unit run still passes** (leak test is opt-in and must stay skipped): `cd /Users/timestes/projects/rtt-art-candidates && npx vitest run __tests__/forge-anon-leak.test.ts` — Expected: skipped/passed, no failures.
- [ ] **Step 4: Commit**

```bash
git -C /Users/timestes/projects/rtt-art-candidates add supabase/migrations/082_forge_art_candidates.sql __tests__/forge-anon-leak.test.ts
git -C /Users/timestes/projects/rtt-art-candidates commit -m "feat(forge): migration 082 — art candidates table + RPCs"
```

---

### Task 2: Crop math + sharp crop helper

**Files:**
- Create: `app/forge/lib/cropPreview.ts`
- Create: `app/forge/lib/imageCrop.ts`
- Test: `app/forge/lib/__tests__/cropPreview.test.ts`, `app/forge/lib/__tests__/imageCrop.test.ts`

**Interfaces:**
- Produces: `type CropRect = { x: number; y: number; width: number; height: number }` (fractions 0–1, exported from `cropPreview.ts`); `cropBackgroundStyle(rect: CropRect): { backgroundSize: string; backgroundPosition: string }`; `clampCropRect(rect: unknown): CropRect | null`; `cropCardImage(input: Buffer, rect: CropRect): Promise<{ data: Buffer; contentType: "image/jpeg" }>` (throws `"Crop too small"` under 32 px per output axis). Tasks 3 and 6 consume these exact names.

- [ ] **Step 1: Write failing tests** — `app/forge/lib/__tests__/cropPreview.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cropBackgroundStyle } from "../cropPreview";

describe("cropBackgroundStyle", () => {
  it("scales the background so the subrect fills the container", () => {
    const s = cropBackgroundStyle({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 });
    expect(s.backgroundSize).toBe(`${100 / 0.5}% ${100 / 0.4}%`);
    // position denominators are (1 - span): 0.25/0.5 = 50%, 0.1/0.6 ≈ 16.67%
    expect(s.backgroundPosition).toBe(`${(0.25 / 0.5) * 100}% ${(0.1 / 0.6) * 100}%`);
  });

  it("pins position to 0 when the crop spans the full axis (no room to pan)", () => {
    const s = cropBackgroundStyle({ x: 0, y: 0.2, width: 1, height: 0.6 });
    expect(s.backgroundPosition.startsWith("0%")).toBe(true);
  });
});
```

and `app/forge/lib/__tests__/imageCrop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { clampCropRect, cropCardImage } from "../imageCrop";

const fixture = () =>
  sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();

describe("clampCropRect", () => {
  it("passes a valid rect through", () => {
    expect(clampCropRect({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 })).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
  });
  it("clamps out-of-range values into [0,1]", () => {
    expect(clampCropRect({ x: -0.5, y: 0, width: 2, height: 1 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
  it("rejects garbage", () => {
    expect(clampCropRect(null)).toBeNull();
    expect(clampCropRect({ x: NaN, y: 0, width: 1, height: 1 })).toBeNull();
    expect(clampCropRect({ x: 1, y: 0, width: 0.5, height: 1 })).toBeNull(); // zero width after clamp
  });
});

describe("cropCardImage", () => {
  it("extracts the fractional rect in pixels", async () => {
    const out = await cropCardImage(await fixture(), { x: 0.25, y: 0, width: 0.5, height: 1 });
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
    expect(out.contentType).toBe("image/jpeg");
  });
  it("throws on a crop smaller than 32px per axis", async () => {
    await expect(cropCardImage(await fixture(), { x: 0, y: 0, width: 0.1, height: 0.1 })).rejects.toThrow(/too small/i);
  });
});
```

- [ ] **Step 2: Run to verify failure:** `cd /Users/timestes/projects/rtt-art-candidates && npx vitest run app/forge/lib/__tests__/cropPreview.test.ts app/forge/lib/__tests__/imageCrop.test.ts` — Expected: FAIL (modules not found).
- [ ] **Step 3: Implement** — `app/forge/lib/cropPreview.ts` (client-safe, no server imports):

```ts
// Shared crop-rect type (fractions of the source image, 0–1) + the pure CSS
// math the crop modal uses to live-preview a subrect: scale the background so
// the rect fills the container, then pan with percentage positioning (whose
// denominator is the leftover space, hence the 1-span divisor).
export type CropRect = { x: number; y: number; width: number; height: number };

export function cropBackgroundStyle(rect: CropRect): { backgroundSize: string; backgroundPosition: string } {
  const pos = (offset: number, span: number) => (span >= 1 ? 0 : (offset / (1 - span)) * 100);
  return {
    backgroundSize: `${100 / rect.width}% ${100 / rect.height}%`,
    backgroundPosition: `${pos(rect.x, rect.width)}% ${pos(rect.y, rect.height)}%`,
  };
}
```

and `app/forge/lib/imageCrop.ts` (server-only — imports sharp):

```ts
// Server-only: crop an already-normalized forge art image (upright JPEG,
// ≤1050px — see imageNormalize.ts) to a fractional rect. No trim pass here:
// re-running the corner-gated trim could eat a crop with white corners.
import sharp from "sharp";
import type { CropRect } from "@/app/forge/lib/cropPreview";

export type { CropRect };

const MIN_CROP_PX = 32;
const MAX_HEIGHT = 1050;
const JPEG_QUALITY = 85;

/** Clamp a fractional crop rect into [0,1]; null when it isn't a usable rect. Pure. */
export function clampCropRect(rect: unknown): CropRect | null {
  if (typeof rect !== "object" || rect === null) return null;
  const r = rect as Record<string, unknown>;
  if (![r.x, r.y, r.width, r.height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const x = Math.min(Math.max(r.x as number, 0), 1);
  const y = Math.min(Math.max(r.y as number, 0), 1);
  const width = Math.min(Math.max(r.width as number, 0), 1 - x);
  const height = Math.min(Math.max(r.height as number, 0), 1 - y);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export async function cropCardImage(
  input: Buffer,
  rect: CropRect
): Promise<{ data: Buffer; contentType: "image/jpeg" }> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error("Could not read image");
  const left = Math.round(rect.x * meta.width);
  const top = Math.round(rect.y * meta.height);
  const width = Math.min(Math.round(rect.width * meta.width), meta.width - left);
  const height = Math.min(Math.round(rect.height * meta.height), meta.height - top);
  if (width < MIN_CROP_PX || height < MIN_CROP_PX) throw new Error("Crop too small");
  const data = await sharp(input)
    .extract({ left, top, width, height })
    .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { data, contentType: "image/jpeg" };
}
```

- [ ] **Step 4: Run tests to verify pass:** same command as Step 2 — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git -C /Users/timestes/projects/rtt-art-candidates add app/forge/lib/cropPreview.ts app/forge/lib/imageCrop.ts app/forge/lib/__tests__/cropPreview.test.ts app/forge/lib/__tests__/imageCrop.test.ts
git -C /Users/timestes/projects/rtt-art-candidates commit -m "feat(forge): crop rect math + sharp crop helper"
```

---

### Task 3: `uploadForgeArtRaw` + candidate server actions

**Files:**
- Modify: `app/forge/lib/art.ts` (add one function after `uploadForgeFinished`, ~line 70)
- Create: `app/forge/lib/artCandidates.ts`
- Test: extend `app/forge/lib/__tests__/art.test.ts`; create `app/forge/lib/__tests__/artCandidates.test.ts`

**Interfaces:**
- Consumes: Task 1 RPC names; Task 2 `clampCropRect` / `cropCardImage`; existing `validateArtFile` / `uploadForgeArt` / `readForgeArt` from `art.ts`; `requireElder` from `app/forge/lib/auth`.
- Produces (Tasks 5–7 consume): `type ArtCandidate = { id: string; createdAt: string; isActiveSource: boolean }`;
  `listArtCandidates(cardId: string): Promise<ArtCandidate[]>`;
  `addArtCandidate(cardId: string, formData: FormData): Promise<{ ok: boolean; error?: string }>`;
  `deleteArtCandidate(cardId: string, candidateId: string): Promise<{ ok: boolean; error?: string }>`;
  `activateCandidate(cardId: string, candidateId: string): Promise<{ ok: boolean; error?: string }>`;
  `applyCrop(cardId: string, candidateId: string, rect: CropRect): Promise<{ ok: boolean; error?: string }>`;
  `uploadForgeArtRaw(data: Buffer, contentType: string): Promise<string>` in `art.ts`.

- [ ] **Step 1: Add to `art.ts`** (below `uploadForgeFinished`):

```ts
/** Upload an already-processed image buffer (e.g. a crop derivative) under
 * forge-art/ WITHOUT re-normalizing — the corner-gated trim could eat a crop
 * that happens to have white corners. */
export async function uploadForgeArtRaw(data: Buffer, contentType: string): Promise<string> {
  const key = `${ART_PREFIX}${randomUUID()}`;
  const blob = await put(key, data, {
    access: "private",
    addRandomSuffix: false,
    ...forgeAuth,
    contentType,
  });
  return blob.pathname;
}
```

- [ ] **Step 2: Extend `art.test.ts`** with (mirror the file's existing `put` mock style — `put` is already mocked at the top):

```ts
describe("uploadForgeArtRaw", () => {
  beforeEach(() => vi.clearAllMocks());
  it("puts the buffer as-is under forge-art/ without normalizing", async () => {
    (put as ReturnType<typeof vi.fn>).mockResolvedValue({ pathname: "forge-art/raw-key" });
    const buf = Buffer.from([9, 9, 9]);
    const key = await uploadForgeArtRaw(buf, "image/jpeg");
    expect(key).toBe("forge-art/raw-key");
    expect(normalizeCardImage).not.toHaveBeenCalled();
    const [putKey, putData, putOpts] = (put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putKey).toMatch(/^forge-art\//);
    expect(putData).toBe(buf);
    expect(putOpts.contentType).toBe("image/jpeg");
    expect(putOpts.access).toBe("private");
  });
});
```

(add `uploadForgeArtRaw` to the existing import from `"../art"`.)

- [ ] **Step 3: Create `app/forge/lib/artCandidates.ts`:**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireElder } from "@/app/forge/lib/auth";
import { validateArtFile, uploadForgeArt, uploadForgeArtRaw, readForgeArt } from "@/app/forge/lib/art";
import { clampCropRect, cropCardImage } from "@/app/forge/lib/imageCrop";
import type { CropRect } from "@/app/forge/lib/cropPreview";

// Candidate ids/timestamps only — blob keys never leave the server; the client
// renders images through /forge/api/art/[cardId]?candidate=<id>.
export type ArtCandidate = { id: string; createdAt: string; isActiveSource: boolean };

export async function listArtCandidates(cardId: string): Promise<ArtCandidate[]> {
  const ctx = await requireElder();
  if (!ctx) return [];
  const [{ data: rows }, { data: card }] = await Promise.all([
    ctx.supabase
      .from("forge_card_art_candidates")
      .select("id, key, created_at")
      .eq("card_id", cardId)
      .order("created_at", { ascending: true }),
    ctx.supabase
      .from("forge_cards")
      .select("working_art_key, working_art_original_key")
      .eq("id", cardId)
      .maybeSingle(),
  ]);
  const activeKey = card?.working_art_key ? card.working_art_original_key : null;
  return (rows ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    isActiveSource: !!activeKey && r.key === activeKey,
  }));
}

export async function addArtCandidate(
  cardId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided" };
  const invalid = validateArtFile(file);
  if (invalid) return { ok: false, error: invalid };

  let key: string;
  try {
    key = await uploadForgeArt(file);
  } catch {
    return { ok: false, error: "Could not read image file." };
  }
  const { error } = await ctx.supabase.rpc("forge_add_art_candidate", {
    p_card_id: cardId,
    p_key: key,
  });
  if (error) {
    return { ok: false, error: /limit/i.test(error.message) ? "Limit of 12 images per card." : "Could not save image" };
  }

  // First image on an art-less card becomes the artwork uncropped, preserving
  // the old one-step upload flow.
  const { data: card } = await ctx.supabase
    .from("forge_cards")
    .select("working_art_key")
    .eq("id", cardId)
    .maybeSingle();
  if (card && !card.working_art_key) {
    await ctx.supabase.rpc("forge_set_working_art", { p_card_id: cardId, p_key: key, p_original_key: key });
  }
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function deleteArtCandidate(
  cardId: string,
  candidateId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_delete_art_candidate", { p_candidate_id: candidateId });
  if (error) {
    return { ok: false, error: /source of the current artwork/i.test(error.message) ? "This image is the source of the current artwork." : "Could not delete image" };
  }
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

async function candidateKey(
  ctx: NonNullable<Awaited<ReturnType<typeof requireElder>>>,
  cardId: string,
  candidateId: string
): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("forge_card_art_candidates")
    .select("key")
    .eq("id", candidateId)
    .eq("card_id", cardId)
    .maybeSingle();
  return data?.key ?? null;
}

export async function activateCandidate(
  cardId: string,
  candidateId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const key = await candidateKey(ctx, cardId, candidateId);
  if (!key) return { ok: false, error: "Image not found" };
  const { error } = await ctx.supabase.rpc("forge_set_working_art", {
    p_card_id: cardId,
    p_key: key,
    p_original_key: key,
  });
  if (error) return { ok: false, error: "Could not set artwork" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function applyCrop(
  cardId: string,
  candidateId: string,
  rect: CropRect
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const clamped = clampCropRect(rect);
  if (!clamped) return { ok: false, error: "Invalid crop" };
  const key = await candidateKey(ctx, cardId, candidateId);
  if (!key) return { ok: false, error: "Image not found" };

  let input: Buffer;
  try {
    const blob = await readForgeArt(key);
    if (!blob || blob.statusCode !== 200) return { ok: false, error: "Could not read image" };
    input = Buffer.from(await new Response(blob.stream).arrayBuffer());
  } catch {
    return { ok: false, error: "Could not read image" };
  }

  let croppedKey: string;
  try {
    const cropped = await cropCardImage(input, clamped);
    croppedKey = await uploadForgeArtRaw(cropped.data, cropped.contentType);
  } catch (e) {
    return { ok: false, error: e instanceof Error && /too small/i.test(e.message) ? "Crop is too small." : "Could not crop image" };
  }

  const { error } = await ctx.supabase.rpc("forge_set_working_art", {
    p_card_id: cardId,
    p_key: croppedKey,
    p_original_key: key,
  });
  if (error) return { ok: false, error: "Could not save artwork" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}
```

- [ ] **Step 4: Write `artCandidates.test.ts`** (mock style mirrors `art.test.ts` + the route test):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireElder: vi.fn() }));
vi.mock("@/app/forge/lib/art", () => ({
  validateArtFile: vi.fn(() => null),
  uploadForgeArt: vi.fn(),
  uploadForgeArtRaw: vi.fn(),
  readForgeArt: vi.fn(),
}));
vi.mock("@/app/forge/lib/imageCrop", () => ({
  clampCropRect: vi.fn((r) => r),
  cropCardImage: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireElder } from "@/app/forge/lib/auth";
import { uploadForgeArt, uploadForgeArtRaw, readForgeArt } from "@/app/forge/lib/art";
import { clampCropRect, cropCardImage } from "@/app/forge/lib/imageCrop";
import { addArtCandidate, applyCrop, deleteArtCandidate } from "../artCandidates";

/** Supabase mock: from() returns a self-chaining builder resolving to `rows`
 * keyed by table name; rpc() resolves from `rpcResults` keyed by fn name. */
function mockCtx(opts: {
  rows?: Record<string, unknown>;
  rpcResults?: Record<string, { error: null | { message: string } }>;
}) {
  const from = vi.fn((table: string) => {
    const result = { data: opts.rows?.[table] ?? null, error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) builder[m] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(() => Promise.resolve(result));
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
  const rpc = vi.fn((fn: string) =>
    Promise.resolve(opts.rpcResults?.[fn] ?? { data: null, error: null })
  );
  const ctx = { supabase: { from, rpc }, user: { id: "u1" }, role: "elder" };
  (requireElder as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  return { from, rpc };
}

const fd = () => {
  const f = new FormData();
  f.set("file", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
  return f;
};

describe("addArtCandidate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads, registers the candidate, and auto-activates on an art-less card", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: null } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k1");
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_add_art_candidate", { p_card_id: "card1", p_key: "forge-art/k1" });
    expect(rpc).toHaveBeenCalledWith("forge_set_working_art", { p_card_id: "card1", p_key: "forge-art/k1", p_original_key: "forge-art/k1" });
  });

  it("does not auto-activate when the card already has art", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: "forge-art/existing" } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k2");
    await addArtCandidate("card1", fd());
    expect(rpc).not.toHaveBeenCalledWith("forge_set_working_art", expect.anything());
  });

  it("maps the cap error to friendly copy", async () => {
    mockCtx({ rpcResults: { forge_add_art_candidate: { error: { message: "candidate limit reached (12)" } } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k3");
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/12 images/);
  });

  it("refuses when not an elder", async () => {
    (requireElder as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(false);
    expect(uploadForgeArt).not.toHaveBeenCalled();
  });
});

describe("deleteArtCandidate", () => {
  beforeEach(() => vi.clearAllMocks());
  it("maps the active-source refusal to friendly copy", async () => {
    mockCtx({ rpcResults: { forge_delete_art_candidate: { error: { message: "candidate is the source of the current artwork" } } } });
    const r = await deleteArtCandidate("card1", "cand1");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/source of the current artwork/i);
  });
});

describe("applyCrop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an invalid rect before touching the blob store", async () => {
    mockCtx({});
    (clampCropRect as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const r = await applyCrop("card1", "cand1", { x: 0, y: 0, width: 0, height: 0 });
    expect(r.ok).toBe(false);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("crops, uploads raw, and saves cropped-as-working with the candidate as original", async () => {
    const { rpc } = mockCtx({ rows: { forge_card_art_candidates: { key: "forge-art/src" } } });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      stream: new Blob([new Uint8Array([1, 2])]).stream(),
    });
    (cropCardImage as ReturnType<typeof vi.fn>).mockResolvedValue({ data: Buffer.from([3]), contentType: "image/jpeg" });
    (uploadForgeArtRaw as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/cropped");
    const r = await applyCrop("card1", "cand1", { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_set_working_art", {
      p_card_id: "card1",
      p_key: "forge-art/cropped",
      p_original_key: "forge-art/src",
    });
  });
});
```

- [ ] **Step 5: Run the new tests:** `cd /Users/timestes/projects/rtt-art-candidates && npx vitest run app/forge/lib/__tests__/artCandidates.test.ts app/forge/lib/__tests__/art.test.ts` — Expected: PASS. (If the `builder.then` chaining trick fights vitest, replace the list call's await with explicit `.maybeSingle()`-style terminal mocks — keep the production code as written and adjust only the mock.)
- [ ] **Step 6: Commit**

```bash
git -C /Users/timestes/projects/rtt-art-candidates add app/forge/lib/art.ts app/forge/lib/artCandidates.ts app/forge/lib/__tests__/art.test.ts app/forge/lib/__tests__/artCandidates.test.ts
git -C /Users/timestes/projects/rtt-art-candidates commit -m "feat(forge): candidate art server actions + raw blob upload"
```

---

### Task 4: Art route `candidate` param

**Files:**
- Modify: `app/forge/api/art/[cardId]/route.ts` (the RPC call at ~lines 22-29)
- Test: `app/forge/api/art/[cardId]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `forge_candidate_art_key(p_card_id, p_candidate_id)` from Task 1.
- Produces: `GET /forge/api/art/<cardId>?candidate=<id>[&t=…][&download=1]` — Tasks 6–7 build thumbnail/download URLs against exactly this shape.

- [ ] **Step 1: Write failing tests** — add to the existing describe block (the `mockSupabase` helper needs its `rpc` mock extended to answer `forge_candidate_art_key` from a new `opts.candidateKey`):

```ts
  it("routes candidate requests through forge_candidate_art_key", async () => {
    const client = mockSupabase({ candidateKey: "forge-art/cand" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc?candidate=cand-1") as never;
    await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(client.rpc).toHaveBeenCalledWith("forge_candidate_art_key", {
      p_card_id: "abc",
      p_candidate_id: "cand-1",
    });
    expect(readForgeArt).toHaveBeenCalledWith("forge-art/cand");
  });

  it("returns 404 when the candidate RPC yields no key (non-elder, wrong card…)", async () => {
    mockSupabase({ candidateKey: null });
    const req = new Request("http://localhost/forge/api/art/abc?candidate=cand-1") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });
```

Extend the helper like:

```ts
function mockSupabase(opts: { user?: boolean; artKey?: string | null; candidateKey?: string | null; rpcError?: boolean }) {
  const rpc = vi.fn((fn: string) => {
    if (fn === "forge_art_key") { /* unchanged */ }
    if (fn === "forge_candidate_art_key") {
      return Promise.resolve({ data: opts.candidateKey ?? null, error: null });
    }
    return Promise.resolve({ data: null, error: null }); // audit log
  });
  /* rest unchanged */
}
```

- [ ] **Step 2: Run to verify failure:** `npx vitest run "app/forge/api/art/[cardId]/__tests__/route.test.ts"` — Expected: the two new tests FAIL (route still calls `forge_art_key`).
- [ ] **Step 3: Implement** — in `route.ts`, replace the RPC half of the `Promise.all` (keep the comment block, append one line to it):

```ts
  const candidateId = url.searchParams.get("candidate");
  // ... existing comment ...
  // `candidate` swaps in the designer-gallery lookup (082): same 404-on-anything.
  const [{ data: userData, error: userError }, { data: artKey }] = await Promise.all([
    supabase.auth.getUser(),
    candidateId
      ? supabase.rpc("forge_candidate_art_key", { p_card_id: cardId, p_candidate_id: candidateId })
      : supabase.rpc("forge_art_key", { p_card_id: cardId, p_approved: wantApproved, p_kind: kind }),
  ]);
```

- [ ] **Step 4: Run the full route test file:** Expected: ALL pass (old tests unaffected).
- [ ] **Step 5: Commit**

```bash
git -C /Users/timestes/projects/rtt-art-candidates add "app/forge/api/art/[cardId]/route.ts" "app/forge/api/art/[cardId]/__tests__/route.test.ts"
git -C /Users/timestes/projects/rtt-art-candidates commit -m "feat(forge): serve candidate art via the authed art proxy"
```

---

### Task 5: FilePicker `multiple` mode

**Files:**
- Modify: `app/forge/components/FilePicker.tsx`

**Interfaces:**
- Produces: `<FilePicker multiple onFiles={(files: File[]) => …} />`; `onFile` becomes optional. Existing single-file call sites (StudioEditor ×2, others) compile unchanged.

(No component-test infra in this repo — verification is the type check + Task 7's integration.)

- [ ] **Step 1: Implement** — change the props and the `onChange`:

```ts
export default function FilePicker({
  label,
  accept,
  disabled,
  onFile,
  onFiles,
  multiple,
  hint,
}: {
  label: string;
  accept?: string;
  disabled?: boolean;
  onFile?: (file: File) => void;
  onFiles?: (files: File[]) => void;
  multiple?: boolean;
  hint?: string;
}) {
```

input element gains `multiple={multiple}`; the `onChange` body becomes:

```ts
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) {
            if (multiple && onFiles) onFiles(files);
            else if (onFile) onFile(files[0]);
          }
          e.target.value = "";
        }}
```

- [ ] **Step 2: Type-check:** `cd /Users/timestes/projects/rtt-art-candidates && npx tsc --noEmit` — Expected: clean (pre-existing errors, if any, must not grow; note the baseline).
- [ ] **Step 3: Commit**

```bash
git -C /Users/timestes/projects/rtt-art-candidates add app/forge/components/FilePicker.tsx
git -C /Users/timestes/projects/rtt-art-candidates commit -m "feat(forge): FilePicker multiple-file mode"
```

---

### Task 6: Crop modal (react-easy-crop + live preview)

**Files:**
- Create: `app/forge/components/CropCandidateModal.tsx`
- Modify: `package.json` (via `npm install react-easy-crop` — currently ^6.2.3)

**Interfaces:**
- Consumes: `applyCrop`, `activateCandidate` (Task 3); `cropBackgroundStyle`, `CropRect` (Task 2); `Dialog` from `@/components/ui/dialog` (portals to `<body>` — check how `components/ui/confirmation-dialog.tsx` composes it and mirror that usage exactly).
- Produces: `<CropCandidateModal cardId candidateId imageUrl cardName onClose onApplied />` — Task 7 renders it. `onApplied` fires after a successful apply (caller refreshes); `onClose` on cancel/dismiss.

- [ ] **Step 1: Install:** `cd /Users/timestes/projects/rtt-art-candidates && npm install react-easy-crop`
- [ ] **Step 2: Implement `CropCandidateModal.tsx`:**

```tsx
"use client";

import { useState } from "react";
import Cropper from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { applyCrop, activateCandidate } from "@/app/forge/lib/artCandidates";
import { cropBackgroundStyle, type CropRect } from "@/app/forge/lib/cropPreview";

// Frame aspect = the card face's art slot: full width × 48% of a 750×1050 face.
const ART_SLOT_ASPECT = 750 / 504;

export default function CropCandidateModal({
  cardId, candidateId, imageUrl, cardName, onClose, onApplied,
}: {
  cardId: string;
  candidateId: string;
  imageUrl: string;
  cardName: string | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  // react-easy-crop reports croppedArea in PERCENTAGES of the source image.
  const [rect, setRect] = useState<CropRect | null>(null);
  const [busy, setBusy] = useState<"crop" | "full" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(kind: "crop" | "full") {
    if (kind === "crop" && !rect) return;
    setErr(null);
    setBusy(kind);
    const r = kind === "crop"
      ? await applyCrop(cardId, candidateId, rect!)
      : await activateCandidate(cardId, candidateId);
    setBusy(null);
    if (r.ok === false) setErr(r.error ?? "Something went wrong");
    else onApplied();
  }

  return (
    /* Mirror confirmation-dialog.tsx's Dialog composition here. Content: */
    <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
      <p className="text-sm font-medium">Crop artwork</p>

      <div className="relative w-full" style={{ aspectRatio: "3 / 2", background: "black" }}>
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          aspect={ART_SLOT_ASPECT}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(area) =>
            setRect({ x: area.x / 100, y: area.y / 100, width: area.width / 100, height: area.height / 100 })
          }
        />
      </div>

      {/* Live preview: the card face's art strip showing exactly the framed subrect. */}
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Preview on card</p>
        <div className="w-40 overflow-hidden rounded-md border">
          <div
            style={{
              aspectRatio: "750 / 504",
              backgroundImage: `url(${imageUrl})`,
              backgroundRepeat: "no-repeat",
              ...(rect ? cropBackgroundStyle(rect) : { backgroundSize: "cover", backgroundPosition: "center" }),
            }}
          />
          <p className="truncate px-2 py-1 text-xs font-semibold">{cardName?.trim() || "Untitled"}</p>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy !== null}>Cancel</Button>
        <Button variant="outline" size="sm" onClick={() => run("full")} disabled={busy !== null}>
          {busy === "full" ? "Saving…" : "Use uncropped"}
        </Button>
        <Button size="sm" onClick={() => run("crop")} disabled={busy !== null || !rect}>
          {busy === "crop" ? "Saving…" : "Use cropped"}
        </Button>
      </div>
    </div>
  );
}
```

**Implementation notes (must-do):**
- Wrap the content above in this repo's `Dialog` exactly the way `confirmation-dialog.tsx` does (it portals to `<body>`; do NOT add your own `fixed inset-0` wrapper — that swallows clicks, see PR #229 lesson). Keep the `stopPropagation` on the content so overlay-click still closes.
- If `react-easy-crop`'s `onCropComplete` types complain, its first arg is `Area` (`{ x, y, width, height }` in percent) — import `type { Area } from "react-easy-crop"` or type inline; check `node_modules/react-easy-crop/index.d.ts` rather than guessing.

- [ ] **Step 3: Type-check:** `npx tsc --noEmit` — Expected: no new errors.
- [ ] **Step 4: Commit**

```bash
git -C /Users/timestes/projects/rtt-art-candidates add app/forge/components/CropCandidateModal.tsx package.json package-lock.json
git -C /Users/timestes/projects/rtt-art-candidates commit -m "feat(forge): crop modal with react-easy-crop + live card preview"
```

---

### Task 7: Candidate gallery panel + studio wiring

**Files:**
- Create: `app/forge/components/ArtCandidatesPanel.tsx`
- Modify: `app/forge/cards/[cardId]/StudioEditor.tsx` (Artwork fieldset, ~lines 203-228; props at ~line 33)
- Modify: `app/forge/cards/[cardId]/page.tsx` (fetch + pass candidates, ~lines 19-53)

**Interfaces:**
- Consumes: `listArtCandidates` / `addArtCandidate` / `deleteArtCandidate` + `ArtCandidate` type (Task 3), `CropCandidateModal` (Task 6), `FilePicker` multiple mode (Task 5), route `candidate` URLs (Task 4), `ConfirmationDialog` from `@/components/ui/confirmation-dialog`.
- Produces: `<ArtCandidatesPanel cardId candidates cardName />`; `StudioEditor` gains prop `artCandidates: ArtCandidate[]`.

- [ ] **Step 1: Implement `ArtCandidatesPanel.tsx`:**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import FilePicker from "@/app/forge/components/FilePicker";
import CropCandidateModal from "@/app/forge/components/CropCandidateModal";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { addArtCandidate, deleteArtCandidate, type ArtCandidate } from "@/app/forge/lib/artCandidates";

// Candidate blobs are immutable (a row is written once, never replaced), so a
// constant t cache-buster is enough for the proxy's immutable caching.
const candidateUrl = (cardId: string, id: string) => `/forge/api/art/${cardId}?candidate=${id}&t=c`;

export default function ArtCandidatesPanel({
  cardId, candidates, cardName,
}: {
  cardId: string;
  candidates: ArtCandidate[];
  cardName: string | null;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cropping, setCropping] = useState<string | null>(null); // candidate id
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function onFiles(files: File[]) {
    setErr(null);
    const errors: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress(`Uploading ${i + 1} of ${files.length}…`);
      const fd = new FormData();
      fd.set("file", files[i]);
      const r = await addArtCandidate(cardId, fd);
      if (r.ok === false) errors.push(`${files[i].name}: ${r.error ?? "failed"}`);
    }
    setProgress(null);
    if (errors.length > 0) setErr(errors.join(" · "));
    router.refresh();
  }

  async function onDelete(id: string) {
    setErr(null);
    const r = await deleteArtCandidate(cardId, id);
    if (r.ok === false) setErr(r.error ?? "Could not delete image");
    router.refresh();
  }

  return (
    <div>
      <FilePicker label="Add images…" accept="image/jpeg,image/png,image/webp" multiple
        disabled={progress !== null} onFiles={onFiles}
        hint={progress ?? `${candidates.length}/12 · click an image to crop`} />
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}

      {candidates.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {candidates.map((c) => (
            <li key={c.id} className="group relative">
              <button type="button" className="block w-full" onClick={() => setCropping(c.id)}
                aria-label={c.isActiveSource ? "Re-crop the current artwork's source" : "Crop this image"}>
                {/* eslint-disable-next-line @next/next/no-img-element -- forge art must use the authed proxy, never next/image */}
                <img src={candidateUrl(cardId, c.id)} alt="" loading="lazy" decoding="async"
                  className={`aspect-square w-full rounded-md border object-cover ${c.isActiveSource ? "ring-2 ring-primary" : ""}`} />
              </button>
              {c.isActiveSource ? (
                <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1 text-[10px] font-medium">Artwork source</span>
              ) : (
                <button type="button" aria-label="Delete image"
                  className="absolute right-1 top-1 rounded-md border bg-background/85 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                  onClick={() => setPendingDelete(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {cropping && (
        <CropCandidateModal cardId={cardId} candidateId={cropping}
          imageUrl={candidateUrl(cardId, cropping)} cardName={cardName}
          onClose={() => setCropping(null)}
          onApplied={() => { setCropping(null); router.refresh(); }} />
      )}

      <ConfirmationDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        onConfirm={() => { const id = pendingDelete; setPendingDelete(null); if (id) void onDelete(id); }}
        variant="destructive"
        title="Delete this image?"
        description="Removes it from this card's gallery. This can't be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}
```

(Note: mobile has no hover — the `opacity-0 group-hover:opacity-100` delete affordance must also become visible via `focus:opacity-100` as written, and add `active:opacity-100`. If a simpler always-visible delete button reads better at this size, prefer that.)

- [ ] **Step 2: Wire `StudioEditor.tsx`.** Add to props: `artCandidates: ArtCandidate[]` (import `type { ArtCandidate } from "@/app/forge/lib/artCandidates"`). In the Artwork fieldset, replace the single `<FilePicker label="Choose image…" … onFile={(f) => onUpload(f, "art")} />` line with:

```tsx
            <ArtCandidatesPanel cardId={card.id} candidates={artCandidates} cardName={snapshot.name ?? null} />
```

Keep the placeholder checkbox. Update the Download-original link: above the return, `const activeSourceId = artCandidates.find((c) => c.isActiveSource)?.id ?? null;` and the anchor href becomes:

```tsx
              <a href={activeSourceId
                ? `/forge/api/art/${card.id}?candidate=${activeSourceId}&download=1`
                : `/forge/api/art/${card.id}?download=1`}
```

The `uploading === "art"` state and the `onUpload(file, "art")` branch are now dead — remove the `"art"` variant (keep `"finished"`): `uploading` becomes `"finished" | null` and `onUpload(file: File, kind: "finished")`. Do NOT remove `uploadArt` from `app/forge/lib/cards.ts` (other callers may exist; it stays).

- [ ] **Step 3: Wire `page.tsx`.** Import `listArtCandidates` from `@/app/forge/lib/artCandidates`; after `const card = await getCard(cardId);` add `const artCandidates = await listArtCandidates(cardId);` and pass `artCandidates={artCandidates}` to `<StudioEditor …>`.
- [ ] **Step 4: Run everything:** `npx vitest run` and `npx tsc --noEmit` — Expected: all tests pass, no new type errors.
- [ ] **Step 5: Commit**

```bash
git -C /Users/timestes/projects/rtt-art-candidates add app/forge/components/ArtCandidatesPanel.tsx "app/forge/cards/[cardId]/StudioEditor.tsx" "app/forge/cards/[cardId]/page.tsx"
git -C /Users/timestes/projects/rtt-art-candidates commit -m "feat(forge): candidate art gallery in the card studio"
```

---

### Task 8: Final verification + PR (orchestrator)

- [ ] **Step 1: Apply migration 082** via the Supabase MCP (`apply_migration`, name `082_forge_art_candidates`, content = the file). Additive only (new table + new functions) — safe pre-merge.
- [ ] **Step 2: Full gates in the worktree:** `npx vitest run` (all pass) and `npx tsc --noEmit` (no new errors vs. baseline).
- [ ] **Step 3: E2E smoke** (see the `verify` project skill for minting a real elder session against the dev server): open a card studio, upload 2 images, crop one → card face shows the crop; "Use uncropped" → face shows full image; delete guard blocks the artwork-source candidate; second image deletable.
- [ ] **Step 4: Push + PR** from the worktree, base `origin/main`:

```bash
git -C /Users/timestes/projects/rtt-art-candidates push -u origin feature/forge-art-candidates
```

then `gh pr create` with title `feat(forge): multi-image art candidates + crop in the card studio`, body summarizing the spec (link `docs/superpowers/specs/2026-07-26-forge-art-candidates-crop-design.md`), noting migration 082 is applied, ending with the standard generated-with footer.

- [ ] **Step 5: Clean up** only after the PR is open: leave the worktree in place until merge (do NOT `git worktree remove` yet — review may need fixes).

---

## Self-Review (done at planning time)

- **Spec coverage:** table+RPCs+RLS+cap → Task 1; normalize→blob→candidate upload + auto-activate → Task 3; crop UI + aspect + preview → Task 6; server crop + `forge_set_working_art` wiring → Tasks 2-3; proxy `candidate` param + download-original swap → Tasks 4, 7; active ring + delete guard + row-only delete → Tasks 1, 7; anon-leak extension → Task 1; route tests → Task 4. No gaps found.
- **Type consistency:** `CropRect` defined once in `cropPreview.ts`, re-exported by `imageCrop.ts`; `ArtCandidate` defined once in `artCandidates.ts`; action names match between Tasks 3, 6, 7.
- **Placeholder scan:** none.
