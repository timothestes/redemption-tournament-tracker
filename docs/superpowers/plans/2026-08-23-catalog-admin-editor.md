# Catalog Admin Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Superuser-gated admin surface (`/admin/catalog`) to edit public card metadata via a DB-backed overrides overlay and replace card images in-place on Vercel Blob, with deploy-time `?v=` cache-busting.

**Architecture:** Two Supabase tables (`card_overrides` keyed by card `name|set`, `card_image_versions` keyed by `imgFile`) feed a committed overlay file `scripts/data/card-overrides.json` via a pull script; `scripts/parse-carddata.js` applies overrides last (winning over upstream and forge-released rows) and emits `lib/cards/generated/imgVersions.json` for URL cache-busting. Image replacement overwrites the public blob immediately (archive-first); metadata edits ride the pull → PR → deploy loop.

**Tech Stack:** Next.js 15 App Router server actions + route handlers, Supabase (RLS, no new RPCs), `@vercel/blob` ^2.4.1 (`put`/`copy`/`head`), `sharp` via existing `app/forge/lib/releaseImage.ts`, vitest, CJS node scripts.

**Spec:** `docs/superpowers/specs/2026-08-23-catalog-admin-editor-design.md` — read it first; §12 lists the adversarial findings (F1–F15) that shaped several tasks.

## Global Constraints

- **Worktree isolation (CLAUDE.md):** all work in `/Users/timestes/projects/rtt-catalog-admin` on branch `feat/catalog-admin-editor` off `origin/main`. Absolute paths everywhere. Never touch the main checkout. Never `git add -A`/`.`/`-a` — stage named files only.
- **Do NOT apply migration 092 to prod.** It applies at merge time, like 091 (note it in the PR body).
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- PR body ends with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- Admin surfaces answer **404, never 401/403** (`requireSuperuser()` → `notFound()` / `new Response("Not Found", { status: 404 })`).
- `tsconfig` has `strict: false` — union narrowing via `if (res.ok === false)`, never `if (!res.ok)`/`else`.
- `"use server"` files export **only async functions and erased types** — put constants/pure helpers in separate non-server modules.
- UI: shadcn/Tailwind tokens; **no `focus:ring-*` on form controls**; green accent reserved for hover/active/CTAs (distinguish by weight, not color at rest); plain `<img>` with `{/* eslint-disable-next-line @next/next/no-img-element */}` for blob card images (repo convention).
- Node scripts under `scripts/` stay **CJS** (`require`/`module.exports`).
- All 12 editable fields, everywhere, in this exact order: `officialSet`, `type`, `brigade`, `strength`, `toughness`, `class`, `identifier`, `specialAbility`, `rarity`, `reference`, `alignment`, `legality`. Identity fields (never editable): `name`, `set`, `imgFile`.
- Verification commands (run inside the worktree): `npx tsc --noEmit` (7 pre-existing errors on main in `__tests__/forge-anon-leak.test.ts` and playDecksAuthorize tests are NOT yours — compare against a `git stash`-free baseline by count), `npx vitest run`, `npm run build`.

---

### Task 0: Worktree + environment setup

**Files:** none (environment only)

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/timestes/projects/redemption-tournament-tracker
git fetch origin main
git worktree add /Users/timestes/projects/rtt-catalog-admin -b feat/catalog-admin-editor origin/main
```

- [ ] **Step 2: Wire env + deps** (worktrees carry neither `.env.local` nor `node_modules`)

```bash
cp /Users/timestes/projects/redemption-tournament-tracker/.env.local /Users/timestes/projects/rtt-catalog-admin/.env.local
ln -s /Users/timestes/projects/redemption-tournament-tracker/node_modules /Users/timestes/projects/rtt-catalog-admin/node_modules
```

- [ ] **Step 3: Sanity-check**

```bash
cd /Users/timestes/projects/rtt-catalog-admin && git status --short && git log --oneline -1
npx vitest run app/forge/lib/__tests__/catalogRow.test.ts
```
Expected: clean tree, HEAD at origin/main, 13 tests pass.

---

### Task 1: URL-builder consolidation (spec §5.3 / finding F1)

Six independent card-image URL builders exist; cache-busting only works if they all route through one. This task is pure consolidation — **byte-identical URLs for all real inputs** — and lands before any `?v=` logic exists.

**Files:**
- Modify: `app/shared/utils/cardImageUrl.ts` (the canonical helper)
- Modify: `app/decklist/card-search/hooks/useCardImageUrl.ts` (delegate)
- Modify: `app/play/components/CardPreviewSystem.tsx:6-17` (delete local copy, import)
- Modify: `app/decklist/my-decks/QuickLookModal.tsx:8-15` (delete local copy, import)
- Modify: `app/decklist/my-decks/client.tsx:1398-1405` (delete local copy, import)
- Modify: `app/admin/cards/page.tsx:94,120` (inline literals → helper)
- Modify: `app/admin/rulings/page.tsx:338` (inline literal → helper)
- Modify: `lib/card-images.ts` (thin delegate)
- Test: `app/shared/utils/__tests__/cardImageUrl.test.ts` (create)

**Interfaces:**
- Produces: `getCardImageUrl(imgFile: string): string` and `getCardImageUrlOrNull(imgFile: string | null | undefined): string | null` from `@/app/shared/utils/cardImageUrl` — every card-image URL in the app flows through these two after this task. `sanitizeImgFile` gains `/`→`_` mapping.

Known deliberate behavior deltas (all are bug fixes, spec F13):
1. Extension-stripping becomes uniform (the `lib/card-images.ts` family didn't strip, so a deck-stored `"snap.jpg"` produced `…/snap.jpg.jpg`).
2. `/`→`_` mapping becomes uniform (the shared helper didn't have it; the deck-preview family did).
If an existing test asserts the old double-extension output, update that expectation and say so in the commit message.

- [ ] **Step 1: Write the failing test**

```ts
// app/shared/utils/__tests__/cardImageUrl.test.ts
import { describe, it, expect } from "vitest";

// The helper reads NEXT_PUBLIC_BLOB_BASE_URL at module load — set it before the
// dynamic import below.
process.env.NEXT_PUBLIC_BLOB_BASE_URL = "https://blob.example.com";
const { getCardImageUrl, getCardImageUrlOrNull, sanitizeImgFile } = await import(
  "../cardImageUrl"
);

describe("sanitizeImgFile", () => {
  it("strips .jpg/.jpeg and maps slashes to underscores", () => {
    expect(sanitizeImgFile("Foo.jpg")).toBe("Foo");
    expect(sanitizeImgFile("Foo.JPEG")).toBe("Foo");
    expect(sanitizeImgFile("Good/Evil_Card")).toBe("Good_Evil_Card");
    expect(sanitizeImgFile("Plain")).toBe("Plain");
  });
});

describe("getCardImageUrl", () => {
  it("builds the blob URL", () => {
    expect(getCardImageUrl("Angel_of_God_(I)")).toBe(
      "https://blob.example.com/card-images/Angel_of_God_(I).jpg",
    );
  });
  it("strips a stored extension instead of doubling it", () => {
    expect(getCardImageUrl("snap.jpg")).toBe("https://blob.example.com/card-images/snap.jpg");
  });
  it("passes through leading-slash local assets and blanks forge refs", () => {
    expect(getCardImageUrl("/goldfish/back.png")).toBe("/goldfish/back.png");
    expect(getCardImageUrl("forge:abc")).toBe("");
    expect(getCardImageUrl("")).toBe("");
  });
});

describe("getCardImageUrlOrNull", () => {
  it("nulls on nullish input, mirrors getCardImageUrl otherwise", () => {
    expect(getCardImageUrlOrNull(null)).toBeNull();
    expect(getCardImageUrlOrNull(undefined)).toBeNull();
    expect(getCardImageUrlOrNull("snap.jpg")).toBe(
      "https://blob.example.com/card-images/snap.jpg",
    );
  });
});
```

- [ ] **Step 2: Run it — expect the slash-mapping case to FAIL** (current `sanitizeImgFile` only strips extensions)

```bash
npx vitest run app/shared/utils/__tests__/cardImageUrl.test.ts
```

- [ ] **Step 3: Update the shared helper**

In `app/shared/utils/cardImageUrl.ts` replace `sanitizeImgFile`:

```ts
/** Strip trailing .jpg / .jpeg and map path-breaking slashes, so we can append
 *  a canonical extension. Slash→underscore matches how the legacy deck-preview
 *  builders (and the blob store's actual filenames) always treated slashes. */
