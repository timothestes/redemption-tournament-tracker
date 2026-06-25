# The Forge — Phase 1b.2: Realtime Collaboration Layer

**Date:** 2026-06-25
**Phase:** 1b.2 (second sub-slice of Phase 1b — collaborative review)
**Branch:** `forge-phase-1b-2-realtime`
**Predecessor:** 1b.1 (Review Layer — proposals + comments/suggestions), PR #129, merged to `main`.

---

## Context

Phase 1b.1 shipped the review layer (proposals, comments, single-field suggestions, per-set review queue) but is **refetch-only**: every collaborative surface updates via `router.refresh()` on the acting user's own action. A second elder looking at the same card or the set's review queue sees nothing until they reload. The master spec (`2026-06-19`) always intended Phase 1b to **make this layer live** via Supabase Realtime (lines 58–60, 466–471): live comment threads, presence avatars + collision warnings, live review-queue badge counts, live set-notes, live progress.

This slice delivers that liveness. It adds **no new product surface** — every feature already exists from 1b.1/1a.5. It makes the existing surfaces update in real time and adds presence/collision affordances. The load-bearing work is the **security spine**: standing up private, authorized Realtime channels and extending the anon-leak guardrail to cover them, without violating the hard constraint that *nothing about prerelease cards may reach a non-member*.

---

## Goals / non-goals

**Goals**
- **Live comment threads** — a comment/suggestion posted by one elder appears immediately for everyone viewing the card.
- **Presence + soft collision warning** — avatars of who is currently viewing/editing a card; a non-blocking "X is also editing this card" banner when ≥2 elders have the studio open. Last-write-wins autosave is unchanged (no locking, no CRDT).
- **Live review-queue badges** — a set's open-proposal / unresolved-suggestion counts update live for its elders.
- **Live set-notes** and **live progress dashboard** — viewers see edits/status changes without reloading.
- **Security spine holds:** Realtime is delivered over **private, authorized** channels gated by RLS on `realtime.messages`; the anon-leak guardrail is extended to prove a non-member (and anon) cannot join a Forge channel or receive any Forge broadcast.

**Non-goals (this slice)**
- Proposing **art** changes (`proposed_art_key` stays reserved → later).
- Multi-reviewer / **N>1** approval (stays single-elder per the parent spec).
- Proposal **re-open / re-base** (a stale-base proposal is still closed `superseded`; author re-proposes).
- **Playtester** participation (Phase 2). Today every set-card reader is an elder; presence/collision is among co-designing elders.
- **CRDT / operational-transform** co-editing of a card's fields. Collision is *warned*, not prevented.
- A **notification feed** or email. Liveness is in-app only, as the master spec dictates.
- Any change to **`/board`** or its `supabase_realtime` publication (this slice uses a different delivery mechanism — see below).

---

## The core architecture decision: Broadcast from Database, not Postgres Changes

The master spec's wording was "Realtime enabled on `card_comments`, `forge_cards`, `forge_sets` … `postgres_changes` … private/authorized channels." During design we found that **Postgres Changes is the wrong mechanism for this threat model**, and chose **Broadcast from Database** instead. This is a deliberate, security-motivated upgrade over the spec's literal wording — same intent (live, private, RLS-gated), strictly safer realization.

