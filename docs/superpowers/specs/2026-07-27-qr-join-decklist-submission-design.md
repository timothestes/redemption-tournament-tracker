# QR Tournament Join + Decklist Submission

**Date:** 2026-07-27
**Status:** Draft for Tim's review — rev 4 (rev 2: public/unlisted-deck
submission, required-category wizard + Unofficial, frozen generated names,
typeable join codes, listing-path coverage; rev 3: public per-event results
page with standings + published decklists; rev 4: auto-publish at tournament
end per Tim's ruling, host-guide follow-up)
**Driver:** Elders want this season's tournaments run through the app so tournament
data (participation, decks per event) accumulates in one place. The missing piece is
getting players — and their decklists — into an event without the host typing
everything. This design went through two independent adversarial reviews
(security/data-integrity + product/codebase-fit); their surviving findings are
incorporated throughout.

## 1. Goal

Players join a tournament by scanning a QR code the host displays. For constructed
events, a **legal decklist is required to join** — validated server-side against the
event's format at submission time and snapshotted immutably. Side effects that serve
the data-platform direction: participants become linked to real accounts, and each
event carries a frozen, verified copy of every submitted deck.

## 2. Current state (verified)

- **No join flow exists.** Participants are free-text names the host types
  (`app/tracker/tournaments/[id]/page.tsx:128-143`); `participants` has **no
  `user_id`** column (deliberately omitted originally). 2,340 rows in prod.
- **`tournaments.code` exists, is UNIQUE, and is used by nothing** (0/272 rows
  populated) — a ready-made join-code column.
- **RLS is host-only on every tournament table** — an anonymous scanner can't even
  read the event name. House patterns for crossing this: `SECURITY DEFINER`
  functions (forge invites, migration 049) and service-role clients in server
  actions (`publishTournamentDecklistsAction`, `app/tracker/tournaments/actions.ts`).
- **~80% of the decklist plumbing exists**: `tournament_decklists` (participant_id
  UNIQUE, migration 017), host attach/detach actions, a format-compatibility helper
  (`deckAttachability`, `components/ui/AttachDeckDialog.tsx:44-58`), and the
  authoritative server-callable validator `checkDeck(cards, reserve, format)`
  (`utils/deckcheck/index.ts:295`) which `saveDeckAction` already runs in-process.
- **Format registry** (`lib/formats.ts`): `FormatId = Limited | Unlimited | T2 |
  Paragon`; `normalizeTournamentFormat` maps `tournaments.deck_format` to
  `FormatId | 'Other' | null`. Prod tournaments: 250 null, 12 'T1', 4 'Other',
  4 'T2', 1 'Type 1', 1 'Limited' — always normalize on read.
- **Lifecycle** is the boolean pair `has_started` / `has_ended`; the
  "no adds after start" rule (`lib/tournament/lifecycle.ts:9`) is **UI-only** —
  no DB or server enforcement exists.

## 3. Player flow

1. Host enables **QR Join** on the tournament page → app generates a join code,
   shows a large QR encoding `{origin}/join/{code}` + the copyable URL **+ the
   code itself in large type** ("or go to {site}/join and enter `T7K2QF`"). A bare **`/join`** landing page offers a code-entry field for
   players who can't scan — same lookup, same rate limit.
2. Player scans or types the code → public route **`/join/[code]`**:
   - Invalid or disabled code → friendly error.
   - Shows event name, category, format badge, host name (host's
     `profiles.username` — never an email fallback).
   - Not signed in → "Sign in to join" → `/sign-in?redirectTo=/join/{code}`
     (forge-invite precedent, `app/invite/[token]/page.tsx:23`).
   - Signed in → display-name field (prefilled from `profiles.username`,
     trimmed, max 40 chars) + **deck step when the event requires a decklist**:
     - Deck picker, three sources: **My decks** (default tab, searchable,
       compatible-format decks first, most recently updated first),
       **Community decks** (search public decks — netdecking is normal and the
       host-side attach dialog already searches them), and **paste a deck
       link/id** (accepts unlisted decks, which are link-visible by design;
       `loadPublicDeckAction` already permits them). Incompatible-format decks
       are **selectable with a warning** — the declared deck format is a
       sorting hint, not a gate, because 1211/1808 decks have NULL format;
       `checkDeck` is the true gate. Ownership is NOT required: the snapshot
       freezes whatever was submitted, so the source deck's later edits or
       deletion don't matter.
     - Submit → server re-reads the deck **once**, runs `checkDeck` on exactly
       that card array under the **tournament's** format, and snapshots the same
       array. Zero errors required; `card-not-found` warnings also block
       (prevents fabricated-name decks passing in Unlimited, where no pool
       check exists). Errors render as the rule messages with a link to open
       the deck in the builder.
     - Consent line under the submit button: *"Your decklist will be visible
       to the host. When the event ends, your display name, final standing,
       and decklist will be published with the results unless the host
       withholds them."* (Publication at end is the default, so the line says
       "will", not "may".)