export function sanitizeImgFile(f: string): string {
  return f.replace(/\//g, "_").replace(/\.jpe?g$/i, "");
}
```

(The leading-`/` local-asset early-returns in both functions run BEFORE sanitize, so local assets are unaffected.)

- [ ] **Step 4: Run the test — PASS**

- [ ] **Step 5: Delegate `useCardImageUrl.ts`**

Replace the entire body of `app/decklist/card-search/hooks/useCardImageUrl.ts` with:

```ts
/**
 * Card image URLs for the deck builder. Now a thin wrapper over the shared
 * helper (app/shared/utils/cardImageUrl.ts) so cache-busting and path rules
 * live in exactly one place. The old STRATEGY switch is gone — 'blob' was the
 * only live branch.
 */
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";

export function getPublicImageUrl(imgFile: string): string {
  return getCardImageUrl(imgFile);
}

export function useCardImageUrl() {
  return { getImageUrl: getPublicImageUrl, strategy: "blob" as const };
}
```

Then `grep -rn "strategy" app/decklist/card-search --include="*.tsx" --include="*.ts" | grep -i cardimage` — if any caller branches on `strategy` values other than `'blob'`, stop and re-read it (none expected; the const was already narrowed).

- [ ] **Step 6: Replace the four local copies**

`app/play/components/CardPreviewSystem.tsx` — delete the local `BLOB_BASE_URL`, `sanitizeImgFile`, `getCardImageUrl` (lines ~6-17); add `import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';`. (The local copy lacked the `forge:` blank — the shared one blanks forge refs, which is correct: play previews resolve forge art elsewhere.)

`app/decklist/my-decks/QuickLookModal.tsx` and `app/decklist/my-decks/client.tsx` — delete each local `getCardImageUrl` (the nullable `cardName`-parameter flavor); add `import { getCardImageUrlOrNull } from "@/app/shared/utils/cardImageUrl";` and rename the call sites `getCardImageUrl(` → `getCardImageUrlOrNull(`. Verify with:

```bash
grep -n "getCardImageUrl" app/decklist/my-decks/QuickLookModal.tsx app/decklist/my-decks/client.tsx
```
Every remaining hit must be `getCardImageUrlOrNull` calls or the import line.

- [ ] **Step 7: Replace the inline literals**

`app/admin/cards/page.tsx` — in `CardImagePreview` (~line 94) and `CardHoverPreview` (~line 120) replace

```ts
const imageUrl = `${process.env.NEXT_PUBLIC_BLOB_BASE_URL}/card-images/${imgFile}.jpg`;
```
with
```ts
const imageUrl = getCardImageUrl(imgFile);
```
(second site uses `card.imgFile`), adding `import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";`.

`app/admin/rulings/page.tsx` (~line 338): same replacement for `card.imgFile`.

- [ ] **Step 8: Delegate `lib/card-images.ts`**

Replace the file's entire content:

```ts
// Thin delegate kept for existing import paths (play lobby / deck picker).
// Canonical implementation: app/shared/utils/cardImageUrl.ts.
export { getCardImageUrlOrNull as getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
```

Then check its consumers still type-check (`app/play/components/GameLobby.tsx`, `app/play/components/DeckPickerCard.tsx` — signature `(string | null | undefined) => string | null` is unchanged).

- [ ] **Step 9: Sweep for stragglers**

```bash
grep -rn "card-images/" app components lib utils --include="*.ts" --include="*.tsx" \
  | grep -v "shared/utils/cardImageUrl" | grep -v "__tests__" \
  | grep -v "api/sync-card-images" | grep -v "app/api/card-image"
```
Expected: only server-side non-display consumers (e.g. `app/forge/api/promote/bundle/[releaseId]/route.ts`, `app/forge/lib/promote.ts` blob-path строки, shopify import via the helper) — anything else building a **display** URL by hand gets the same treatment as Step 7.

- [ ] **Step 10: Full test run + typecheck**

```bash
npx vitest run && npx tsc --noEmit
```
Expected: all green (tsc: only the 7 pre-existing main-branch errors). Fix any test that asserted the old double-extension bug (update expectation, note in commit).

- [ ] **Step 11: Commit**

```bash
git add app/shared/utils/cardImageUrl.ts app/shared/utils/__tests__/cardImageUrl.test.ts \
  app/decklist/card-search/hooks/useCardImageUrl.ts app/play/components/CardPreviewSystem.tsx \
  app/decklist/my-decks/QuickLookModal.tsx app/decklist/my-decks/client.tsx \
  app/admin/cards/page.tsx app/admin/rulings/page.tsx lib/card-images.ts
git commit -m "refactor(images): consolidate six card-image URL builders onto the shared helper

Prereq for catalog-editor cache-busting (spec F1). Uniform extension-strip
and slash mapping; deletes four local copies and two inline literals.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 092 + anon-leak coverage (spec §4)

**Files:**
- Create: `supabase/migrations/092_card_overrides.sql`
- Modify: `__tests__/superuser-anon-leak.test.ts`

**Interfaces:**
- Produces (DB): `public.card_overrides (id, card_name, set_code, fields jsonb, note, updated_by, created_at, updated_at, unique(card_name,set_code))`; `public.card_image_versions (img_file pk, version int, note, updated_by, updated_at)`. All access superuser-only via RLS; writes from server actions/routes use the user's session (no definer RPCs).

- [ ] **Step 1: Write the migration**

```sql
-- 092_card_overrides.sql
-- Catalog admin editor (docs/superpowers/specs/2026-08-23-catalog-admin-editor-design.md).
-- Two tables because cards and images are different resources: ~151 imgFiles
-- serve 2+ catalog cards (Limited/Unlimited pairs share art), so image versions
-- key on img_file — a per-card version was shown to produce non-monotonic ?v=
-- regressions and archive clobbering (spec F2).
--
-- No definer RPCs: single-admin tables with no cross-row invariants. The one
-- atomic need (version bump) is handled by a compare-and-set UPDATE from the
-- route. SCHEMA ONLY — no data.

create table if not exists public.card_overrides (
  id           uuid primary key default gen_random_uuid(),
  card_name    text not null,   -- catalog identity, matched byte-for-byte
  set_code     text not null,   --   against CardData name|set (strict lookup, spec F3)
  fields       jsonb not null default '{}'::jsonb,  -- SPARSE: only changed fields
  note         text not null,
  updated_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (card_name, set_code)
);

create table if not exists public.card_image_versions (
  img_file     text primary key,  -- the blob's identity (card-images/<img_file>.jpg)
  version      int  not null,     -- monotonic; bumped via CAS from the image route
  note         text,
  updated_by   uuid not null references auth.users(id),
  updated_at   timestamptz not null default now()
);

alter table public.card_overrides      enable row level security;
alter table public.card_image_versions enable row level security;

drop policy if exists "card_overrides_superuser" on public.card_overrides;
create policy "card_overrides_superuser" on public.card_overrides
  for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

drop policy if exists "card_image_versions_superuser" on public.card_image_versions;
create policy "card_image_versions_superuser" on public.card_image_versions
  for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

revoke all on public.card_overrides      from anon;
revoke all on public.card_image_versions from anon;
grant select, insert, update, delete on public.card_overrides      to authenticated;
grant select, insert, update, delete on public.card_image_versions to authenticated;
```

- [ ] **Step 2: Extend the anon-leak suite**

Append inside the existing `describe.runIf(ENABLED)` block of `__tests__/superuser-anon-leak.test.ts`:

```ts
  // Catalog editor tables (migration 092): superuser-only via RLS + anon revoke.
  for (const table of ["card_overrides", "card_image_versions"] as const) {
    it(`anon sees zero rows in ${table}`, async () => {
      const { data, error } = await anonClient().from(table).select("*").limit(1000);
      const rows = data ?? [];
      expect(
        rows.length,
        `anon leaked ${rows.length} row(s) from ${table} (error: ${error?.message ?? "none"})`
      ).toBe(0);
    });

    it(`anon cannot write to ${table}`, async () => {
      const { error } = await anonClient()
        .from(table)
        .insert(
          table === "card_overrides"
            ? { card_name: "x", set_code: "x", fields: {}, note: "x", updated_by: "00000000-0000-0000-0000-000000000000" }
            : { img_file: "x", version: 1, updated_by: "00000000-0000-0000-0000-000000000000" }
        );
      expect(error, `anon was able to insert into ${table}`).not.toBeNull();
    });
  }
```

- [ ] **Step 3: Verify the suite still skips hermetically and the SQL parses**

```bash
npx vitest run __tests__/superuser-anon-leak.test.ts      # skipped (no FORGE_LEAK_TEST) — must not error
```
The live run (`npm run test:security`) only passes **after 092 is applied at merge time** — note this in the PR body, don't run it now.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/092_card_overrides.sql __tests__/superuser-anon-leak.test.ts
git commit -m "feat(catalog): migration 092 — card_overrides + card_image_versions, superuser-only RLS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The overlay patch module (spec §5.2, F5/F12)

**Files:**
- Create: `scripts/lib/applyCardOverrides.js` (CJS)
- Create: `scripts/lib/applyCardOverrides.d.ts` (so `tsc --noEmit` and TS imports type it without `allowJs`)
- Test: `scripts/lib/__tests__/applyCardOverrides.test.ts`

**Interfaces:**
- Produces: `applyCardOverrides(cards, overlay) → { errors: string[], warnings: string[] }` — mutates `cards` rows in place (parse-carddata style). `EDITABLE_FIELDS: string[]`, `IDENTITY_FIELDS: string[]`. Consumed by Task 4 (parse-carddata) and the Task 6 drift-guard test.

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/lib/__tests__/applyCardOverrides.test.ts
import { describe, it, expect } from "vitest";
import { applyCardOverrides, EDITABLE_FIELDS, IDENTITY_FIELDS } from "../applyCardOverrides";

const card = (over: Record<string, string> = {}) => ({
  name: "Angel of God", set: "I", imgFile: "Angel_of_God_(I)", officialSet: "Prophets",
  type: "Hero", brigade: "Silver", strength: "10", toughness: "10", class: "",
  identifier: "", specialAbility: "Protect.", rarity: "Rare", reference: "Gen 1:1",
  alignment: "Good", legality: "Rotation", ...over,
});

describe("applyCardOverrides", () => {
  it("patches only the listed fields, in place", () => {
    const c = card();
    const r = applyCardOverrides([c], {
      overrides: [{ name: "Angel of God", set: "I", fields: { legality: "Banned" }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors).toEqual([]);
    expect(c.legality).toBe("Banned");
    expect(c.specialAbility).toBe("Protect."); // untouched fields flow through
  });

  it("errors on an orphan override (no catalog match) and names the recovery path", () => {
    const r = applyCardOverrides([card()], {
      overrides: [{ name: "Nope", set: "I", fields: { type: "Hero" }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("Nope|I");
    expect(r.errors[0]).toContain("/admin/catalog");
  });

  it("errors when the name|set key matches more than one row (shadowed rows patch as silent no-ops otherwise)", () => {
    const r = applyCardOverrides([card(), card()], {
      overrides: [{ name: "Angel of God", set: "I", fields: { type: "Hero" }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors.some((e) => e.includes("more than one"))).toBe(true);
  });

  it("errors on identity fields, unknown fields, and non-string values", () => {
    const r = applyCardOverrides([card()], {
      overrides: [{ name: "Angel of God", set: "I", fields: { imgFile: "x", bogus: "y", strength: 5 as unknown as string }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors).toHaveLength(3);
  });

  it("warns (does not error) when the base already equals the override — the retire signal", () => {
    const c = card();
    const r = applyCardOverrides([c], {
      overrides: [{ name: "Angel of God", set: "I", fields: { legality: "Rotation" }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes("retiring"))).toBe(true);
    expect(c.legality).toBe("Rotation");
  });

  it("errors on a stranded image version (no card uses the imgFile) — spec F5", () => {
    const r = applyCardOverrides([card()], {
      overrides: [],
      imageVersions: { Ghost_Image: 2 },
    });
    expect(r.errors.some((e) => e.includes("Ghost_Image"))).toBe(true);
  });

  it("errors on a non-positive-integer image version; passes a valid one", () => {
    const bad = applyCardOverrides([card()], { overrides: [], imageVersions: { "Angel_of_God_(I)": 0 } });
    expect(bad.errors).toHaveLength(1);
    const good = applyCardOverrides([card()], { overrides: [], imageVersions: { "Angel_of_God_(I)": 3 } });
    expect(good.errors).toEqual([]);
  });

  it("tolerates an empty/absent overlay", () => {
    expect(applyCardOverrides([card()], { overrides: [], imageVersions: {} }).errors).toEqual([]);
    expect(applyCardOverrides([card()], {}).errors).toEqual([]);
  });

  it("field constants: 12 editable + 3 identity, disjoint", () => {
    expect(EDITABLE_FIELDS).toHaveLength(12);
    expect(IDENTITY_FIELDS).toEqual(["name", "set", "imgFile"]);
    expect(EDITABLE_FIELDS.some((f: string) => IDENTITY_FIELDS.includes(f))).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL (module missing)**

```bash
npx vitest run scripts/lib/__tests__/applyCardOverrides.test.ts
```

- [ ] **Step 3: Implement**

```js
// scripts/lib/applyCardOverrides.js
// Applies the card-overrides overlay (scripts/data/card-overrides.json) to the
// merged catalog rows. Overrides win over upstream AND forge-released rows —
// applied last in parse-carddata.js. Mutates rows in place; the caller decides
// exit behavior from the returned errors/warnings.
//
// The overlay is DB-shaped data, not trusted input: unknown keys, identity
// keys, ambiguous matches and stranded image versions are hard errors here so
// a bad pull can never silently corrupt the generated catalog.

const EDITABLE_FIELDS = [
  'officialSet', 'type', 'brigade', 'strength', 'toughness', 'class',
  'identifier', 'specialAbility', 'rarity', 'reference', 'alignment', 'legality',
];
const IDENTITY_FIELDS = ['name', 'set', 'imgFile'];

function applyCardOverrides(cards, overlay) {
  const errors = [];
  const warnings = [];
  const overrides = Array.isArray(overlay && overlay.overrides) ? overlay.overrides : [];
  const imageVersions =
    overlay && overlay.imageVersions && typeof overlay.imageVersions === 'object'
      ? overlay.imageVersions
      : {};

  // name|set → row, with duplicate keys poisoned: the catalog tolerates
  // last-wins collisions (lib/cards/lookup.ts), so nothing else guarantees
  // uniqueness, and patching a shadowed row would be a silent no-op.
  const DUP = Symbol('dup');
  const byKey = new Map();
  for (const c of cards) {
    const k = `${c.name}|${c.set}`;
    byKey.set(k, byKey.has(k) ? DUP : c);
  }

  for (const o of overrides) {
    const key = `${o.name}|${o.set}`;
    const row = byKey.get(key);
    if (!row) {
      errors.push(
        `orphan override: no catalog card matches "${key}" — the catalog changed underneath it; ` +
          `fix or delete the override in /admin/catalog, then re-run make pull-card-overrides`
      );
      continue;
    }
    if (row === DUP) {
      errors.push(`ambiguous override: "${key}" matches more than one catalog row — cannot patch safely`);
      continue;
    }
    const fields = o.fields || {};
    for (const [field, value] of Object.entries(fields)) {
      if (IDENTITY_FIELDS.includes(field)) {
        errors.push(`override for "${key}" touches identity field "${field}" — identity is immutable`);
        continue;
      }
      if (!EDITABLE_FIELDS.includes(field)) {
        errors.push(`override for "${key}" has unknown field "${field}"`);
        continue;
      }
      if (typeof value !== 'string') {
        errors.push(`override for "${key}" field "${field}" is not a string`);
        continue;
      }
      if (row[field] === value) {
        warnings.push(
          `override absorbed: "${key}" ${field} already equals ${JSON.stringify(value)} in the base data — consider retiring it`
        );
      }
      row[field] = value;
    }
  }

  const liveImgFiles = new Set(cards.map((c) => c.imgFile));
  for (const [imgFile, version] of Object.entries(imageVersions)) {
    if (!Number.isInteger(version) || version < 1) {
      errors.push(`image version for "${imgFile}" must be a positive integer (got ${JSON.stringify(version)})`);
      continue;
    }
    if (!liveImgFiles.has(imgFile)) {
      errors.push(
        `stranded image version: no catalog card uses imgFile "${imgFile}" — upstream likely renamed the ` +
          `image file (art silently reverts, spec F5); re-replace the art under the new imgFile and delete this entry`
      );
    }
  }

  return { errors, warnings };
}

module.exports = { applyCardOverrides, EDITABLE_FIELDS, IDENTITY_FIELDS };
```

```ts
// scripts/lib/applyCardOverrides.d.ts
export declare const EDITABLE_FIELDS: string[];
export declare const IDENTITY_FIELDS: string[];
export declare function applyCardOverrides(
  cards: Array<Record<string, string>>,
  overlay: { overrides?: Array<{ name: string; set: string; fields?: Record<string, unknown>; note?: string }>; imageVersions?: Record<string, number> } | Record<string, never>,
): { errors: string[]; warnings: string[] };
```

- [ ] **Step 4: Run — PASS.** Also `npx tsc --noEmit` (the `.d.ts` must satisfy the test's typed import).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/applyCardOverrides.js scripts/lib/applyCardOverrides.d.ts scripts/lib/__tests__/applyCardOverrides.test.ts
git commit -m "feat(catalog): overlay patch module — orphan/ambiguity/identity guards, retire warnings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: parse-carddata integration — overrides hook, AB-pairing guard, imgVersions emission (spec §5.2, §5.3, F6)

**Files:**
- Create: `scripts/data/card-overrides.json` (committed scaffold: `{"overrides": [], "imageVersions": {}}`)
- Modify: `scripts/parse-carddata.js`
- Create (generated, committed): `lib/cards/generated/imgVersions.json` (`{}` initially)

**Interfaces:**
- Consumes: `applyCardOverrides` from Task 3.
- Produces: `lib/cards/generated/imgVersions.json` (map `imgFile → version`) — consumed by Task 6's helper. The overlay file format `{overrides: [{name,set,fields,note}], imageVersions: {imgFile: n}}` — produced by Task 5's pull script.

No vitest here (parse-carddata is a script; the patch logic is already unit-tested) — verification is behavioral, Step 4.

- [ ] **Step 1: Create the scaffold overlay**

```bash
printf '{\n  "overrides": [],\n  "imageVersions": {}\n}\n' > scripts/data/card-overrides.json
```
(Committed so the Task 8/11 bundled import never dangles; parse-carddata also tolerates the file being absent.)

- [ ] **Step 2: Add requires + the overrides application to `scripts/parse-carddata.js`**

At the top, after the existing path consts (`forgeReleasedPath` line ~20):

```js
const cardOverridesPath = path.join(__dirname, 'data/card-overrides.json');
const imgVersionsPath = path.join(__dirname, '../lib/cards/generated/imgVersions.json');
const { applyCardOverrides } = require('./lib/applyCardOverrides');
```

Immediately **after** the forge-released overlay block closes (after the `🔥 … appended` log, ~line 130) and **before** the "Diff summary against previous generated data" section, insert:

```js
// ---- Card-override overlay (catalog admin editor) --------------------------
// Superuser metadata edits ride scripts/data/card-overrides.json (synced by
// `make pull-card-overrides`) and are applied LAST — they win over upstream AND
// forge-released rows. Validation lives in scripts/lib/applyCardOverrides.js;
// any error there (orphan, ambiguity, unknown/identity field, stranded image
// version) is a hard exit so a bad pull can never silently corrupt the catalog.
let overridesOverlay = { overrides: [], imageVersions: {} };
if (fs.existsSync(cardOverridesPath)) {
  try {
    overridesOverlay = JSON.parse(fs.readFileSync(cardOverridesPath, 'utf-8'));
  } catch (e) {
    console.error(`❌ Failed to read ${cardOverridesPath}: ${e.message}`);
    process.exit(1);
  }
}
const overrideCount = (overridesOverlay.overrides || []).length;
// Pristine copy for the AB-pairing guard below: pairing derives from editable
// fields (reference + stats), so we must prove the patch didn't re-pair anything.
const cardsPrePatch = overrideCount > 0 ? cards.map((c) => ({ ...c })) : null;
{
  const { errors, warnings } = applyCardOverrides(cards, overridesOverlay);
  for (const w of warnings) console.log(`♻️  ${w}`);
  if (errors.length > 0) {
    console.error(
      `❌ card-overrides.json failed validation:\n` + errors.map((e) => `   - ${e}`).join('\n')
    );
    process.exit(1);
  }
}
if (overrideCount > 0) console.log(`✏️  ${overrideCount} card override(s) applied`);
```

- [ ] **Step 3: Extract `deriveAbMap` and add the pairing guard**

In the AB section, the current inline derivation (~lines 224-241: `const abCards = …` / `const candidatesByFamily = …` / `const abMap = {}; for (const ab of abCards) { … }`) becomes:

```js
function deriveAbMap(cardList) {
  const abList = cardList.filter(isAbCard);
  const byFamily = new Map();
  for (const c of cardList) {
    if (isAbCard(c)) continue;
    const fam = familyOf(c.set);
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam).push(c);
  }
  const map = {}; // { "<ab name>|<ab set>": "<original name>|<original set>" }
  for (const ab of abList) {
    const cands = byFamily.get(familyOf(ab.set)) || [];
    const match =
      pickCandidate(cands, (c) => normName(c.name), normName(ab.name), ab) ||
      pickCandidate(cands, (c) => normRef(c.reference), normRef(ab.reference), ab);
    if (match) map[keyOf(ab)] = keyOf(match);
  }
  return map;
}

