# The Forge — Private Card Design & Playtesting Area

**Date:** 2026-06-19 (rev. 2026-06-20 after two-reviewer pass)
**Status:** Draft
**Branch:** forge-card-design-playtesting
**Working name:** "The Forge" (route `/forge`) — renameable.

## Overview

A private, invite-only area of the Redemption Tournament Tracker where a small trusted group designs new Redemption CCG cards, iterates on them collaboratively, playtests them in real games, and eventually promotes a finished set toward print and (later) the public card pool.

Three roles operate here: **superadmin** (the user `baboonytim`, can do anything), **elders** (designers — create/iterate cards, run sets, review, manage members), and **playtesters** (build decks with approved cards and play games against other playtesters). Elders are playtesters by default.

The hard constraint that shapes the whole architecture: **nothing about unreleased playtest cards may leak to the public, even though the repo is open source.** The UI code (`.tsx`) being public is fine; all secret data (card names, abilities, art, set contents) lives only in the backend (Postgres behind RLS + private blob storage) and is served only to authorized users.

## Goals

- Elders can design new cards — both 10-second rough text drafts and fully-specified cards with art.
- Each elder has a private personal library ("ideas") that no one else can see until they choose to share an idea into a set.
- Cards iterate through multiple versions with a review/approval workflow that feels like code review, but for cards.
- Elders collaborate on a set in real time (presence, live comments, live progress).
- Each set has an at-a-glance progress dashboard broken down by brigade and card type against declared targets.
- Elders can write holistic, set-level design notes.
- A finished set can be exported for the printer ("download all"), with a path designed for later promotion into the public app card pool.
- Playtesters (Phase 2) build decks mixing approved playtest cards with the real card pool and play online games — only against other playtesters.
- Publishing a new version of a card updates what playtesters are testing.
- **No unreleased card data is ever reachable by the public**, and that property is verifiable by an automated test.

## Non-Goals (Out of Scope)

- Google-Docs-style real-time co-editing of a single card (CRDT/OT). The proposal/review workflow already prevents lost work.
- A full rules engine for playtest cards (reuses existing deck validation + multiplayer engine).
- Branching/merging version history. History is strictly linear.
- Public discovery of the Forge's existence (routes return 404, not 403, to unauthorized users).
- Multi-elder approval quorums (ships at single-elder approval; the column exists for later).
- Automatic public-pool promotion in Phase 1 (the print export ships; the public-pool merge is designed now, wired up in Phase 2).
- Email notifications in Phase 1 (review state surfaces as in-app badges; email is deferred).

---

## Phasing

The full vision is captured in this document. Implementation is split so the independent, lower-risk creation side ships first, and so the single largest sub-feature (the collaborative review engine) is its own plan.

**Phase 1a — Single-author design tool + security foundation (first implementation plan):**
- Access foundation: `playtest_members` roles, invites, elder/superadmin onboarding, the security spine, and the anon-leak CI test (the keystone guardrail). This proves the leak-proofing before any rich features are built on it.
- Private art upload/serving (private Blob + authed proxy) + placeholder/original handling + "download original."
- Card design studio (quick-draft + full mode, live preview, placeholder art) — single-author editing with last-write-wins autosave (no presence yet).
- Private "ideas" library.
- Sets: card library, set-level holistic notes, declared targets.
- Card lifecycle managed by elders: share-to-set (move), publish, approve, archive, delete, send-back-to-private (with confirmation on the destructive ones).
- Set progress dashboard.
- "Download all for printer."