3. Success: "You're registered." Revisiting `/join/{code}` re-verifies the
   participant row (handles host removal) and shows the joined state; until the
   tournament starts the player may **resubmit** a fixed or different deck.
4. `has_started = true` hard-locks join and resubmission, enforced inside the
   join transaction (§5), not just the UI.

## 4. Data model (one migration)

### `tournaments`
- `code` — reused as the join code. **6-char Crockford base32** from
  `crypto.randomBytes` (`Math.random` is not acceptable), uppercase +
  alias-normalized on lookup (I→1, O→0, etc. — players will hand-type it),
  retry loop on unique violation (23505). Six chars ≈ 1.07B combinations is
  deliberate: short enough to type from a whiteboard, and the anonymous lookup
  is IP-rate-limited (§5) while codes are only live pre-start on QR-enabled
  events — enumeration yields nothing durable. `NULL` = QR join disabled.
  Controls: **Enable** (generate) / **Disable** (clear). No separate
  "regenerate" — disable + enable covers the leaked-poster case.
- `results_published boolean NOT NULL DEFAULT false` — gates the public
  results page (§9), independent of `decklists_published`.
- `require_decklists boolean NOT NULL DEFAULT false` — **explicit policy knob,
  decoupled from format** (review P0: `deck_format` is NULL on ~76% of even
  recent tournaments because category is optional at creation, and no UI can
  edit it afterward — a derived-only gate would almost never fire). The DB
  default is `false`; the **app** seeds it `true` when a tournament is created
  with (or the QR dialog is configured for) a Limited/Unlimited/T2
  category/format, per the §7 defaulting table. The stored value is always
  explicit thereafter.

### `participants`
- `user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL`.
- Partial unique index `(tournament_id, user_id) WHERE user_id IS NOT NULL`
  (blocks double-join; conflict maps to "already joined").
