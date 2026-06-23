# Forge Phase 1a.4 — Card Design Studio + Ideas Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Forge members a single-author card design studio — a live faithful card preview + form with autosave — plus an ideas library to browse their cards.

**Architecture:** Migration 051 adds card *content* (`working_snapshot` jsonb + `status`) to the identity-only `forge_cards` from 1a.3, fixes the SELECT policy to owner-or-superadmin, and adds a column-only autosave RPC. A pure `designCard.ts` module owns the schema + applicability matrix + advisory validation; a pure `frameAssets.ts` module maps a card to its frame layer assets. `<ForgeCardPreview>` composites those layers (exported Figma `Elements/` PNGs→WebP + libre fonts) over the uploaded art (served by the 1a.3 private-art proxy). The studio editor and ideas library compose those units; writes go through server actions in `cards.ts`.

**Tech Stack:** Next.js 15 (App Router, RSC + server actions), React 19, TypeScript, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), Vitest, `@vercel/blob` (private art, already wired), `sharp`/`cwebp` (one-time asset prep), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-23-forge-phase-1a-4-card-studio-design.md` (and parent `2026-06-19-forge-card-design-playtesting-design.md`).

## Global Constraints

- **Writes go through SECURITY DEFINER RPCs**, never direct table writes. Every new RPC clones the 050 pattern verbatim: `language plpgsql security definer set search_path = ''`, authz check that raises on failure, then `revoke execute ... from public, anon` + `grant execute ... to authenticated`.
- **RLS is the security boundary**, not app-layer query filters. `forge_cards` SELECT is **owner-or-superadmin** after this phase.
- **Visibility:** a member sees only their **own** cards (single-author Phase 1a). Superadmin may see all (helper), but the ideas grid is always scoped to the caller's own cards.
- **No `next/image` anywhere under `app/forge`** — plain `<img>` only (enforced by `__tests__/forge-no-next-image.test.ts`).
- **All `/forge` routes stay `force-dynamic`** (`export const dynamic = "force-dynamic"`). No ISR/caching of card content.
- **Autosave snapshot is capped at 64 KB** server-side; the RPC writes the `working_snapshot` column only (never trusts `owner_id`/`status`/`set_id` keys inside the jsonb) and syncs `title` from `name`.
- **`validate()` is advisory only** — it never blocks autosave or card creation (the napkin promise: structure is never demanded).
- **Brigade `Multi` sentinels are not selectable** — a multi-brigade card is an explicit array (spec Decision #2).
- **Fonts: libre only** (Arimo, Anton/Archivo Black). The proprietary kit fonts are removed and must never be committed.
- **Frame chrome is public-static.** Only `public/forge/frames/Elements/`, `.../Icons/`, `public/forge/fonts/` (libre) ship; the per-type reference folders + `Complete Cards/` are git-ignored and never deployed.
- **Gate-first:** every `app/forge/**/{page,layout}.tsx` and `app/forge/api/**/route.ts` calls `requireForge`/`requireElder`/`requireForgeSuperadmin` as the first action.
- TypeScript path alias: `@/` → repo root. Tests: `npm test` (Vitest, hermetic, mocks the auth gate + supabase server client); `npm run test:security` (live anon-leak guardrail, opt-in via env).

---

## File Structure

**Create:**
- `supabase/migrations/051_forge_card_content.sql` — content columns, enum, `is_forge_superadmin()`, RLS fix, `forge_save_card`.
- `app/forge/lib/designCard.ts` — `DesignCard` type, enums, applicability matrix, `validate()`, helpers.
- `app/forge/lib/__tests__/designCard.test.ts`
- `app/forge/lib/frameAssets.ts` — card → frame layer asset paths + fallback.
- `app/forge/lib/__tests__/frameAssets.test.ts`
- `app/forge/lib/__tests__/cards.test.ts` — tests for the new card actions.
- `app/forge/components/ForgeCardPreview.tsx` — pure layered preview component.
- `app/forge/forge-fonts.css` — `@font-face` for the libre fonts.
- `app/forge/ideas/page.tsx` — ideas library (server).
- `app/forge/ideas/IdeasLibrary.tsx` — ideas grid + filters (client).
- `app/forge/ideas/[cardId]/page.tsx` — studio editor (server).
- `app/forge/ideas/[cardId]/StudioEditor.tsx` — studio shell + autosave + napkin (client).
- `app/forge/ideas/[cardId]/FullModeForm.tsx` — applicability-driven inputs (client).
- `__tests__/forge-gate-first.test.ts` — gate-first grep guardrail.
- `scripts/forge-convert-frames.mjs` — one-time WebP conversion.

**Modify:**
- `app/forge/lib/cards.ts` — add `saveCard`, `listForgeCards`, `getCard`; fix `revalidatePath` targets.
- `app/forge/layout.tsx` — import `forge-fonts.css`.
- `app/forge/art/page.tsx` — redirect to `/forge/ideas`.
- `__tests__/forge-anon-leak.test.ts` — add new RPC probes + authenticated member-isolation block.
- `.gitignore` — ignore reference frame folders + any `.ttf` not libre.

**Delete:**
- `app/forge/art/ArtPanel.tsx` — superseded by the studio (after Task 11).

**Parallelizable:** Tasks 3, 4, 12 are independent pure units. Task 1→2 are sequential. Task 5 (assets) is independent. Tasks 6→{8,9,10}→11 are sequential on the UI chain.

---

### Task 1: Migration 051 — card content schema, RLS fix, save RPC

**Files:**
- Create: `supabase/migrations/051_forge_card_content.sql`

**Interfaces:**
- Produces (SQL surface consumed by later tasks): `forge_cards.working_snapshot jsonb`, `forge_cards.status forge_card_status`; RPC `forge_save_card(p_card_id uuid, p_snapshot jsonb) returns timestamptz`; helper `is_forge_superadmin() returns boolean`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/051_forge_card_content.sql`:

```sql
-- 051_forge_card_content.sql
-- Forge phase 1a.4: add card CONTENT to the identity-only forge_cards (mig 050).
-- Adds working_snapshot (autosave draft) + status, FIXES the SELECT policy to
-- owner-or-superadmin (050's member-wide policy would leak private ideas once
-- content lands), and adds a column-only, size-capped autosave RPC.
-- Builds on 048 (is_forge_member / is_forge_elder_or_super) and 050 (forge_cards).

-- 1) Card status enum (full lifecycle from the spec; only private_idea is used in 1a.4).
do $$ begin
  create type public.forge_card_status as enum
    ('private_idea','draft','playtesting','approved','promoted','archived');
exception when duplicate_object then null; end $$;

-- 2) Content columns. working_snapshot = the mutable DesignCard draft (autosave target).
alter table public.forge_cards
  add column if not exists working_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists status public.forge_card_status not null default 'private_idea';

-- 3) Superadmin SQL helper (mirrors 048's is_forge_member / is_forge_elder_or_super).
create or replace function public.is_forge_superadmin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.playtest_members m
    where m.user_id = auth.uid() and m.role = 'superadmin'
  );
$$;

-- 4) FIX the SELECT policy: owner-or-superadmin (was is_forge_member() — a leak
--    once working_snapshot holds card names/abilities). A private idea is owner-only;
--    the sets sub-phase later adds set-elder/granted branches via create-or-replace.
drop policy if exists "forge_cards_select" on public.forge_cards;
create policy "forge_cards_select" on public.forge_cards
  for select to authenticated
  using (owner_id = auth.uid() or public.is_forge_superadmin());

-- 5) Autosave RPC. Column-only write (never trusts identity keys inside the jsonb),
--    64 KB cap, syncs the title mirror from name, returns the new updated_at.
create or replace function public.forge_save_card(p_card_id uuid, p_snapshot jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_updated timestamptz;
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  if octet_length(p_snapshot::text) > 64000 then
    raise exception 'snapshot too large';
  end if;
  update public.forge_cards
     set working_snapshot = p_snapshot,
         title = nullif(btrim(coalesce(p_snapshot->>'name','')), ''),
         updated_at = now()
   where id = p_card_id
  returning updated_at into v_updated;
  return v_updated;
end; $$;

-- 6) Lock down execute: strip anon (Supabase default-grants directly), grant authenticated.
revoke execute on function public.is_forge_superadmin() from public, anon;
revoke execute on function public.forge_save_card(uuid, jsonb) from public, anon;
grant execute on function public.is_forge_superadmin() to authenticated;
grant execute on function public.forge_save_card(uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (name `forge_card_content`, the SQL above), or `supabase db push`. This is a remote project; apply carefully.

- [ ] **Step 3: Verify the schema landed**

Run via Supabase MCP `execute_sql`:

```sql
select column_name from information_schema.columns
 where table_name='forge_cards' and column_name in ('working_snapshot','status');