| | Postgres Changes (spec's literal reading) | **Broadcast from Database (chosen)** |
|---|---|---|
| How | Add forge tables to the global `supabase_realtime` publication + `REPLICA IDENTITY FULL`; clients subscribe to row-change events. | A `security definer` trigger on each forge table calls `realtime.broadcast_changes()` to a **private** topic; clients subscribe to that topic. |
| Authorization | RLS on the **source table** filters rows — **but only on private channels**. On a **public** channel, Postgres Changes performs **no** authorization. | RLS on **`realtime.messages`** governs who may join/receive a topic. A private topic and a public topic of the same name are **distinct channels**; DB broadcasts reach only the private topic. |
| Threat-model exposure | Forge tables sit in a **global** publication. A non-member could attempt a **public-channel** Postgres-Changes subscription to `card_comments` and receive unfiltered changes. The leak test must actively disprove this path, and it depends on correct project config. | **No exposure surface.** Broadcasts exist only on the private topic; a non-member fails `realtime.messages` RLS and cannot join it. A public channel of the same name receives nothing because no broadcast is ever sent there. |
| Schema footprint | Touches the shared `supabase_realtime` publication (`/board` lives there) + replica identity. | Touches **nothing** shared. `broadcast_changes` passes `NEW`/`OLD` explicitly and rides Realtime's own internal `realtime.messages` replication — **no publication change, no `REPLICA IDENTITY` change**. `/board` is untouched. |
| Supabase guidance | "Simpler, but does not scale as well." | "**Recommended** method for scalability and security." |

**Decision: Broadcast from Database.** It eliminates the public-channel bypass surface entirely, is uniform (a trigger can't be forgotten the way a hand-rolled per-RPC broadcast could), leaves shared infrastructure untouched, and is Supabase's recommended direction.

---

## Channel topology (private, member-authorized)

Two topic families, each consumed by exactly one page type so every consumer subscribes to a single channel:

- **`forge:card:{cardId}`** — used by the card studio/review page (`/forge/cards/[cardId]`). Carries broadcasts for: the card row, its comments, its proposals. **Also hosts presence** (who is viewing/editing this card).
- **`forge:set:{setId}`** — used by the set pages (`/forge/sets/[setId]/{review,notes,progress}`). Carries broadcasts for: the set row (notes), every card in the set (status/brigade/type for progress), and proposals/comments on those cards (badge counts). No presence.

**Trigger fan-out.** Each table's trigger broadcasts to the topic(s) a consumer needs, looking up the owning set where the row doesn't carry it directly (cheap indexed PK lookups, run in a `security definer` trigger):

| Table | Broadcast to `forge:card:{…}` | Broadcast to `forge:set:{…}` |
|---|---|---|
| `forge_sets` | — | `forge:set:{id}` |
| `forge_cards` | `forge:card:{id}` | `forge:set:{set_id}` when `set_id` is not null |
| `card_proposals` | `forge:card:{card_id}` | `forge:set:{set_id of card_id}` when the card is in a set |
| `card_comments` | `forge:card:{card_id}` | `forge:set:{set_id of card_id}` when the card is in a set |

A card page thus reacts to everything about its card; a set page reacts to everything about its set — each from one subscription.

**Join authorization — per-topic, matching table RLS.** A non-member must not join any `forge:*` topic, and — crucially — a member must not join a topic for a card/set they cannot read. Broadcast payloads are **not** per-row RLS filtered the way Postgres Changes are; whoever joins a topic receives every payload sent to it. So the join gate itself must carry the full read-authorization, parsing `realtime.topic()` and reusing the existing read predicates:

- `forge:card:{uuid}` → `public._forge_can_read_card(uuid)` (owner / set-elder of the card's set / superadmin — the exact 053 read rule).
- `forge:set:{uuid}` → `public.is_forge_set_elder(uuid) or public.is_forge_superadmin()` (the exact 052 set-read rule).

This makes the Realtime layer's visibility **identical to the table RLS** — no intra-member content exposure, not just no non-member leak — and it is the same predicate Phase-2 playtesters will need, so Phase 2 requires no rework. (The cast `split_part(topic,':',3)::uuid` is guarded by a uuid-format check first so a malformed topic fails closed without a noisy error.)

---

## Security spine — migration `054_forge_realtime.sql`

Schema + functions only, no data. Follows every 052/053 convention: `security definer`, `set search_path = ''`, explicit anon handling, default-deny posture.

**1. `realtime.messages` RLS policies (the join gate).** A `select` policy (receive broadcasts + others' presence + join) and an `insert` policy (publish own presence) share one **per-topic read predicate** so Realtime visibility equals table RLS. A `stable` helper `public._forge_can_read_topic(text)` encapsulates the parse-and-check so both policies (and the test) stay in sync:

```sql
create or replace function public._forge_can_read_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_topic like 'forge:card:%' then
    begin v_id := (split_part(p_topic, ':', 3))::uuid; exception when others then return false; end;
    return public._forge_can_read_card(v_id);
  elsif p_topic like 'forge:set:%' then
    begin v_id := (split_part(p_topic, ':', 3))::uuid; exception when others then return false; end;
    return public.is_forge_set_elder(v_id) or public.is_forge_superadmin();
  end if;
  return false;
end $$;

create policy "forge realtime receive" on realtime.messages
  for select to authenticated
  using ( public._forge_can_read_topic((select realtime.topic())) );

create policy "forge realtime presence-send" on realtime.messages
  for insert to authenticated
  with check ( public._forge_can_read_topic((select realtime.topic())) );
```

`_forge_can_read_card` (053), `is_forge_set_elder` (052), `is_forge_superadmin` (051) are existing helpers. No `anon` grant is added; `anon` is not `authenticated`, so anon is denied by default, and the predicate returns `false` for any non-`forge:` topic. (All **data** broadcasts originate from the DB triggers as the Realtime admin role, so the client `insert` policy is needed only for presence tracking; gating it to topic-readers keeps presence visible only to a card's co-designers.)

**2. Trigger functions (broadcast on write).** One `security definer` function per table (or a shared helper) that computes the topic(s) and calls `realtime.broadcast_changes(topic, TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD)`. `AFTER INSERT OR UPDATE OR DELETE` triggers on `forge_sets`, `forge_cards`, `card_proposals`, `card_comments`. Set-topic lookups: `forge_cards.set_id` directly; for `card_proposals`/`card_comments`, `select set_id from public.forge_cards where id = <card_id>`. Functions own `search_path = ''` and reference `realtime.broadcast_changes` / `public.forge_cards` fully qualified.

**3. No publication / replica-identity changes.** `broadcast_changes` does not use the `supabase_realtime` publication. `/board` is unaffected.

**4. Project setting (documented, not a migration).** Disable **"Allow public access"** in Realtime Settings as defense-in-depth so the project serves *only* private channels. Security does not depend on it for this slice (DB broadcasts never reach a public topic), but it removes an entire class of future foot-gun. Recorded in the plan as a manual dashboard step + in the PR description.

**5. Anon-leak guardrail extension (the keystone).** `__tests__/forge-anon-leak.test.ts` gains a Realtime section. As **anon** and as a **signed-in non-member**:
- `realtime.setAuth(token)` then `.channel('forge:card:<seed-id>', { config: { private: true } }).subscribe()` → assert the channel **does not reach `SUBSCRIBED`** (it gets `CHANNEL_ERROR`/timeout because the `realtime.messages` SELECT policy denies the join).
- Same for a `forge:set:<seed-id>` topic.
- Defense-in-depth: join a **public** channel of the same topic name and assert **zero** messages arrive within a window even after a member-side write occurs.
- Positive control (optional, gated behind the live-test flag): a member **can** reach `SUBSCRIBED`.

The test runs under the existing `FORGE_LEAK_TEST=1 npm run test:security` live harness (the only mode with a real socket + seeded ids); it is skipped in the hermetic default run like the other live probes.

---

## Client modules

**`app/forge/lib/realtime.ts`** (new) — the single private-channel factory. Browser-only (`utils/supabase/client.ts`). Responsibilities:
- `forgeChannel(name, opts)` — creates a channel with `config: { private: true }`, after ensuring `await supabase.realtime.setAuth()` has run (so the socket carries the member's JWT before join).
- `forgeCardTopic(cardId)` / `forgeSetTopic(setId)` — the canonical topic-name builders (single source of truth, mirrored by the trigger SQL's topic format; both documented as `forge:card:{uuid}` / `forge:set:{uuid}`).
- Subscribe/teardown helpers that return an unsubscribe function for React effect cleanup.

**Hooks** (new, colocated under `app/forge/` — `lib/useForgeRealtime.ts` or per-surface):
- `useForgeChannelInvalidate(topic, onChange)` — subscribes to a topic's broadcast events and calls `onChange` (debounced ~250ms) so the consumer can `router.refresh()` / scoped-refetch. Used by review badges, progress, notes, proposal lists.
- `useForgeComments(cardId, initial)` — subscribes to the card topic, applies INSERT/UPDATE/DELETE comment payloads to local state for an instant live thread. (The one surface that consumes payloads directly rather than refetching.)
- `useForgePresence(cardId, me)` — joins the card topic's presence, tracks `{ userId, displayName, editing }`, returns the roster + an `othersEditing` boolean for the collision banner.

All hooks are no-ops/clean-teardown when their id is absent (e.g. the studio's card has `set_id === null`, so the card page still works; the set surfaces simply aren't mounted).

---

## Live surfaces & consumption strategy

| Surface | Mechanism | Consumption |
|---|---|---|
| **Comment thread** (`CommentThread.tsx`) | `forge:card` broadcasts of `card_comments` | **Apply payloads directly** — append on INSERT, patch on UPDATE (resolve/edit), drop on DELETE. Instant live thread; reconciles against the optimistic local insert by row `id`. |
| **Presence + collision** (`StudioEditor.tsx` / card page) | `forge:card` presence track | Avatar row of current viewers; `editing:true` set on focus/typing in the editor. ≥2 editors ⇒ soft non-blocking banner. No locking. |
| **Review-queue badges** (`ReviewQueue.tsx`, set nav tab) | `forge:set` broadcasts of `card_proposals`/`card_comments` | **Invalidation signal** → debounced `router.refresh()` (re-derives counts server-side). |
| **Set notes** (`NotesEditor.tsx`) | `forge:set` broadcasts of `forge_sets` | Invalidation signal → refetch notes for viewers. The editor stays single-author autosave; a viewer sees updates live. (Author's own in-flight edit is not clobbered — refresh only pulls when not dirty.) |
| **Progress dashboard** (`ProgressDashboard.tsx`) | `forge:set` broadcasts of `forge_cards` | Invalidation signal → debounced `router.refresh()`; progress recomputes server-side via the pure `progress.ts`. |

**Why "invalidation signal" for the derived surfaces:** badges/progress/notes are *derived* (counts, cartesian cells, rendered markdown). Reconstructing them from raw INSERT/UPDATE/DELETE payloads is bug-prone (ordering, dedupe, old-row handling) for no user-visible gain at this scale. A debounced server refetch keeps the server as the single source of truth and slots directly into 1b.1's existing `router.refresh()` model. Only the comment thread, where instant append is the whole point and the payload maps 1:1 to a list item, consumes payloads directly.

---

## Collision / presence UX

- Presence key = the member's `auth.uid()`; payload `{ displayName, editing }`.
- **Viewing** = card page mounted. **Editing** = the studio editor has focus or has autosaved within a short window.
- The card page shows a small avatar cluster of present members (display name on hover, reusing the existing avatar rendering).
- When another member is `editing` the same card, `StudioEditor` shows a quiet, dismissible banner: *"Land of Redemption is also editing this card — changes use last-write-wins."* No input is blocked. This is exactly the mitigation the master spec calls "collision warning," and it softens the 1b.1 tradeoff where accepting a proposal overwrites the working draft.
- All motion respects `prefers-reduced-motion` (avatars fade, no pulsing).

---

## Testing

- **Anon-leak guardrail extension** (above) — the keystone; must pass under the live `FORGE_LEAK_TEST=1` harness as anon + non-member.
- **Pure unit tests** for the non-React helpers: topic builders (`forgeCardTopic`/`forgeSetTopic`) and the comment-payload reducer (apply INSERT/UPDATE/DELETE to a list, dedupe vs optimistic id) — TDD, hermetic.
- **`forge-gate-first`** guardrail unchanged (no new pages; existing pages keep their own `requireForge()` gate).
- **`npm test`** full suite green (allowing the one pre-existing unrelated `store-route` failure); **`npm run build`** clean; **`get_advisors`** no new findings after 054 applies.
- **Manual signed-in smoke** (two browser sessions): post a comment in one → appears in the other; open the same card in both → collision banner; change a card's status → set progress/badges update in the other tab. Logged as the remaining manual step (no creds in an autonomous session).

---

## Risks & tradeoffs

- **Topic parsing in RLS.** The join gate parses `realtime.topic()` and casts a substring to `uuid`. The cast is wrapped in an exception guard that returns `false`, so a malformed/unknown topic fails closed rather than erroring the join. Per-topic authz means Realtime visibility equals table RLS — no intra-member content exposure — at the cost of one `stable` helper call per join.
- **Refetch on every set-topic event.** Debounced, and write volume is tiny (a few elders). If it ever became chatty, the derived surfaces could move to payload-applied reducers — deferred under YAGNI.
- **`realtime.messages` RLS join latency.** One `_forge_can_read_topic()` call per join (which itself runs one existing read predicate). Negligible at this scale; Supabase's complexity warning is about heavier policies.
- **Project setting drift.** "Allow public access" is a dashboard setting, not in the migration. Mitigated by documenting it in the PR and by the design not depending on it for correctness.

---

## Deferred to later slices

Art proposals; N>1 approval; proposal re-open/re-base; playtester access (the per-topic authz built here already accommodates them); notification feed/email; any CRDT co-editing. None are required for "make the 1b.1 review layer live."