- Host manual adds keep `user_id` NULL — the free-text flow is untouched, and
  existing consumers ignore the new column (host page selects `*`,
  `ParticipantTable`'s interface ignores unknown fields — review-verified).

### New table `tournament_deck_submissions` — the immutable record
```sql
create table tournament_deck_submissions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  participant_id uuid not null unique references participants(id) on delete cascade,
  deck_id uuid references decks(id) on delete set null,  -- provenance only
  submitted_by uuid references auth.users(id) on delete set null,
  source text not null check (source in ('player','host')),
  deck_snapshot jsonb not null,  -- { deckName, deckFormat, cards: [{name, set, imgFile, quantity, zone}] }
  is_legal boolean,
  deckcheck_issues jsonb,
  submitted_at timestamptz not null default now()
);
alter table tournament_deck_submissions enable row level security;
revoke all on tournament_deck_submissions from anon, authenticated;
-- no policies: service-role access only, via server actions that verify authority
```

**Why a new table, not columns on `tournament_decklists` (review P0):**
`tournament_decklists` carries `public_can_read_published_decklists` — a SELECT
policy open to everyone once `tournaments.decklists_published` flips true
(migration 017:30-35; live grants are even broader). RLS is row-level, so a
snapshot column there would expose full private-deck contents + submitter uuids
to anon the moment a host clicks Publish, before any consent step. A default-deny
table (forge-invites pattern) contains the blast radius by construction.

**Why `deck_id` is nullable SET NULL, not CASCADE (both reviews, P0):**
`tournament_decklists.deck_id` is `NOT NULL ... ON DELETE CASCADE` — a player
deleting their deck (routine cleanup) silently destroys the event record. The
snapshot must survive the live deck. The migration also alters
**`tournament_decklists.deck_id` to nullable + `ON DELETE SET NULL`** to fix the
same rot in the existing table (its `published_deck_id` is already SET NULL).

- Maybeboard is excluded from snapshot and validation (zone filter
  `in ('main','reserve')` — note `loadDeckByIdAction` does NOT filter zones and
  must not be reused for the submission read).
- Snapshot cards carry `imgFile` so the host modal can render images without
  set-name drift.

### `tournament_decklists` — kept in sync, role unchanged
Player submission upserts the `(participant_id, deck_id)` link here too, so the
existing attach UI and publish flow keep working. A shared helper owns writes to
both tables so they can't diverge. Folding `tournament_decklists` into the
submissions table is a named follow-up, not v1.

### `tournament_join_blocks`
```sql
create table tournament_join_blocks (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (tournament_id, user_id)
);
```
Same default-deny grants. Written when a host removes a QR-joined participant
and chooses "Remove & block"; checked in the join transaction. Without it, a
removed player can rejoin forever (the partial unique index dies with the row)
and the host's only counter is disabling the code for everyone.

## 5. Server actions & the join transaction

New `app/join/actions.ts` (`"use server"`), following the admin-client house
style (`getSupabaseAdmin()` as in the publish flow) with explicit checks
replacing RLS. Server actions are open POST endpoints — each action's checks
are the entire security boundary:

- **`getJoinInfoAction(code)`** — anonymous. Normalizes the code, rate-limits by
  IP (`rateLimitForUnauthIp`, `lib/api/rateLimit.ts:84` — the only anonymous
  enumeration surface). Returns `{ tournamentName, category, deckFormat
  (normalized), hostName, hasStarted, requiresDecklist }`; if authenticated,
  adds `{ alreadyJoined, mySubmission: {deckName, submittedAt, isLegal} }`.
  Nothing else leaks — no participant list, no ids beyond what the page needs.
- **`joinTournamentAction(code, { displayName, deckId? })`** — requires
  `getUser()`. Pipeline:
  1. Normalize + look up code; reject if no tournament or `has_started`.
  2. Reject if `(tournament_id, user_id)` is in `tournament_join_blocks`.
  3. If `require_decklists`: verify the deck exists AND is submittable by this
     user — **own deck, or `is_public = true`** (covers `public` and
     `unlisted` visibility; a private deck belonging to someone else is
     rejected even if the id is known). Admin-read `deck_cards` **once** with
     the zone filter; run `checkDeck(main, reserve, tournamentFormat)`;
     require `valid === true` and zero `card-not-found` warnings. The same
     card array becomes the snapshot — verdict and snapshot are consistent by
     construction (no check-then-reread TOCTOU).
  4. Call the **join transaction function** (below) with the validated payload.
- **`resubmitDeckAction(code, deckId)`** — same checks; replaces the
  submission row + decklist link; before start only. Locates the participant
  strictly by `(tournament.id, auth.uid())` — these actions never accept a
  `participantId` parameter (confused-deputy guard).

### Join transaction: one SQL function, atomically
`tournament_qr_join(...)` — a single Postgres function (EXECUTE revoked from
`public, anon, authenticated`; called only by the service-role client) that:

1. `SELECT ... FROM tournaments WHERE id = $1 FOR UPDATE` and re-checks
   `has_started = false` **under the row lock**;
2. inserts the participant (name, user_id) — unique-violation → "already joined";
3. inserts/updates the submission row and the `tournament_decklists` link;
4. commits all or nothing.

This closes two review P1s at once: the **Start race** (`handleStartTournament`
sets `has_started` then generates pairings — `page.tsx:479→:499`; the row lock
serializes joins against that update, so any join that wins commits before
pairing generation reads participants) and the **half-joined state** (participant
row without a required decklist can't be produced by a mid-pipeline failure).

### Host-side actions — user-scoped client, not admin
Enable/disable QR join and `require_decklists`/`deck_format` edits go through
the **normal user client**, so the existing `auth.uid() = host_id` RLS policy
enforces authority for free (review P1: admin-client host actions that forget
the host check would let any authenticated user mint or kill codes for all 272
tournaments). This matches how `TournamentSettings` writes today.

## 6. Tournament creation: required category, Unofficial, frozen generated names

The creation modal (`components/ui/tournament-form-modal.tsx`) already behaves
like a one-step wizard — category checkboxes that auto-build a name
(`buildAutoName`: "Jun 29, 2026 Type 1 Tournament") and seed
`deck_format`/`max_score`/`round_length` via `categoryDefaults`. Three changes
turn it into the standardized funnel the elders asked for:

1. **Category becomes required.** Today it's optional (`category: selected[0]
   ?? null`, `tournament-form-modal.tsx:103`), which is exactly why 250/272
   prod tournaments have NULL `deck_format` and the data is untrackable. The
   submit button disables until ≥1 category is checked.
2. **New "Unofficial" category**, listed last in `STANDARD_CATEGORIES`' modal
   options. Semantics: `deck_format 'Other'`, `require_decklists` seeded
   false, **free-text name allowed**, and flagged so future elder reporting
   can exclude it. This is the pressure valve that lets every *official*
   category be strict: casual/house events don't fight the standardization,
   they opt out of it.
3. **Generated names are frozen for official categories.** The name field
   becomes a read-only preview of `buildAutoName(category)`; the
   "rename later from the tournaments list" affordance is disabled for
   official-category tournaments (Unofficial keeps free naming + rename).
   Host identity doesn't need to live in the title — `host_id` is already on
   every row, which is the "know the host in the back end" TheDudeAbides
   asked for.

**The "Host This Event" listing path goes through the same rules.** Today it
passes a listing-derived free name (`City Type MM-DD`,
`tournaments-client.tsx:328`) that overrides the auto-name, plus the listing's
format strings as category options. Revised: listing formats still drive the
category choices (they map through `categoryDefaults` fuzzy matching as
today), but the name is generated as `{Mon D, YYYY} {Category} — {listing
city}` and frozen; `listing_id` linking is unchanged. "Host another category"
inherits the same behavior. One formula everywhere means event names sort and
group predictably in the future dataset.

The wizard also seeds `require_decklists` per the §7 defaulting table, so a
"Type 2" tournament is born requiring decklists without the host touching a
setting.

## 7. The decklist requirement

- **`require_decklists` defaults ON** when the event's category/format resolves
  to **Limited, Unlimited, or T2** (`Type 1 Limited`, `Type 1 Unlimited`,
  `Type 2` categories or equivalent `deck_format`). Defaults **OFF** for
  Paragon, Teams, Type A, Booster Draft, Sealed Deck, **Closed Deck** (the
  official listing term — 46 listing entries use it and the fuzzy matcher
  previously missed it, falling through to Limited), **Unofficial**, 'Other',
  and null — but the host can flip it wherever a validation format exists:
  - **Paragon ON is allowed** with a documented caveat: `validateParagonRules`
    covers size/reserve/pool/copy limits server-side, but brigade quotas,
    no-Lost-Souls, and dominants ≤ 7 are still client-only (format-restructure
    spec §9 follow-up). The gate enforces the server-side subset; the verdict
    is stored with its issues.
  - **Type A defaults OFF deliberately** — its category maps to `deck_format
    'Limited'` (`categoryDefaults.ts:45-47`), and full Limited validation would
    hard-block beginner-rules decks at the door. Needs an elder ruling before
    requiring.
  - ON requires `deck_format` to resolve to a `FormatId` — there is nothing to
    validate against otherwise. The QR Join dialog surfaces both knobs
    (format dropdown + require toggle) since **no UI can currently edit
    `deck_format` post-creation** — that editor is part of this feature.
- Compatibility at validation: the deck is checked under the **tournament's**
  format regardless of its declared format (so a Limited-pool deck passes in an
  Unlimited event; an Unlimited-labeled but rotation-legal deck passes in a
  Limited event; anything oversized/off-pool fails with named cards).
- **Legality is point-in-time.** Verdicts snapshot the rules at submission
  (consistent with the restructure spec's "history reflects the rules it was
  played under"). Because the August 2026 rules cutover lands mid-season, the
  host gets a **"Re-check all decklists"** action that re-runs `checkDeck` over
  stored snapshots and updates verdicts — for the deck-check table on event day.

## 8. Host experience

- **QR Join dialog** (button in the Participants tab toolbar next to Add
  Participant, `components/ui/TournamentTabs.tsx:179-201`; visible pre-start):
  large QR (`qrcode.react`, new dependency), the code in large type for
  hand-entry, copyable URL, enable/disable, the format + require-decklists
  knobs, and a **live counter** ("7 joined · 5 decklists", polled every few
  seconds — the page has no realtime today).
- **Participants tab**: linked-account rows show the account's
  `profiles.username` beside the free-text display name (host can tell two
  "John S" rows apart; impersonation is visible). A "9/12 participants have
  submitted decklists" line appears pre-start and on the Start confirmation —
  the soft feedback loop matters more to the data goal than the hard gate,
  since host-added walk-ins never pass through the QR door.
- **Viewing submissions**: `loadTournamentDecklistsAction` merges
  snapshot-derived name/count/verdict (admin read after verifying
  `host_id = auth.uid()`), because the current `decks` join returns
  "Unknown / 0c" for private decks the host can't read. The decklist link opens
  a **snapshot modal** (grouped by type, main/reserve, legality badge,
  submitted-at) instead of `/decklist/{id}` when the live deck is private or
  gone.
- **Host attach** (existing `AttachDeckDialog`) now writes a fresh snapshot +
  verdict through the same shared helper (`source: 'host'`) — previously it
  only swapped `deck_id`, which would have welded a player's stale snapshot to
  a different deck. **Detach** on a player-submitted row asks for confirmation
  and deletes the submission.
- **Remove participant** on a QR-joined row offers "Remove" / "Remove & block".
- **Publish flow publishes from the snapshot when one exists** (fidelity: what
  was checked is what gets published; the consent line at submit covers it),
  falling back to the live deck for host-attached rows without snapshots as
  today. This is the "push results to the community" step: publishing copies
  each snapshot into a real public deck credited to the participant (existing
  flow, `publishTournamentDecklistsAction`), and those decks surface in the
  community gallery — which already supports a tournament-decks filter
  (`loadPublicDecksAction`'s `tournamentOnly`). This runs **automatically when
  the host ends the tournament** (see §9) — no separate click unless the host
  opted out at end and publishes later.
- **The existing attach-decklist feature is absorbed, not replaced**: it
  becomes the host-side lane of the same system. Player QR submissions and
  host attaches write the same submission record through one shared helper;
  `AttachDeckDialog` stays as the host's override for walk-ins and
  corrections. `tournament_decklists` keeps its role (and the publish flow its
  wiring) with rows synced from both lanes, until the follow-up that folds it
  into `tournament_deck_submissions`.

## 9. Public results page

The public face of the collected data — one page per published event:
**`/tournaments/results/[tournamentId]`** showing the (standardized, frozen)
event name, date, category/format badge, **final standings** (place, display
name, points/record — already computed by `lib/tournament/standings.ts`), and
each participant's **decklist link** where one was published
(`published_deck_id` → the community deck copy). Unpublished decklists show
as "—"; the page never renders raw snapshots — snapshots stay host-only until
the publish step consents them into public copies.

- **Publication is automatic at tournament end (Tim's ruling, 2026-07-27).**
  The End Tournament flow publishes results AND decklists by default: it sets
  `results_published = true` and runs the snapshot-publish step in one go,
  with an opt-out checkbox in the end-confirmation dialog ("Keep results/
  decklists private") rather than an opt-in prompt. Tournaments that end
  automatically by completing their final round (the common path — no dialog
  exists there) publish unconditionally; the host's recourse is unpublishing
  afterward. New column
  `tournaments.results_published boolean NOT NULL DEFAULT false` (false until
  the event actually ends). The host can still unpublish either afterward —
  the toggles live next to the existing Publish Decklists section, and the
  two remain independent (results public with decklists withheld, and vice
  versa).
- **Access mechanism:** no RLS changes. The page is a server component whose
  loader reads via the admin client after checking `results_published = true`
  — same pattern as every other cross-RLS read in this design. Standings,
  names, and published-deck links only; matches/rounds detail stays private
  in v1.
- **Discovery:** a "Results" tab on the existing public `/tournaments` page
  (tab infrastructure already exists there) listing recently published
  events, newest first. With frozen generated names, the list reads cleanly:
  "Aug 2, 2026 Type 2 Tournament — 12 players".
- The §3 consent line covers this surface too (see below): players are told
  at join time that their display name and final standing may appear in
  public results.

## 10. Route & page

- `/join/[code]` — public (middleware protects only `/tracker`, `/admin`;
  review-verified `utils/supabase/middleware.ts:7`). Mobile-first: this is a
  phone-at-the-reg-desk page. States: invalid code / signed-out / form /
  validation errors / joined / event-started / removed.
- Deck-fix loop: validation errors link to the deck in the builder (the builder
  has real mobile support); the join page stays one back-tap away and offers
  re-check on return.

## 11. Testing

- Unit: code generation/normalization (including hand-typed alias mapping);
  `require_decklists` defaulting per category (Unofficial OFF, Type A OFF);
  generated-name formula incl. listing city variant; snapshot serialization
  excludes maybeboard.
- Integration (vitest against the actions): join happy path per format;
  illegal deck rejected with issues; `card-not-found` blocks; double-join →
  "already joined"; join after start rejected; blocked user rejected; resubmit
  replaces; submitting a public deck and an unlisted deck succeeds, someone
  else's private deck is rejected; host attach overwrites snapshot; deck
  deletion nulls `deck_id` but leaves the snapshot; publish uses snapshot;
  creation requires a category and frozen names resist rename for official
  categories.
- The join transaction's Start-race behavior gets a direct test: join committed
  under lock is visible to the pairing read.
- Results page: 404/hidden while `results_published = false`; standings match
  the host view; unpublished decklists render "—"; no snapshot content ever
  reaches the public payload.
- End Tournament: default path sets `results_published` and creates published
  deck copies from snapshots in one flow; the opt-out checkbox leaves both
  private; unpublish reverses each independently.
- E2E (existing verify skill): scan-path simulation — visit `/join/{code}`
  signed-out, sign in, submit a seeded legal deck, confirm participant +
  submission rows; host sees the snapshot modal.

## 12. Explicitly out of scope / follow-ups

- **Elder analytics / aggregation** (category participation rates, deck
  archetype performance across events) — the per-event public results page
  (§9) is in scope; cross-event aggregation and any elder back-end views are
  their own design, built on the same data.
- **Host-side manual decklist entry** (paste a text list for a walk-in /
  paper player — the deckcheck API already parses pasted text). Named because
  it is the known coverage boundary: the QR funnel only captures smartphone
  self-servers, and elders should know the dataset excludes walk-ins until
  this exists.
- **Late entry after round 1** — the pairing engine would handle it (new
  participants pair in at 0 points), but "no adds after start" is today's rule
  app-wide; this design enforces it server-side without foreclosing a future
  late-entry feature.
- **Player "leave event"** — host removal covers it for v1.
- **Porting Paragon's client-only rules server-side** (pre-req for Paragon
  required-submission without caveats; already a restructure-spec follow-up).
- **Folding `tournament_decklists` into `tournament_deck_submissions`.**
- **Host guide: "How to run a tournament in the tracker"** — with hosts being
  directed to run this season's events through the app, a walkthrough doc is
  needed: create via the wizard, enable QR join, decklist requirements, deck
  checks from snapshots, rounds/pairings/timer, drops, ending the event, and
  what auto-publishes when. Likely an in-app page linked from the tracker
  (plus something the elders can circulate to hosts). Small, ships right
  after v1 — worth its own quick pass so screenshots match the shipped UI.
- **v2: Online-play tournaments.** The compelling follow-on: for an online
  event, players and decklists are *already in the app*, so the same join flow
  plus pairings that generate SpacetimeDB game links (the multiplayer lobby
  already has invite-by-link) would run a whole tournament with zero physical
  logistics — no QR needed, joining happens from the event page itself.
  Pairing → game link → result reporting back into the tracker is the sketch;
  needs its own design (result verification, timers, spectating).

## 13. Decisions Tim may want to override

1. **Paragon defaults to not-required** (host can opt in, partial validation
   caveat documented). Alternative: require once server-side Paragon rules land.
2. **No player "leave event"** in v1 — host removes instead.
3. **Walk-ins stay free-text** — no attempt to require accounts for
   host-added participants.
4. **`require_decklists` is host-controllable** rather than hard-wired to
   format — an elder-driven "always required for sanctioned constructed
   events" policy would be a one-line default change later.
5. **Name formula** is `{Mon D, YYYY} {Category}` (the existing
   `buildAutoName` shape), `— {city}` appended when hosting from a listing;
   frozen for official categories only. If the elders want a different
   formula (host name in the title, season prefix), it's a one-function
   change — but pick it before launch, since frozen names are forever.
6. **Public and unlisted decks are submittable at join** (not just the
   player's own) — the snapshot freezes contents, so source ownership doesn't
   affect integrity. Flip to own-decks-only if the elders want decklists to
   prove authorship.
7. ~~Results publication opt-in vs opt-out~~ — **decided by Tim 2026-07-27:
   publication (results + decklists) is automatic at tournament end, with a
   host opt-out at the end-confirmation step and unpublish afterward.**