select polname, pg_get_expr(polqual, polrelid) as using_expr
 from pg_policy where polrelid='public.forge_cards'::regclass;
select proname from pg_proc where proname in ('forge_save_card','is_forge_superadmin');
```

Expected: both columns present; the `forge_cards_select` USING expression mentions `owner_id` + `is_forge_superadmin`; both functions present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/051_forge_card_content.sql
git commit -m "feat(forge): migration 051 — card content columns, owner-or-superadmin RLS, save RPC"
```

---

### Task 2: Broaden the anon-leak guardrail

**Files:**
- Modify: `__tests__/forge-anon-leak.test.ts`

**Interfaces:**
- Consumes: RPCs `forge_save_card`, `is_forge_superadmin` (Task 1); env `FORGE_LEAK_TEST`, and optional `FORGE_TEST_MEMBER_EMAIL`/`FORGE_TEST_MEMBER_PASSWORD`/`SUPABASE_SERVICE_ROLE_KEY`/`FORGE_TEST_OTHER_OWNER_ID` for the member-isolation block.

- [ ] **Step 1: Add the two new RPCs to the anon-reject list**

In `__tests__/forge-anon-leak.test.ts`, add to the `FORGE_RPCS` array:

```ts
    ["is_forge_superadmin", {}],
    ["forge_save_card", { p_card_id: "00000000-0000-0000-0000-000000000000", p_snapshot: {} }],
```

- [ ] **Step 2: Add the authenticated member-isolation block (opt-in)**

Append inside the existing `describe.runIf(ENABLED)` body. It only runs when the extra env is present, so the default `test:security` run is unaffected:

```ts
  // Member-vs-member isolation: a signed-in member must NOT see another member's
  // private idea. Opt-in (needs a test member + service role to seed a foreign card).
  const MEMBER_EMAIL = process.env.FORGE_TEST_MEMBER_EMAIL;
  const MEMBER_PW = process.env.FORGE_TEST_MEMBER_PASSWORD;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const OTHER_OWNER = process.env.FORGE_TEST_OTHER_OWNER_ID; // an auth.users id != the test member
  const ISO_ENABLED = !!(MEMBER_EMAIL && MEMBER_PW && SERVICE && OTHER_OWNER);

  describe.runIf(ISO_ENABLED)("member cannot read another member's card", () => {
    it("a signed-in member sees zero rows for a foreign-owned card", async () => {
      const svc = createClient(URL!, SERVICE!);
      const ins = await svc
        .from("forge_cards")
        .insert({ owner_id: OTHER_OWNER!, working_snapshot: { name: "SECRET IDEA" } })
        .select("id")
        .single();
      expect(ins.error, ins.error?.message).toBeNull();
      const foreignId = ins.data!.id as string;
      try {
        const member = createClient(URL!, ANON!);
        const auth = await member.auth.signInWithPassword({ email: MEMBER_EMAIL!, password: MEMBER_PW! });
        expect(auth.error, auth.error?.message).toBeNull();
        const { data } = await member.from("forge_cards").select("*").eq("id", foreignId);
        expect((data ?? []).length, "member leaked a foreign-owned card").toBe(0);
      } finally {
        await svc.from("forge_cards").delete().eq("id", foreignId);
      }
    });
  });
```

- [ ] **Step 3: Run the guardrail**

Run: `npm run test:security`
Expected: PASS — anon sees 0 rows in all `FORGE_TABLES`; anon cannot execute any RPC (including the two new ones). The member-isolation block runs only if its env is set (otherwise skipped); when set, it passes (the Task-1 policy blocks the foreign read).

> Note for the executor: provisioning `FORGE_TEST_MEMBER_*` + `SUPABASE_SERVICE_ROLE_KEY` + `FORGE_TEST_OTHER_OWNER_ID` is a one-time setup. If unavailable, the block skips cleanly; record that the isolation assertion was not exercised.

- [ ] **Step 4: Commit**

```bash
git add __tests__/forge-anon-leak.test.ts
git commit -m "test(forge): guardrail probes for save RPC + superadmin helper + member isolation"
```

---

### Task 3: `DesignCard` schema + validation module

**Files:**
- Create: `app/forge/lib/designCard.ts`
- Test: `app/forge/lib/__tests__/designCard.test.ts`

**Interfaces:**
- Produces: `DesignCard` type; const arrays `CARD_TYPES`, `ALIGNMENTS`, `GOOD_BRIGADES`, `EVIL_BRIGADES`, `BRIGADES`, `CLASSES`, `ICONS`, `LEGALITIES`; types `CardType`, `Alignment`, `Brigade`; `cardApplicability(types: CardType[]): Record<FieldKey, Applicability>`; `isStatBearing(types: CardType[]): boolean`; `validate(card: DesignCard): ValidationHint[]` where `ValidationHint = { field: string; message: string }`.

- [ ] **Step 1: Write the failing test**

Create `app/forge/lib/__tests__/designCard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cardApplicability, isStatBearing, validate, BRIGADES } from "../designCard";

describe("cardApplicability", () => {
  it("Hero requires brigade + stats", () => {
    const a = cardApplicability(["Hero"]);
    expect(a.brigades).toBe("required");
    expect(a.stats).toBe("required");
  });
  it("Artifact has no brigade/stats but requires ability", () => {
    const a = cardApplicability(["Artifact"]);
    expect(a.brigades).toBe("na");
    expect(a.stats).toBe("na");
    expect(a.specialAbility).toBe("required");
  });
  it("Site expects a brigade; Fortress treats it as optional", () => {
    expect(cardApplicability(["Site"]).brigades).toBe("required");
    expect(cardApplicability(["Fortress"]).brigades).toBe("optional");
  });
  it("dual-type unions field requirements (Hero/GE needs stats AND ability)", () => {
    const a = cardApplicability(["Hero", "GE"]);
    expect(a.stats).toBe("required");
    expect(a.specialAbility).toBe("required");
  });
});

describe("isStatBearing", () => {
  it("true for Hero/EvilCharacter, false for LostSoul", () => {
    expect(isStatBearing(["Hero"])).toBe(true);
    expect(isStatBearing(["EvilCharacter"])).toBe(true);
    expect(isStatBearing(["LostSoul"])).toBe(false);
  });
});

describe("validate (advisory only)", () => {
  it("hints a missing required field but never throws / blocks", () => {
    const hints = validate({ cardType: ["Hero"] }); // no brigade, no stats, no name
    expect(hints.some((h) => h.field === "brigades")).toBe(true);
    expect(Array.isArray(hints)).toBe(true);
  });
  it("returns no hints for an empty napkin card (zero required fields demanded)", () => {
    expect(validate({})).toEqual([]);
  });
});

describe("BRIGADES enum", () => {
  it("excludes the ambiguous Multi sentinels", () => {
    expect(BRIGADES).not.toContain("GoodMulti");
    expect(BRIGADES).not.toContain("EvilMulti");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- designCard`
Expected: FAIL — `Cannot find module '../designCard'`.

- [ ] **Step 3: Write the module**

Create `app/forge/lib/designCard.ts`:

