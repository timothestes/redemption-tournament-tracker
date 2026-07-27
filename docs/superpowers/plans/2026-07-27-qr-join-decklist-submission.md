# QR Tournament Join + Decklist Submission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players join tournaments by scanning a QR code (or typing a 6-char code); constructed events require a server-validated, immutably-snapshotted decklist to join; ending a tournament auto-publishes results + decklists to a new public results page.

**Architecture:** One migration adds `participants.user_id`, two policy columns on `tournaments`, a default-deny `tournament_deck_submissions` table (JSONB snapshots), a `tournament_join_blocks` table, and an atomic `tournament_qr_join` SQL function. All player-side reads/writes go through server actions using the service-role client with explicit checks (house style: `publishTournamentDecklistsAction`); host-side writes stay on the user-scoped client so existing RLS enforces authority. UI: public `/join` pages, a host QR dialog, wizard changes in the create modal, and a public results page.

**Tech Stack:** Next.js 15 App Router server actions, Supabase (Postgres + RLS + service role), `utils/deckcheck` validator, `qrcode.react` (new dep), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-27-qr-join-decklist-submission-design.md` (rev 4). Read it before starting any task.

## Global Constraints

- **Worktree:** all work in `../rtt-qr-join` on branch `feat/qr-join` off `origin/main` (`git worktree add ../rtt-qr-join -b feat/qr-join origin/main`). Absolute paths only; never touch the main checkout; never `git add -A` — stage named files only.
- **Migration number is 083** — 080 and 082 are reserved by open PRs #241/#245; 079/081 are the latest on main.
- **Join codes:** 6-char Crockford base32 (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no I, L, O, U), `crypto.randomBytes`, never `Math.random`.
- **Format reads:** always `normalizeFormat` / `normalizeTournamentFormat` from `lib/formats.ts`; never compare raw stored strings (prod holds `'T1'`, `'Type 1'`, null).
- **Zone filter:** every deck read for validation/snapshot uses `.in("zone", ["main", "reserve"])`. Never reuse `loadDeckByIdAction` (no zone filter, permits others' decks).
- **One read rule:** the card rows fed to `checkDeck` and the rows serialized into `deck_snapshot` must be the same in-memory array.
- **tsconfig has `strict: false`:** union narrowing via `if (r.success)` / `else` does NOT narrow — compare `=== false` / `=== true` explicitly (repo-known gotcha).
- **Server actions are open POST endpoints:** every action validates everything itself (auth, host/ownership, `has_started`, code match). Admin client = `getSupabaseAdmin()` from `lib/pricing/supabase-admin.ts`.
- **`checkDeck` needs request context** (imports `utils/supabase/server` via `sameCard.ts`) — call it only inside server actions/route handlers, never scripts.
- **UI conventions:** no `focus:ring-2 focus:ring-ring` on form controls; green accent reserved for hover/active/CTAs; shadcn `Dialog` components from `components/ui/dialog`.
- **Tests:** `npm run test -- <file>` (vitest). Type gate: `npx tsc --noEmit`. Do NOT run `next build` while a dev server runs (shared `.next`); use `NEXT_DIST_DIR=.next-build npm run build` if a build is needed.
- **Commits:** small, per task, message style `feat(join): …` / `feat(tracker): …` matching repo history. End commit messages with the Claude Code co-author trailer.

---

### Task 1: Migration 083 — schema + atomic join function

**Files:**
- Create: `supabase/migrations/083_qr_join_and_deck_submissions.sql`

**Interfaces:**
- Produces: tables `tournament_deck_submissions`, `tournament_join_blocks`; columns `participants.user_id`, `tournaments.require_decklists`, `tournaments.results_published`; function `tournament_qr_join(...)` returning jsonb; altered FK `tournament_decklists.deck_id` (nullable, SET NULL).
- Consumed by: Tasks 4–6 (actions call the function and read/write the tables via admin client).

- [ ] **Step 1: Write the migration file** with exactly this content:

```sql
-- 083: QR join + decklist submissions.
-- New surface is default-deny: service-role only, accessed via server actions.

-- 1) Link participants to accounts (host manual adds keep NULL).
alter table public.participants
  add column user_id uuid references auth.users(id) on delete set null;

create unique index participants_tournament_user_uniq
  on public.participants (tournament_id, user_id)
  where user_id is not null;

-- 2) Tournament policy knobs. code (join code) already exists + UNIQUE.
alter table public.tournaments
  add column require_decklists boolean not null default false,
  add column results_published boolean not null default false;

-- 3) The immutable submission record. Default-deny by construction.
create table public.tournament_deck_submissions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  participant_id uuid not null unique references public.participants(id) on delete cascade,
  deck_id uuid references public.decks(id) on delete set null, -- provenance only
  submitted_by uuid references auth.users(id) on delete set null,
  source text not null check (source in ('player', 'host')),
  deck_snapshot jsonb not null,
  is_legal boolean,
  deckcheck_issues jsonb,
  submitted_at timestamptz not null default now()
);
alter table public.tournament_deck_submissions enable row level security;
revoke all on public.tournament_deck_submissions from anon, authenticated;
-- No policies on purpose: service-role only (forge_invites precedent, 049).

-- 4) Rejoin blocks ("Remove & block").
create table public.tournament_join_blocks (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
alter table public.tournament_join_blocks enable row level security;
revoke all on public.tournament_join_blocks from anon, authenticated;

-- 5) Fix submission rot: deleting a live deck must not destroy the event
-- record. published_deck_id is already SET NULL; deck_id was CASCADE.
alter table public.tournament_decklists
  alter column deck_id drop not null;
alter table public.tournament_decklists
  drop constraint tournament_decklists_deck_id_fkey;
alter table public.tournament_decklists
  add constraint tournament_decklists_deck_id_fkey
  foreign key (deck_id) references public.decks(id) on delete set null;