const abCards = cards.filter(isAbCard); // the assertions below still use this
const abMap = deriveAbMap(cards);

// Guard (spec F6): an override to reference/stat fields can silently re-pair an
// AB card while the map stays complete and 1:1 — the existing assertions can't
// see it. Intentional re-pairing goes through data/ab-overrides.json instead.
if (cardsPrePatch) {
  const abMapBefore = deriveAbMap(cardsPrePatch);
  const allKeys = new Set([...Object.keys(abMapBefore), ...Object.keys(abMap)]);
  const changed = [...allKeys].filter((k) => abMapBefore[k] !== abMap[k]);
  if (changed.length > 0) {
    console.error(
      `❌ card override(s) changed AB→original pairing:\n` +
        changed.map((k) => `   - ${k}: ${abMapBefore[k] ?? '(none)'} → ${abMap[k] ?? '(none)'}`).join('\n') +
        `\nIf intentional, pin the pairing in ${path.relative(process.cwd(), abOverridesPath)}.`
    );
    process.exit(1);
  }
}
```

The existing manual `abOverridesPath` application and both assertions stay exactly where they are, operating on `abMap`.

- [ ] **Step 4: Emit `imgVersions.json`**

Next to the `abMapPath` write (~line 220), add:

```js
// Image cache-bust versions (catalog editor image replacements). Consumed by
// app/shared/utils/cardImageUrl.ts, which appends ?v=<n>. Always written —
// {} when no image has ever been replaced.
const imgVersionsOut = {};
for (const k of Object.keys(overridesOverlay.imageVersions || {}).sort()) {
  imgVersionsOut[k] = overridesOverlay.imageVersions[k];
}
fs.writeFileSync(imgVersionsPath, JSON.stringify(imgVersionsOut, null, 2) + '\n');
console.log(`🖼️  ${path.relative(process.cwd(), imgVersionsPath)} — ${Object.keys(imgVersionsOut).length} versioned image(s)`);
```

- [ ] **Step 5: Behavioral verification (all modes)**

```bash
# a) No-op mode: scaffold overlay → generated output must be byte-identical
node scripts/parse-carddata.js
git status --short lib/cards/generated/   # ONLY the new imgVersions.json ({}) may appear
git diff --stat lib/cards/generated/cardData.json lib/cards/generated/cardData.ts lib/cards/generated/abMap.json  # empty