```ts
// Pure DesignCard schema + advisory validation. No UI, no DB. Consumed by the
// form, the preview, and (later) publish validation. Arrays are native; the
// legacy delimited-string toCardData() adapter is deferred to Phase 2.

export const CARD_TYPES = [
  "Hero", "EvilCharacter", "GE", "EE", "LostSoul", "Artifact",
  "Dominant", "Fortress", "Site", "City", "Curse", "Covenant",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const ALIGNMENTS = ["Good", "Evil", "Neutral", "Good_Evil"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

// Resolved brigades only — no GoodMulti/EvilMulti sentinels (spec Decision #2).
// Red, Teal, and Evil Gold are intentionally unsupported (the kit has no frame for them).
export const GOOD_BRIGADES = ["Blue", "Clay", "GoodGold", "Green", "Purple", "Silver", "White"] as const;
export const EVIL_BRIGADES = ["Black", "Brown", "Crimson", "Gray", "Orange", "PaleGreen"] as const;
export const BRIGADES = [...GOOD_BRIGADES, ...EVIL_BRIGADES] as const;
export type Brigade = (typeof BRIGADES)[number];

export const CLASSES = ["Warrior", "Weapon"] as const;
export const ICONS = ["Territory", "Star", "Cloud"] as const;
export const LEGALITIES = ["Rotation", "Classic", "Scrolls", "Paragon", "Banned"] as const;

export type DesignCard = {
  name?: string;
  cardType?: CardType[];
  alignment?: Alignment;
  brigades?: Brigade[];
  strength?: number | null;
  toughness?: number | null;
  strengthModifier?: string;
  toughnessModifier?: string;
  class?: (typeof CLASSES)[number][];
  icons?: (typeof ICONS)[number][];
  identifiers?: string[];
  specialAbility?: string;
  reference?: string;
  legality?: (typeof LEGALITIES)[number];
  rarity?: string;
  flavorText?: string;
  artistCredit?: string;
  cardFrame?: string;
};

export type Applicability = "required" | "optional" | "na";
export type FieldKey =
  | "brigades" | "stats" | "strengthModifier" | "class" | "icons"
  | "identifiers" | "specialAbility" | "reference";

const NA: Record<FieldKey, Applicability> = {
  brigades: "na", stats: "na", strengthModifier: "na", class: "na",
  icons: "na", identifiers: "na", specialAbility: "na", reference: "na",
};

// Per-type applicability, grounded in the real Redemption card pool (Site ~100%
// brigade, Fortress ~6%). "stats" = strength+toughness (Hero/EvilCharacter only).
const MATRIX: Record<CardType, Partial<Record<FieldKey, Applicability>>> = {
  Hero:          { brigades: "required", stats: "required", class: "optional", icons: "optional", identifiers: "optional", specialAbility: "optional", reference: "optional" },
  EvilCharacter: { brigades: "required", stats: "required", class: "optional", icons: "optional", identifiers: "optional", specialAbility: "optional", reference: "optional" },
  GE:            { brigades: "required", strengthModifier: "optional", specialAbility: "required", reference: "optional" },
  EE:            { brigades: "required", strengthModifier: "optional", specialAbility: "required", reference: "optional" },
  LostSoul:      { specialAbility: "optional", reference: "optional" },
  Artifact:      { specialAbility: "required", identifiers: "optional", reference: "optional" },
  Dominant:      { specialAbility: "required", identifiers: "optional", reference: "optional" },
  Fortress:      { brigades: "optional", specialAbility: "optional", reference: "optional" },
  Site:          { brigades: "required", specialAbility: "optional", reference: "optional" },
  City:          { brigades: "optional", specialAbility: "optional", reference: "optional" },
  Curse:         { brigades: "optional", specialAbility: "optional", reference: "optional" },
  Covenant:      { brigades: "optional", specialAbility: "optional", reference: "optional" },
};

const RANK: Record<Applicability, number> = { na: 0, optional: 1, required: 2 };

export function cardApplicability(types: CardType[]): Record<FieldKey, Applicability> {
  const out: Record<FieldKey, Applicability> = { ...NA };
  for (const t of types) {
    const m = MATRIX[t] ?? {};
    for (const k of Object.keys(out) as FieldKey[]) {
      const cand = m[k] ?? "na";
      if (RANK[cand] > RANK[out[k]]) out[k] = cand;
    }
  }
  return out;
}

export function isStatBearing(types: CardType[]): boolean {
  return cardApplicability(types).stats === "required";
}

export type ValidationHint = { field: string; message: string };

// ADVISORY ONLY — never blocks autosave/creation. Empty/napkin card => no hints.
export function validate(card: DesignCard): ValidationHint[] {
  const types = card.cardType ?? [];
  if (types.length === 0) return [];
  const app = cardApplicability(types);
  const hints: ValidationHint[] = [];
  const has = (v: unknown) =>
    Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "";

  if (app.brigades === "required" && !has(card.brigades))
    hints.push({ field: "brigades", message: "This type usually has a brigade." });
  if (app.stats === "required" && (!has(card.strength) || !has(card.toughness)))
    hints.push({ field: "stats", message: "This type usually has strength / toughness." });
  if (app.specialAbility === "required" && !has(card.specialAbility))
    hints.push({ field: "specialAbility", message: "This type usually has a special ability." });
  return hints;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- designCard`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/designCard.ts app/forge/lib/__tests__/designCard.test.ts
git commit -m "feat(forge): DesignCard schema + applicability matrix + advisory validate"
```

---

### Task 4: Frame asset mapping module

**Files:**
- Create: `app/forge/lib/frameAssets.ts`
- Test: `app/forge/lib/__tests__/frameAssets.test.ts`

**Interfaces:**
- Consumes: `Brigade`, `CardType`, `DesignCard`, `isStatBearing` (Task 3).
- Produces: `washPath(card: DesignCard): string | null`; `statBoxPath(card: DesignCard): string | null`; `iconPath(card: DesignCard): string | null`; `isPreviewApproximate(card: DesignCard): boolean`; const `BRIGADE_HEX: Record<Brigade,string>` (fallback solid colors).

Asset facts (post-WebP): files live under `/forge/frames/Elements/` and `/forge/frames/Icons/`. The supported brigades map 1:1 to the shipped single washes: `blue clay gold green purple silver white black brown crimson gray orange pale-green` (Red/Teal/Evil Gold are not supported brigades). Special washes: `artifact good-dom evil-dom good-fort evil-fort lost-soul default`. Dual washes exist nested (`Background={a}/{b}.webp`); v1 tries the dual, falls back to the first brigade's single, else solid color.

- [ ] **Step 1: Write the failing test**

Create `app/forge/lib/__tests__/frameAssets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { washPath, statBoxPath, iconPath, isPreviewApproximate, BRIGADE_HEX } from "../frameAssets";

describe("washPath", () => {
  it("maps a single good brigade to its Elements wash", () => {
    expect(washPath({ cardType: ["Hero"], brigades: ["Blue"] }))
      .toBe("/forge/frames/Elements/Background=blue.webp");
  });
  it("special types override brigade with a type wash", () => {
    expect(washPath({ cardType: ["LostSoul"] })).toBe("/forge/frames/Elements/Background=lost-soul.webp");
    expect(washPath({ cardType: ["Artifact"] })).toBe("/forge/frames/Elements/Background=artifact.webp");
    expect(washPath({ cardType: ["Dominant"], alignment: "Evil" })).toBe("/forge/frames/Elements/Background=evil-dom.webp");
  });
  it("returns null (=> solid fallback) when a brigadeless card has no brigade", () => {
    expect(washPath({ cardType: ["Hero"] })).toBeNull();
  });
  it("uses the dual wash when both brigades are available", () => {
    expect(washPath({ cardType: ["EvilCharacter"], brigades: ["Black", "Brown"] }))
      .toBe("/forge/frames/Elements/Background=black/brown.webp");
  });
});