-- 6) Atomic join. Locks the tournament row so joins serialize against the
-- host's Start update (has_started); inserts participant + submission +
-- decklist link in one transaction. Service-role only.
create or replace function public.tournament_qr_join(
  p_code text,
  p_user_id uuid,
  p_display_name text,
  p_deck_id uuid,
  p_snapshot jsonb,
  p_is_legal boolean,
  p_issues jsonb,
  p_resubmit boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t record;
  v_participant_id uuid;
begin
  select id, has_started, require_decklists into v_t
    from public.tournaments
    where code = p_code
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_t.has_started then
    return jsonb_build_object('ok', false, 'error', 'started');
  end if;
  if exists (
    select 1 from public.tournament_join_blocks b
    where b.tournament_id = v_t.id and b.user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;
  if v_t.require_decklists and p_snapshot is null then
    return jsonb_build_object('ok', false, 'error', 'decklist_required');
  end if;

  select id into v_participant_id
    from public.participants
    where tournament_id = v_t.id and user_id = p_user_id;

  if p_resubmit then
    if v_participant_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_joined');
    end if;
  else
    if v_participant_id is not null then
      return jsonb_build_object('ok', false, 'error', 'already_joined');
    end if;
    insert into public.participants (tournament_id, name, user_id)
      values (v_t.id, p_display_name, p_user_id)
      returning id into v_participant_id;
  end if;

  if p_snapshot is not null then
    insert into public.tournament_deck_submissions
      (tournament_id, participant_id, deck_id, submitted_by, source,
       deck_snapshot, is_legal, deckcheck_issues)
    values
      (v_t.id, v_participant_id, p_deck_id, p_user_id, 'player',
       p_snapshot, p_is_legal, p_issues)
    on conflict (participant_id) do update set
      deck_id = excluded.deck_id,
      submitted_by = excluded.submitted_by,
      source = excluded.source,
      deck_snapshot = excluded.deck_snapshot,
      is_legal = excluded.is_legal,
      deckcheck_issues = excluded.deckcheck_issues,
      submitted_at = now();

    if p_deck_id is not null then
      insert into public.tournament_decklists (tournament_id, participant_id, deck_id)
        values (v_t.id, v_participant_id, p_deck_id)
        on conflict (participant_id) do update set deck_id = excluded.deck_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'participant_id', v_participant_id);
end
$$;

revoke execute on function public.tournament_qr_join(text, uuid, text, uuid, jsonb, boolean, jsonb, boolean)
  from public, anon, authenticated;
```

- [ ] **Step 2: Sanity-check the `on conflict (participant_id)` target for `tournament_decklists`** — migration 017 declares `participant_id ... unique`, so the bare column conflict target works. Verify by reading `supabase/migrations/017_create_tournament_decklists.sql:5-9`. If the live constraint name differs, that's fine — `on conflict (participant_id)` targets the column, not the name.

- [ ] **Step 3: Validate the SQL — do NOT apply via the Supabase MCP during implementation: the configured MCP project IS PROD** (review-verified: its applied migrations include 080/082, which are live in prod only). Validate on a disposable Supabase **branch** (`create_branch` → `apply_migration` on the branch → checks below → `delete_branch`), or a local stack (`supabase start` + `db reset`) if available. Prod apply happens once, as the final pre-merge step with Tim's explicit go-ahead (Task 13). Verification queries:

```sql
select column_name from information_schema.columns
  where table_name = 'participants' and column_name = 'user_id';
select confdeltype from pg_constraint where conname = 'tournament_decklists_deck_id_fkey'; -- expect 'n' (SET NULL)
select proname from pg_proc where proname = 'tournament_qr_join';
select relrowsecurity from pg_class where relname = 'tournament_deck_submissions'; -- expect t
```

Also verify default-deny actually holds: with an `authenticated`-role connection (or via PostgREST with a user token), `select * from tournament_deck_submissions` must return a permission error or zero rows.

**Start-race note (explicit waiver):** the spec's "join committed under lock is visible to the pairing read" property rests on two review-verified facts — `handleStartTournament` is a single `has_started` UPDATE with pairing generation strictly after it (`app/tracker/tournaments/[id]/page.tsx:476-499`), and `tournament_qr_join` takes `FOR UPDATE` on the same row, so any join either commits before the Start UPDATE proceeds or fails the `has_started` check. A live two-session race test isn't runnable through the single-shot MCP; if a local psql is available, demonstrate it manually (session A: `begin; select * from tournaments where code='…' for update;` — session B's Start UPDATE blocks). Otherwise this waiver stands in for the spec §11 race test.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/083_qr_join_and_deck_submissions.sql
git commit -m "feat(join): migration 083 — submissions, blocks, user link, atomic qr join"
```

---

### Task 2: Join code generation + normalization (`lib/tournament/joinCodes.ts`)

**Files:**
- Create: `lib/tournament/joinCodes.ts`
- Test: `lib/tournament/__tests__/joinCodes.test.ts`

**Interfaces:**
- Produces: `generateJoinCode(): string` (6-char Crockford), `normalizeJoinCode(input: string): string | null` (null when the cleaned input isn't exactly 6 valid chars).
- Consumes: node `crypto` only.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { generateJoinCode, normalizeJoinCode } from "../joinCodes";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("generateJoinCode", () => {
  it("returns 6 chars from the Crockford alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(ALPHABET).toContain(ch);
    }
  });
  it("varies between calls", () => {
    const s = new Set(Array.from({ length: 50 }, () => generateJoinCode()));
    expect(s.size).toBeGreaterThan(45);
  });
});