# b) Patch mode: pick a real card key from cardData.json, temp-edit the overlay
node -e "const c=require('./lib/cards/generated/cardData.json')[0]; console.log(JSON.stringify({name:c.name,set:c.set,legality:c.legality}))"
#   → write {"overrides":[{"name":"<that name>","set":"<that set>","fields":{"legality":"ZZTest"},"note":"t"}],"imageVersions":{}}
node scripts/parse-carddata.js            # expect: "✏️ 1 card override(s) applied"
node -e "const c=require('./lib/cards/generated/cardData.json').find(x=>x.name==='<that name>'&&x.set==='<that set>');console.log(c.legality)"  # ZZTest

# c) Absorbed mode: set the override value to the card's REAL legality → expect ♻️ retire warning, exit 0
# d) Orphan mode: name "No Such Card" → expect ❌ + exit 1
# e) Stranded image: {"imageVersions":{"No_Such_Img":1}} → expect ❌ + exit 1

# Restore and prove byte-identical:
printf '{\n  "overrides": [],\n  "imageVersions": {}\n}\n' > scripts/data/card-overrides.json
node scripts/parse-carddata.js
git diff --stat lib/cards/generated/      # only imgVersions.json as a NEW file, content {}
```

- [ ] **Step 6: Commit** (generated file included — it's a committed artifact like `cardData.json`)

```bash
git add scripts/parse-carddata.js scripts/data/card-overrides.json lib/cards/generated/imgVersions.json
git commit -m "feat(catalog): parse-carddata applies the card-overrides overlay last; AB-pairing guard; imgVersions.json

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Pull script + makefile target (spec §5.1)

**Files:**
- Create: `scripts/pull-card-overrides.js`
- Modify: `makefile` (help line ~38, new target after `pull-forge-releases` ~line 113, `.PHONY`)

**Interfaces:**
- Consumes (DB): `card_overrides`, `card_image_versions` (Task 2).
- Produces: `scripts/data/card-overrides.json` in the Task 4 format, then chains `parse-carddata.js`.

- [ ] **Step 1: Write the script** (mirror of `pull-forge-releases.js` — same env handling, same chaining)

```js
#!/usr/bin/env node

/**
 * Sync catalog admin edits from Supabase into scripts/data/card-overrides.json,
 * then regenerate the card catalog (parse-carddata.js applies the overrides
 * LAST, winning over upstream and forge-released rows).
 *
 * Usage:
 *   node scripts/pull-card-overrides.js
 *   OR
 *   make pull-card-overrides
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Worktree caveat: .env.local is gitignored and does not follow `git worktree add`
 * — run from the main checkout or copy the file first.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const { createClient } = require('@supabase/supabase-js');

const outPath = path.join(__dirname, 'data/card-overrides.json');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      '❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing. ' +
        'Run from the main checkout (worktrees do not carry .env.local).'
    );
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { data: overrideRows, error: ovErr } = await supabase
    .from('card_overrides')
    .select('card_name, set_code, fields, note')
    .order('card_name', { ascending: true });
  if (ovErr) {
    console.error(`❌ Could not read card_overrides: ${ovErr.message}`);
    process.exit(1);
  }

  const { data: imageRows, error: imgErr } = await supabase
    .from('card_image_versions')
    .select('img_file, version')
    .order('img_file', { ascending: true });
  if (imgErr) {
    console.error(`❌ Could not read card_image_versions: ${imgErr.message}`);
    process.exit(1);
  }

  const overrides = (overrideRows ?? [])
    .map((r) => ({ name: r.card_name, set: r.set_code, fields: r.fields ?? {}, note: r.note ?? '' }))
    .sort((a, b) => `${a.name}|${a.set}`.localeCompare(`${b.name}|${b.set}`));

  const imageVersions = {};
  for (const r of imageRows ?? []) imageVersions[r.img_file] = r.version;

  fs.writeFileSync(outPath, JSON.stringify({ overrides, imageVersions }, null, 2) + '\n');
  console.log(
    `✅ Wrote ${path.relative(process.cwd(), outPath)} — ${overrides.length} override(s), ` +
      `${Object.keys(imageVersions).length} image version(s)`
  );

  execFileSync('node', [path.join(__dirname, 'parse-carddata.js')], { stdio: 'inherit' });
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: makefile** — add to the help block (after the `pull-forge-releases` echo, line ~38):

```make
	@echo "  make pull-card-overrides - Sync catalog admin edits into the overlay"
```

after the `pull-forge-releases` target (~line 113):

```make
# Sync catalog admin edits (card_overrides + card_image_versions) into the
# overlay + regenerate the catalog. Needs .env.local (service key).
pull-card-overrides:
	@echo "📥 Syncing card overrides from Supabase..."
	@node scripts/pull-card-overrides.js
```

and append `pull-card-overrides` to the `.PHONY` line.

- [ ] **Step 3: Verify** — the tables don't exist in prod yet (092 unapplied), so a live run must fail *gracefully*:

```bash
node scripts/pull-card-overrides.js
```
Expected: `❌ Could not read card_overrides: …` and exit 1 (relation missing) — proves env wiring and error path. `make -n pull-card-overrides` prints the recipe.

- [ ] **Step 4: Commit**

```bash
git add scripts/pull-card-overrides.js makefile
git commit -m "feat(catalog): make pull-card-overrides — sync editor tables into the overlay

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `?v=` cache-busting in the shared helper (spec §5.3, F13)

**Files:**
- Modify: `app/shared/utils/cardImageUrl.ts`
- Modify: `app/shared/utils/__tests__/cardImageUrl.test.ts`

**Interfaces:**
- Consumes: `lib/cards/generated/imgVersions.json` (Task 4).
- Produces: both helpers append `?v=<n>` when the **sanitized** imgFile has an entry. Every consumer from Task 1 inherits this automatically.

