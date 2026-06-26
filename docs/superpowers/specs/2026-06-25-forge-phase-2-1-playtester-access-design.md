# The Forge — Phase 2.1: Playtester Access Foundation

**Status:** Design approved 2026-06-25. Branch `forge-phase-2-1-playtester-access` (off `main`).
**Master spec:** `docs/superpowers/specs/2026-06-19-forge-card-design-playtesting-design.md` (Phase 2 — Playtester play).
**Predecessors (all merged to `main`):** Phase 1a.1–1a.5, Phase 1b.1–1b.2, Set Artwork Download.

This is the **first sub-slice of Phase 2** and the dependency-root for the playtester-play arc. It activates the dormant `forge_set_grants` plumbing, gives playtesters a read-only reveal of the approved cards in the sets they've been granted, and establishes a hard role boundary between playtesters and the elder authoring workspace. The mixed-pool deckbuilder (2.2) and SpacetimeDB games (2.3) attach to the landing pad this slice creates.

---

## 1. Goal & success criteria

A granted **playtester** can sign in, land on a role-appropriate desk, open a set that's been shared with them, and browse that set's **approved** cards rendered as full card previews (text + stats + frozen approved art). They can do nothing else in the Forge: no editor, no design notes, no targets, no review queue, no draft/playtesting cards. Elders/superadmins can grant and revoke that access, both when minting a playtester invite and after the fact from a per-set panel.

**Done when:**

- An elder (or superadmin) can grant a specific playtester access to a set they run, and revoke it, from the set's progress page.
- A playtester invite can carry one or more sets; redeeming it grants those sets in the same transaction.
- A granted playtester sees, and only sees, the `approved` cards of granted sets — with the **frozen approved-version** art, never the elder's live working draft.
- Every authoring route (`/forge/ideas/**`, `/forge/cards/**`, `/forge/sets/**`) redirects a playtester to `/forge/play`.
- The anon-leak test and the per-set boundary tests pass (anon and non-member see nothing; granted playtester sees approved-only).

**Explicitly deferred (surfaced as disabled "coming soon" CTAs on the playtester desk):** mixed-pool deckbuilder (2.2), SpacetimeDB-isolated games (2.3), republish notifications (2.4), public-pool promotion (2.5).

---

## 2. Current state (what already ships, dormant)

Migration 052 shipped the read-path RLS for granted playtesters, deliberately dormant (no rows, no write path, no UI):

- **Table** `forge_set_grants(set_id, user_id, granted_by, primary key(set_id, user_id))`.
- **Helper** `is_forge_set_granted(p_set_id)` — `SECURITY DEFINER STABLE SET search_path=''`.
- **Read paths already enforced** for a granted playtester:
  - `forge_sets` SELECT — granted users see the set row.
  - `forge_cards` SELECT — granted users see `set_id IS NOT NULL AND status = 'approved'` cards.
  - `card_versions` SELECT — granted users see `status = 'approved'` versions of those cards.
- `requireForge()` already admits the `playtester` role.
- `forge_invites.set_ids` is **stored at mint** but **not consumed at redeem** ("stored for 1a.5; not consumed yet", migration 049).

So the access *model* exists. This slice supplies the **write path** (grant creation), the **playtester UI**, the **elder-page lockdown**, and **approved-version art serving**.

---

## 3. Data model & RLS — migration 055

No new tables. Migration 055 adds the write plumbing and one policy widening. All functions `SECURITY DEFINER`, `SET search_path = ''`, anon-revoked, `authenticated`-granted (the hardened pattern from 048/052).

### 3.1 `forge_grant_set(p_set_id uuid, p_user_id uuid)`