describe("normalizeJoinCode", () => {
  it("uppercases and maps Crockford aliases", () => {
    // i/l -> 1, o -> 0, u -> V is NOT a Crockford alias — u is simply invalid.
    expect(normalizeJoinCode("abio1l")).toBe("AB1011");
  });
  it("strips whitespace and hyphens", () => {
    expect(normalizeJoinCode(" ab-c 123 ")).toBe("ABC123"); // cleans to 6 valid chars
    expect(normalizeJoinCode("abc-123")).toBe("ABC123");
  });
  it("rejects wrong length or invalid chars", () => {
    expect(normalizeJoinCode("ABCDE")).toBe(null);
    expect(normalizeJoinCode("ABCDEFG")).toBe(null);
    expect(normalizeJoinCode("ABC12U")).toBe(null);
    expect(normalizeJoinCode("")).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -- lib/tournament/__tests__/joinCodes.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { randomBytes } from "crypto";

// Crockford base32: no I, L, O, U. Codes are hand-typed from whiteboards.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ALIASES: Record<string, string> = { I: "1", L: "1", O: "0" };
export const JOIN_CODE_LENGTH = 6;

export function generateJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

/** Uppercase, strip separators, map Crockford aliases. Null if not exactly 6 valid chars. */
export function normalizeJoinCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .split("")
    .map((ch) => ALIASES[ch] ?? ch)
    .join("");
  if (cleaned.length !== JOIN_CODE_LENGTH) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}
```

(`bytes[i] % 32` over 256 byte values is exactly uniform: 256 = 8 × 32.)

- [ ] **Step 4: Run to verify pass** — same command, expect PASS.

- [ ] **Step 5: Commit** — `git add lib/tournament/joinCodes.ts lib/tournament/__tests__/joinCodes.test.ts && git commit -m "feat(join): join code generation + hand-typed normalization"`

---

### Task 3: Categories — Unofficial, decklist defaulting, generated frozen names

**Files:**
- Modify: `utils/tournament/categoryDefaults.ts`
- Create: `utils/tournament/naming.ts`
- Modify: `components/ui/tournament-form-modal.tsx`
- Modify: `app/tracker/tournaments/page.tsx` (creation handler + listing link params)
- Modify: `app/tournaments/tournaments-client.tsx:328` ("Host This Event" href)
- Test: `utils/tournament/__tests__/categoryDefaults.test.ts` (extend or create), `utils/tournament/__tests__/naming.test.ts`

**Interfaces:**
- Produces: `requireDecklistsDefault(category: string | null): boolean`; `buildTournamentName(category: string, opts?: { date?: Date; city?: string }): string`; `isNameFrozen(category: string | null): boolean`; `"Unofficial"` appended to `STANDARD_CATEGORIES`.
- Consumes: existing `categoryDefaults(category)` fuzzy matcher (order is load-bearing: paragon → teams → type 2 → draft/sealed → unlimited → default Limited).

- [ ] **Step 1: Write failing tests**

```ts
// utils/tournament/__tests__/naming.test.ts
import { describe, it, expect } from "vitest";
import { buildTournamentName, isNameFrozen } from "../naming";
import { requireDecklistsDefault, categoryDefaults, STANDARD_CATEGORIES } from "../categoryDefaults";

describe("buildTournamentName", () => {
  const d = new Date(2026, 7, 2); // Aug 2, 2026
  it("formats date + category", () => {
    expect(buildTournamentName("Type 2", { date: d })).toBe("Aug 2, 2026 Type 2 Tournament");
  });
  it("appends listing city", () => {
    expect(buildTournamentName("Type 1 Limited", { date: d, city: "Wichita" }))
      .toBe("Aug 2, 2026 Type 1 Limited Tournament — Wichita");
  });
});

describe("isNameFrozen", () => {
  it("frozen for official categories, free for Unofficial and none", () => {
    expect(isNameFrozen("Type 2")).toBe(true);
    expect(isNameFrozen("Unofficial")).toBe(false);
    expect(isNameFrozen(null)).toBe(false);
  });
});

describe("requireDecklistsDefault", () => {
  it("on when the category RESOLVES to L/U/T2 (listing strings included)", () => {
    expect(requireDecklistsDefault("Type 1 Limited")).toBe(true);
    expect(requireDecklistsDefault("Type 1 Unlimited")).toBe(true);
    expect(requireDecklistsDefault("Type 2")).toBe(true);
    // Listing-derived categories resolve through categoryDefaults' fuzzy match:
    expect(requireDecklistsDefault("Type 1")).toBe(true); // -> Limited fallthrough
    expect(requireDecklistsDefault("T2 - 2P")).toBe(true);
    // "Closed Deck - 2 Player" is the 2nd-most-common listing format (46 in
    // prod) and previously fell through to Limited — it's sealed product,
    // never decklist-required:
    expect(requireDecklistsDefault("Closed Deck - 2 Player")).toBe(false);
  });
  it("off for Teams/Type A despite resolving to Limited, and all non-constructed", () => {
    for (const c of ["Paragon", "Teams", "Type A", "Booster Draft", "Sealed Deck", "Unofficial", null]) {
      expect(requireDecklistsDefault(c)).toBe(false);
    }
  });
});

describe("Unofficial category", () => {
  it("is offered and maps to Other", () => {
    expect(STANDARD_CATEGORIES).toContain("Unofficial");
    expect(categoryDefaults("Unofficial").deck_format).toBe("Other");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -- utils/tournament/__tests__/naming.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In `categoryDefaults.ts`: append `"Unofficial"` to `STANDARD_CATEGORIES` (last position); add an `unofficial` branch to `categoryDefaults()` **before** the Limited fallthrough returning `{ deck_format: "Other", max_score: 5, round_length: 45 }`; extend the `sealed` branch to `if (c.includes("sealed") || c.includes("closed"))` — "Closed Deck - 2 Player" is the official listing term for sealed-product events (46 prod listing entries) and previously fell through to Limited; add:

```ts
/** Whether a decklist is required to QR-join, by category. Derives from the
 * category's RESOLVED format (so listing strings like "Type 1" count), with
 * explicit carve-outs: Type A and Teams also resolve to Limited but default
 * off (Type A construction rules would hard-block at the door; Teams pending
 * elder details). Hosts can flip per event. */
export function requireDecklistsDefault(category: string | null): boolean {
  if (!category) return false;
  const c = category.toLowerCase();
  if (c.includes("type a") || c.includes("teams") || c.includes("unofficial")) return false;
  const fmt = categoryDefaults(category).deck_format;
  return fmt === "Limited" || fmt === "Unlimited" || fmt === "T2";
}
```

(`categoryDefaults` maps Booster Draft / Sealed / Unofficial to `"Other"` and Paragon to `"Paragon"`, so those fall out of the format test naturally; the carve-outs handle the two Limited-resolving exceptions.)

New `utils/tournament/naming.ts` — move `buildAutoName`'s logic here (single source):

```ts
/** One formula everywhere: frozen generated names make events sort/group
 * predictably in the public dataset. */
export function buildTournamentName(
  category: string,
  opts?: { date?: Date; city?: string }
): string {
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(opts?.date ?? new Date());
  const base = `${date} ${category} Tournament`;
  return opts?.city ? `${base} — ${opts.city}` : base;
}

export function isNameFrozen(category: string | null): boolean {
  return !!category && category !== "Unofficial";
}
```

- [ ] **Step 4: Run tests** — expect PASS.

- [ ] **Step 5: Rewire the create modal** (`tournament-form-modal.tsx`):
  - Delete local `buildAutoName`; import `buildTournamentName` + `isNameFrozen` from `utils/tournament/naming` and use `buildTournamentName(cleanCategory(type))` wherever `buildAutoName(type)` was called (lines 70, 90, 98, 164-171).
  - **Category required:** `canSubmit` becomes `selected.length >= 1 && (isMulti || !isNameFrozen(selected[0]) ? name.trim().length > 0 : true)` — i.e. at least one category always; a name is only demanded when it's editable. Simplest correct form:

```ts
const frozen = selected.length === 1 && isNameFrozen(selected[0]);
const canSubmit =
  selected.length >= 1 && (isMulti || frozen || name.trim().length > 0);
```

  - **Frozen name UI:** when `frozen`, replace the name `<input>` with a read-only preview row (same styling as the multi list) showing `buildTournamentName(selected[0], { city: listingCity })` and helper text "Official events use standardized names." When category is `Unofficial`, keep the editable input.
  - The modal gains an optional `listingCity?: string` prop; `defaultName` no longer overrides generated names — remove the `defaultName ? defaultName : …` branch (keep the prop for now, unused, to avoid breaking the other call site until Step 6 removes it).
  - Update the multi-create helper text `"Rename any of them later from the tournaments list."` → `"Official event names are standardized."` (there is no rename UI in the app — verified — so the old copy was already wrong).
  - `handleSubmit` submits `buildTournamentName(c, { city: listingCity })` for frozen selections.

- [ ] **Step 6: Rewire the two creation entry points** (precise — these lines are load-bearing):
  - `app/tournaments/tournaments-client.tsx` (~line 328): change the Host This Event href params from `name=…` to `city=${encodeURIComponent(listing.city)}` (keep `from_listing` and `formats`).
  - `app/tracker/tournaments/page.tsx`:
    - `handleAddTournament` (lines 90-103): after `row.category = category`, add `row.require_decklists = requireDecklistsDefault(category);` (import it).
    - Search-param effect (lines 39-48): **keep** the `from_listing` (39) and `formats` (41) reads; replace the `name` read (40) with `const city = searchParams.get("city")` into a new `listingCity` state; change the auto-open gate at line 42 from `if (listingId && name)` to `if (listingId)`.
    - Remove `prefillName` entirely: state declaration (line 27), the clear in the post-create block (line 120), and the pass to the modal (line 336, `defaultName={prefillName}` → `listingCity={listingCity}`); also the clear in the modal `onClose` (line 330).
    - `openHostAnotherCategory` (lines 135-140): drop the `baseName` param and `setPrefillName` call. This flow has the listing's grouped event data on the page already — set `listingCity` from the listing group's city so the added category's generated name matches its siblings. **Accepted divergence:** the generated date is today's, not the original event date; a category added after the fact carries the date it was created. Note this in the commit message.
    - Delete the now-unused `defaultName` prop from `TournamentFormModal` (only one call site exists — verified).

- [ ] **Step 7: Type gate + run all touched tests** — `npx tsc --noEmit` and `npm run test -- utils/tournament` → PASS. Manually load `/tracker/tournaments`, open Add Tournament: category required, frozen preview shows, Unofficial keeps free text.

- [ ] **Step 8: Commit** — `git add utils/tournament/categoryDefaults.ts utils/tournament/naming.ts utils/tournament/__tests__/naming.test.ts components/ui/tournament-form-modal.tsx app/tracker/tournaments/page.tsx app/tournaments/tournaments-client.tsx && git commit -m "feat(tracker): required category, Unofficial, frozen generated names"`

---

### Task 4: Deck submission builder (`lib/tournament/deckSubmission.ts`)

**Files:**
- Create: `lib/tournament/deckSubmission.ts`
- Test: `lib/tournament/__tests__/deckSubmission.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DeckSnapshotCard {
  name: string; set: string; imgFile: string | null;
  quantity: number; zone: "main" | "reserve";
}
export interface DeckSnapshot {
  deckName: string; deckFormat: string; cards: DeckSnapshotCard[];
}
export type SubmissionBuild =
  | { success: true; snapshot: DeckSnapshot; isLegal: boolean;
      issues: DeckCheckIssue[]; hasUnresolvedCards: boolean }
  | { success: false; error: "deck_not_found" | "deck_not_accessible" };

export async function buildDeckSubmission(
  admin: SupabaseClient,
  deckId: string,
  requestingUserId: string,
  tournamentFormat: FormatId
): Promise<SubmissionBuild>;
```

- Consumes: `checkDeck` from `utils/deckcheck` (`checkDeck(cards, reserve, format)` → `{ valid, issues, stats }`), `DeckCheckCard = { name, set, quantity, imgFile? }`.
- Access rule enforced here: requester must own the deck OR `decks.visibility !== 'private'`.
- Callers decide policy: join/resubmit require `isLegal && !hasUnresolvedCards`; host attach records the verdict but does not block.

- [ ] **Step 1: Write failing tests.** `checkDeck` transitively imports `utils/supabase/server` (cookies) — mock it at module level; the unit under test is access control + the one-read/snapshot-shape contract:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/deckcheck", () => ({ // MUST match the implementation's "@/" specifier exactly or the mock silently doesn't apply
  checkDeck: vi.fn(async (cards, reserve) => ({
    valid: true,
    format: "Limited",
    issues: [{ type: "warning", rule: "card-not-found", message: "x", cards: ["Bogus"] }],
    stats: { mainDeckSize: cards.length, reserveSize: reserve.length },
  })),
}));
import { buildDeckSubmission } from "../deckSubmission";

function fakeAdmin(deckRow: any, cardRows: any[], calls: { in: any[] } = { in: [] }) {
  // Minimal PostgREST chain stub: .from().select().eq().single() for decks,
  // .from().select().eq().in() resolving cardRows for deck_cards.
  // Records .in() args so the maybeboard exclusion is actually asserted.
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: deckRow, error: deckRow ? null : { message: "not found" } }),
          in: async (col: string, vals: string[]) => {
            calls.in.push([col, vals]);
            return { data: cardRows, error: null };
          },
        }),
      }),
    }),
  } as any;
}