- [ ] **Step 1: Add failing tests** (mock the generated map — the real one is `{}`)

```ts
// Append to app/shared/utils/__tests__/cardImageUrl.test.ts
import { vi } from "vitest";

describe("image version cache-busting", () => {
  it("appends ?v= for a versioned image, keyed on the SANITIZED imgFile", async () => {
    vi.resetModules();
    vi.doMock("@/lib/cards/generated/imgVersions.json", () => ({
      default: { "Angel_of_God_(I)": 3 },
    }));
    const mod = await import("../cardImageUrl");
    expect(mod.getCardImageUrl("Angel_of_God_(I)")).toBe(
      "https://blob.example.com/card-images/Angel_of_God_(I).jpg?v=3",
    );
    // deck-stored values carry extensions — the map hit must survive that (F13)
    expect(mod.getCardImageUrlOrNull("Angel_of_God_(I).jpg")).toBe(
      "https://blob.example.com/card-images/Angel_of_God_(I).jpg?v=3",
    );
    expect(mod.getCardImageUrl("Unversioned_(X)")).toBe(
      "https://blob.example.com/card-images/Unversioned_(X).jpg",
    );
    vi.doUnmock("@/lib/cards/generated/imgVersions.json");
  });
});
```

- [ ] **Step 2: Run — FAIL** (`?v=3` missing)

- [ ] **Step 3: Implement** — in `app/shared/utils/cardImageUrl.ts`:

```ts
import imgVersions from "@/lib/cards/generated/imgVersions.json";

// imgFile → replacement version (catalog editor). Keyed on SANITIZED names;
// non-empty entries append ?v= so a deploy busts every cached replaced image.
const IMG_VERSIONS = imgVersions as Record<string, number>;

function versionSuffix(sanitized: string): string {
  const v = IMG_VERSIONS[sanitized];
  return v ? `?v=${v}` : "";
}
```

and change both return statements' blob branches to:

```ts
  const sanitized = sanitizeImgFile(imgFile);
  return `${BLOB_BASE_URL}/card-images/${sanitized}.jpg${versionSuffix(sanitized)}`;
```

- [ ] **Step 4: Run the file's tests + full suite + tsc — PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/shared/utils/cardImageUrl.ts app/shared/utils/__tests__/cardImageUrl.test.ts
git commit -m "feat(catalog): ?v= cache-busting from generated imgVersions map

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Pure editor logic — field validation + pending diff (spec §4, §7, F4/F9/F10)

**Files:**
- Create: `app/admin/catalog/lib/editorShared.ts` (client-safe constants + types)
- Create: `app/admin/catalog/lib/validateOverride.ts`
- Create: `app/admin/catalog/lib/pendingDiff.ts`
- Test: `app/admin/catalog/lib/__tests__/validateOverride.test.ts`
- Test: `app/admin/catalog/lib/__tests__/pendingDiff.test.ts`

**Interfaces:**
- Produces:
  - `EDITABLE_FIELDS: readonly string[]` and `findCardStrict(name: string, set: string): CardData | null` from `editorShared.ts`
  - `validateOverrideFields(input: Record<string, unknown>): { ok: true; fields: Record<string, string> } | { ok: false; error: string }`
  - `diffPending(db: DbState, bundled: BundledOverlay): PendingItem[]` where `DbState = { overrides: Array<{ card_name: string; set_code: string; fields: Record<string, string> }>; imageVersions: Record<string, number> }`, `BundledOverlay = { overrides: Array<{ name: string; set: string; fields: Record<string, string> }>; imageVersions: Record<string, number> }`, `PendingItem = { kind: "override-new" | "override-changed" | "override-removed" | "image-bump"; key: string; detail: string }`
- Consumed by Tasks 8 (actions), 9 (route), 10/11 (client).

- [ ] **Step 1: `editorShared.ts`**

```ts
// Client-safe constants for the catalog editor. The scripts-side twin is
// scripts/lib/applyCardOverrides.js — a drift-guard test pins them together.
import { findCard, type CardData } from "@/lib/cards/lookup";

export const EDITABLE_FIELDS = [
  "officialSet", "type", "brigade", "strength", "toughness", "class",
  "identifier", "specialAbility", "rarity", "reference", "alignment", "legality",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const IDENTITY_FIELDS = ["name", "set", "imgFile"] as const;

/**
 * Strict catalog lookup. findCard falls back to name-only and lowercased
 * matches — good for deck resolution, WRONG for admin writes (a typo'd set
 * would edit a different print; promote's verify-live documents the trap).
 */
export function findCardStrict(name: string, set: string): CardData | null {
  const card = findCard(name, set);
  return card && card.name === name && card.set === set ? card : null;
}
```

- [ ] **Step 2: Failing tests for `validateOverrideFields`**

```ts
// app/admin/catalog/lib/__tests__/validateOverride.test.ts
import { describe, it, expect } from "vitest";
import { validateOverrideFields } from "../validateOverride";
import { CARDS } from "@/lib/cards/lookup";
import { EDITABLE_FIELDS } from "../editorShared";
// Drift guard (spec §5.2/F12): the scripts-side field list must match exactly.
import { EDITABLE_FIELDS as SCRIPT_FIELDS, IDENTITY_FIELDS as SCRIPT_IDENTITY } from "@/scripts/lib/applyCardOverrides";

describe("field-list drift guard", () => {
  it("app and scripts agree on editable + identity fields", () => {
    expect([...EDITABLE_FIELDS]).toEqual(SCRIPT_FIELDS);
    expect(SCRIPT_IDENTITY).toEqual(["name", "set", "imgFile"]);
  });
});

describe("validateOverrideFields", () => {
  it("accepts known fields, trims, and strips control characters", () => {
    const r = validateOverrideFields({ specialAbility: "  Protect.\tAll.\n " });
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.fields.specialAbility).toBe("Protect.All.");
  });

  it("rejects identity fields, unknown fields, and non-strings", () => {
    expect(validateOverrideFields({ name: "X" }).ok).toBe(false);
    expect(validateOverrideFields({ bogus: "X" }).ok).toBe(false);
    expect(validateOverrideFields({ strength: 5 }).ok).toBe(false);
  });

  it("enum-checks legality and alignment against values present in CARDS (F10)", () => {
    const legality = CARDS.find((c) => c.legality === "Rotation")!.legality;
    expect(validateOverrideFields({ legality }).ok).toBe(true);
    expect(validateOverrideFields({ legality: "Rotaton" }).ok).toBe(false);
    expect(validateOverrideFields({ alignment: "NeitherGoodNorEvil" }).ok).toBe(false);
  });

  it("accepts a value equal to a live value — no no-op rejection (F9)", () => {
    const card = CARDS[0];
    const r = validateOverrideFields({ type: card.type });
    expect(r.ok).toBe(true);
  });

  it("caps total size at 16KB", () => {
    expect(validateOverrideFields({ specialAbility: "x".repeat(17000) }).ok).toBe(false);
  });

  it("allows explicit empty strings (clearing a field is a real override)", () => {
    const r = validateOverrideFields({ strength: "" });
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.fields.strength).toBe("");
  });
});
```

- [ ] **Step 3: Implement `validateOverride.ts`**

```ts
import { CARDS } from "@/lib/cards/lookup";
import { EDITABLE_FIELDS, IDENTITY_FIELDS, type EditableField } from "./editorShared";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g; // TSV-inexpressible; untested downstream
const MAX_FIELDS_BYTES = 16 * 1024;

// Enum sets built lazily from the catalog itself: the legal values are exactly
// the values the data already uses (upstream is the authority, not a hardcoded list).
let enumSets: { legality: Set<string>; alignment: Set<string> } | null = null;
function getEnumSets() {
  if (!enumSets) {
    enumSets = { legality: new Set<string>(), alignment: new Set<string>() };
    for (const c of CARDS) {
      enumSets.legality.add(c.legality);
      enumSets.alignment.add(c.alignment);
    }
  }
  return enumSets;
}

export function validateOverrideFields(
  input: Record<string, unknown>,
): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  const fields: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    if ((IDENTITY_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `"${key}" is an identity field and cannot be overridden` };
    }
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `Unknown field "${key}"` };
    }
    if (typeof raw !== "string") {
      return { ok: false, error: `Field "${key}" must be a string` };
    }
    const value = raw.replace(CONTROL_CHARS, "").trim();
    if (key === "legality" && value !== "" && !getEnumSets().legality.has(value)) {
      return { ok: false, error: `"${value}" is not a legality value used anywhere in the catalog` };
    }
    if (key === "alignment" && value !== "" && !getEnumSets().alignment.has(value)) {
      return { ok: false, error: `"${value}" is not an alignment value used anywhere in the catalog` };
    }
    fields[key as EditableField] = value;
  }
  if (JSON.stringify(fields).length > MAX_FIELDS_BYTES) {
    return { ok: false, error: "Override too large" };
  }
  return { ok: true, fields };
}
```

- [ ] **Step 4: Failing tests for `diffPending`**