describe("statBoxPath / iconPath", () => {
  it("stat-bearing types get a stat box; non-stat types do not", () => {
    expect(statBoxPath({ cardType: ["Hero"], brigades: ["Blue"] })).not.toBeNull();
    expect(statBoxPath({ cardType: ["LostSoul"] })).toBeNull();
  });
  it("maps the type icon", () => {
    expect(iconPath({ cardType: ["Hero"] })).toBe("/forge/frames/Icons/Cross Icon.png");
    expect(iconPath({ cardType: ["EvilCharacter"] })).toBe("/forge/frames/Icons/Evil Character.png");
  });
});

describe("isPreviewApproximate", () => {
  it("flags 3+ brigades and Classic frame as approximate", () => {
    expect(isPreviewApproximate({ cardType: ["Hero"], brigades: ["Blue", "Green", "Purple"] })).toBe(true);
    expect(isPreviewApproximate({ cardType: ["Hero"], legality: "Classic" })).toBe(true);
    expect(isPreviewApproximate({ cardType: ["Hero"], brigades: ["Blue"] })).toBe(false);
  });
});

describe("BRIGADE_HEX", () => {
  it("provides a fallback color for supported brigades", () => {
    expect(BRIGADE_HEX.Blue).toMatch(/^#/);
    expect(BRIGADE_HEX.Crimson).toMatch(/^#/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frameAssets`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `app/forge/lib/frameAssets.ts`:

```ts
import type { Brigade, CardType, DesignCard } from "./designCard";
import { isStatBearing } from "./designCard";

const BASE = "/forge/frames/Elements";
const ICONS = "/forge/frames/Icons";

// Brigade -> wash slug. GoodGold uses the kit's single "gold" wash.
const BRIGADE_SLUG: Record<Brigade, string> = {
  Blue: "blue", Clay: "clay", GoodGold: "gold", Green: "green", Purple: "purple",
  Silver: "silver", White: "white",
  Black: "black", Brown: "brown", Crimson: "crimson",
  Gray: "gray", Orange: "orange", PaleGreen: "pale-green",
};

// Slugs that ship as Elements washes — one per supported brigade.
const AVAILABLE_WASH = new Set([
  "blue", "clay", "gold", "green", "purple", "silver", "white",
  "black", "brown", "crimson", "gray", "orange", "pale-green",
]);

// Fallback solid colors for every brigade (used for dual washes / safety).
export const BRIGADE_HEX: Record<Brigade, string> = {
  Blue: "#2f6fb3", Clay: "#b08a5a", GoodGold: "#d4af37", Green: "#2f8f4e",
  Purple: "#7a4fa3", Silver: "#aab2bd", White: "#e8e8e8",
  Black: "#222222", Brown: "#6b4423", Crimson: "#a01a4a",
  Gray: "#6b7280", Orange: "#d2691e", PaleGreen: "#9bbf8a",
};

// Special types use a type-specific wash instead of a brigade wash.
function specialWash(card: DesignCard): string | null {
  const types = card.cardType ?? [];
  const evil = card.alignment === "Evil";
  if (types.includes("LostSoul")) return "lost-soul";
  if (types.includes("Artifact")) return "artifact";
  if (types.includes("Dominant")) return evil ? "evil-dom" : "good-dom";
  if (types.includes("Fortress")) return evil ? "evil-fort" : "good-fort";
  return null;
}

export function washPath(card: DesignCard): string | null {
  const special = specialWash(card);
  if (special) return `${BASE}/Background=${special}.webp`;
  const brigades = card.brigades ?? [];
  if (brigades.length === 0) return null;
  const s1 = BRIGADE_SLUG[brigades[0]];
  if (brigades.length >= 2) {
    const s2 = BRIGADE_SLUG[brigades[1]];
    if (AVAILABLE_WASH.has(s1) && AVAILABLE_WASH.has(s2)) return `${BASE}/Background=${s1}/${s2}.webp`;
  }
  return AVAILABLE_WASH.has(s1) ? `${BASE}/Background=${s1}.webp` : null;
}

export function statBoxPath(card: DesignCard): string | null {
  if (!isStatBearing(card.cardType ?? [])) return null;
  const brigades = card.brigades ?? [];
  const s1 = brigades[0] ? BRIGADE_SLUG[brigades[0]] : null;
  if (!s1 || !AVAILABLE_WASH.has(s1)) return null; // solid fallback handled by component
  // Stat-box color element: capitalized brigade name in the kit (e.g. Color=Gold).
  const cap = s1.charAt(0).toUpperCase() + s1.slice(1);
  return `${BASE}/Color=${cap}.webp`;
}

// Type icon shown in the stat box / corner. Tuned visually against references.
const ICON_BY_TYPE: Partial<Record<CardType, string>> = {
  Hero: "Cross Icon.png",
  EvilCharacter: "Evil Character.png",
  Site: "Site.png",
};
export function iconPath(card: DesignCard): string | null {
  const t = (card.cardType ?? [])[0];
  const f = t ? ICON_BY_TYPE[t] : undefined;
  return f ? `${ICONS}/${f}` : null;
}

export function isPreviewApproximate(card: DesignCard): boolean {
  if ((card.brigades ?? []).length >= 3) return true;
  if (card.legality === "Classic") return true;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- frameAssets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/frameAssets.ts app/forge/lib/__tests__/frameAssets.test.ts
git commit -m "feat(forge): frame asset mapping with graceful fallback"
```

---

### Task 5: Asset prep — gitignore reference frames, WebP conversion, libre fonts

**Files:**
- Create: `scripts/forge-convert-frames.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Ignore reference frames + non-libre fonts**

Append to `.gitignore`:

```gitignore
# Forge: reference-only Figma frames (baked text) — never deploy/commit; keep local for visual tuning
public/forge/frames/Complete Cards/
public/forge/frames/Heroes/
public/forge/frames/Good Enhancements/
public/forge/frames/Evil Enhancements/
public/forge/frames/Evil Characters/
public/forge/frames/Sites/
public/forge/frames/Covenants/
public/forge/frames/Curses/
# Forge: never commit raw kit PNGs (we ship .webp) or proprietary fonts
public/forge/frames/Elements/**/*.png
public/forge/fonts/*.ttf
```

- [ ] **Step 2: Write the WebP conversion script**

Create `scripts/forge-convert-frames.mjs`:

```js
// One-time: convert the consumed Elements PNGs to WebP (the .png are git-ignored).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = "public/forge/frames/Elements";
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".png")) {
      const out = p.replace(/\.png$/, ".webp");
      sharp(p).webp({ quality: 82 }).toFile(out)
        .then(() => console.log("✓", out))
        .catch((e) => console.error("✗", p, e.message));
    }
  }
}
walk(ROOT);
```

- [ ] **Step 3: Run the conversion**

Run: `node scripts/forge-convert-frames.mjs`
Expected: a `.webp` beside each `Elements/**/*.png`. Verify size: `du -sh public/forge/frames/Elements` should be far below the ~57 MB PNG total.

- [ ] **Step 4: Fetch libre fonts**

Run (downloads Arimo + Anton from the google/fonts repo):

```bash
cd public/forge/fonts
curl -fsSL -o Arimo-Regular.ttf  https://github.com/google/fonts/raw/main/apache/arimo/Arimo%5Bwght%5D.ttf
curl -fsSL -o Anton-Regular.ttf  https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf
cd -
ls -la public/forge/fonts
```

Expected: `Arimo-Regular.ttf` (variable, covers regular/bold) + `Anton-Regular.ttf` present. (If offline, the preview falls back to system fonts — note it and proceed; fonts can be added later.)

- [ ] **Step 5: Commit**

```bash
git add .gitignore scripts/forge-convert-frames.mjs "public/forge/frames/Elements" "public/forge/frames/Icons" public/forge/fonts public/forge/frames/README.md
git commit -m "chore(forge): WebP frame assets, libre fonts, ignore reference frames"
```

> Verify the commit does NOT include any `.png` under Elements, any `.ttf` that is proprietary, or the reference folders: `git show --stat HEAD | grep -iE "Complete Cards|Heroes/|\.png|Helvetica|Symphony" || echo "clean"`.

---

### Task 6: `<ForgeCardPreview>` component + fonts

**Files:**
- Create: `app/forge/components/ForgeCardPreview.tsx`
- Create: `app/forge/forge-fonts.css`
- Modify: `app/forge/layout.tsx` (import the CSS)

**Interfaces:**
- Consumes: `DesignCard` (Task 3); `washPath`, `statBoxPath`, `iconPath`, `isPreviewApproximate`, `BRIGADE_HEX` (Task 4).
- Produces: `export default function ForgeCardPreview(props: { card: DesignCard; artUrl?: string | null; className?: string })`.

This component has **no unit test** (the repo has no React-render test infra — matching `ArtPanel`/`AdminConsole`). Verification = `npm run build` compiles + visual check against `public/forge/frames/Complete Cards/` references. Geometry constants are a starting point to be tuned visually.

- [ ] **Step 1: Add the font faces**

Create `app/forge/forge-fonts.css`:

```css
@font-face {
  font-family: "ForgeBody"; /* Arimo — metric-compatible Helvetica substitute */
  src: url("/forge/fonts/Arimo-Regular.ttf") format("truetype");
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "ForgeTitle"; /* Anton — libre display face for card titles */
  src: url("/forge/fonts/Anton-Regular.ttf") format("truetype");
  font-weight: 400;
  font-display: swap;
}
```

- [ ] **Step 2: Import the CSS in the forge layout**

In `app/forge/layout.tsx`, add at the top (with the other imports):

```ts
import "./forge-fonts.css";
```

- [ ] **Step 3: Write the preview component**

Create `app/forge/components/ForgeCardPreview.tsx`:

```tsx
"use client";

import type { DesignCard } from "@/app/forge/lib/designCard";
import { isStatBearing } from "@/app/forge/lib/designCard";
import { washPath, statBoxPath, iconPath, isPreviewApproximate, BRIGADE_HEX } from "@/app/forge/lib/frameAssets";

// Slot geometry as % of the 750×1050 canvas. STARTING VALUES — tune visually
// against public/forge/frames/Complete Cards/ references.
const G = {
  wash:      { left: "4.8%", top: "3.5%", width: "90.4%", height: "93%" },
  art:       { left: "8.5%", top: "13%", width: "83%", height: "49%" },
  statBox:   { left: "4%", top: "3%", width: "22%", height: "11%" },
  title:     { left: "28%", top: "3.5%", width: "68%", height: "8%" },
  ability:   { left: "9%", top: "64%", width: "82%", height: "16%" },
  scripture: { left: "9%", top: "80%", width: "82%", height: "12%" },
  footer:    { left: "9%", top: "93%", width: "82%", height: "5%" },
} as const;

// eslint-disable-next-line @next/next/no-img-element
const Img = (p: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt="" {...p} />;

export default function ForgeCardPreview({
  card, artUrl, className,
}: { card: DesignCard; artUrl?: string | null; className?: string }) {
  const types = card.cardType ?? [];
  const wash = washPath(card);
  const firstBrigade = (card.brigades ?? [])[0];
  const fallbackColor = firstBrigade ? BRIGADE_HEX[firstBrigade] : "#cfcfcf";
  const statBox = statBoxPath(card);
  const icon = iconPath(card);
  const approximate = isPreviewApproximate(card);

  const abs = (g: { left: string; top: string; width: string; height: string }) =>
    ({ position: "absolute" as const, ...g });

  return (
    <div
      className={className}
      style={{ position: "relative", aspectRatio: "750 / 1050", width: "100%", fontFamily: "ForgeBody, system-ui, sans-serif" }}
    >
      {/* 1. white base */}
      <Img src="/forge/frames/Elements/White Border.png" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }} />
      {/* 2. brigade wash (image) or solid-color fallback */}
      {wash ? (
        <Img src={wash} style={{ ...abs(G.wash), zIndex: 1, objectFit: "cover", borderRadius: "5%" }} />
      ) : (
        <div style={{ ...abs(G.wash), zIndex: 1, background: fallbackColor, borderRadius: "5%" }} />
      )}
      {/* 3. art */}
      {artUrl && <Img src={artUrl} style={{ ...abs(G.art), zIndex: 2, objectFit: "cover" }} />}
      {/* 4. art frame */}
      <Img src="/forge/frames/Elements/Art Box.png" style={{ ...abs(G.art), zIndex: 3, width: G.art.width, height: G.art.height }} />
      {/* 5. stat box (stat-bearing types) */}
      {isStatBearing(types) && (
        <div style={{ ...abs(G.statBox), zIndex: 4, background: statBox ? undefined : fallbackColor, borderRadius: "10%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700 }}>
          {statBox && <Img src={statBox} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />}
          <span style={{ position: "relative", fontSize: "clamp(10px, 4vw, 28px)" }}>
            {card.strength ?? 0}/{card.toughness ?? 0}
          </span>
          {icon && <Img src={icon} style={{ position: "relative", height: "40%", marginTop: "2%" }} />}
        </div>
      )}
      {/* 6. title */}
      <div style={{ ...abs(G.title), zIndex: 5, display: "flex", alignItems: "center", justifyContent: "flex-end", color: "#fff", fontFamily: "ForgeTitle, ForgeBody, sans-serif", fontSize: "clamp(12px, 5vw, 34px)", textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>
        {card.name || "Card Title"}
      </div>
      {/* 8. ability */}
      <div style={{ ...abs(G.ability), zIndex: 5, overflow: "hidden", color: "#111", fontWeight: 700, textAlign: "center", fontSize: "clamp(8px, 2.6vw, 16px)", lineHeight: 1.15, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {card.specialAbility || ""}
      </div>
      {/* scripture + reference */}
      <div style={{ ...abs(G.scripture), zIndex: 5, overflow: "hidden", color: "#eee", fontStyle: "italic", fontSize: "clamp(7px, 2.2vw, 13px)", lineHeight: 1.15 }}>
        {card.flavorText || ""}
        <div style={{ textAlign: "right", fontStyle: "normal", fontWeight: 700 }}>{card.reference || ""}</div>
      </div>
      {/* footer */}
      <div style={{ ...abs(G.footer), zIndex: 5, display: "flex", justifyContent: "space-between", alignItems: "flex-end", color: "#fff", fontSize: "clamp(6px, 1.6vw, 10px)", opacity: 0.85 }}>
        <span>{card.artistCredit ? `Illus. ${card.artistCredit}` : "Illus. Artist Unknown"}</span>
        <span>© Cactus Game Design, Inc.</span>
      </div>
      {/* approximate badge */}
      {approximate && (
        <div style={{ position: "absolute", left: "50%", bottom: "1%", transform: "translateX(-50%)", zIndex: 6, background: "rgba(0,0,0,.7)", color: "#fff", fontSize: "9px", padding: "1px 6px", borderRadius: "4px" }}>
          preview approximate
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: build succeeds; `/forge` routes still compile. (No render test — visual check happens once the studio renders it in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add app/forge/components/ForgeCardPreview.tsx app/forge/forge-fonts.css app/forge/layout.tsx
git commit -m "feat(forge): ForgeCardPreview layered composite + libre @font-face"
```

---

### Task 7: Card actions — saveCard, listForgeCards, getCard

**Files:**
- Modify: `app/forge/lib/cards.ts`
- Test: `app/forge/lib/__tests__/cards.test.ts`

**Interfaces:**
- Consumes: `requireForge`/`requireElder` (auth.ts); `forge_save_card` RPC (Task 1); `DesignCard` (Task 3).
- Produces: `saveCard(cardId: string, snapshot: DesignCard): Promise<{ ok: boolean; error?: string; updatedAt?: string }>`; `getCard(cardId: string): Promise<ForgeCardFull | null>`; `listForgeCards(): Promise<ForgeCardFull[]>`; type `ForgeCardFull = { id: string; title: string | null; snapshot: DesignCard; hasArt: boolean; isPlaceholder: boolean; status: string; updatedAt: string }`.

- [ ] **Step 1: Write the failing test**

Create `app/forge/lib/__tests__/cards.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));
vi.mock("@/app/forge/lib/art", () => ({ validateArtFile: vi.fn(), uploadForgeArt: vi.fn() }));

import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { saveCard, getCard, listForgeCards } from "../cards";

function ctx(rpcImpl?: any, queryRows?: any[]) {
  const order = vi.fn(async () => ({ data: queryRows ?? [], error: null }));
  const eqList = vi.fn(() => ({ order }));
  const maybeSingle = vi.fn(async () => ({ data: (queryRows ?? [])[0] ?? null, error: null }));
  const eqOne = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ order, maybeSingle })) }));
  return {
    role: "elder",
    user: { id: "u1", email: "e@x" },
    supabase: {
      rpc: vi.fn(rpcImpl ?? (async () => ({ data: "2026-06-23T00:00:00Z", error: null }))),
      from: vi.fn(() => ({ select })),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("saveCard", () => {
  it("rejects when caller is not an elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await saveCard("c1", { name: "x" })).ok).toBe(false);
  });
  it("calls forge_save_card with the card id + snapshot and returns updatedAt", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const r = await saveCard("c1", { name: "Goliath", cardType: ["EvilCharacter"] });
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_save_card", { p_card_id: "c1", p_snapshot: { name: "Goliath", cardType: ["EvilCharacter"] } },
    ]);
    expect(r.updatedAt).toBe("2026-06-23T00:00:00Z");
  });
});

describe("getCard / listForgeCards", () => {
  it("returns null when not a member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await getCard("c1")).toBeNull();
    expect(await listForgeCards()).toEqual([]);
  });
  it("maps a row into ForgeCardFull", async () => {
    const row = { id: "c1", title: "Goliath", working_snapshot: { name: "Goliath" }, working_art_key: "k", working_art_is_placeholder: false, status: "private_idea", updated_at: "t" };
    (requireForge as any).mockResolvedValue(ctx(undefined, [row]));
    const got = await getCard("c1");
    expect(got).toMatchObject({ id: "c1", title: "Goliath", snapshot: { name: "Goliath" }, hasArt: true, status: "private_idea" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cards`
Expected: FAIL — `saveCard`/`getCard`/`listForgeCards` not exported.

- [ ] **Step 3: Add the actions**

In `app/forge/lib/cards.ts`, add the import and the new functions (keep the existing `createCard`/`uploadArt`/`setPlaceholder`; replace `listMyForgeCards` usage with `listForgeCards`). Add near the top:

```ts
import type { DesignCard } from "@/app/forge/lib/designCard";
```

Add these exports:

```ts
export type ForgeCardFull = {
  id: string;
  title: string | null;
  snapshot: DesignCard;
  hasArt: boolean;
  isPlaceholder: boolean;
  status: string;
  updatedAt: string;
};

function toFull(row: any): ForgeCardFull {
  return {
    id: row.id,
    title: row.title,
    snapshot: (row.working_snapshot ?? {}) as DesignCard,
    hasArt: !!row.working_art_key,
    isPlaceholder: !!row.working_art_is_placeholder,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

const CARD_COLS = "id, title, working_snapshot, working_art_key, working_art_is_placeholder, status, updated_at";

export async function saveCard(
  cardId: string,
  snapshot: DesignCard
): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_save_card", {
    p_card_id: cardId,
    p_snapshot: snapshot,
  });
  if (error) return { ok: false, error: "Could not save card" };
  revalidatePath(`/forge/ideas/${cardId}`);
  return { ok: true, updatedAt: typeof data === "string" ? data : undefined };
}

export async function getCard(cardId: string): Promise<ForgeCardFull | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select(CARD_COLS)
    .eq("id", cardId)
    .maybeSingle();
  return data ? toFull(data) : null;
}

// Caller's OWN cards only (single-author Phase 1a). Full snapshot is the caller's
// own data — used to render grid thumbnails.
export async function listForgeCards(): Promise<ForgeCardFull[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select(CARD_COLS)
    .eq("owner_id", ctx.user.id)
    .order("updated_at", { ascending: false });
  return (data ?? []).map(toFull);
}
```

Also update the existing `createCard` to revalidate `/forge/ideas` instead of `/forge/art`:

```ts
  revalidatePath("/forge/ideas");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- cards`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/cards.ts app/forge/lib/__tests__/cards.test.ts
git commit -m "feat(forge): saveCard / getCard / listForgeCards actions"
```

---

### Task 8: Studio shell — napkin mode, live preview, autosave

**Files:**
- Create: `app/forge/ideas/[cardId]/page.tsx`
- Create: `app/forge/ideas/[cardId]/StudioEditor.tsx`

**Interfaces:**
- Consumes: `getCard` (Task 7), `requireForge` (auth), `ForgeCardPreview` (Task 6), `saveCard` (Task 7), `DesignCard` (Task 3).
- Produces: the studio route. `StudioEditor` props: `{ card: ForgeCardFull }`.

Verification = build + visual (no render-test infra).

- [ ] **Step 1: Write the server page (gate-first)**

Create `app/forge/ideas/[cardId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import StudioEditor from "./StudioEditor";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ cardId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { cardId } = await params;
  const card = await getCard(cardId);
  if (!card) notFound();
  return <StudioEditor card={card} />;
}
```

- [ ] **Step 2: Write the studio shell (napkin + autosave + preview)**

Create `app/forge/ideas/[cardId]/StudioEditor.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { saveCard, type ForgeCardFull } from "@/app/forge/lib/cards";
import type { DesignCard } from "@/app/forge/lib/designCard";
import FullModeForm from "./FullModeForm";

export default function StudioEditor({ card }: { card: ForgeCardFull }) {
  const [snapshot, setSnapshot] = useState<DesignCard>(card.snapshot ?? {});
  const [fullMode, setFullMode] = useState<boolean>(!!card.snapshot?.cardType?.length);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autosave — always persists whatever is typed (never blocks).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      const r = await saveCard(card.id, snapshot);
      setSaved(r.ok ? "saved" : "error");
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [snapshot, card.id]);

  const update = (patch: Partial<DesignCard>) => setSnapshot((s) => ({ ...s, ...patch }));

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <Link href="/forge/ideas" className="text-muted-foreground hover:underline">← Ideas</Link>
        <div className="flex items-center gap-3">
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Private idea</span>
          <span className="text-xs text-muted-foreground">
            {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Save failed" : ""}
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
        {/* Preview (hero) — sticky on desktop, top on mobile */}
        <div className="md:sticky md:top-4 md:self-start">
          <ForgeCardPreview card={snapshot} artUrl={card.hasArt ? `/forge/api/art/${card.id}` : null} />
        </div>

        {/* Form */}
        <div className="space-y-4">
          {!fullMode ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={snapshot.name ?? ""}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Name your card… (just start typing)"
                className="w-full rounded-md border bg-background px-3 py-2 text-lg"
              />
              <textarea
                value={snapshot.specialAbility ?? ""}
                onChange={(e) => update({ specialAbility: e.target.value })}
                placeholder="Jot the idea — ability, theme, anything. No fields required."
                className="h-40 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <button onClick={() => setFullMode(true)} className="text-sm text-emerald-600 hover:underline">
                Add card details →
              </button>
            </div>
          ) : (
            <FullModeForm card={card} snapshot={snapshot} update={update} />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create a minimal `FullModeForm` placeholder so the shell compiles**

Create `app/forge/ideas/[cardId]/FullModeForm.tsx` (fleshed out in Task 9):

```tsx
"use client";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { DesignCard } from "@/app/forge/lib/designCard";

export default function FullModeForm(_props: {
  card: ForgeCardFull;
  snapshot: DesignCard;
  update: (patch: Partial<DesignCard>) => void;
}) {
  return <p className="text-sm text-muted-foreground">Full mode — fields land in Task 9.</p>;
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds; `/forge/ideas/[cardId]` compiles.

- [ ] **Step 5: Commit**

```bash
git add "app/forge/ideas/[cardId]/page.tsx" "app/forge/ideas/[cardId]/StudioEditor.tsx" "app/forge/ideas/[cardId]/FullModeForm.tsx"
git commit -m "feat(forge): studio shell — napkin mode, live preview, debounced autosave"
```

---

### Task 9: Full-mode form + art control

**Files:**
- Modify: `app/forge/ideas/[cardId]/FullModeForm.tsx`

**Interfaces:**
- Consumes: `cardApplicability`, `isStatBearing`, `CARD_TYPES`, `ALIGNMENTS`, `BRIGADES`, `LEGALITIES` (Task 3); `uploadArt`, `setPlaceholder` (existing `cards.ts`); `ForgeCardFull`, `DesignCard`.

- [ ] **Step 1: Implement the applicability-driven form + art control**

Replace `app/forge/ideas/[cardId]/FullModeForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadArt, setPlaceholder, type ForgeCardFull } from "@/app/forge/lib/cards";
import {
  CARD_TYPES, ALIGNMENTS, BRIGADES, LEGALITIES,
  cardApplicability, isStatBearing, type DesignCard, type CardType, type Brigade,
} from "@/app/forge/lib/designCard";

export default function FullModeForm({
  card, snapshot, update,
}: { card: ForgeCardFull; snapshot: DesignCard; update: (patch: Partial<DesignCard>) => void }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const types = snapshot.cardType ?? [];
  const app = cardApplicability(types);
  const show = (k: keyof typeof app) => app[k] !== "na";

  const toggle = <T,>(arr: T[] | undefined, v: T): T[] => {
    const a = arr ?? [];
    return a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
  };

  async function onUpload(file: File) {
    setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await uploadArt(card.id, fd);
    if (!r.ok) setErr(r.error ?? "Upload failed");
    else router.refresh();
  }

  return (
    <div className="space-y-4 text-sm">
      {err && <p className="text-red-500">{err}</p>}

      <label className="block">
        <span className="mb-1 block font-medium">Name</span>
        <input value={snapshot.name ?? ""} onChange={(e) => update({ name: e.target.value })}
          className="w-full rounded-md border bg-background px-3 py-2" />
      </label>

      <fieldset>
        <legend className="mb-1 font-medium">Card type</legend>
        <div className="flex flex-wrap gap-2">
          {CARD_TYPES.map((t) => (
            <button key={t} type="button"
              onClick={() => update({ cardType: toggle<CardType>(snapshot.cardType, t) })}
              className={`rounded-full border px-3 py-1 text-xs ${types.includes(t) ? "bg-emerald-600 text-white" : ""}`}>
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1 block font-medium">Alignment</span>
        <select value={snapshot.alignment ?? ""} onChange={(e) => update({ alignment: (e.target.value || undefined) as any })}
          className="rounded-md border bg-background px-3 py-2">
          <option value="">—</option>
          {ALIGNMENTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      {show("brigades") && (
        <fieldset>
          <legend className="mb-1 font-medium">Brigade{app.brigades === "required" ? "" : " (optional)"}</legend>
          <div className="flex flex-wrap gap-2">
            {BRIGADES.map((b) => (
              <button key={b} type="button"
                onClick={() => update({ brigades: toggle<Brigade>(snapshot.brigades, b) })}
                className={`rounded-full border px-3 py-1 text-xs ${(snapshot.brigades ?? []).includes(b) ? "bg-emerald-600 text-white" : ""}`}>
                {b}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {isStatBearing(types) && (
        <div className="flex gap-3">
          <label className="block"><span className="mb-1 block font-medium">Strength</span>
            <input type="number" value={snapshot.strength ?? ""} onChange={(e) => update({ strength: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-24 rounded-md border bg-background px-3 py-2" /></label>
          <label className="block"><span className="mb-1 block font-medium">Toughness</span>
            <input type="number" value={snapshot.toughness ?? ""} onChange={(e) => update({ toughness: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-24 rounded-md border bg-background px-3 py-2" /></label>
        </div>
      )}

      {show("specialAbility") && (
        <label className="block"><span className="mb-1 block font-medium">Special ability</span>
          <textarea value={snapshot.specialAbility ?? ""} onChange={(e) => update({ specialAbility: e.target.value })}
            className="h-28 w-full rounded-md border bg-background px-3 py-2" /></label>
      )}

      {show("reference") && (
        <label className="block"><span className="mb-1 block font-medium">Reference</span>
          <input value={snapshot.reference ?? ""} onChange={(e) => update({ reference: e.target.value })}
            placeholder="e.g. 2 Kings 25:8" className="w-full rounded-md border bg-background px-3 py-2" /></label>
      )}

      <label className="block"><span className="mb-1 block font-medium">Flavor text</span>
        <textarea value={snapshot.flavorText ?? ""} onChange={(e) => update({ flavorText: e.target.value })}
          className="h-20 w-full rounded-md border bg-background px-3 py-2" /></label>

      <label className="block"><span className="mb-1 block font-medium">Legality</span>
        <select value={snapshot.legality ?? ""} onChange={(e) => update({ legality: (e.target.value || undefined) as any })}
          className="rounded-md border bg-background px-3 py-2">
          <option value="">—</option>
          {LEGALITIES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select></label>

      {/* Art control (reuses 1a.3) */}
      <fieldset className="rounded-md border p-3">
        <legend className="px-1 font-medium">Art</legend>
        <input type="file" accept="image/jpeg,image/png,image/webp"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
          className="block w-full text-xs" />
        <div className="mt-2 flex gap-3">
          <button type="button" onClick={async () => { await setPlaceholder(card.id, !card.isPlaceholder); router.refresh(); }}
            className="text-emerald-600 hover:underline">
            {card.isPlaceholder ? "Unmark placeholder" : "Mark placeholder"}
          </button>
          {card.hasArt && <a href={`/forge/api/art/${card.id}?download=1`} className="text-emerald-600 hover:underline">Download original</a>}
        </div>
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Visual check**

Start dev (`npm run dev`), sign in as an elder, open a card under `/forge/ideas/[id]`, toggle "Add card details", set type Hero + a brigade + stats + ability, upload art. Confirm the live preview updates and "Saved" appears. Compare the rendered frame to `public/forge/frames/Complete Cards/`; note any geometry/icon offsets for tuning in the `G` constant (Task 6).

- [ ] **Step 4: Commit**

```bash
git add "app/forge/ideas/[cardId]/FullModeForm.tsx"
git commit -m "feat(forge): full-mode applicability-driven form + art control"
```

---

### Task 10: Ideas library

**Files:**
- Create: `app/forge/ideas/page.tsx`
- Create: `app/forge/ideas/IdeasLibrary.tsx`

**Interfaces:**
- Consumes: `requireForge` (auth), `listForgeCards` + `createCard` (cards.ts), `ForgeCardPreview` (Task 6), `CARD_TYPES`/`BRIGADES` (Task 3).

- [ ] **Step 1: Write the server page (gate-first)**

Create `app/forge/ideas/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listForgeCards } from "@/app/forge/lib/cards";
import IdeasLibrary from "./IdeasLibrary";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const cards = await listForgeCards();
  return <IdeasLibrary cards={cards} canCreate={ctx.role === "elder" || ctx.role === "superadmin"} />;
}
```

- [ ] **Step 2: Write the library client**

Create `app/forge/ideas/IdeasLibrary.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { createCard, type ForgeCardFull } from "@/app/forge/lib/cards";
import { CARD_TYPES, BRIGADES, type CardType, type Brigade } from "@/app/forge/lib/designCard";

export default function IdeasLibrary({ cards, canCreate }: { cards: ForgeCardFull[]; canCreate: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState<CardType | "">("");
  const [brigade, setBrigade] = useState<Brigade | "">("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => cards.filter((c) => {
    const s = c.snapshot ?? {};
    if (q && !(c.title ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    if (type && !(s.cardType ?? []).includes(type)) return false;
    if (brigade && !(s.brigades ?? []).includes(brigade)) return false;
    return true;
  }), [cards, q, type, brigade]);

  async function onNew() {
    setCreating(true);
    const r = await createCard("");
    setCreating(false);
    if (r.ok) router.push(`/forge/ideas/${r.id}`);
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
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
        {canCreate && (
          <button onClick={onNew} disabled={creating} className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            New card
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="mx-auto mt-16 max-w-xs text-center">
          <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
          <p className="mb-3 text-sm text-muted-foreground">No ideas yet. Start with a name and a thought.</p>
          {canCreate && <button onClick={onNew} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white">Jot an idea</button>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((c) => (
            <Link key={c.id} href={`/forge/ideas/${c.id}`} className="block transition hover:opacity-90">
              <ForgeCardPreview card={c.snapshot} artUrl={c.hasArt ? `/forge/api/art/${c.id}` : null} />
              <p className="mt-1 truncate text-xs text-muted-foreground">{c.title ?? "Untitled"}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build + visual**

Run: `npm run build` (expect success). Then `npm run dev`, open `/forge/ideas`: confirm the grid renders thumbnails, filters work, "New card" creates a card and routes to the studio, and the empty state shows when filters match nothing.

- [ ] **Step 4: Commit**

```bash
git add app/forge/ideas/page.tsx app/forge/ideas/IdeasLibrary.tsx
git commit -m "feat(forge): ideas library grid with type/brigade/search filters"
```

---

### Task 11: Route migration — retire `/forge/art`

**Files:**
- Modify: `app/forge/art/page.tsx` (redirect)
- Delete: `app/forge/art/ArtPanel.tsx`
- Modify: `app/forge/lib/cards.ts` (remaining `/forge/art` revalidate paths)
- Modify: `app/forge/page.tsx` (point any "art" desk link at `/forge/ideas`)

- [ ] **Step 1: Redirect the old route**

Replace `app/forge/art/page.tsx` entirely with:

```tsx
import { redirect } from "next/navigation";
export default function ArtRedirect() {
  redirect("/forge/ideas");
}
```

- [ ] **Step 2: Delete the superseded panel**

```bash
git rm app/forge/art/ArtPanel.tsx
```

- [ ] **Step 3: Fix remaining revalidate paths**

In `app/forge/lib/cards.ts`, change any remaining `revalidatePath("/forge/art")` (in `uploadArt` and `setPlaceholder`) to `revalidatePath("/forge/ideas")`. Verify none remain:

```bash
grep -rn "/forge/art" app/forge/lib/cards.ts || echo "clean"
```

- [ ] **Step 4: Update the desk landing**

In `app/forge/page.tsx`, if any link/card targets `/forge/art`, point it at `/forge/ideas` (label "Ideas"). If there is no such link, skip.

- [ ] **Step 5: Verify build + existing tests**

Run: `npm test` (the art-proxy route test still passes — it tests the API, not the panel) and `npm run build`.
Expected: PASS + build success. The art proxy `app/forge/api/art/[cardId]/route.ts` and `app/forge/lib/art.ts` are untouched.

- [ ] **Step 6: Commit**

```bash
git add app/forge/art/page.tsx app/forge/lib/cards.ts app/forge/page.tsx
git commit -m "refactor(forge): retire /forge/art panel, redirect to /forge/ideas"
```

---

### Task 12: Gate-first grep guardrail

**Files:**
- Create: `__tests__/forge-gate-first.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/forge-gate-first.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

// Every forge page/layout/route must call a gate. /forge has NO middleware
// coverage, so the in-file gate is the only defense for API routes.
function listFiles(): string[] {
  // Node 22's fs.globSync; if unavailable, fall back to a manual walk.
  const pattern = "app/forge/**/{page,layout}.tsx";
  const routes = "app/forge/**/route.ts";
  return [...globSync(pattern), ...globSync(routes)];
}

const GATE = /require(Forge|Elder|ForgeSuperadmin)\s*\(/;

describe("forge gate-first guardrail", () => {
  const files = listFiles().filter((f) => !f.includes("__tests__"));

  it("finds the forge route files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} calls a Forge gate`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(GATE.test(src), `${f} must call requireForge/requireElder/requireForgeSuperadmin`).toBe(true);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it passes (existing + new routes are all gated)**

Run: `npm test -- forge-gate-first`
Expected: PASS — every existing and new forge page/route (`/forge`, `/forge/welcome`, `/forge/admin`, `/forge/ideas`, `/forge/ideas/[cardId]`, the art route; `/forge/art` is now a redirect with no gate — see Step 3) matches the gate regex.

- [ ] **Step 3: Handle the redirect-only page**

`app/forge/art/page.tsx` is now a pure `redirect("/forge/ideas")` with no gate (it exposes nothing). Add it to an explicit allowlist in the test so the guardrail stays honest:

```ts
const ALLOW_NO_GATE = new Set(["app/forge/art/page.tsx"]); // pure redirect, no data
```
and filter: `const files = listFiles().filter((f) => !f.includes("__tests__") && !ALLOW_NO_GATE.has(f));`

Re-run: `npm test -- forge-gate-first` → PASS.

- [ ] **Step 4: Commit**

```bash
git add __tests__/forge-gate-first.test.ts
git commit -m "test(forge): gate-first guardrail for forge pages/routes"
```

---

## Final verification

- [ ] `npm test` — all hermetic tests pass (designCard, frameAssets, cards, gate-first, existing forge tests).
- [ ] `npm run test:security` — anon-leak guardrail passes (incl. new RPC probes; member-isolation block if env provided).
- [ ] `npm run build` — clean.
- [ ] Manual e2e (dev, signed in as elder): create a card → napkin type → live preview renders → autosave "Saved" → full mode (Hero + brigade + stats + ability + reference) → upload art → preview matches a `Complete Cards/` reference acceptably → back to `/forge/ideas`, card appears in the grid, filters work, `/forge/art` redirects.
- [ ] `git show --stat` across the branch confirms no proprietary fonts, no `Elements/**/*.png`, no reference frame folders were committed.

---

## Self-Review

**Spec coverage:**
- Migration 051 (content cols, enum, RLS fix, save RPC, superadmin helper) → Task 1. ✓
- Broadened leak guardrail (RPC probes + authenticated isolation) → Task 2. ✓
- `DesignCard` schema + applicability matrix + advisory validate → Task 3. ✓
- Faithful layered preview + fallback + fonts → Tasks 4 (assets map), 5 (asset prep), 6 (component). ✓
- Studio editor (napkin + full mode + autosave + art control + read-only status pill + mobile) → Tasks 8, 9. ✓
- Ideas library (grid + type/brigade/search + empty state, replaces /forge/art) → Tasks 10, 11. ✓
- Security: owner-or-superadmin policy (T1), trimmed-to-own-cards grid (T7/T10), gate-first test (T12), public-static frames + libre fonts (T5). ✓
- Deferrals honored: no sets/`set_id`, no `card_versions`/publish, no status stepper/RPC, no review layer. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases" steps; every code step shows complete code. The `G` geometry + icon map are explicitly "starting values, tuned visually" (a real, runnable baseline — not a placeholder), consistent with the spec calling preview fidelity the iterative long pole.

**Type consistency:** `ForgeCardFull` (T7) is consumed identically in T8/T9/T10. `DesignCard` field names (`cardType`, `brigades`, `strength`, `specialAbility`, `flavorText`, `reference`, `legality`, `artistCredit`) are consistent across designCard.ts (T3), frameAssets.ts (T4), ForgeCardPreview (T6), and the forms (T9). RPC name `forge_save_card` + args `{p_card_id, p_snapshot}` match between T1 (SQL), T2 (probe), and T7 (action). `washPath`/`statBoxPath`/`iconPath`/`isPreviewApproximate`/`BRIGADE_HEX` names match between T4 and T6.

**Known follow-ups (non-blocking, out of scope):** Red, Teal, and Evil Gold are unsupported brigades (no kit frame) and are not selectable. Icon mapping covers Hero/EvilCharacter/Site (others fall back to no icon) — improves as assets/visual tuning land. Dual-brigade stat box uses the first brigade's color element in v1.