const deck = { id: "d1", user_id: "owner", name: "My Deck", format: "Limited", visibility: "private" };
const cards = [
  { card_name: "Son of God", card_set: "I/J", card_img_file: "sog.jpg", quantity: 1, zone: "main" },
  { card_name: "Burial", card_set: "I/J", card_img_file: null, quantity: 1, zone: "reserve" },
];

describe("buildDeckSubmission", () => {
  it("owner can submit a private deck; snapshot mirrors the validated rows; maybeboard excluded at the query", async () => {
    const calls = { in: [] as any[] };
    const r = await buildDeckSubmission(fakeAdmin(deck, cards, calls), "d1", "owner", "Limited");
    expect(r.success).toBe(true);
    if (r.success === true) {
      expect(r.snapshot.cards).toEqual([
        { name: "Son of God", set: "I/J", imgFile: "sog.jpg", quantity: 1, zone: "main" },
        { name: "Burial", set: "I/J", imgFile: null, quantity: 1, zone: "reserve" },
      ]);
      expect(r.hasUnresolvedCards).toBe(true); // card-not-found warning present
    }
    expect(calls.in).toContainEqual(["zone", ["main", "reserve"]]);
  });
  it("stranger blocked from private deck", async () => {
    const r = await buildDeckSubmission(fakeAdmin(deck, cards), "d1", "other", "Limited");
    expect(r.success).toBe(false);
    if (r.success === false) expect(r.error).toBe("deck_not_accessible");
  });
  it("stranger allowed on unlisted/public deck", async () => {
    const r = await buildDeckSubmission(
      fakeAdmin({ ...deck, visibility: "unlisted" }, cards), "d1", "other", "Limited");
    expect(r.success).toBe(true);
  });
  it("missing deck", async () => {
    const r = await buildDeckSubmission(fakeAdmin(null, []), "nope", "u", "Limited");
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -- lib/tournament/__tests__/deckSubmission.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { checkDeck, type DeckCheckCard, type DeckCheckIssue } from "@/utils/deckcheck";
import type { FormatId } from "@/lib/formats";
import type { SupabaseClient } from "@supabase/supabase-js";

// (interfaces from the block above)

export async function buildDeckSubmission(
  admin: SupabaseClient,
  deckId: string,
  requestingUserId: string,
  tournamentFormat: FormatId
): Promise<SubmissionBuild> {
  const { data: deck, error } = await admin
    .from("decks")
    .select("id, user_id, name, format, visibility")
    .eq("id", deckId)
    .single();
  if (error || !deck) return { success: false, error: "deck_not_found" };
  const isOwner = deck.user_id === requestingUserId;
  if (!isOwner && deck.visibility === "private")
    return { success: false, error: "deck_not_accessible" };

  const { data: rows, error: cardsError } = await admin
    .from("deck_cards")
    .select("card_name, card_set, card_img_file, quantity, zone")
    .eq("deck_id", deckId)
    .in("zone", ["main", "reserve"]); // maybeboard NEVER ships
  if (cardsError) return { success: false, error: "deck_not_found" };

  // ONE read: these rows are both what we validate and what we snapshot.
  const toCheckCard = (r: any): DeckCheckCard => ({
    name: r.card_name, set: r.card_set, quantity: r.quantity,
    imgFile: r.card_img_file ?? undefined,
  });
  const main = (rows ?? []).filter((r) => r.zone === "main").map(toCheckCard);
  const reserve = (rows ?? []).filter((r) => r.zone === "reserve").map(toCheckCard);

  const result = await checkDeck(main, reserve, tournamentFormat);

  return {
    success: true,
    snapshot: {
      deckName: deck.name ?? "Untitled Deck",
      // Provenance: the deck's DECLARED format. The validation format is
      // implied by the tournament + is_legal; don't overwrite the record.
      deckFormat: deck.format ?? "",
      cards: (rows ?? []).map((r) => ({
        name: r.card_name, set: r.card_set, imgFile: r.card_img_file ?? null,
        quantity: r.quantity, zone: r.zone,
      })),
    },
    isLegal: result.valid,
    issues: result.issues,
    hasUnresolvedCards: result.issues.some(
      (i) => i.rule === "card-not-found"
    ),
  };
}
```

- [ ] **Step 4: Run tests** — PASS. Adjust the stub chain if the real query shape differs (keep the implementation's query shape, fix the stub).

- [ ] **Step 5: Commit** — `git add lib/tournament/deckSubmission.ts lib/tournament/__tests__/deckSubmission.test.ts && git commit -m "feat(join): deck submission builder — one-read validate + snapshot"`

---

### Task 5: Player join actions (`app/join/actions.ts`)

**Files:**
- Create: `app/join/actions.ts`
- Test: `app/join/__tests__/actions.test.ts`

**Interfaces:**
- Produces:

```ts
export type JoinInfo = {
  success: true;
  tournamentName: string; category: string | null;
  deckFormat: FormatId | "Other" | null;
  requiresDecklist: boolean; hasStarted: boolean; hostName: string | null;
  joined: null | {
    displayName: string;
    submission: null | { deckName: string; submittedAt: string; isLegal: boolean | null };
  };
} | { success: false; error: "invalid_code" | "rate_limited" };

export async function getJoinInfoAction(rawCode: string): Promise<JoinInfo>;

export type JoinResult =
  | { success: true }
  | { success: false;
      error: "invalid_code" | "not_signed_in" | "started" | "blocked"
        | "already_joined" | "not_joined" | "decklist_required"
        | "deck_not_found" | "deck_not_accessible" | "deck_illegal"
        | "invalid_name" | "join_failed";
      issues?: DeckCheckIssue[] };

export async function joinTournamentAction(
  rawCode: string, params: { displayName: string; deckId?: string }
): Promise<JoinResult>;
export async function resubmitDeckAction(rawCode: string, deckId: string): Promise<JoinResult>;
```

- Consumes: `normalizeJoinCode` (Task 2), `buildDeckSubmission` (Task 4), `tournament_qr_join` RPC (Task 1), `getSupabaseAdmin` (`lib/pricing/supabase-admin.ts`), `createClient` (`utils/supabase/server`), `rateLimitForUnauthIp` + `extractClientIp` (`lib/api/rateLimit.ts`), `normalizeTournamentFormat` (`lib/formats.ts`), `headers()` from `next/headers` for IP.

- [ ] **Step 1: Write the shared core, actions first (TDD on the pure parts is impractical here — the value is in the pipeline order, so write the action, then integration-style tests with mocked clients).** Implementation outline (`"use server"` at top):

```ts
"use server";
import { headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { normalizeJoinCode } from "@/lib/tournament/joinCodes";
import { buildDeckSubmission } from "@/lib/tournament/deckSubmission";
import { normalizeTournamentFormat, type FormatId } from "@/lib/formats";
import { rateLimitForUnauthIp, extractClientIp } from "@/lib/api/rateLimit";
import type { DeckCheckIssue } from "@/utils/deckcheck";

const NAME_MAX = 40;

async function findTournamentByCode(code: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("tournaments")
    .select("id, name, category, deck_format, require_decklists, has_started, host_id, code")
    .eq("code", code)
    .maybeSingle();
  return data;
}

export async function getJoinInfoAction(rawCode: string): Promise<JoinInfo> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return { success: false, error: "invalid_code" };

  // Auth-aware first: signed-in users skip the IP throttle (the limiter
  // guards the ANONYMOUS enumeration surface; 30 players behind one venue
  // NAT must not exhaust it at QR-reveal time).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    try {
      const h = await headers();
      const ip = extractClientIp(new Request("http://x", { headers: h }));
      const rl = await rateLimitForUnauthIp(ip);
      if (rl.success === false) return { success: false, error: "rate_limited" };
    } catch {
      // Fail open: rateLimitForUnauthIp throws when KV_REST_API_* is unset
      // (fresh dev env, e2e CI). A missing limiter must not 500 the page.
    }
  }

  const t = await findTournamentByCode(code);
  if (!t) return { success: false, error: "invalid_code" };

  const admin = getSupabaseAdmin();
  const { data: hostProfile } = await admin
    .from("profiles").select("username").eq("id", t.host_id).maybeSingle();

  // Auth-aware extras (user client for identity only; reads stay admin-side).
  type JoinedInfo = Extract<JoinInfo, { success: true }>["joined"];
  let joined: JoinedInfo = null;
  if (user) {
    const { data: p } = await admin
      .from("participants").select("id, name")
      .eq("tournament_id", t.id).eq("user_id", user.id).maybeSingle();
    if (p) {
      const { data: sub } = await admin
        .from("tournament_deck_submissions")
        .select("deck_snapshot, submitted_at, is_legal")
        .eq("participant_id", p.id).maybeSingle();
      joined = {
        displayName: p.name ?? "",
        submission: sub
          ? { deckName: (sub.deck_snapshot as any)?.deckName ?? "Deck",
              submittedAt: sub.submitted_at, isLegal: sub.is_legal }
          : null,
      };
    }
  }

  return {
    success: true,
    tournamentName: t.name,
    category: t.category,
    deckFormat: normalizeTournamentFormat(t.deck_format),
    requiresDecklist: t.require_decklists === true,
    hasStarted: t.has_started === true,
    hostName: hostProfile?.username ?? null,
    joined,
  };
}
```

Join/resubmit share one worker:

```ts
async function submitToTournament(
  rawCode: string, deckId: string | undefined,
  displayName: string | null, resubmit: boolean
): Promise<JoinResult> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return { success: false, error: "invalid_code" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "not_signed_in" };

  const t = await findTournamentByCode(code);
  if (!t) return { success: false, error: "invalid_code" };
  if (t.has_started === true) return { success: false, error: "started" };

  let name: string | null = null;
  if (!resubmit) {
    name = (displayName ?? "").replace(/[\p{Cc}]/gu, "").trim().slice(0, NAME_MAX);
    if (!name) return { success: false, error: "invalid_name" };
  }

  const admin = getSupabaseAdmin();
  let snapshot = null, isLegal: boolean | null = null, issues: DeckCheckIssue[] = [];
  const format = normalizeTournamentFormat(t.deck_format);
  if (t.require_decklists === true) {
    if (!deckId) return { success: false, error: "decklist_required" };
    if (format === null || format === "Other")
      return { success: false, error: "decklist_required" }; // misconfigured event; host must set a format
    const built = await buildDeckSubmission(admin, deckId, user.id, format);
    if (built.success === false) return { success: false, error: built.error };
    if (built.isLegal === false || built.hasUnresolvedCards === true)
      return { success: false, error: "deck_illegal", issues: built.issues };
    snapshot = built.snapshot; isLegal = built.isLegal; issues = built.issues;
  }

  const { data, error } = await admin.rpc("tournament_qr_join", {
    p_code: code, p_user_id: user.id, p_display_name: name,
    p_deck_id: snapshot ? deckId : null, p_snapshot: snapshot,
    p_is_legal: isLegal, p_issues: issues.length ? issues : null,
    p_resubmit: resubmit,
  });
  if (error) return { success: false, error: "join_failed" };
  const out = data as { ok: boolean; error?: string };
  if (out.ok !== true) {
    // Explicit map from the SQL function's error strings; unknown -> join_failed.
    const SQL_ERRORS: Record<string, Extract<JoinResult, { success: false }>["error"]> = {
      not_found: "invalid_code",
      started: "started",
      blocked: "blocked",
      decklist_required: "decklist_required",
      already_joined: "already_joined",
      not_joined: "not_joined",
    };
    return { success: false, error: SQL_ERRORS[out.error ?? ""] ?? "join_failed" };
  }
  return { success: true };
}

export async function joinTournamentAction(rawCode, params) {
  return submitToTournament(rawCode, params.deckId, params.displayName, false);
}
export async function resubmitDeckAction(rawCode, deckId) {
  return submitToTournament(rawCode, deckId, null, true);
}
```

- [ ] **Step 2: Write integration tests** — `vi.mock` with the EXACT `@/`-aliased specifiers the implementation imports (`"@/utils/supabase/server"`, `"@/lib/pricing/supabase-admin"`, `"@/lib/api/rateLimit"`, `"@/lib/tournament/deckSubmission"`) **plus `"next/headers"`** (`headers: vi.fn(async () => new Headers())`) — bare specifiers resolve to different module ids and the mocks silently don't apply. Cover, at minimum: invalid code; rate-limited info (anon only — a mocked signed-in user must SKIP the limiter); limiter throwing → info still succeeds (fail-open); signed-out join → `not_signed_in`; started → `started`; decklist required but no deckId; format `Other` + require → `decklist_required`; illegal deck → `deck_illegal` with issues passed through; legal path calls `rpc("tournament_qr_join", …)` with `p_resubmit: false` and the SAME snapshot object returned by the builder; RPC `already_joined` and `blocked` surface with those exact errors; RPC `not_found` maps to `invalid_code`; resubmit passes `p_resubmit: true` and no display name requirement.

- [ ] **Step 3: Run** — `npm run test -- app/join/__tests__/actions.test.ts` → PASS.

- [ ] **Step 4: Commit** — `git add app/join/actions.ts app/join/__tests__/actions.test.ts && git commit -m "feat(join): player join/resubmit/info server actions"`

---

### Task 6: Host-side actions (tracker `actions.ts`)

**Files:**
- Modify: `app/tracker/tournaments/actions.ts`
- Test: `app/tracker/tournaments/__tests__/joinHostActions.test.ts`

**Interfaces:**
- Produces (all exported from `app/tracker/tournaments/actions.ts`):

```ts
export async function setQrJoinEnabledAction(tournamentId: string, enabled: boolean):
  Promise<{ success: boolean; code?: string | null; error?: string }>;
export async function updateJoinSettingsAction(tournamentId: string,
  s: { deckFormat: FormatId | "Other"; requireDecklists: boolean }):
  Promise<{ success: boolean; error?: string }>;
export async function getJoinStatsAction(tournamentId: string):
  Promise<{ success: boolean; joined: number; submitted: number }>;
export async function getSubmissionAction(tournamentId: string, participantId: string):
  Promise<{ success: boolean; submission?: { snapshot: DeckSnapshot; isLegal: boolean | null;
    issues: DeckCheckIssue[]; submittedAt: string; source: "player" | "host";
    submittedByUsername: string | null } ; error?: string }>;
export async function removeParticipantWithBlockAction(tournamentId: string,
  participantId: string, block: boolean): Promise<{ success: boolean; error?: string }>;
export async function recheckAllSubmissionsAction(tournamentId: string):
  Promise<{ success: boolean; rechecked: number; nowIllegal: number; error?: string }>;
export async function setResultsPublishedAction(tournamentId: string, published: boolean):
  Promise<{ success: boolean; error?: string }>;
```

- Modifies: `loadTournamentDecklistsAction` (returns `submission` summary per row), `attachDeckToParticipantAction` (writes snapshot), `detachDeckFromParticipantAction` (deletes submission), `publishTournamentDecklistsAction` (snapshot-first copies).
- Consumes: `generateJoinCode` (Task 2), `buildDeckSubmission` (Task 4), `checkDeck`, tables from Task 1.
- **Authority pattern:** writes on `tournaments` (`code`, `require_decklists`, `deck_format`, `results_published`) go through the **user-scoped** client (`createClient()`) so `host_can_access_tournaments` RLS enforces authority. Any admin-client read/write on the default-deny tables MUST first verify `tournaments.host_id === auth.uid()` via a helper:

```ts
async function requireHost(tournamentId: string):
  Promise<{ userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: t } = await supabase
    .from("tournaments").select("id").eq("id", tournamentId).maybeSingle();
  // RLS: only the host can see the row at all.
  return t ? { userId: user.id } : null;
}
```

- [ ] **Step 1: Implement `setQrJoinEnabledAction`.** Enabled: loop up to 5 attempts — `generateJoinCode()`, user-client `update({ code }).eq("id", id).select("code").single()`; on Postgres unique violation (`error.code === "23505"`) retry; other error → fail. Disabled: `update({ code: null })`. RLS makes non-host updates hit zero rows — treat `data == null` as `{ success: false, error: "not_found" }`.

- [ ] **Step 2: Implement `updateJoinSettingsAction`** — user-client update of `deck_format` + `require_decklists`; reject `requireDecklists === true` when `deckFormat === "Other"` with error `"format_required"`.

  **`setResultsPublishedAction(id, true)` must also persist final places.** `participants.place` is written in exactly one existing spot — inside `publishTournamentDecklistsAction` (`actions.ts:270-282`) — so a results-only publish would render an empty Place column. Extract that place-computation block into a shared `async function persistFinalPlaces(tournamentId: string)` and call it from BOTH `setResultsPublishedAction(…, true)` and `publishTournamentDecklistsAction` (replacing the inline block). The user-client `results_published` update itself stays RLS-enforced.

- [ ] **Step 3: Implement `getJoinStatsAction`** — after `requireHost`, user-client `select("id", { count: "exact", head: true })` on participants; admin-client count on `tournament_deck_submissions` filtered by tournament.

- [ ] **Step 4: Rework the decklist row loader + attach/detach.**
  - `loadTournamentDecklistsAction`: after the existing query, `requireHost` then admin-read `tournament_deck_submissions` for the tournament (`participant_id, deck_snapshot, is_legal, submitted_at, source`) and merge into each returned row: `submission: { deckName, cardCount: snapshot.cards.reduce((n,c)=>n+c.quantity,0), isLegal, submittedAt, source } | null`. Rows whose `decks` join failed (private deck → name "Unknown") take name/count from the snapshot instead.
  - `attachDeckToParticipantAction(tournamentId, participantId, deckId)`: keep the existing upsert; then `requireHost` + `buildDeckSubmission(admin, deckId, hostUserId, format)` where `format = normalizeTournamentFormat(tournament.deck_format)`; when format is null/'Other', run under `"Limited"`? — **No: skip the verdict entirely** and store `is_legal: null, issues: null` with the snapshot built from a plain zone-filtered read (no checkDeck) — validation without a declared format is meaningless. Upsert into `tournament_deck_submissions` with `source: 'host'`, `submitted_by: hostUserId`.
  - `detachDeckFromParticipantAction(participantId)`: **the current implementation is a bare user-client delete with NO read** (`actions.ts:203-217`) — do not bolt an admin-delete onto it keyed only on `participantId`, or any authenticated user can destroy any submission through this open POST endpoint. Rework: run the existing user-client delete with `.select("tournament_id")` appended; only when it returns a deleted row (proof the caller passed the host RLS policy) admin-delete the `tournament_deck_submissions` row for that participant. Zero rows deleted → return failure, touch nothing.

- [ ] **Step 5: `getSubmissionAction`, `removeParticipantWithBlockAction`, `recheckAllSubmissionsAction`.**
  - `getSubmissionAction`: `requireHost` → admin-read the row; resolve `submitted_by` → `profiles.username` (admin).
  - `removeParticipantWithBlockAction`: `requireHost` → admin-read participant (`user_id`), user-client delete of the participant row (RLS-checked); when `block === true && user_id != null`, admin-insert `(tournament_id, user_id)` into `tournament_join_blocks` (`on conflict do nothing` via `.upsert` with `ignoreDuplicates: true`).
  - `recheckAllSubmissionsAction`: `requireHost` → admin-read all submissions with snapshots; for each: rebuild `DeckCheckCard[]` from `snapshot.cards` (split by zone) → `checkDeck(main, reserve, format)` under the tournament's current normalized format → admin-update `is_legal`, `deckcheck_issues`. Skip (count separately) when format resolves null/'Other'. Return counts.
  - `publishTournamentDecklistsAction`: in the per-decklist loop, if a submission exists for the participant, create the public deck copy from `snapshot.cards` (insert `deck_cards` rows from the snapshot: `card_name: c.name, card_set: c.set, card_img_file: c.imgFile, quantity, zone`) and carry `is_legal`/`deckcheck_issues` from the submission; otherwise keep the current live-deck copy path. Guard the existing live-deck path against `deck_id === null` rows (now possible): skip with a warning entry when neither snapshot nor live deck exists. Update `TournamentDecklistRow.deck_id` (`actions.ts:23`) to `string | null` so `tsc` flags every consumer.

- [ ] **Step 6: Tests** (`vi.mock` with `@/`-aliased specifiers: `"@/utils/supabase/server"`, `"@/lib/pricing/supabase-admin"`, `"@/lib/tournament/deckSubmission"`): non-host `setQrJoinEnabledAction` → zero-row update → failure; 23505 retry loop generates a second code; `updateJoinSettingsAction` rejects require+Other; detach with a zero-row user-client delete touches NO submission row; `removeParticipantWithBlockAction` inserts block only when block=true and user-linked; `recheckAllSubmissionsAction` updates verdicts from snapshots; `setResultsPublishedAction(true)` calls `persistFinalPlaces`; publish prefers snapshot over live deck. Run: `npm run test -- app/tracker/tournaments/__tests__/joinHostActions.test.ts` → PASS.

- [ ] **Step 7: Commit** — `git add app/tracker/tournaments/actions.ts app/tracker/tournaments/__tests__/joinHostActions.test.ts && git commit -m "feat(tracker): host join controls, submission merge, snapshot publish"`

---

### Task 7: Join pages (`/join`, `/join/[code]`)

**Files:**
- Create: `app/join/page.tsx` (code-entry landing, public)
- Create: `app/join/[code]/page.tsx` (server component shell)
- Create: `app/join/[code]/JoinClient.tsx` (client component — states + form)
- Create: `app/join/[code]/DeckPicker.tsx` (client component)

**Interfaces:**
- Consumes: `getJoinInfoAction`, `joinTournamentAction`, `resubmitDeckAction` (Task 5); `loadUserDecksAction`, `loadPublicDeckAction`, `searchDecksForTournamentAction` (existing, `app/decklist/actions.ts` / `app/tracker/tournaments/actions.ts`); `normalizeFormat`, `FORMATS` (`lib/formats.ts`); `normalizeJoinCode` (client-safe, no node deps in that function's module? — **it imports `crypto` at module top; split**: move `normalizeJoinCode` + `JOIN_CODE_LENGTH` into `lib/tournament/joinCodeShared.ts` with no crypto import; `joinCodes.ts` re-exports them. Do this refactor in this task, update Task 2's test import path only if needed).
- Produces: routes only.

- [ ] **Step 1: `/join` landing** — small centered card: heading "Join a tournament", 6-char input (auto-uppercase, `inputMode="text"`, `autoCapitalize="characters"`), on submit `router.push('/join/' + normalizeJoinCode(value))`, inline error when normalize returns null. No auth required.

- [ ] **Step 2: `/join/[code]/page.tsx`** — server component. Next 15 async params: `const { code } = await params;` then `const info = await getJoinInfoAction(code)` (precedent: `app/invite/[token]/page.tsx:15`); also `createClient()` → `getUser()` for signed-in state and `profiles.username` prefill. Render `<JoinClient info={info} code={params.code} signedIn={!!user} defaultName={username ?? ""} />`. `export const dynamic = "force-dynamic"`.

- [ ] **Step 3: `JoinClient` states** (mobile-first, single column, Cinzel header for the event name):
  - `info.success === false` → invalid/rate-limited error card with a "Enter a code" link to `/join`.
  - `hasStarted === true && joined === null` → "This event has already started."
  - `signedIn === false` → event card (name, category badge via `FORMATS[deckFormat]?.badge`, host name) + primary button linking `/sign-in?redirectTo=/join/${code}` (precedent: `app/invite/[token]/page.tsx:23`).
  - `joined !== null` → registered state: display name, submission summary (deck name, submitted time, legality badge), a `DeckPicker` behind a "Change decklist" button (calls `resubmitDeckAction`), disabled with explainer once started. Re-render from a fresh `getJoinInfoAction` after any action (handles host-removed → back to join form).
  - Otherwise → join form: display-name input (`maxLength={40}`, prefilled `defaultName`), `DeckPicker` shown when `requiresDecklist === true`, consent line verbatim from the spec: *"Your decklist will be visible to the host. When the event ends, your display name, final standing, and decklist will be published with the results unless the host withholds them."* Submit calls `joinTournamentAction(code, { displayName, deckId })`; on `deck_illegal`, render `issues` as a list (message text per issue, error type first) + a link `/decklist/card-search?deckId=<deckId>` "Open in deck builder" (the builder reads `deckId` — `card-search/client.tsx:178` — NOT `deck`); map other errors to friendly copy (`blocked`: "The host has blocked you from this event"; `already_joined`: refresh info).
- [ ] **Step 4: `DeckPicker`** — three sources in one component:
  - Tab "My decks": `loadUserDecksAction()` once; client-side search box; sort compatible-first: compatible = `normalizeFormat(deck.format) === tournamentFormat || (tournamentFormat === "Unlimited" && normalizeFormat(deck.format) === "Limited")`; incompatible rendered below a divider with an amber "different format — will be validated as {tournament format}" note, still selectable.
  - Tab "Community": input + `searchDecksForTournamentAction(query)` (already returns own + public).
  - "Paste a link": input accepting a full `/decklist/<uuid>` URL or bare uuid; extract the uuid (`/([0-9a-f-]{36})/i`), `loadPublicDeckAction(id)` to preview name/format before selecting.
  - Selection state lifts to `JoinClient` via `onSelect(deckId, deckName)`.
- [ ] **Step 5: Manual verification** with the dev server + a dev-DB tournament: full signed-out → sign-in → join → resubmit loop on a phone-width viewport. Check `/join/BADCODE` and a disabled-code tournament.
- [ ] **Step 6: Type gate** — `npx tsc --noEmit` → clean.
- [ ] **Step 7: Commit** — `git add app/join lib/tournament/joinCodeShared.ts lib/tournament/joinCodes.ts && git commit -m "feat(join): public join pages with deck picker"`

---

### Task 8: QR dialog + participants-tab integration

**Files:**
- Create: `components/ui/QRJoinDialog.tsx`
- Modify: `components/ui/TournamentTabs.tsx` (toolbar button ~line 179-201; decklist summary line)
- Modify: `app/tracker/tournaments/[id]/page.tsx` (mount dialog, pass tournament)
- Modify: `package.json` (add `qrcode.react`)

**Interfaces:**
- Consumes: `setQrJoinEnabledAction`, `updateJoinSettingsAction`, `getJoinStatsAction` (Task 6); `FORMATS` registry; `requireDecklistsDefault` (Task 3).
- Produces: `<QRJoinDialog tournament={...} isOpen onClose onTournamentUpdated />`.

- [ ] **Step 1: `npm install qrcode.react`** (renders SVG client-side; no server dep).
- [ ] **Step 2: Build `QRJoinDialog`:**
  - Disabled state: explainer + format `<select>` (registry ids + "Other") defaulting from `normalizeTournamentFormat(tournament.deck_format)`, "Require decklist to join" checkbox defaulting per `requireDecklistsDefault(tournament.category)`, Enable button → `updateJoinSettingsAction` then `setQrJoinEnabledAction(id, true)`.
  - Enabled state: `<QRCodeSVG value={`${window.location.origin}/join/${code}`} size={280} />`, the code in large mono type, copy-URL button, the two knobs still editable (require toggle disabled+explained when format is "Other"), joined/submitted counter from `getJoinStatsAction` polled every 5 s while open (`useEffect` + `setInterval`, cleared on close), Disable button.
  - Visible only when `!has_started && !has_ended` (same condition as Start button, `page.tsx:778-797`).
- [ ] **Step 3: Wire into `TournamentTabs`** Participants toolbar next to Add Participant: button "QR Join" (icon: `FaQrcode` from react-icons, already a repo dep). Add the pre-start summary line under the toolbar when the tournament requires decklists: "N of M participants have decklists" — data via a `decklistSummary` prop passed down from the page (the page already loads decklists; extend with submissions count from `loadTournamentDecklistsAction`'s merged rows). Pass the same `decklistSummary` into `TournamentStartModal` (`app/tracker/tournaments/[id]/page.tsx:1099-1102`) and render the "N of M" line in the Start confirmation body — the spec requires it in both places.
- [ ] **Step 4: Manual verification** — enable, scan the QR with a phone against the LAN dev URL (or paste the URL), watch the counter tick after a join. Toggle disable → `/join/<oldcode>` shows invalid.
- [ ] **Step 5: Commit** — `git add components/ui/QRJoinDialog.tsx components/ui/TournamentTabs.tsx 'app/tracker/tournaments/[id]/page.tsx' package.json package-lock.json && git commit -m "feat(tracker): QR join dialog with live counter"`

---

### Task 9: Participant table — account badge, snapshot modal, remove & block

**Files:**
- Modify: `components/ui/ParticipantTable.tsx`
- Create: `components/ui/SubmissionModal.tsx`
- Modify: `app/tracker/tournaments/[id]/page.tsx` (pass through new row fields)

**Interfaces:**
- Consumes: `loadTournamentDecklistsAction` merged rows (Task 6: `submission` summary), `getSubmissionAction`, `removeParticipantWithBlockAction` (Task 6).
- Produces: UI only.

- [ ] **Step 1: Account linkage display.** Participant rows now carry `user_id`; the page's participant query (`select("*")`) already returns it. For linked rows, show the linked `profiles.username` in muted small text beside the display name (fetch usernames in one batched query on the page: `supabase.from("profiles").select("id, username").in("id", userIds)` — profiles are publicly readable). Tooltip: "Joined via QR with account @username".
- [ ] **Step 2: Decklist cell.** When a row's `submission` exists: deck name + card count from the summary, legality dot (green/red/gray for null), click → `SubmissionModal` (fetch full snapshot via `getSubmissionAction`; render main and reserve sections, each **grouped by card type** — resolve types client-side via `findCard` from `lib/cards/lookup` (build-time generated data, client-safe), unresolved names under "Other"; `quantity× name (set)` rows; submitted-at, source, issues list when not legal). When only a live attach exists (no submission), keep today's behavior. The `/decklist/${deck_id}` link renders only when `deck_id != null` AND the joined deck row resolved (not "Unknown").
- [ ] **Step 2b: "Re-check all decklists" button** in the decklist section of the Participants tab (host-only, visible when any submission exists): calls `recheckAllSubmissionsAction`, toast with "`rechecked` re-checked, `nowIllegal` now illegal" — this is the season-boundary tool from spec §7; without a control the Task 6 action is a dead endpoint.
- [ ] **Step 3: Remove & block.** The existing remove-participant control gains, for rows with `user_id`, a confirm dialog with two buttons: "Remove" and "Remove & block" → `removeParticipantWithBlockAction(tournamentId, participantId, block)`. Free-text rows keep the current single confirm.
- [ ] **Step 4: Manual verification** on the dev tournament from Task 8: QR-joined row shows badge + submission; removed & blocked account gets `blocked` on rejoin attempt.
- [ ] **Step 5: Commit** — `git add components/ui/ParticipantTable.tsx components/ui/SubmissionModal.tsx 'app/tracker/tournaments/[id]/page.tsx' && git commit -m "feat(tracker): linked-account rows, submission modal, remove & block"`

---

### Task 10: End-tournament auto-publish

**Files:**
- Modify: `app/tracker/tournaments/[id]/page.tsx` (`handleTournamentStatusToggle` :233, `performEndTournament` :248, existing end-confirm dialog :1117-1123, `handleEndRound` final-round branch :415-424)
- Modify: `components/ui/PublishDecklistsSection.tsx` (results toggle alongside decklists)

**Interfaces:**
- Consumes: `publishTournamentDecklistsAction` (snapshot-first, Task 6), `setResultsPublishedAction` (Task 6).
- Produces: end-confirmation dialog with opt-out.

- [ ] **Step 1: There are TWO end paths — hook both** (review-verified; missing the second silently defeats auto-publish for most events, because tournaments usually end by completing the final round):
  1. **Manual end**: `handleTournamentStatusToggle` (page.tsx:233) → sets `endTournamentConfirmOpen` (line 245) → an **existing** confirm dialog (rendered lines 1117-1123) → `performEndTournament` (line 248). Do NOT add a second dialog. Extend the existing one with the checkbox (default **checked**) "Publish results and decklists" and a body line "Results and decklists publish automatically when the event ends."
  2. **Auto end on final round**: `handleEndRound`'s `if (round === tournament.n_rounds)` branch (page.tsx:415-424) sets `has_ended: true` directly. Route both paths through one helper:

```ts
// after has_ended is committed (either path):
async function publishOnEnd(publish: boolean) {
  if (!publish) return;
  const results = await setResultsPublishedAction(id, true);
  const decks = await publishTournamentDecklistsAction(id, tournament?.deck_format ?? "Other");
  // "No decklists to publish" is NORMAL for events without submissions —
  // treat it as success for the toast, not a failure (actions.ts:256-258).
  const deckFailure = decks.success === false && decks.error !== "No decklists to publish";
  if (results.success === false || deckFailure) {
    showToast("Ended, but publishing failed — use the Publish section.", "warning");
  } else {
    showToast("Tournament ended — results published.", "success");
  }
}
```

  The auto-end path publishes with `publish: true` unconditionally (no dialog exists there; the host's opt-out for auto-ended events is unpublishing afterward — note this in the PR description). Publish failures never roll back the end.
- [ ] **Step 2: Post-end controls.** In `PublishDecklistsSection`, add a "Results page" row: status line (published + link to `/tournaments/results/${id}`, or private), toggle button calling `setResultsPublishedAction`. Decklist publish/unpublish rows stay as they are.
- [ ] **Step 3: Manual verification** — end a dev tournament with the box checked: `results_published` true, published deck copies exist; repeat with box unchecked: both stay private; publish later from the section.
- [ ] **Step 4: Commit** — `git add 'app/tracker/tournaments/[id]/page.tsx' components/ui/PublishDecklistsSection.tsx && git commit -m "feat(tracker): auto-publish results + decklists at tournament end"`

---

### Task 11: Public results page + Results tab

**Files:**
- Create: `app/tournaments/results/page.tsx` (index of published events)
- Create: `app/tournaments/results/[id]/page.tsx` (one event)
- Modify: `app/tournaments/actions.ts` (two public loaders)
- Modify: `app/tournaments/tournaments-client.tsx` (add a "Recent results" link in the page header area) and `app/tournaments/history/NavTabs.tsx` (add a `<Link href="/tournaments/results">` styled like the existing tab buttons). Reality check (review-verified): NavTabs is a **local view-state switcher consumed only by `HistoryClient.tsx:165`** — its `TABS` are `onClick={() => setView(id)}` buttons, so the Results entry is a deliberate pattern-break `<Link>` and appears only on `/tournaments/history`; the `/tournaments` listings page needs its own link, hence both edits.

**Interfaces:**
- Produces (in `app/tournaments/actions.ts`, `"use server"`):

```ts
export async function loadPublicResultsIndexAction(limit = 50): Promise<{
  success: boolean;
  events: { id: string; name: string; category: string | null;
    deckFormat: string | null; endedAt: string | null; playerCount: number }[];
}>;
export async function loadPublicResultsAction(tournamentId: string): Promise<
  | { success: false }
  | { success: true;
      name: string; category: string | null; deckFormat: FormatId | "Other" | null;
      endedAt: string | null; decklistsPublished: boolean;
      standings: { place: number | null; name: string | null;
        matchPoints: number | null; differential: number | null;
        publishedDeckId: string | null }[] }>;