```ts
// app/admin/catalog/lib/__tests__/pendingDiff.test.ts
import { describe, it, expect } from "vitest";
import { diffPending } from "../pendingDiff";

const bundled = {
  overrides: [{ name: "A", set: "S", fields: { legality: "Banned" } }],
  imageVersions: { Img_A: 1 },
};

describe("diffPending", () => {
  it("empty when DB matches the bundled overlay exactly", () => {
    const db = {
      overrides: [{ card_name: "A", set_code: "S", fields: { legality: "Banned" } }],
      imageVersions: { Img_A: 1 },
    };
    expect(diffPending(db, bundled)).toEqual([]);
  });

  it("flags a new override, a changed override, and an image bump", () => {
    const db = {
      overrides: [
        { card_name: "A", set_code: "S", fields: { legality: "Rotation" } }, // changed
        { card_name: "B", set_code: "S", fields: { type: "Hero" } },          // new
      ],
      imageVersions: { Img_A: 2 },                                            // bumped
    };
    const kinds = diffPending(db, bundled).map((i) => i.kind).sort();
    expect(kinds).toEqual(["image-bump", "override-changed", "override-new"]);
  });

  it("flags a DELETED override the bundled overlay still carries — the F4 state", () => {
    const db = { overrides: [], imageVersions: { Img_A: 1 } };
    const items = diffPending(db, bundled);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("override-removed");
    expect(items[0].key).toBe("A|S");
  });
});
```

- [ ] **Step 5: Implement `pendingDiff.ts`**

```ts
// Pending-deploy detection (spec §7, F4/F9): diff the LIVE tables against the
// BUNDLED committed overlay (what the running deploy was generated from) — in
// both directions, so deleted overrides that prod still serves are visible.
export type PendingItem = {
  kind: "override-new" | "override-changed" | "override-removed" | "image-bump";
  key: string;    // "name|set" or imgFile
  detail: string; // human line for the dashboard
};

export type DbState = {
  overrides: Array<{ card_name: string; set_code: string; fields: Record<string, string> }>;
  imageVersions: Record<string, number>;
};
export type BundledOverlay = {
  overrides: Array<{ name: string; set: string; fields: Record<string, string> }>;
  imageVersions: Record<string, number>;
};

const fieldsEqual = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export function diffPending(db: DbState, bundled: BundledOverlay): PendingItem[] {
  const items: PendingItem[] = [];
  const bundledByKey = new Map(bundled.overrides.map((o) => [`${o.name}|${o.set}`, o]));
  const dbKeys = new Set<string>();

  for (const row of db.overrides) {
    const key = `${row.card_name}|${row.set_code}`;
    dbKeys.add(key);
    const shipped = bundledByKey.get(key);
    if (!shipped) {
      items.push({ kind: "override-new", key, detail: `New override for ${key} — not yet deployed` });
    } else if (!fieldsEqual(row.fields, shipped.fields)) {
      items.push({ kind: "override-changed", key, detail: `Override for ${key} changed since the last deploy` });
    }
  }
  for (const [key] of bundledByKey) {
    if (!dbKeys.has(key)) {
      items.push({
        kind: "override-removed", key,
        detail: `Override for ${key} was deleted but the deployed catalog still serves it`,
      });
    }
  }
  for (const [img, v] of Object.entries(db.imageVersions)) {
    if ((bundled.imageVersions[img] ?? 0) < v) {
      items.push({ kind: "image-bump", key: img, detail: `Image ${img} replaced (v${v}) — cache-bust ships with the next deploy` });
    }
  }
  return items;
}
```

- [ ] **Step 6: Run both test files + tsc — PASS.** (`@/scripts/lib/applyCardOverrides` resolves via the root alias; the `.d.ts` from Task 3 types it.)

- [ ] **Step 7: Commit**