**Phase 1b — Collaborative review layer (second implementation plan):**
- Proposals ("code review for cards"): submit a candidate change, before/after card diff, single-elder accept/deny.
- Single-field suggestions (comment + one-click apply).
- Threaded comments, live via Supabase Realtime.
- Presence avatars (who's viewing/editing a card) + collision warnings.
- Per-set review queue with live badge counts.

**Phase 2 — Playtester play (separate spec/plan, designed here):**
- Playtester role, invites, and onboarding.
- Deckbuilder over a mixed pool (approved playtest cards + real cards); reuses existing deck-legality rules unchanged, since playtest cards conform to current deck-building rules.
- SpacetimeDB-isolated games restricted to playtesters (UUID-only card references; see below).
- "Updated card available" diff/swap when a card is republished, plus republish notifications.
- Public-pool promotion via reviewable PR into a committed `forge-promoted.json` that the card-data generator merges.

`forge_set_grants` and `published_version_id`/`approved_version_id` ship in Phase 1 (cheap forward-compat) but are only *consumed* in Phase 2. There is no hidden Phase-1-depends-on-Phase-2 coupling.

---

## Roles & Access Model

### Role hierarchy

`superadmin > elder > playtester`. Roles are hierarchical — **an elder automatically has playtester capabilities**, and superadmin has everything. Permission checks for playtester features accept `role IN ('playtester','elder','superadmin')`.

A single `playtest_members` table holds one row per member with their highest role. Set-level relationships (which elders run a set, which playtesters are granted a set) live in join tables.

### Capabilities by role

| Capability | Superadmin | Elder | Playtester |
|---|---|---|---|
| Create/edit cards, sets | ✅ | ✅ (sets they're on) | ❌ |
| Review / accept / deny proposals | ✅ | ✅ (sets they're on) | ❌ |
| Write set-level notes | ✅ | ✅ (sets they're on) | ❌ |
| Send card back to private / archive / delete | ✅ | ✅ (sets they're on) | ❌ |
| Declare set targets, create sets | ✅ | ✅ | ❌ |
| Invite/remove **playtesters** | ✅ | ✅ | ❌ |
| Invite/remove **elders** | ✅ | ❌ | ❌ |
| Build decks + play with approved cards | ✅ | ✅ | ✅ (granted sets) |
| Promote set / export for printer | ✅ | ✅ (sets they're on) | ❌ |
| Manage everything, override | ✅ | ❌ | ❌ |

### Superadmin encoding

The superadmin is **not** hardcoded by username or email anywhere (emails are mutable; string checks in public code are brittle). It is a row `playtest_members(user_id = <baboonytim's auth.users.id>, role = 'superadmin')`, seeded by a migration that resolves the UID from `auth.users` at apply time (same approach migration 016 uses for `rharbold`). A `BEFORE UPDATE/DELETE` trigger on `playtest_members` forbids removing or demoting the **last** superadmin, so the role can't be locked out.

### Member management & removal

Membership rows are managed only through `SECURITY DEFINER` RPCs (`add_member`, `remove_member`, `change_role`) that enforce the role-cap (elders manage only playtesters; superadmin manages elders) against the caller's own role server-side.

**Removing a member** deletes their `playtest_members` row (never their `auth.users` row). The `remove_member` RPC handles their artifacts so nothing is silently lost (decision: keep work, reassign ownership):
- **Cards they own that are shared into a set** (`set_id IS NOT NULL`) → `owner_id` reassigned to a superadmin; the cards stay in the set. The team keeps the work; the removed member simply loses access (RLS denies them once their membership row is gone).
- **Their purely-private ideas** (`set_id IS NULL`) → untouched; they remain owned by the now-removed user and are inaccessible to other members (superadmin retains visibility via the superadmin SELECT policy and can clean up).
- **Sets where they were the sole elder** → the RPC reassigns the set to a superadmin (or requires the caller to name a replacement elder) so no set is left without an elder.
- **Proposals/comments they authored** → retained as historical record (authorship preserved).

`forge_cards.owner_id` is `NOT NULL`; ownership reassignment happens inside the RPC. Deletion of the underlying `auth.users` account is out of scope (handled by superadmin reassignment first).

### Invites & onboarding

No self-serve path. Membership is granted only via an invite minted by an authorized member.

- **Token**: `crypto.randomBytes(32)` base64url, emailed via Resend. Only the **sha256 hash** is stored (reuse migration 030's `api_keys` hash pattern). Raw token never touches the DB.
- **Single-use + expiry + optional email-bind**: a `SECURITY DEFINER` redemption RPC checks `used_at IS NULL AND expires_at > now()` (and, if the invite is email-bound, `email = auth.email()`), then in one transaction inserts the membership + any set grants and stamps `used_at`. If an email-bound invite is redeemed by a session with a different email, the RPC returns the same not-found result as a bad token (no oracle).
- **Role-capping enforced at mint**: the mint RPC caps `forge_invites.role` against the caller's role; the stored row is authoritative at redeem time. (An invite minted by an elder can never grant `elder`.)
- **Table access**: `forge_invites` has **no** direct INSERT/SELECT policy for `authenticated`; it is reachable only through the SECURITY DEFINER mint/redeem RPCs (mirroring how `api_keys` restricts access). No member can read another's `token_hash`.
- Redemption requires an authenticated session, so the invite binds to a real `auth.users.id`. Bad/expired/used/mismatched tokens return 404.

**Onboarding (Phase 1a covers elder/superadmin):** a newly-invited elder gets a short welcome (set display name + optional avatar) then a choice — "jot a private idea" (drops into the quick-draft studio) or "open a set" (lands on its progress dashboard). A light, dismissible 3-step checklist appears on the desk and fades when complete. Playtester onboarding (card-back reveal of granted cards → "build a deck" / "find a game") ships in Phase 2.

---

## Security Architecture

**Core principle:** keep the secret in exactly one place — Postgres behind RLS — and make every other surface (Blob, SpacetimeDB, RSC, API, CDN, Realtime) carry only opaque references or stream bytes after a server-side gate. If a leak surface ever holds only a UUID, leaking it is harmless.

### Threat model

An adversary who (a) reads the public GitHub repo, (b) has the public Supabase anon key (it ships in the bundle — assume known), (c) can sign up for a normal account, and (d) pokes the deployed app, its API/RSC payloads, the Blob CDN, the Realtime websocket, and (Phase 2) the SpacetimeDB websocket. The asset is prerelease card data. "Leak" = any of that reaching a non-member.

### RLS posture

- Every Forge table has RLS enabled, with policies scoped `TO authenticated` only. The `anon` role gets **no policy** (Postgres RLS default-denies) plus an explicit `REVOKE ALL ... FROM anon` belt-and-suspenders.
- Helper functions (`is_playtest_member()`, `is_elder_or_super()`, `playtest_role_of(uid)`) are `SECURITY DEFINER STABLE` with **`SET search_path = ''`** (the hardened pattern from migration 046's `get_published_outline`, stricter than the unset `check_admin_role()` in migration 005). This reads membership without tripping the caller's RLS and avoids the recursive-policy loop documented in migration 009. **Do not copy migration 005's self-referential policies** — use the definer-helper shape from migrations 010/044.
- Migrations are **self-contained**: they create their own enums/columns and do not assume parity with the out-of-band `admin_users.permissions` column (which has no migration of record).
- Visibility rules enforced by SELECT policy on `forge_cards`: superadmin sees all; an owner always sees their own private idea; an elder on a set sees everything in that set; a playtester granted a set sees only `approved` cards in it.
- Writes gated by INSERT/UPDATE policies checking both authorship and set-elder membership (an elder can't move a card into a set they aren't on). Mutations that need cross-row invariants (publish, approve, accept-proposal, member removal) go through `SECURITY DEFINER` RPCs, not raw table writes.

### Image isolation

The existing card-art scheme (public bucket, guessable filename URLs in `app/shared/utils/cardImageUrl.ts`) is **disqualified** here.

- Playtest art lives in a **private** Vercel Blob store (`access: 'private'` — a real, current Blob feature) with **UUID keys** (not card names), so paths are unguessable even if the scheme leaks. The existing upload routes use `access: 'public'`; Forge upload code must not copy that.
- Served only through an **authenticated proxy route** `GET /forge/api/art/[cardId]` → `requireForge()` (404 if unauthorized) → RLS-checked lookup → server-side fetch of the private blob (server-only token) → stream bytes with `Cache-Control: private, no-store`. The browser only ever sees the proxy URL on the app's own domain — never the blob host or key.
- **`next/image` is forbidden for Forge art.** `next.config.js` already wildcards `*.public.blob.vercel-storage.com` in `remotePatterns`, and private Blob shares the storage domain family, so an `<Image>` could "just work" and CDN-cache a public optimized variant. Forge art uses plain `<img src="/forge/api/art/...">`; a lint rule forbids `<Image>` under `app/forge/**`.
- **"Download original"**: same proxy with `?download=1` → `Content-Disposition: attachment`. Logged in `forge_audit`.
- **Print export** streams the same gated private-blob fetch path; it never generates a public URL.

### Middleware reality & the in-route gate

`middleware.ts` **excludes any path containing `api/`**, and `utils/supabase/middleware.ts` only force-auths `/tracker` and `/admin`. So there is **no middleware-level protection for Forge routes** — the in-route gate is the *only* defense. Therefore:
- A shared `requireForge()` / `requireElder()` helper (cloning `app/threshingfloor/api/auth.ts`, returning 404 not 403) is the **literal first statement** of every Forge route handler, layout, and API route, before any data access.
- A CI test greps every `app/forge/**/page.tsx`, `app/forge/**/route.ts`, and `app/forge/api/**` and fails if the gate is not the first call.
- All Forge routes set `export const dynamic = 'force-dynamic'` and `revalidate = 0`; none use `generateStaticParams` over card data; responses set `Cache-Control: private, no-store`. (This is net-new convention, not reuse.)

### Realtime authorization

Realtime is enabled only on `card_comments`, `forge_cards`, `forge_sets` — tables whose RLS already gates rows. Supabase enforces RLS on `postgres_changes` **only when the channel is configured private/authorized**, so Forge Realtime channels must be set to private (authorized) — an explicit setting, not a default. The CI leak test subscribes to these channels as anon and as a non-member and asserts zero rows broadcast.

### SpacetimeDB isolation (Phase 2 — larger than a rule)

This is a **significant engine change, not a config flag.** The existing `spacetimedb/src/schema.ts` defines `CardInstance` as `public: true` storing full card text (`cardName`, `specialAbility`, `brigade`, `strength`, `toughness`, etc.), and `Player`/`Game` carry JSON deck payloads. `spacetimedb/CLAUDE.md` also states **RLS is deprecated in this SDK; visibility is via private tables + views.** Therefore Phase 2 commits to, as the **baseline** (not a fallback):
- A **UUID-only card representation in STDB** — game/instance rows carry `cardId` (UUID) + game state only; **no unreleased name/ability/art string is ever written to any STDB column.** Human-readable definitions resolve client-side from the RLS-gated Postgres set the player already has access to. This requires a client-side resolver touching every renderer that currently reads `card.cardName`/`specialAbility`/etc. off the STDB row — scope this explicitly.
- **Entry gating**: a server action verifies playtester membership and mints a short-lived, single-use join token bound to a specific game; playtest games are excluded from the public lobby. STDB reducers bind seats to `ctx.sender` and reject joins from identities not on the pre-authorized player list.
- Whether this lives in a separate STDB module or a UUID-only variant of the existing one is a Phase-2 implementation decision; either way the no-secret-data rule is what makes it safe even though STDB tables are broadly readable.

### Leakage-vector checklist

| # | Vector | Mitigation |
|---|---|---|
| 1 | anon key + permissive RLS | No anon policy; `REVOKE ALL FROM anon`; CI anon-leak test. |
| 2 | RSC renders before auth | `requireForge()`/`requireElder()` as first statement of every route/layout; 404 not 403; no middleware reliance. |
| 3 | API route returns data without auth | Same gate first in every API handler; CI grep enforces it. |
| 4 | Build-time/static generation/ISR | All Forge routes `force-dynamic`, `revalidate = 0`; no `generateStaticParams` over card data. |
| 5 | CDN caching | `Cache-Control: private, no-store`; no `s-maxage`. |
| 6 | Migrations/seeds/fixtures in repo | Schema-only migrations; never commit real card data; superadmin seeded by resolving UID; test data = obvious fakes. |
| 7 | Env vars | Service-role key + private `BLOB_READ_WRITE_TOKEN` stay server-only, never `NEXT_PUBLIC_*`, never in `.env.example`. |
| 8 | Predictable Blob URLs | Private store (`access:'private'`) + UUID keys + authed proxy on app domain. |
| 9 | `next/image` cache leak | `<Image>` forbidden under `app/forge/**` (lint); plain `<img>` to the proxy only. |
| 10 | Source maps | Card data never imported into client code; only `.tsx` structure is public, which is fine by design. |
| 11 | STDB public tables (Phase 2) | UUID-only rows + entry gating (above). |
| 12 | Realtime broadcast | Private/authorized channels only, on RLS-gated tables; covered by the leak test. |
| 13 | SECURITY DEFINER functions | No Forge definer function granted to `anon`; leak test asserts grants; `get_advisors` in CI. |
| 14 | RSC prefetch | Per-request server gate returns the 404 payload to unauthorized prefetch. |

### The keystone guardrail (broadened)

A **CI test** that asserts the "nothing leaks" property across surfaces, not just PostgREST tables:
1. With the bare public **anon key**, query every Forge table → 0 rows.
2. As a logged-in **non-member**, query every Forge table → 0 rows.
3. Assert **no Forge `SECURITY DEFINER` function is granted to `anon`** (the shape of an accidental bypass, cf. migration 046's intentionally-anon `get_published_outline`).
4. Hit every `/forge/**` route and `/forge/api/art/<known-id>` **unauthenticated** → 404/empty.
5. Subscribe to each Forge **Realtime** channel as anon and non-member → 0 rows.
6. Run Supabase `get_advisors` (security lints) and fail on new findings.
7. (Phase 2) Subscribe to the playtest STDB module as a non-member → no playtest rows.

This is what makes "nothing leaks" verifiable in an open-source repo rather than hoped-for. Steps 3–7 close the surfaces a table-only test would miss.

---

## Data Model

All tables: `uuid` PKs (`gen_random_uuid()`), `auth.users` FKs, `timestamptz` defaults `now()`, RLS enabled. Migrations are self-contained.

```sql
create type playtest_role  as enum ('superadmin','elder','playtester');
create type forge_card_status as enum
  ('private_idea','draft','playtesting','approved','promoted','archived');
create type version_status  as enum ('published','approved','superseded');
create type proposal_status as enum ('open','accepted','denied','superseded');

-- Membership (one row per member; highest role)
create table playtest_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         playtest_role not null,
  display_name text,
  avatar_url   text,
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- Sets
create table forge_sets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,         -- slugify(name) + numeric suffix on collision
  notes         text,                          -- holistic set-level design notes (markdown), elder-editable
  target_counts jsonb not null default '{}',   -- 2-D targets; see "Set progress dashboard"
  status        text not null default 'open',  -- open | frozen | promoted (computed gate, not auto-cascade)
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table forge_set_elders (        -- who designs a set
  set_id  uuid references forge_sets(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (set_id, user_id)
);

create table forge_set_grants (        -- who playtests a set (consumed in Phase 2)
  set_id     uuid references forge_sets(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  primary key (set_id, user_id)
);

-- Card identity (stable). set_id NULL = private idea (in owner's sketchbook).
-- A card is in AT MOST ONE set (single FK) — sharing MOVES it in, send-back MOVES it out.
create table forge_cards (
  id                   uuid primary key default gen_random_uuid(),
  set_id               uuid references forge_sets(id) on delete set null,
  owner_id             uuid not null references auth.users(id),  -- reassigned on member removal
  status               forge_card_status not null default 'private_idea',
  -- The live, MUTABLE draft being edited (autosave writes here). Immutable snapshots
  -- are frozen into card_versions only at publish.
  working_snapshot     jsonb not null default '{}',     -- DesignCard game fields
  working_art_key      text,                            -- private blob key (UUID) for the draft
  working_art_is_placeholder boolean not null default false,
  working_art_original_key   text,
  -- Pointers into immutable history. Enforced same-card via composite FK below.
  published_version_id uuid,
  approved_version_id  uuid,
  promoted_version_id  uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Immutable, append-only published snapshots (linear history). Created at publish.
create table card_versions (
  id              uuid primary key default gen_random_uuid(),
  card_id         uuid not null references forge_cards(id) on delete cascade,
  version_number  int not null,
  status          version_status not null default 'published',
  data            jsonb not null,        -- frozen DesignCard payload (validated vs schema at publish)
  art_key         text,                  -- private blob key (UUID), never a public URL
  art_is_placeholder boolean not null default false,
  art_original_key text,                 -- full-res asset for printer download
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  unique (card_id, version_number),
  unique (card_id, id)                    -- enables composite-FK same-card enforcement
);

-- Same-card integrity for the pointers (a published_version_id must belong to this card):
alter table forge_cards
  add constraint fk_published  foreign key (id, published_version_id) references card_versions(card_id, id),
  add constraint fk_approved   foreign key (id, approved_version_id)  references card_versions(card_id, id),
  add constraint fk_promoted   foreign key (id, promoted_version_id)  references card_versions(card_id, id);
-- (Pointers are nullable; the two-step insert — card row first, then version, then UPDATE the
--  pointer — is required and documented in the publish RPC.)

-- "Pull request": a proposed change for review (Phase 1b)
create table card_proposals (
  id                uuid primary key default gen_random_uuid(),
  card_id           uuid not null references forge_cards(id) on delete cascade,
  base_version_id   uuid references card_versions(id),  -- the published base it was branched from
  proposed_snapshot jsonb not null,      -- validated vs the DesignCard schema, same shape as data
  proposed_art_key  text,
  status            proposal_status not null default 'open',
  resulting_version_id uuid references card_versions(id),
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by         uuid references auth.users(id)
);

-- Threaded comments; field-anchored (single-field suggestions) or proposal/card-level (Phase 1b)
create table card_comments (
  id                uuid primary key default gen_random_uuid(),
  card_id           uuid not null references forge_cards(id) on delete cascade,
  proposal_id       uuid references card_proposals(id) on delete cascade,
  field             text,                 -- nullable; which DesignCard field a suggestion targets
  suggested_value   jsonb,                -- nullable; one-click "apply" writes this into working_snapshot
  parent_comment_id uuid references card_comments(id),
  body              text not null,
  resolved          boolean not null default false,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now()
);

-- Invites (hash-only token storage; access only via SECURITY DEFINER RPCs)
create table forge_invites (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  role       playtest_role not null,     -- capped at mint by inviter's role
  set_ids    uuid[] not null default '{}',
  email      text,                        -- optional bind
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Minimal audit (membership changes, deletes, art downloads). Write-only via definer RPCs.
create table forge_audit (
  id     bigserial primary key,
  actor  uuid not null references auth.users(id),
  action text not null,  -- 'art_download' | 'member_added' | 'member_removed' | 'card_deleted' | 'card_approved'
  target text,
  at     timestamptz not null default now()
);
```

Notes:
- `working_snapshot`/`working_art_*` on `forge_cards` is the **mutable** draft (autosave target). `card_versions` rows are **immutable** and created only at publish — this reconciles "edit with autosave" against "versions are immutable." `proposed_snapshot`/`data`/`working_snapshot` all share the validated DesignCard shape.
- Publishing a new version sets the prior published version `superseded`, the new one `published`, and `forge_cards.published_version_id`. Only one `published` version exists per card at a time.
- Realtime publication added for `card_comments`, `forge_cards`, `forge_sets` (private channels). Presence uses a Realtime presence channel (no DB writes).

---

## DesignCard Field Schema

Grounded in the repo's existing `CardData` (`lib/cards/lookup.ts`) and the real Redemption model. Stored as the `working_snapshot`/`data` jsonb. Multi-value fields are arrays; a `toCardData()` adapter collapses them to the legacy delimited-string shape **only where needed** — for the deck-validation reuse and the promotion export, both of which are Phase 2. Phase 1 stores and renders the array shape natively.

### Fields

| Field | Type | Applies to | Required | Notes |
|---|---|---|---|---|
| `name` | text | all | ✅ | Working/card title |
| `cardType` | enum[] | all | ✅ | Array supports dual-types (e.g., Hero/EvilCharacter) |
| `alignment` | enum | all | ✅ | Good / Evil / Neutral / Good_Evil |
| `brigades` | enum[] | characters, enhancements, some Sites/Cities/Fortresses, Curses/Covenants | type-dependent | Designer chooses the resolved brigade up front (Good/Evil Gold, Good/Evil Multi explicit); the tool never stores ambiguous raw "Gold"/"Multi". Empty for Artifact/Dominant/Lost Soul |
| `strength` | int? | Hero, Evil Character, stat-bearing GE/EE | type-dependent | Might (top number) |
| `toughness` | int? | same | type-dependent | Defense (bottom number) |
| `strengthModifier`/`toughnessModifier` | text? | enhancements | opt | Signed `+N` for enhancement modifiers |
| `class` | enum[] | characters | opt | Warrior / Weapon |
| `icons` | enum[] | characters, sites | opt | Territory / Star / Cloud (separated from class) |
| `identifiers` | text[] | mostly characters/dominants/artifacts | opt | Open vocab (Prophet, Demon, Egyptian, X=…) |
| `specialAbility` | text? | all (esp. enhancements; Lost Souls legality-relevant) | type-dependent | Rules text box |
| `reference` | text? | all printed cards | opt (usually req) | Bible verse |
| `legality` | enum? | all | opt | Rotation / Classic / Scrolls / Paragon / Banned |
| `rarity` | text? | all | opt | Distribution/rarity |
| `flavorText` | text? | all | opt | Distinct from specialAbility |
| `artistCredit` | text? | all | opt | |
| `cardFrame` | text? | all | opt | Template choice |

Art refs (`*_art_key`, `*_art_is_placeholder`, `*_art_original_key`) live as columns (on `forge_cards` for the draft, on `card_versions` for frozen snapshots), not in the jsonb. Identity/meta (status, version, owner, set, timestamps) live on the rows, not in the jsonb.

### Enums

```
CARD_TYPE: Hero | EvilCharacter | GE | EE | LostSoul | Artifact | Dominant
           | Fortress | Site | City | Curse | Covenant
           (+ HeroToken | EvilCharacterToken | LostSoulToken)
ALIGNMENT: Good | Evil | Neutral | Good_Evil
BRIGADE (good):  Blue | Clay | GoodGold | Green | Purple | Red | Silver | Teal | White | GoodMulti
BRIGADE (evil):  Black | Brown | Crimson | EvilGold | Gray | Orange | PaleGreen | EvilMulti
CLASS: Warrior | Weapon          ICON: Territory | Star | Cloud
LEGALITY: Rotation | Classic | Scrolls | Paragon | Banned
```

### Type/field applicability (summary)

- **Lost Soul**: ability optional but legality-relevant (souls with an ability are unique/T1 or max-2/T2; plain souls duplicate freely); no brigade/might/toughness.
- **Hero / Evil Character**: require brigade + might + toughness; optional class/icons/identifiers.
- **Artifact / Dominant**: ability + identifiers, no brigade/might/toughness. Dominant max-1 unique, capped by Lost Soul count.
- **GE / EE**: brigade + ability; strength/toughness as modifiers.
- Full matrix carried from research into the implementation plan.

---

## Card Lifecycle

### States (`forge_cards.status` is authoritative)

`private_idea → draft → playtesting → approved → promoted`, plus `archived`. **There is no separate `in_review` status** — "in review" is a *derived* condition (the card has ≥1 open proposal) shown as a badge, so a `draft` or `playtesting` card can be under review without an ambiguous state flip.

| State | Meaning | Entered by |
|---|---|---|
| `private_idea` | In an owner's personal library; `set_id IS NULL`; only owner (+superadmin) sees it | Owner creates a card outside any set |
| `draft` | In a set; iterating; nothing published yet | A card is shared (moved) into a set, or an elder creates directly in a set |
| `playtesting` | Has a `published` version | An elder publishes the working draft |
| `approved` | Elders signed off; the published version is locked from casual edits | An elder approves the published version |
| `promoted` | Frozen; exported (printer / public pool) | Elder/superadmin promotes |
| `archived` | Cut from the set; hidden, recoverable | Elder archives |

### Transitions

- **Share** (`private_idea → draft`): **moves** the card into a set — one row, `set_id` set, `status = draft`. The card leaves the owner's private sketchbook and appears under the set. No duplication, no `source_card_id`, and (single FK) a card belongs to at most one set, so "shared twice / divergence" cannot occur. Owner is retained; set-elders gain edit rights via RLS.
- **Send back to private** (`draft/playtesting/approved → private_idea`): **moves** the same card back out — `set_id = NULL`, `status = private_idea`, returned to the owner's sketchbook (carrying its version history). Elder on the set (or owner/superadmin). **Requires manual confirmation.**
- **Publish** (`draft → playtesting`, or re-publish while `playtesting`): freezes `working_snapshot` into a new immutable `card_versions` row, supersedes the prior published version, sets `published_version_id`. Re-publishing is intentionally live for playtesters (Phase 2).
- **Approve** (`playtesting → approved`): marks the published version `approved`, sets `approved_version_id`, `status = approved`. Reversible (`approved → playtesting`) before promotion.
- **Promote** (`approved → promoted`): freezes `promoted_version_id`; `status = promoted`. Reopening requires a deliberate superadmin action.
- **Archive** (`{draft,playtesting,approved} → archived`): soft, reversible (`archived → draft`). Any open proposals on the card are closed `superseded` at archive time.
- **Delete from set**: hard delete of the `forge_cards` row and its versions (cascade). Elder/superadmin, **manual confirmation**, logged to `forge_audit`. Archive is presented in the UI as the safer default next to delete.

### Version-status sync (single source of truth)

`forge_cards.status` is authoritative for the card. `card_versions.status` tracks each frozen snapshot (`published` → `approved` on approval, `superseded` when a newer one is published). Invariant: exactly one non-superseded version per card may be `published` or `approved`, and `forge_cards.published_version_id`/`approved_version_id` point at it. Enforced inside the publish/approve RPCs (with the row lock below), not by client writes.

---

## Review Workflow — "Code Review, but for Cards" (Phase 1b)

There are three distinct edit paths, deliberately separated so it's unambiguous which edits need sign-off:

1. **Direct edit** (no review) — elders on the set (and the card's owner) edit the **working draft** directly via autosave. This is the default for people with write access in a small trusted group; presence warns of collisions.
2. **Proposal** (the "pull request") — any member who can see the card can submit a `card_proposals` row: a candidate full snapshot against the current published `base_version_id`, for sign-off. Used when you want review rather than just editing. Reviewed via the card diff; an elder accepts or denies.
3. **Single-field suggestion** — a `card_comments` row anchored to one field with an optional `suggested_value`. An elder **applies** it in one click, which writes the value into the **working draft** (it does *not* itself create a published version or a proposal). Most lightweight iteration lives here.

**Diff visualization**: never a text diff. Two card previews side-by-side — **Current** (published, left) and **Proposed** (right) — with changed fields highlighted on the card itself (added text in accent, removed struck-through, changed brigade as ghosted→solid pill), plus a one-line plain-language summary. On mobile they stack.

**Accept/deny (proposals)**: only elders/superadmin. **Single-elder approval (N=1).** The accept RPC:
1. `SELECT ... FOR UPDATE` on the `forge_cards` row (closes the TOCTOU window).
2. Verifies `base_version_id` still equals the card's `published_version_id`; if not, the proposal is marked `superseded` and the author is asked to re-base (no auto-re-diff in Phase 1b — manual reopen).
3. Validates `proposed_snapshot` against the DesignCard schema.
4. Allocates the next `version_number` under the lock, inserts the new immutable `card_versions` row (`published`), supersedes the prior published version, updates `published_version_id`.
5. Closes the proposal `accepted` (records `resulting_version_id`), and marks sibling open proposals `superseded`.

Denying closes `denied` with a required reason comment.

**History**: a per-card timeline of published versions + accepted/denied proposals with before/after thumbnails.

---

## Real-Time Collaboration

Supabase Realtime only (private/authorized channels) — no SpacetimeDB on the design side, no CRDT.

| Spot | Real-time? | Mechanism | Phase |
|---|---|---|---|
| Comment threads on a proposal | Yes | Realtime changes on `card_comments` filtered by `proposal_id` | 1b |
| "Who's viewing/editing this card" presence | Yes | Realtime presence channel (no DB writes) | 1b |
| Review-queue badge counts per set | Yes | Realtime on `card_proposals`/`forge_cards` (or refetch-on-focus) | 1b |
| Set-progress dashboard | Yes (coarse) | Realtime on `forge_cards` / refetch-on-focus | 1a (refetch) → 1b (live) |
| Set-level notes | Yes (coarse) | Realtime on `forge_sets`; single-author autosave | 1a (refetch) → 1b (live) |
| Card field editing | No | Single-author autosave; last-write-wins in 1a, presence-warned in 1b | — |

---

## Notifications

Phase 1 is **in-app only, derived, no table, no email**: review state surfaces as badge counts (a set's open-proposal + unresolved-suggestion count for its elders), computed by query and live-updated via Realtime in 1b. There is no separate notification feed.

Phase 2 introduces a `forge_notifications` table when persistent, cross-session notifications are actually needed — specifically the **republish notice** to playtesters whose decks contain a changed card ("Updated card available" + diff/swap). Email via Resend is deferred and optional even then.

---

## Information Architecture & UX

Gated root `/forge`, mobile-first, reusing the existing glassmorphic floating dock (contextual: top-level vs in-set sub-tabs).

```
/forge
├── /                      → role-aware desk / landing
├── /ideas                 → private sketchbook (cards with set_id = NULL)
│   └── /[cardId]          → studio editor (private context)
├── /sets                  → sets index
│   └── /[setId]
│       ├── /cards         → set card library (grid)
│       ├── /notes         → holistic set-level design notes (elder-editable)
│       ├── /progress      → progress dashboard
│       ├── /review        → review queue (Phase 1b)
│       ├── /print         → download-all / printer export
│       └── /card/[cardId] → studio editor (set context)
├── /forge/api/art/[cardId] → authed private-art proxy (not a page)
├── /play                  → Phase 2: deckbuilder + lobby + game
└── /admin                 → superadmin: invites, roles, set creation/targets
```

### Card design studio

Live card preview (the hero) + form. **Quick-draft "napkin" mode** is the default on "+": a single free-text field (ghost prompt, zero required fields) that renders as a real card frame immediately; smart chips light up structure (type/brigade) as recognized, never demanded. **Full mode** reveals the typed fields (segmented type control, multi-select brigade color pills, ability textarea with keyword formatting, stat inputs). **Status stepper** (`Draft → Finalized → Ready for printer`) in the header. Art control surfaces three states (No art → Placeholder → Final); placeholder shows an unmistakable diagonal "PLACEHOLDER" stamp; replacing art retains the previous file as downloadable. All editing autosaves to `working_snapshot` (Phase 1a single-author; Phase 1b adds presence + proposal authoring as the explicit "Propose changes" action for non-direct-editors).

### Ideas library & sets

`/ideas` is the private sketchbook — a dense card-preview grid (cards with `set_id = NULL`) with tag/type/brigade/status filters and free-text search; tags over folders. "Send to a set" **moves** an idea in with a gentle confirm (it leaves the sketchbook). `/sets/[id]/cards` is the same grid framed as collective work (owner/recent-editor info, status badges; review-count badges in 1b; "needs review" facet in 1b).

### Set notes

`/sets/[id]/notes` holds holistic, set-level design notes (markdown) — direction, themes, open questions, decisions. Elder-editable, single-author autosave, live-updated for viewers (refetch in 1a, Realtime in 1b).

### Set progress dashboard

One honest headline number (`73/120 · 61%`) + a **status breakdown bar** (draft/finalized/ready, so "%" never lies) + the hero **Brigade × Card-Type completion heatmap** + a "what's left" checklist auto-generated from targets vs actuals. Tap a gap cell → filtered library with a pre-filled "new [Brown Lost Soul]" CTA. Mobile: matrix scrolls horizontally with sticky row labels; headline/status/checklist stack above.

**`target_counts` shape** (must back the 2-D matrix — two 1-D vectors can't):
```jsonc
{
  "total": 120,
  "cells": {                       // per (cardType → brigade) target; source of truth for the heatmap
    "Hero":     { "Red": 4, "Blue": 3, "Green": 3 },
    "LostSoul": { "none": 12 },    // brigade-less types use the "none" bucket / a single column
    "Artifact": { "none": 8 },
    "Dominant": { "none": 6 }
  }
}
```
`byType`/`byBrigade` roll-ups are derived from `cells`; a set that declares only a `total` still renders actual distribution with per-cell targets omitted (graceful degrade).

### Onboarding & empty states

Invite-only first-run is a welcome, not a tutorial wall (above). Empty states are a card-shaped dashed cut-out slot + one CTA + one sentence — no mascots.

### Delight touches (sparing, on-brand)

The signature **napkin→card live render** and the **placeholder stamp** are core (Phase 1a). Lower-priority touches — accept-suggestion morph, progress-cell saturation pulse, set-complete sweep, presence avatars — ride with Phase 1b and are cuttable under time pressure. All respect `prefers-reduced-motion`.

---

## Promotion & Print Export

- **Gate**: a set is promotable when every non-archived card is `approved` (or an elder explicitly excludes stragglers). The progress dashboard is the gate's UI. `forge_sets.status` (`open/frozen/promoted`) is a computed/elder-set marker; it does **not** auto-cascade per-card status. Freezing a set gates further edits.
- **Phase 1 — "Download all for printer"**: a button that zips approved versions' **original** art (full-res, streamed via the gated private-blob path) + a print-layout sheet/PDF. Pure read of `card_versions` where `status='approved'`. **Sizing note:** the data read is trivial, but generating a print-ready sheet/PDF (layout, bleed) is non-trivial engineering — size it as its own task, not a freebie. Independent of the public-pool merge.
- **Phase 2 — Public-pool promotion (corrected pipeline)**: `cardData.json` is **regenerated wholesale** by `scripts/parse-carddata.js` from an external upstream `carddata.txt` on every `make update-cards` — so appending promoted cards to that output would be **silently wiped**. Instead, promotion writes/updates a separate **committed `forge-promoted.json`** (the serialized `CardData`-shaped rows for approved cards) via a reviewable GitHub PR, and `parse-carddata.js` is extended to **concatenate `forge-promoted.json` onto the upstream-parsed array** during generation. This makes promoted cards survive regeneration, keeps the public pool a type-checked generated artifact, and goes through the normal build/deploy. A dry-run previews the `forge-promoted.json` delta first. We avoid any runtime-merged "virtual pool" (it would fork `lib/cards/lookup.ts`'s synchronous global `CARDS` array and risk leaking unfinished cards). On promotion, `status='promoted'` and `promoted_version_id` is stamped.

---

## Top Risks & Mitigations

1. **Reusing the public Blob bucket / predictable URLs / `next/image` for playtest art** → private store (`access:'private'`) + UUID keys + authed proxy on app domain; `<Image>` forbidden under `app/forge/**`.
2. **A Forge table/route/function/channel reachable by anon or a non-member** → default-deny RLS + in-route gate as first statement + the broadened CI leak test (tables, definer grants, routes, Realtime) + `get_advisors`.
3. **Promotion silently wiped by `make update-cards`** → separate committed `forge-promoted.json` concatenated by the generator, not an append to the regenerated output.
4. **STDB leaking card text (Phase 2)** → UUID-only rows + client-side resolver + entry gating; scoped as a real engine change, not a flag.
5. **Concurrent proposal accept / version-pointer corruption** → `SELECT … FOR UPDATE` in the accept/publish RPCs, `version_number` allocated under the lock, composite-FK same-card enforcement on the pointers.
6. **Republish silently breaking playtesters' decks (Phase 2)** → live resolution to current published version + visible notification/diff, never silent mutation, never version-pinning.

## Design Decisions (resolved)

1. **No gender field.** Dropped entirely — not part of the model.
2. **Brigade chosen up front.** Designers explicitly pick the resolved brigade (Good/Evil Gold, Good/Evil Multi) at creation; the tool never stores ambiguous raw "Gold"/"Multi".
3. **No printed-vs-functional brigade override** (`brigadeCountsAs` removed). Not needed.
4. **Playtest cards conform to existing deck-building rules.** No novel brigades, card types, or anything that breaks current deck design rules. The Phase 2 mixed-pool deckbuilder therefore reuses `deckValidation.ts` as-is, with no rule changes.

---

## Appendix — Files this builds on

- Auth/roles to mirror: `supabase/migrations/005_refactor_to_table_based_admins.sql` (table-based admin — but **use the helper pattern, not its self-referential policies**), `010_add_get_my_permissions_function.sql`, `016_add_permissions_and_rharbold_admin.sql` (UID-resolution seed), `046` (`get_published_outline` — the `SET search_path=''` definer pattern to copy).
- Recursive-policy trap to avoid: `supabase/migrations/009`.
- Hash-only token pattern: `supabase/migrations/030_create_api_keys.sql`.
- Secret-area gate (404-not-403): `app/threshingfloor/api/auth.ts`; upload-route auth precedent: `app/api/spoilers/upload/route.ts`.
- Realtime publication pattern: `supabase/migrations/040_enable_realtime_for_board.sql`.
- Three-state visibility precedent: `supabase/migrations/041_add_deck_visibility.sql`.
- Current (public) card-art URL scheme to avoid copying: `app/shared/utils/cardImageUrl.ts`; public upload pattern to avoid: `app/api/spoilers/upload/route.ts`, `app/api/sync-card-images/route.ts`.
- Existing card model + the generated-artifact promotion target: `lib/cards/lookup.ts`, `lib/cards/generated/cardData.ts`, `scripts/parse-carddata.js`, `Makefile` (`update-cards`), `app/decklist/card-search/constants.ts`, `app/decklist/card-search/utils/deckValidation.ts`.
- Middleware reality (no `api/` coverage): `middleware.ts`, `utils/supabase/middleware.ts`; image config: `next.config.js`.
- STDB schema (Phase 2 isolation) + SDK rules: `spacetimedb/src/schema.ts`, `spacetimedb/CLAUDE.md`.