```

- Consumes: admin client; `normalizeTournamentFormat`. **Every loader checks `results_published === true` first and returns `{ success: false }` otherwise — snapshots are NEVER read here.** Standings come from `participants` (`place, name, match_points, differential`, order by `place` nulls last, then `match_points` desc); decklist links from `tournament_decklists.published_deck_id` only when `decklists_published === true`.

- [ ] **Step 1: Implement the two loaders** (admin client; no auth). Index: `tournaments` where `results_published = true` order `ended_at` desc, participant counts via one `in`-grouped count query.
- [ ] **Step 1b: Unit-test the loaders** (`app/tournaments/__tests__/resultsLoaders.test.ts`, mocked admin client, same stub pattern as Task 4): unpublished tournament → `{ success: false }`; published → standings ordered place-nulls-last then match_points desc; `publishedDeckId` null when `decklists_published === false` even if the row has one; assert the payload contains NO `deck_snapshot` field. Run: `npm run test -- app/tournaments/__tests__/resultsLoaders.test.ts` → PASS.
- [ ] **Step 2: Results page** (`[id]/page.tsx`, server component): `loadPublicResultsAction`; `success === false` → `notFound()`. Render: event name (Cinzel), date, category/format badge, standings table (Place / Player / Points / Diff / Decklist), decklist cell = link `/decklist/${publishedDeckId}` or "—". Mobile: table scrolls in an `overflow-x-auto` container. Add `generateMetadata` (title = event name).
- [ ] **Step 3: Index page + tab.** Card list "«name» — N players", linking to the event page. Add the Results tab to `NavTabs` (inspect its current tab model first; follow it exactly).
- [ ] **Step 4: Manual verification** — published dev tournament renders standings + deck links; flipping `results_published` off 404s it; unpublished decklists show "—".
- [ ] **Step 5: Commit** — `git add app/tournaments/results app/tournaments/actions.ts app/tournaments/history/NavTabs.tsx app/tournaments/tournaments-client.tsx app/tournaments/__tests__/resultsLoaders.test.ts && git commit -m "feat(tournaments): public results pages"`

---

### Task 12: E2E happy path + full gates

**Files:**
- Create: `e2e/qr-join.spec.ts` (follow the patterns in the existing e2e specs + the project `verify` skill: mint chunked `sb-` cookies via admin `generate_link`/`verify`)

**Interfaces:** none new.

- [ ] **Step 1: Write the spec:** seed (via admin client in the test) a tournament with `code`, `require_decklists = true`, `deck_format = 'Limited'`, and a legal seeded deck for the test player account. Flow: visit `/join/<code>` signed out → sign-in redirect honored → join form → pick the seeded deck → submit → registered state. Assert DB rows: participant with `user_id`, submission with non-empty `deck_snapshot.cards`, `is_legal = true`. Then host view: decklist summary shows the submission. Clean up rows in `afterAll`.
- [ ] **Step 2: Run** — `npm run test:e2e -- qr-join` (dev server running) → PASS.
- [ ] **Step 3: Full gates:** `npm run test` (all vitest) and `npx tsc --noEmit` → clean. Skim `git diff origin/main --stat` — every touched file traces to this plan.
- [ ] **Step 4: Commit** — `git add e2e/qr-join.spec.ts && git commit -m "test(join): e2e QR join happy path"`

---

### Task 13: PR

- [ ] **Step 1:** Push `feat/qr-join`; open PR against `origin/main` (fetch first). Body: link the spec, summarize the migration (083, incl. the `tournament_decklists.deck_id` FK change and its prod-apply note), the two P0s the design closed (public-policy snapshot leak; CASCADE submission rot), and the manual prod steps: apply migration 083, then verify default-deny + spot-check `tournament_qr_join` with a service-role call.
- [ ] **Step 2:** Use the finishing-a-development-branch skill; do not merge without review.

---

## Review provenance

This plan passed two independent adversarial reviews (spec-coverage/consistency + codebase-reality, both with repo + live-DB verification); all surviving findings are folded into the tasks above — notably: both end-tournament paths hooked (manual + auto-end on final round), `requireDecklistsDefault` derives from resolved format, the Supabase MCP prod-target warning in Task 1, `@/`-aliased `vi.mock` specifiers throughout, the detach rework, and `persistFinalPlaces` for results-only publishes.

## Self-review notes (already applied)

- Spec §4 `participants` partial unique is created in Task 1 exactly as spec'd; the SQL function relies on the row lock (not the index) for same-user two-device races — the index is the backstop.
- Spec §6 wizard: "no UI can edit deck_format post-creation" is solved via `updateJoinSettingsAction` + QRJoinDialog knobs (Task 6/8), satisfying the format-editor requirement without touching `TournamentSettings`.
- Spec §8 "attach writes fresh snapshot": Task 6 Step 4. Spec §8 re-check action: Task 6 Step 5. Spec §9 auto-publish: Task 10. Consent line verbatim: Task 7 Step 3.
- Rename lock: there is no rename UI in the app (verified during planning — the modal's "rename later" copy was aspirational); Task 3 fixes the copy and freezes names at creation. If a rename affordance appears later it must check `isNameFrozen`.