```bash
git add app/admin/catalog/lib/editorShared.ts app/admin/catalog/lib/validateOverride.ts \
  app/admin/catalog/lib/pendingDiff.ts app/admin/catalog/lib/__tests__/validateOverride.test.ts \
  app/admin/catalog/lib/__tests__/pendingDiff.test.ts
git commit -m "feat(catalog): editor validation + pending-deploy diff (pure, tested)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Server actions (spec §4)

**Files:**
- Create: `app/admin/catalog/actions.ts`

**Interfaces:**
- Consumes: `requireSuperuser` from `@/app/admin/permissions/lib/auth`; `validateOverrideFields`, `findCardStrict` from Task 7.
- Produces (all `"use server"`, all return unions checked with `=== false`):
  - `listCatalogState(): Promise<{ overrides: OverrideRow[]; imageVersions: ImageVersionRow[] }>`
  - `saveOverride(name: string, set: string, rawFields: Record<string, unknown>, note: string): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }>` — empty validated fields ⇒ row delete
  - `deleteOverride(name: string, set: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - Types: `OverrideRow = { card_name: string; set_code: string; fields: Record<string, string>; note: string; updated_at: string }`, `ImageVersionRow = { img_file: string; version: number; note: string | null; updated_at: string }`

- [ ] **Step 1: Implement**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { findCardStrict } from "./lib/editorShared";
import { validateOverrideFields } from "./lib/validateOverride";

export type OverrideRow = {
  card_name: string;
  set_code: string;
  fields: Record<string, string>;
  note: string;
  updated_at: string;
};
export type ImageVersionRow = {
  img_file: string;
  version: number;
  note: string | null;
  updated_at: string;
};

export async function listCatalogState(): Promise<{
  overrides: OverrideRow[];
  imageVersions: ImageVersionRow[];
}> {
  const ctx = await requireSuperuser();
  if (!ctx) return { overrides: [], imageVersions: [] };
  const [{ data: overrides }, { data: imageVersions }] = await Promise.all([
    ctx.supabase
      .from("card_overrides")
      .select("card_name, set_code, fields, note, updated_at")
      .order("card_name", { ascending: true }),
    ctx.supabase
      .from("card_image_versions")
      .select("img_file, version, note, updated_at")
      .order("img_file", { ascending: true }),
  ]);
  return {
    overrides: (overrides as OverrideRow[] | null) ?? [],
    imageVersions: (imageVersions as ImageVersionRow[] | null) ?? [],
  };
}

export async function saveOverride(
  name: string,
  set: string,
  rawFields: Record<string, unknown>,
  note: string,
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const ctx = await requireSuperuser();
  if (!ctx) return { ok: false, error: "Not authorized" };

  // Strict identity (spec F3): a typo'd set must never resolve to another print.
  if (!findCardStrict(name, set)) {
    return { ok: false, error: `No catalog card matches exactly "${name}" | "${set}"` };
  }

  const validated = validateOverrideFields(rawFields);
  if (validated.ok === false) return { ok: false, error: validated.error };

  // Empty override = no override: delete the row (the pending dashboard still
  // surfaces the deletion via the bundled-overlay diff — spec F4).
  if (Object.keys(validated.fields).length === 0) {
    const { error } = await ctx.supabase
      .from("card_overrides")
      .delete()
      .eq("card_name", name)
      .eq("set_code", set);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/catalog");
    return { ok: true, deleted: true };
  }

  const trimmedNote = note.trim();
  if (!trimmedNote) return { ok: false, error: "A note is required — future-you wants the why" };

  const { error } = await ctx.supabase.from("card_overrides").upsert(
    {
      card_name: name,
      set_code: set,
      fields: validated.fields,
      note: trimmedNote,
      updated_by: ctx.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "card_name,set_code" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/catalog");
  return { ok: true, deleted: false };
}

export async function deleteOverride(
  name: string,
  set: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireSuperuser();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase
    .from("card_overrides")
    .delete()
    .eq("card_name", name)
    .eq("set_code", set);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/catalog");
  return { ok: true };
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` clean; `npx vitest run` (no regressions; the actions have no unit tests — their logic lives in Task 7's tested modules and the DB is RLS-guarded).

- [ ] **Step 3: Commit**

```bash
git add app/admin/catalog/actions.ts
git commit -m "feat(catalog): server actions — list state, save/delete overrides (strict identity, validated fields)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Image replacement route (spec §6, F3/F8/F11)

**Files:**
- Create: `app/admin/catalog/api/image/route.ts`

**Interfaces:**
- Consumes: `findCardStrict` (Task 7); `transformReleaseImage`, `parseImageTransform` from `@/app/forge/lib/releaseImage` + `@/app/forge/lib/catalogRow`; tables from Task 2.
- Produces: `POST /admin/catalog/api/image` — multipart FormData `{ name, set, transform?, note?, file }` → `{ ok: true, version: number, method: string, upscaled: boolean }` | error status (404 unauth, 400 bad input, 409 version race, 500 blob config).

- [ ] **Step 1: Implement**

```ts
import { put, copy } from "@vercel/blob";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { parseImageTransform } from "@/app/forge/lib/catalogRow";
import { transformReleaseImage } from "@/app/forge/lib/releaseImage";
import { findCardStrict } from "@/app/admin/catalog/lib/editorShared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Replace one public card image in place (spec §6). Route handler, not a
// server action: card scans routinely exceed the 1MB server-action body cap.
// Order of operations is load-bearing:
//   bump (atomic CAS) → archive previous → transform → overwrite.
// Bump-first means a crash can leave a bumped version with old bytes (visible
// in the UI, healed by re-running) but never a new image with no cache-bust.
export async function POST(req: Request): Promise<Response> {
  const ctx = await requireSuperuser();
  if (!ctx) return new Response("Not Found", { status: 404 }); // invisible, portal precedent

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!token || !blobBase) {
    return Response.json({ error: "Public blob store not configured" }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }
  const name = typeof form.get("name") === "string" ? (form.get("name") as string) : "";
  const set = typeof form.get("set") === "string" ? (form.get("set") as string) : "";
  const note = typeof form.get("note") === "string" ? (form.get("note") as string) : "";
  const file = form.get("file");
  if (!name || !set || !(file instanceof Blob)) {
    return Response.json({ error: "name, set and file are required" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Image too large (15MB max)" }, { status: 400 });
  }

  // Strict identity (spec F3) — findCard's fallbacks could replace another card's art.
  const card = findCardStrict(name, set);
  if (!card) {
    return Response.json({ error: `No catalog card matches exactly "${name}" | "${set}"` }, { status: 400 });
  }
  const imgFile = card.imgFile;

  let transform = null;
  const rawTransform = form.get("transform");
  if (typeof rawTransform === "string" && rawTransform) {
    try {
      transform = parseImageTransform(JSON.parse(rawTransform));
    } catch {
      transform = null;
    }
    if (transform === null) return Response.json({ error: "Invalid transform" }, { status: 400 });
  }

  // 1) Version bump — compare-and-set so a double-submit can't reuse a version
  //    or clobber an archive slot (spec F11).
  const { data: existing } = await ctx.supabase
    .from("card_image_versions")
    .select("version")
    .eq("img_file", imgFile)
    .maybeSingle();

  let newVersion: number;
  if (!existing) {
    const { error } = await ctx.supabase
      .from("card_image_versions")
      .insert({ img_file: imgFile, version: 1, note: note || null, updated_by: ctx.user.id });
    if (error) return Response.json({ error: "Version race — retry" }, { status: 409 });
    newVersion = 1;
  } else {
    const { data: updated, error } = await ctx.supabase
      .from("card_image_versions")
      .update({
        version: existing.version + 1,
        note: note || null,
        updated_by: ctx.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("img_file", imgFile)
      .eq("version", existing.version) // CAS
      .select("version");
    if (error || !updated || updated.length === 0) {
      return Response.json({ error: "Version race — retry" }, { status: 409 });
    }
    newVersion = existing.version + 1;
  }

  // 2) Archive the outgoing image — server-side copy, NOT a CDN fetch (a fetch
  //    can capture stale edge bytes on back-to-back replaces, spec F8).
  try {
    await copy(`${blobBase}/card-images/${imgFile}.jpg`, `card-images-archive/${imgFile}.v${newVersion - 1}.jpg`, {
      access: "public",
      token,
      addRandomSuffix: false,
    });
  } catch {
    // Source blob missing (image never synced) — nothing to archive.
  }

  // 3) Transform to the uniform 345×495 q90 format (promote's pipeline).
  const input = Buffer.from(await file.arrayBuffer());
  let result;
  try {
    result = await transformReleaseImage(input, transform);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not process image" },
      { status: 400 },
    );
  }

  // 4) Overwrite in place. The daily sync cron head()-skips existing blobs, so
  //    this can never be clobbered back to the Lackey original.
  await put(`card-images/${imgFile}.jpg`, result.data, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "image/jpeg",
    token,
  });

  return Response.json({
    ok: true,
    version: newVersion,
    method: result.method,
    upscaled: result.upscaled,
  });
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` clean. Care-point from the spec: if `copy()` rejects the full-URL source form at runtime, switch the first argument to the pathname form (`card-images/${imgFile}.jpg`) — both are accepted by `@vercel/blob` ^2.4.1's `copy(fromUrlOrPathname, toPathname, opts)`; note which form worked in the commit message. (Runtime verification happens in Task 12's manual pass — the tables don't exist locally.)

- [ ] **Step 3: Commit**

```bash
git add app/admin/catalog/api/image/route.ts
git commit -m "feat(catalog): image-replace route — CAS bump, blob-copy archive, transform, in-place overwrite

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Page gate + metadata editor + pending dashboard (spec §7)

**Files:**
- Create: `app/admin/catalog/page.tsx`
- Create: `app/admin/catalog/CatalogClient.tsx`
- Modify: `app/admin/permissions/PermissionsPortal.tsx` — add a nav link to `/admin/catalog` (read the file first; place it wherever the portal links to other admin surfaces, matching its markup)

**Interfaces:**
- Consumes: `listCatalogState`, `saveOverride`, `deleteOverride` (Task 8); `diffPending` (Task 7); `getCardImageUrl` (Task 1); bundled overlay via `import bundledOverlay from "@/scripts/data/card-overrides.json"`.
- Produces: the `/admin/catalog` surface; `CatalogClient` props `{ initial: { overrides: OverrideRow[]; imageVersions: ImageVersionRow[] } }`. Task 11 adds the image panel into `CatalogClient.tsx`.

- [ ] **Step 1: `page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { listCatalogState } from "./actions";
import CatalogClient from "./CatalogClient";

export const metadata = { title: "Catalog" };
export const dynamic = "force-dynamic";

export default async function CatalogAdminPage() {
  const ctx = await requireSuperuser();
  if (!ctx) notFound(); // invisible to everyone else — portal precedent
  const initial = await listCatalogState();
  return <CatalogClient initial={initial} />;
}
```

- [ ] **Step 2: `CatalogClient.tsx` — structure**

`"use client"` component. Read `app/admin/cards/page.tsx` first and reuse its layout conventions (TopNav import, container classes, search-input pattern). Core state and behavior:

```tsx
"use client";

import { useMemo, useState } from "react";
import { CARDS, type CardData } from "@/lib/cards/lookup";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import { EDITABLE_FIELDS, type EditableField } from "./lib/editorShared";
import { diffPending } from "./lib/pendingDiff";
import { saveOverride, deleteOverride, type OverrideRow, type ImageVersionRow } from "./actions";
import bundledOverlay from "@/scripts/data/card-overrides.json";
```

- **Tabs:** `"edit" | "pending"`.
- **Search (edit tab):** client-side substring over `CARDS` by name (min 2 chars, cap 30 results), rows show thumbnail (`getCardImageUrl(c.imgFile)` in a plain `<img>` with the eslint-disable comment), name, set, type. Click selects the card.
- **Editor:** for the selected card, one row per `EDITABLE_FIELDS` entry:
  - live value rendered muted (`text-muted-foreground`);
  - override state is EXPLICIT per field — `overrides: Partial<Record<EditableField, string>>` seeded from the card's existing `OverrideRow.fields`. An un-overridden field shows an "Override" button that copies the live value into an enabled input; an overridden field shows the input plus a "Revert" button that deletes the key. **Never derive overridden-ness from value≠live** — an override equal to the live value must be storable (spec F9, the Ephesian Widow seed).
  - `specialAbility` and `identifier` use `<textarea rows={2}>`, everything else `<Input>`. No `focus:ring-*` classes.
  - identity strip above the grid: name / set / imgFile shown read-only with a lock icon and title `"Identity fields are immutable — decks reference cards by name|set"`.
  - Note `<Input>` (required when any field is overridden) + Save button; Save calls `saveOverride(card.name, card.set, overrides, note)` and surfaces `res.error` when `res.ok === false`. When every key was reverted, Save still runs (server deletes the row) and the UI clears.
- **Pending tab:** `const pending = useMemo(() => diffPending({ overrides: dbOverrides.map(o => ({ card_name: o.card_name, set_code: o.set_code, fields: o.fields })), imageVersions: Object.fromEntries(dbImageVersions.map(r => [r.img_file, r.version])) }, bundledOverlay as BundledOverlay), [dbOverrides, dbImageVersions]);` (import `type BundledOverlay` from `./lib/pendingDiff` — the JSON import's inferred type is wider than the declared shape) — render each `PendingItem.detail` with a kind badge; empty state: "Everything here is deployed." Header when non-empty: `Run \`make pull-card-overrides\`, commit the overlay + regenerated files, PR, deploy.`
- Local state mirrors DB after each action (update `dbOverrides` optimistically from the action result rather than refetching).

- [ ] **Step 3: Portal link** — in `app/admin/permissions/PermissionsPortal.tsx`, add a link (`<Link href="/admin/catalog">Catalog editor</Link>` styled like its neighbors). If the portal has no outbound-links block, add a small one under the header; keep it visually quiet.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npx vitest run
npm run dev   # (worktree, own port if 3000 busy: PORT=3010 npm run dev)
```
Manual: `/admin/catalog` as the superuser account → search, select, override a field, revert it. Save will fail with a relation-missing error (092 unapplied) — the error must surface in the UI, not crash it. As a non-superuser (or logged out): 404.

- [ ] **Step 5: Commit**

```bash
git add app/admin/catalog/page.tsx app/admin/catalog/CatalogClient.tsx app/admin/permissions/PermissionsPortal.tsx
git commit -m "feat(catalog): /admin/catalog — search, explicit per-field overrides, pending-deploy dashboard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Image panel (spec §6/§7, F2)

**Files:**
- Modify: `app/admin/catalog/CatalogClient.tsx`

**Interfaces:**
- Consumes: the Task 9 route; `CARD_IMAGE_WIDTH/HEIGHT/ASPECT`, `AUTO_RESIZE_TOLERANCE`, `PRINTER_PRESETS`, `type ReleaseImageTransform` from `@/app/forge/lib/catalogRow` (client-safe module); `getCardImageUrl`.

- [ ] **Step 1: Add the image panel to the editor view**

For the selected card, alongside the field grid:

- **Current image:** `<img src={currentSrc} …>` where `currentSrc` is `getCardImageUrl(card.imgFile)` plus, after a successful replace this session, `&ts=${Date.now()}` (or `?ts=` when unversioned) so the admin sees the new bytes despite their own browser cache.
- **Co-owners (F2):** `const coOwners = useMemo(() => CARDS.filter(c => c.imgFile === card.imgFile && !(c.name === card.name && c.set === card.set)), [card]);` — when non-empty render an amber callout: `This image also serves: <name (set)> …` — replacing it changes those cards too.
- **Version line:** current version from `dbImageVersions` (0 = never replaced); when ≥1, link "previous version" to `${blobBase}/card-images-archive/${card.imgFile}.v${version - 1}.jpg` (build via `process.env.NEXT_PUBLIC_BLOB_BASE_URL`).
- **Upload flow:** `<input type="file" accept="image/*">` → on select, read dimensions client-side:

```tsx
const bmp = await createImageBitmap(file);
const aspect = bmp.width / bmp.height;
const imageClass =
  bmp.width === CARD_IMAGE_WIDTH && bmp.height === CARD_IMAGE_HEIGHT && file.type === "image/jpeg"
    ? "exact"
    : Math.abs(aspect - CARD_IMAGE_ASPECT) / CARD_IMAGE_ASPECT <= AUTO_RESIZE_TOLERANCE
      ? "resize"
      : "crop";
```

  Show `${bmp.width}×${bmp.height} — ${imageClass}` and a preview via `URL.createObjectURL(file)`.
- **Crop decision (crop class only):** three buttons — Cover (default), Printer 1, Printer 2 — setting `transform: ReleaseImageTransform` (`{mode:"cover"}` / `{mode:"preset",preset:"printer1"}` / `{mode:"preset",preset:"printer2"}`). Live final-framing preview in a fixed frame (`width: 172, height: 247` px, `overflow-hidden`):
  - cover: `<img className="h-full w-full object-cover" …>`
  - preset (`rect = PRINTER_PRESETS[preset]`, fractional):

```tsx
const style = {
  width: `${(1 / rect.width) * 100}%`,
  height: `${(1 / rect.height) * 100}%`,
  marginLeft: `${(-rect.x / rect.width) * 100}%`,
  marginTop: `${(-rect.y / rect.height) * 100}%`,
  maxWidth: "none",
} as const;
// inside the frame: <img src={objectUrl} style={style} … />
```

- **Replace button:** disabled while in flight (F11 double-submit guard); optional note input reused from the panel:

```tsx
const form = new FormData();
form.set("name", card.name);
form.set("set", card.set);
if (transform) form.set("transform", JSON.stringify(transform));
if (imgNote) form.set("note", imgNote);
form.set("file", file);
const res = await fetch("/admin/catalog/api/image", { method: "POST", body: form });
const body = await res.json();
// success: update dbImageVersions with body.version, bust the preview, show
//   `Replaced (v${body.version}, ${body.method}${body.upscaled ? ", upscaled — low-res source" : ""})`
// failure: surface body.error; on 409 suggest retrying
```

- [ ] **Step 2: Verify** — tsc + vitest green; manual dev pass: select a card, upload a non-345×495 image, see class + preset previews switch framing. The Replace POST fails on the version bump (092 unapplied) — the surfaced error must be the JSON error, not a crash.

- [ ] **Step 3: Commit**

```bash
git add app/admin/catalog/CatalogClient.tsx
git commit -m "feat(catalog): image panel — co-owner warning, class audit, printer presets, in-place replace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Abort-release override warning (spec §8, F7)

**Files:**
- Modify: `app/forge/lib/promote.ts` (new query fn near `abortRelease`, ~line 509)
- Modify: `app/forge/sets/[setId]/promote/PromoteClient.tsx` (AbortButton confirm copy)

**Interfaces:**
- Produces: `listReleaseOverrides(releaseId: string): Promise<string[]>` in `promote.ts` — card names in the release that have `card_overrides` rows.

- [ ] **Step 1: Add the query** (in `promote.ts`, above `abortRelease`)

**Landmine:** do NOT use `.in("card_name", names)` — PostgREST silently drops later values when a quoted name (comma/quote) appears in an `.in()` list (the PR #290 bug). Fetch by `set_code` and intersect in JS:

```ts
/**
 * Card names in this release that carry catalog-editor overrides. Aborting the
 * release after its overlay has been pulled turns these into codegen-blocking
 * orphans (catalog-editor spec F7) — the abort confirm must say so.
 */
export async function listReleaseOverrides(releaseId: string): Promise<string[]> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return [];
  const { data: release } = await ctx.supabase
    .from("forge_public_releases")
    .select("set_code")
    .eq("id", releaseId)
    .maybeSingle();
  if (!release) return [];
  const { data: cards } = await ctx.supabase
    .from("forge_public_release_cards")
    .select("name")
    .eq("release_id", releaseId);
  const names = new Set((cards ?? []).map((c) => c.name as string));
  if (names.size === 0) return [];
  // No .in() with card names — quoted names corrupt PostgREST in-lists (#290).
  const { data: overrides } = await ctx.supabase
    .from("card_overrides")
    .select("card_name")
    .eq("set_code", release.set_code);
  return ((overrides ?? []).map((o) => o.card_name as string)).filter((n) => names.has(n));
}
```

(Before 092 is applied this query errors; `data` is null and the function returns `[]` — degraded gracefully, which is correct.)

- [ ] **Step 2: Extend the AbortButton** — read the `AbortButton` component in `PromoteClient.tsx` first, then: before its existing confirm step, `const affected = await listReleaseOverrides(releaseId);` and when `affected.length > 0` extend the confirm message with:

```
⚠️ ${affected.length} card(s) in this release have catalog-editor overrides
(${affected.slice(0, 5).join(", ")}${affected.length > 5 ? ", …" : ""}).
If the overlay was already pulled, aborting strands them as codegen-blocking
orphans — delete those overrides in /admin/catalog first.
```

Match the component's existing confirm mechanism (inline confirm state or `window.confirm`) — do not restructure it.

- [ ] **Step 3: Verify** — tsc + vitest green (promote's existing tests must not regress).

- [ ] **Step 4: Commit**

```bash
git add app/forge/lib/promote.ts "app/forge/sets/[setId]/promote/PromoteClient.tsx"
git commit -m "feat(forge): abort-release warns when release cards carry catalog overrides (F7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Docs, full verification, PR

**Files:**
- Modify: `CLAUDE.md` (Key References table)
- Include: `docs/superpowers/specs/2026-08-23-catalog-admin-editor-design.md` + this plan (copy both from the main checkout into the worktree — they're untracked there)

- [ ] **Step 1: CLAUDE.md row** — add under the Forge set promotion row:

```
| Catalog admin editor | `docs/superpowers/specs/2026-08-23-catalog-admin-editor-design.md` + `app/admin/catalog/`; overlay `scripts/data/card-overrides.json` via `make pull-card-overrides` |
```

- [ ] **Step 2: Copy spec + plan into the worktree**

```bash
cp /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/specs/2026-08-23-catalog-admin-editor-design.md \
   /Users/timestes/projects/rtt-catalog-admin/docs/superpowers/specs/
mkdir -p /Users/timestes/projects/rtt-catalog-admin/docs/superpowers/plans
cp /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/plans/2026-08-23-catalog-admin-editor.md \
   /Users/timestes/projects/rtt-catalog-admin/docs/superpowers/plans/
```

- [ ] **Step 3: Full gates**

```bash
npx tsc --noEmit          # only the 7 pre-existing main errors
npx vitest run            # all green
npm run build             # exit 0; /admin/catalog and /admin/catalog/api/image in the route manifest
node scripts/parse-carddata.js && git diff --stat lib/cards/generated/   # byte-identical (imgVersions.json unchanged)
```

- [ ] **Step 4: Commit + push + PR**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-23-catalog-admin-editor-design.md docs/superpowers/plans/2026-08-23-catalog-admin-editor.md
git commit -m "docs(catalog): spec, plan, CLAUDE.md reference

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/catalog-admin-editor
gh pr create --base main --title "feat(catalog): admin editor — public card metadata overrides + in-place image replacement" --body "$(cat <<'EOF'
Superuser-gated `/admin/catalog` for correcting any public card: sparse metadata
overrides (12 editable fields; identity immutable) stored in `card_overrides` and
applied as a third codegen overlay that wins over upstream and forge-released
rows (`make pull-card-overrides` → PR → deploy), plus immediate in-place image
replacement keyed by imgFile (`card_image_versions`, archive-first blob
overwrite, deploy-time `?v=` cache-bust). Also consolidates the six card-image
URL builders onto the shared helper, and adds codegen guards: orphan/ambiguous
overrides, stranded image versions, and AB-pairing changes all fail the build.
Spec (adversary-reviewed, findings F1–F15 in §12):
`docs/superpowers/specs/2026-08-23-catalog-admin-editor-design.md`.

## Merge-time ops (in order)
1. Apply `supabase/migrations/092_card_overrides.sql` (Supabase MCP).
2. Run `npm run test:security` — the new card_overrides/card_image_versions anon checks only pass post-apply.
3. Post-deploy §5.5 seeding: create the Ephesian Widow override in /admin/catalog (legality → Rotation, note → Deck Construction & Format Specific Rules 2.0); the LEGALITY_OVERRIDES map in lib/cards/lookup.ts is removed in the FIRST `make pull-card-overrides` PR (whose overlay carries the row), NOT in this PR.
4. Images replaced before the next overlay deploy serve stale to warm caches until `?v=` ships — expected (spec §6.3).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Report** — PR URL, verification results, the merge-time ops list, and the reminder that `git worktree remove /Users/timestes/projects/rtt-catalog-admin` happens after merge.

---

## Self-review notes (already applied)

- Spec §5.5 (LEGALITY_OVERRIDES removal) is deliberately **not** a task: the map can only be removed in the first overlay-pull PR after the seed row exists in prod. This PR must NOT touch `lib/cards/lookup.ts`. The PR body carries the sequencing.
- Spec §5.3's CDN query-string care-point is folded into Task 9's care-point + §6.3 note in the PR body.
- Type thread check: `OverrideRow`/`ImageVersionRow` (Task 8) match `listCatalogState`'s selects and Task 10's props; `DbState`/`BundledOverlay` (Task 7) match the shapes Task 10 constructs; `EDITABLE_FIELDS` appears in Tasks 3/7 with a drift-guard test pinning them.