- **Authz:** `is_forge_set_elder(p_set_id) OR is_forge_superadmin()`. Raise (not silent) when unauthorized — this is an authenticated member action, not a secret-area probe.
- **Validation:** target `p_user_id` must be an existing `playtest_members` row (can't grant a non-member).
- **Effect:** `INSERT ... ON CONFLICT (set_id, user_id) DO NOTHING` into `forge_set_grants` with `granted_by = auth.uid()`.

### 3.2 `forge_revoke_set(p_set_id uuid, p_user_id uuid)`

- **Authz:** same as grant.
- **Effect:** `DELETE FROM forge_set_grants WHERE set_id = p_set_id AND user_id = p_user_id`.

### 3.3 `forge_redeem_invite` — `CREATE OR REPLACE` (extends migration 049)

Add to the existing redemption transaction: after inserting membership and stamping `used_at`, loop the invite's stored `set_ids` and `INSERT INTO forge_set_grants(set_id, user_id, granted_by) VALUES (set_id, auth.uid(), invite.invited_by) ON CONFLICT DO NOTHING`. Everything else (NDA gate, single-use/expiry/email-bind checks, the 404-equivalent not-found return) is unchanged. A grant for a set that no longer exists is impossible (FK `ON DELETE CASCADE`); a redundant grant is a no-op. This is correct for the playtester case and harmless for elder invites (which mint with `set_ids = []` today).

### 3.4 `forge_set_grants_select` — widen

Extend the SELECT policy with `OR user_id = auth.uid()` so a playtester can read their own grant rows (resolves the logged 1a.5 follow-up "forge_set_grants_select lacks own-row read"). The reveal does not strictly depend on this — `forge_sets`/`forge_cards` RLS already return the right rows — but it makes "your sets" self-describing and lets the playtester UI show `granted_by`/granted-at if desired. Elders/superadmins keep their existing read.

### 3.5 Grants & revokes

`grant execute on forge_grant_set / forge_revoke_set to authenticated`; `revoke ... from anon` (asserted by the anon-leak test). The replaced `forge_redeem_invite` keeps its existing grants.

---

## 4. Approved-version art serving

A playtester must see the **frozen approved version's** art, never the elder's live `working_art_*` (which may be a newer, unapproved replacement, or cleared). The existing proxy `app/forge/api/art/[cardId]/route.ts` serves `forge_cards.working_art_key`. Extend it with a `?v=approved` branch:

- **When `v=approved`:** read `forge_cards.approved_version_id`; if null → 404. Read that `card_versions` row's `art_original_key ?? art_key` (skip if placeholder/missing → 404). Both reads are RLS-gated — a granted playtester can already SELECT the approved version. Stream as today with `Cache-Control: private, no-store`.
- **Default (no `v` param):** unchanged — serves working art for the elder studio.
- The reveal renders `<img src="/forge/api/art/[cardId]?v=approved">`. Same gate (`requireForge()` → 404), same stream path.

**Judgment call (approved):** extend the existing proxy with a query param rather than adding a separate `/forge/api/cards/[cardId]/approved-art` route — reuses the gate, the stream logic, and the existing `forge-gate-first` coverage. The download/audit branch (`?download=1`) is independent and composes (a playtester downloading approved art is acceptable — granted = read-viewer of approved cards).

---

## 5. Routes & UI

### 5.1 Role-aware desk — `app/forge/page.tsx`

When `role === 'playtester'`: render a "Your sets" tile (→ `/forge/play`) plus **disabled "Build a deck" and "Find a game"** coming-soon tiles (visible, non-interactive, labeled). When `role` is elder/superadmin: today's Ideas / Sets / Admin desk, unchanged.

### 5.2 `/forge/play` (new) — granted-sets landing

`requireForge()` gate. Lists granted sets via the existing `listSets()` (RLS already returns only granted sets for a playtester; elders/superadmins would see their full list here too, which is fine — this route is reachable by both, but elders normally use `/forge/sets`). Empty state: "No sets have been shared with you yet."

### 5.3 `/forge/play/[setId]` (new) — the reveal grid

`requireForge()` gate; `getSet(setId)` null → `notFound()` (RLS-backed per-set 404). Renders a read-only grid of the set's **approved** cards, each as `<ForgeCardPreview card={approvedVersion.data} artUrl={"/forge/api/art/<id>?v=approved"} />`. Click → enlarged preview overlay (no editor, no autosave). No notes/targets/review/progress tabs.

New server fn `listSetApprovedCards(setId)` (in `app/forge/lib/play.ts`, server-only): reads the set's cards joined to their `approved_version_id` `card_versions` (status `approved`), returns `{ cardId, data: DesignCard, hasApprovedArt }`. Mirrors the server-only, key-never-to-client shape of `setArtwork.ts`. Cards with no `approved_version_id` are excluded (a set can contain `playtesting` cards not yet approved — those stay hidden).

### 5.4 Per-set grant panel (elder side) — set progress page

On `/forge/sets/[setId]/progress` (where set-elder management already lives), add a **"Playtesters"** panel: list current grants (member display name + granted-at), a member picker to grant, and a revoke control per row. Backed by new server actions `grantSet(setId, userId)` / `revokeSet(setId, userId)` (`requireElder`, call the new RPCs) and a `listSetGrants(setId)` reader. The member picker lists `playtest_members` with `role = 'playtester'` not already granted.

### 5.5 Invite UI — `/forge/admin`

When minting a **playtester** invite, show a multiselect of sets the minter runs; pass the chosen ids as `p_set_ids` to `forge_mint_invite` (today `members.ts` hardcodes `[]`). For elder/superadmin invite roles the set selector is hidden (grants don't apply). The redeem path (§3.3) consumes them.

### 5.6 Elder-page lockdown

Each authoring page calls a gate that redirects a playtester to `/forge/play`. Per the 1b.1 `forge-gate-first` guardrail, **each page gates itself** — no reliance on a shared layout:

- `/forge/ideas`, `/forge/ideas/[cardId]` (→ already redirects), `/forge/cards/[cardId]`, `/forge/sets`, `/forge/sets/[setId]/{cards,notes,progress,review}` → add `requireElder()`; on null-for-playtester, `redirect('/forge/play')` (vs. `notFound()` for true non-members, which `requireForge` already handles upstream).
- `/forge/admin` is already superadmin-gated — unchanged.
- Playtester-reachable routes: `/forge`, `/forge/play`, `/forge/play/[setId]`, `/forge/welcome`, and the art proxy.

### 5.7 Onboarding

Reuse the existing `/forge/welcome` profile step (display name + optional avatar) verbatim — it already runs for any new member regardless of role and redirects to `/forge`. The role-aware desk (§5.1) then presents the playtester their reveal entry + coming-soon CTAs. No separate playtester onboarding screen and no dismissible checklist in this slice (kept minimal; can be added later if wanted).

---

## 6. Security & leak-test extensions

The keystone guardrail must grow with every new surface (the `FORGE_TABLES` / RPC-probe extension points in `__tests__/forge-anon-leak.test.ts`):

- **Anon cannot execute** `forge_grant_set` / `forge_revoke_set` (add to the RPC-probe list).
- **Non-member authed** account (under `FORGE_LEAK_TEST=1`) gets nothing from `forge_set_grants` and cannot read any set/card.
- **Positive boundary (live, gated):** a granted playtester sees a set's `approved` cards but **not** its `draft`/`playtesting` cards, and cannot read another set's cards; non-granted member sees neither.
- **Negative boundary:** a playtester hitting `/forge/sets/[id]/notes` (or any authoring route) is redirected, never served notes/targets/review.
- `forge-gate-first` automatically covers the new `/forge/play/**` pages and the proxy branch (globs `/forge/**`) — they must each call a gate.

**Threat-model note:** playtesters are NDA'd members, so elder notes reaching a playtester is not a "leak" in the master-spec sense (leak = reaching a *non-member*). The lockdown is product separation, not a security boundary. The security boundary — non-member sees nothing — is already enforced by RLS and unchanged here.

---

## 7. Testing strategy

- **Pure/unit:** `listSetApprovedCards` shaping (excludes non-approved, carries no blob keys to client); `v=approved` art-key resolution (approved_version_id → version art_key, placeholder/missing → 404); grant/revoke action result shapes.
- **RLS (live, `FORGE_LEAK_TEST=1`):** the positive + negative boundary tests in §6.
- **Gate tests:** elder-gating redirects for `/forge/sets`, `/forge/cards/[cardId]`, `/forge/ideas`; `forge-gate-first` for the new routes.
- **Build:** `npm run build` clean (watch the `strict:false` discriminated-union narrowing gotcha — client consumers of `{ok}` results use `r.ok === false`).
- **Manual smoke (the usual deferred step, needs two accounts):** mint a set-scoped playtester invite as superadmin → redeem on the `landofredemption@gmail.com` account → land on `/forge/play` → open the set → see only approved cards with frozen approved art → confirm `/forge/sets/...`, `/forge/cards/...`, `/forge/ideas` all redirect to `/forge/play` → revoke from the elder panel → set disappears for the playtester.

---

## 8. File-touch summary

**New:**
- `supabase/migrations/055_forge_set_grants_write.sql`
- `app/forge/play/page.tsx`, `app/forge/play/[setId]/page.tsx` (+ a read-only reveal component)
- `app/forge/lib/play.ts` (`listSetApprovedCards`, server-only)
- grant panel component on the set progress page

**Modified:**
- `app/forge/page.tsx` (role-aware desk)
- `app/forge/api/art/[cardId]/route.ts` (`?v=approved` branch)
- `app/forge/lib/sets.ts` (`grantSet` / `revokeSet` / `listSetGrants`)
- `app/forge/lib/members.ts` (mint passes selected `set_ids`)
- `app/forge/admin/*` (playtester-invite set selector)
- `app/forge/sets/[setId]/progress/*` (Playtesters panel)
- authoring pages: add `requireElder()` + redirect (`/forge/ideas`, `/forge/cards/[cardId]`, `/forge/sets`, `/forge/sets/[setId]/{cards,notes,progress,review}`)
- `__tests__/forge-anon-leak.test.ts` (RPC probes + boundary tests)

---

## 9. Open follow-ups (deferred, logged)

- The reveal's "Build a deck" / "Find a game" CTAs are inert until Phase 2.2 / 2.3.
- No persistent notification when a granted card is republished (Phase 2.4).
- No dismissible playtester onboarding checklist (parity with the elder 3-step) — minimal onboarding by choice.
- `listSets()` is reused for `/forge/play`; if an elder visits `/forge/play` they see their full set list (harmless — they have `/forge/sets` for authoring). Not worth a separate query.
