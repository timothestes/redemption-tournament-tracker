# Forge Set Artwork Download (ZIP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a set-level "Download artwork (ZIP)" action that streams the set's **approved** cards' full-res original illustrations as a ZIP, through the existing gated private-blob path.

**Architecture:** A new gated GET route (`app/forge/api/sets/[setId]/artwork/route.ts`) mirrors the per-card art proxy: `requireForge()` → `getSet()` (null ⇒ 404) → read the approved cards' frozen `card_versions` art keys server-side under RLS → `readForgeArt()` each → in-memory `fflate` `zipSync` → stream as an attachment. A boolean `hasApprovedArt` (computed server-side) gates the button on the progress page. No migration (set-elder RLS already permits reading the set's approved versions). Art keys never cross to the client.

**Tech Stack:** Next.js 15 App Router route handler, `@vercel/blob` private `get` (via `app/forge/lib/art.ts`), `fflate` (new dep), Supabase RLS-scoped reads, Vitest.

## Global Constraints

- **Leak boundary:** the route streams prerelease art. It must call `requireForge()` as its **first statement** and return **404** (`notFoundResponse()`), never 401/403, for non-members and non-set-elders. (`forge-gate-first` auto-scans every `app/forge/**/route.ts` for a `require(Forge|Elder|ForgeSuperadmin)(` call — the route passes that guardrail only by gating itself.)
- **Set authorization = set-read:** reuse `getSet(setId)` — a non-null return means the caller can read the set under RLS (set-elder or superadmin); `null ⇒ notFoundResponse()`. Mirrors the progress page's `getSet → notFound` gate.
- **Private-blob path only:** all bytes via `readForgeArt(key)` (`@/app/forge/lib/art`, `get(..., {access:'private'})`). **No public URL ever generated.** Response headers include `Cache-Control: private, no-store`. Route sets `export const dynamic = "force-dynamic"`.
- **Art keys never reach the client.** `listSetApprovedArt()` is SERVER-ONLY and returns blob keys; the progress page passes only the derived boolean `hasApprovedArt` to the client component. (Consistent with 1a.3's `hasArt:boolean`-not-key rule.)
- **Approved only:** include a card iff `forge_cards.status='approved'` with `approved_version_id` set, and the approved version's art is non-placeholder and present.
- **No migration, no status change, no manifest, no PDF.** Pure read; raw illustration files only.
- **strict:false tsconfig** — discriminated-union narrowing on `if (r.ok)` is broken; use `r.ok === false`. Only `npm run build` typechecks.

---

## File structure

| File | Responsibility |
|---|---|
| `package.json` (modify) | Add `fflate` dependency. |
| `app/forge/lib/setArtwork.ts` (create) | Pure `artExt(contentType)` + `artFileName(seq, name, ext)`; SERVER-ONLY `listSetApprovedArt(setId)` reader + `ApprovedArt` type. |
| `app/forge/lib/__tests__/setArtwork.test.ts` (create) | Unit tests for the two pure helpers. |
| `app/forge/api/sets/[setId]/artwork/route.ts` (create) | Gated GET → ZIP stream. |
| `app/forge/sets/[setId]/progress/page.tsx` (modify) | Compute `hasApprovedArt`, pass to `ProgressDashboard`. |
| `app/forge/sets/[setId]/progress/ProgressDashboard.tsx` (modify) | Render the "Download artwork (ZIP)" button (disabled when `!hasApprovedArt`). |

---

## Task 1: `fflate` dep + pure filename helpers (TDD)

**Files:**
- Modify: `package.json`
- Create: `app/forge/lib/setArtwork.ts`
- Test: `app/forge/lib/__tests__/setArtwork.test.ts`

**Interfaces:**
- Produces: `artExt(contentType: string): string`; `artFileName(seq: number, name: string, ext: string): string`.

- [ ] **Step 1: Add the dependency**

Run: `npm install fflate`
Expected: `fflate` appears in `package.json` dependencies; `package-lock.json` updated.

- [ ] **Step 2: Write the failing test**

Create `app/forge/lib/__tests__/setArtwork.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { artExt, artFileName } from "@/app/forge/lib/setArtwork";

describe("artExt", () => {
  it("maps known image content types", () => {
    expect(artExt("image/png")).toBe("png");
    expect(artExt("image/webp")).toBe("webp");
    expect(artExt("image/jpeg")).toBe("jpg");
  });
  it("falls back to 'img' for unknown types", () => {
    expect(artExt("application/octet-stream")).toBe("img");
    expect(artExt("")).toBe("img");
  });
});

describe("artFileName", () => {
  it("builds {NN}_{slug}.{ext} with a zero-padded sequence", () => {
    expect(artFileName(1, "Angel of the Lord", "png")).toBe("01_angel-of-the-lord.png");
    expect(artFileName(12, "Goliath!", "webp")).toBe("12_goliath.webp");
  });
  it("pads sequences beyond 99 without truncating", () => {
    expect(artFileName(100, "X", "png")).toBe("100_x.png");
  });
  it("falls back to 'card' when the name has no slug characters", () => {
    expect(artFileName(3, "   ", "png")).toBe("03_card.png");
    expect(artFileName(4, "!!!", "png")).toBe("04_card.png");
  });
});
```

- [ ] **Step 3: Run RED**

Run: `npx vitest run app/forge/lib/__tests__/setArtwork.test.ts`
Expected: FAIL — cannot resolve `@/app/forge/lib/setArtwork`.

- [ ] **Step 4: Implement the pure helpers**

Create `app/forge/lib/setArtwork.ts`:
```ts
// Set artwork export helpers. The pure helpers (artExt/artFileName) are unit-tested;
// listSetApprovedArt is SERVER-ONLY (it reads private blob keys — never serialize its
// result to a client component).
import { requireForge } from "@/app/forge/lib/auth";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

/** Map a blob content-type to a file extension; 'img' for anything unknown. Pure. */
export function artExt(contentType: string): string {
  return EXT_BY_TYPE[contentType] ?? "img";
}

/** `{NN}_{slug}.{ext}` — zero-padded sequence, slugified name (fallback 'card'). Pure. */
export function artFileName(seq: number, name: string, ext: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "card";
  return `${String(seq).padStart(2, "0")}_${slug}.${ext}`;
}
```

- [ ] **Step 5: Run GREEN**

Run: `npx vitest run app/forge/lib/__tests__/setArtwork.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app/forge/lib/setArtwork.ts app/forge/lib/__tests__/setArtwork.test.ts
git commit -m "feat(forge): fflate dep + artExt/artFileName helpers for set artwork export (TDD)"
```

---

## Task 2: Approved-art reader + ZIP route

**Files:**
- Modify: `app/forge/lib/setArtwork.ts`
- Create: `app/forge/api/sets/[setId]/artwork/route.ts`

**Interfaces:**
- Consumes: `artExt`, `artFileName` (Task 1); `requireForge`, `notFoundResponse` (`@/app/forge/lib/auth`); `getSet` (`@/app/forge/lib/sets`); `readForgeArt` (`@/app/forge/lib/art`); `zipSync` (`fflate`).
- Produces: `type ApprovedArt = { cardId: string; name: string; key: string; isPlaceholder: boolean; versionNumber: number }`; `listSetApprovedArt(setId: string): Promise<ApprovedArt[]>` (returns only **exportable** entries — non-empty `key`, not placeholder).

- [ ] **Step 1: Add the server reader to `setArtwork.ts`**

Append to `app/forge/lib/setArtwork.ts`:
```ts
export type ApprovedArt = {
  cardId: string;
  name: string;
  key: string;
  isPlaceholder: boolean;
  versionNumber: number;
};

/**
 * SERVER-ONLY. The approved cards of a set with exportable art, read under the
 * caller's RLS (set-elder/superadmin can read the set's approved card_versions).
 * Returns only entries with real, non-placeholder art. Carries blob keys — never
 * pass the result to a client component; derive a boolean/count instead.
 */
export async function listSetApprovedArt(setId: string): Promise<ApprovedArt[]> {
  const ctx = await requireForge();
  if (!ctx) return [];

  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("approved_version_id")
    .eq("set_id", setId)
    .eq("status", "approved")
    .not("approved_version_id", "is", null);

  const versionIds = (cards ?? [])
    .map((c: any) => c.approved_version_id)
    .filter((id: any): id is string => !!id);
  if (versionIds.length === 0) return [];

  const { data: versions } = await ctx.supabase
    .from("card_versions")
    .select("id, card_id, version_number, data, art_key, art_original_key, art_is_placeholder")
    .in("id", versionIds);

  return (versions ?? [])
    .map((v: any) => ({
      cardId: v.card_id as string,
      name: (v.data?.name ?? "").toString(),
      key: (v.art_original_key ?? v.art_key ?? "") as string,
      isPlaceholder: !!v.art_is_placeholder,
      versionNumber: (v.version_number ?? 0) as number,
    }))
    .filter((a: ApprovedArt) => a.key !== "" && !a.isPlaceholder);
}
```

- [ ] **Step 2: Create the route**

Create `app/forge/api/sets/[setId]/artwork/route.ts`:
```ts
import { requireForge, notFoundResponse } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import { listSetApprovedArt, artExt, artFileName } from "@/app/forge/lib/setArtwork";
import { readForgeArt } from "@/app/forge/lib/art";
import { zipSync } from "fflate";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ setId: string }> }
): Promise<Response> {
  const ctx = await requireForge();
  if (!ctx) return notFoundResponse(); // 404, never 401/403 — the area stays secret

  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) return notFoundResponse(); // not readable under RLS ⇒ not a set-elder/super

  const arts = await listSetApprovedArt(setId);
  if (arts.length === 0) return notFoundResponse(); // nothing to export (indistinguishable 404)

  // Stable order: version number, then name.
  arts.sort((a, b) => a.versionNumber - b.versionNumber || a.name.localeCompare(b.name));

  const files: Record<string, Uint8Array> = {};
  let seq = 0;
  for (const art of arts) {
    let result;
    try {
      result = await readForgeArt(art.key);
    } catch {
      continue; // skip a missing/failed blob rather than failing the whole export
    }
    if (!result || result.statusCode !== 200) continue;
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    seq += 1;
    files[artFileName(seq, art.name, artExt(result.blob.contentType))] = bytes;
  }
  if (Object.keys(files).length === 0) return notFoundResponse();

  // Images are already compressed → store (level 0), don't waste CPU recompressing.
  const zip = zipSync(files, { level: 0 });

  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${set.slug}-artwork.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
```
(The `{NN}_` sequence prefix makes every filename unique, so no collision handling is needed.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean compile; the new route appears in the route manifest. Fix any type errors (e.g. `result` narrowing — `strict:false`, so guard with `if (!result || result.statusCode !== 200)` as written).

- [ ] **Step 4: Confirm the gate-first guardrail still passes (route auto-covered)**

Run: `npx vitest run __tests__/forge-gate-first.test.ts`
Expected: PASS — the new `app/forge/api/sets/[setId]/artwork/route.ts` is auto-scanned and recognized as gated (it calls `requireForge`). If it FAILS naming the new route, the gate call is missing — add it.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/setArtwork.ts app/forge/api/sets/[setId]/artwork/route.ts
git commit -m "feat(forge): gated set-artwork ZIP route + approved-art reader"
```

---

## Task 3: "Download artwork" button on the progress page

**Files:**
- Modify: `app/forge/sets/[setId]/progress/page.tsx`
- Modify: `app/forge/sets/[setId]/progress/ProgressDashboard.tsx`

**Interfaces:**
- Consumes: `listSetApprovedArt` (Task 2).
- Produces: `ProgressDashboard` gains a `hasApprovedArt: boolean` prop.

- [ ] **Step 1: Compute `hasApprovedArt` in the page (server-side) and pass it down**

In `app/forge/sets/[setId]/progress/page.tsx`, add the import and the computation, then pass the boolean to `<ProgressDashboard>`:
```ts
import { listSetApprovedArt } from "@/app/forge/lib/setArtwork";
// ...after `const cards = await listSetCards(setId);`
const hasApprovedArt = (await listSetApprovedArt(setId)).length > 0;
```
Add `hasApprovedArt={hasApprovedArt}` to the `<ProgressDashboard ... />` props. **Do not** pass the art list itself — only the boolean (it must not carry blob keys to the client).

- [ ] **Step 2: Render the button in `ProgressDashboard.tsx`**

Add `hasApprovedArt: boolean` to the component's props type. Render a download control in the dashboard header area (near the set title / actions). Use the existing button styling in that file; do **not** add `focus:ring-*`. When enabled it's a plain anchor to the route (browser handles the download); when disabled it's a non-interactive, muted element with a hint:
```tsx
{hasApprovedArt ? (
  <a
    href={`/forge/api/sets/${setId}/artwork`}
    className="<match the file's existing button/secondary-action classes>"
  >
    Download artwork (ZIP)
  </a>
) : (
  <span
    className="<same classes + an opacity-50/cursor-not-allowed muted variant>"
    title="Approve cards with art to enable"
    aria-disabled="true"
  >
    Download artwork (ZIP)
  </span>
)}
```
(`setId` is already a prop of `ProgressDashboard`.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean compile across `page.tsx` and `ProgressDashboard.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "app/forge/sets/[setId]/progress/page.tsx" "app/forge/sets/[setId]/progress/ProgressDashboard.tsx"
git commit -m "feat(forge): Download artwork (ZIP) button on set progress page"
```

---

## Task 4: Whole-feature verification + PR

**Files:** none (verification + docs).

- [ ] **Step 1: Gates**

Run and confirm:
- `npx vitest run app/forge/lib/__tests__/setArtwork.test.ts __tests__/forge-gate-first.test.ts` → green (helpers + gate-first incl. the new route).
- `npm test` → green except the one known pre-existing unrelated `store-route` failure (record the pass count).
- `npm run build` → clean.

- [ ] **Step 2: Manual smoke** (record in the PR)

As a set-elder: a set with ≥1 approved card with real art → the button is enabled → clicking downloads `{set-slug}-artwork.zip` containing `{NN}_{slug}.{ext}` files that open as the correct images. A set with only drafts/placeholders → the button is disabled with the hint. Confirm a non-member / non-set-elder GET of `/forge/api/sets/{id}/artwork` returns 404.

- [ ] **Step 3: Update memory + open PR**

Add a short note to `project_forge_playtesting.md` (set artwork download shipped: branch, the route + `setArtwork.ts`, approved-only, no migration, fflate). Then:
```bash
git push -u origin forge-set-artwork-download
gh pr create --title "The Forge — Set artwork download (ZIP)" --body "<summary + manual-smoke results>"
```

---

## Self-review (completed during planning)

- **Spec coverage:** approved-only filter (Task 2 reader), gated route + 404 + private-blob path (Task 2), `{NN}_{slug}.{ext}` naming + ext-from-contentType (Tasks 1–2), disabled-when-empty button (Task 3), no migration / no status change / art-only (whole plan), guardrail coverage (Task 2 Step 4 + Task 4). All spec sections map to a task.
- **Placeholders:** none — real code/commands in every step. The one intentional "match existing classes" note in Task 3 is a styling instruction, not a logic placeholder (the file's own button styles are the source).
- **Type consistency:** `ApprovedArt` defined in Task 2 and consumed by the Task 2 route + Task 3 page; `artExt`/`artFileName` signatures identical across Tasks 1–2; `hasApprovedArt: boolean` defined in Task 3 page → ProgressDashboard prop.
- **Soft spot flagged:** the implementer must read `ProgressDashboard.tsx` for its existing button classes and a sensible header placement (Task 3 Step 2).
