# The Forge — Phase 1a.2: Invites, Onboarding & Member Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up invite-only membership management on top of the 1a.1 access foundation — hash-only invite tokens minted/redeemed through `SECURITY DEFINER` RPCs, an NDA-gated top-level `/invite/[token]` redemption flow, profile onboarding (display name + avatar), and a `/forge/admin` roles UI — so authorized members can grow and manage the Forge roster without anything leaking.

**Architecture:** A `forge_invites` table that is a pure secret store (no `authenticated` RLS policy at all; reachable only via definer RPCs, mirroring `api_keys`/migration 030). Raw tokens are `crypto.randomBytes(32)` base64url generated in Node; only their sha256 hash touches Postgres. All membership mutations (mint/redeem/add/remove/change-role/profile) go through role-capped `SECURITY DEFINER` RPCs that read the caller's role server-side via `my_forge_role()` (1a.1). Redemption lives at top-level `/invite/[token]` (outside the `/forge` membership gate, since the redeemer isn't a member yet) and requires only an authenticated session.

**Tech Stack:** Next.js 15 App Router (RSC + server actions + a dynamic route), TypeScript, Supabase (Postgres + Auth + RLS + RPC), `@supabase/ssr` server/client helpers, Node `crypto` (token + sha256), Resend via the existing `utils/email.ts` helper, the existing public `avatars` Storage bucket, Vitest (unit + the env-gated security test).

**Scope note:** This is plan **2 of the Phase 1a sequence**, building directly on 1a.1 (PR #119: `playtest_members`, `playtest_role`, `my_forge_role`/`forge_role_of`/`is_forge_member`/`is_forge_elder_or_super`, the last-superadmin trigger, and the `requireForge`/`requireElder`/`requireForgeSuperadmin` gate). Reference spec: `docs/superpowers/specs/2026-06-19-forge-card-design-playtesting-design.md` (Roles & Access Model; Invites & onboarding; Data Model `forge_invites`/`forge_audit`; the keystone guardrail).

**Forced deferrals (tables don't exist until later plans — not gaps):**
- `forge_remove_member` deletes the membership row + audits it (which revokes all access via RLS — the security-critical effect). **Card/set ownership reassignment** and **sole-elder reassignment** wait for `forge_cards` (1a.4) / `forge_sets`+`forge_set_elders` (1a.5).
- The invite's `set_ids` column is stored for forward-compat but **not consumed** — redemption does not create set grants until `forge_set_grants` exists (1a.5).
- Onboarding captures **display name + avatar** and lands on the desk. The spec's "jot an idea / open a set" choices + 3-step checklist wait for the studio (1a.4) / sets (1a.5).

## Global Constraints

- **Next migration number is `049`.** Schema + functions only; **no real card data**; obvious fakes only in tests.
- **Roles & cap (verbatim):** `superadmin > elder > playtester`. Grant/manage cap: **superadmin → {elder, playtester}; elder → {playtester}; others → nobody.** `superadmin` is **never** grantable via RPC (seed-only; the last-superadmin trigger from 048 backstops removal/demotion).
- **Token:** raw = `crypto.randomBytes(32).toString("base64url")`, generated in Node. Store **only** `sha256(raw)` hex (`token_hash`). Raw token never touches the DB; it travels only in the emailed URL.
- **No oracle on redeem:** bad / expired / used / email-mismatched tokens all return the **same** NULL/not-found result. Redemption requires an authenticated session.
- **NDA gate (applies to every invite acceptance):** accepting an invite requires acknowledging a short confidentiality notice by typing **"I agree"** (case-insensitive, trimmed). Enforced in three places: the Accept button is disabled until it matches (UX), the `redeemInvite` server action re-validates the typed text (defense in depth), and `forge_redeem_invite` refuses (`p_nda_agreed` must be true) and stamps `playtest_members.nda_agreed_at` (DB boundary + record). A non-agreeing call returns the same NULL as a bad token (no oracle).
- **RLS posture:** every Forge table has RLS enabled; policies `TO authenticated` only; **no `anon` policy**; explicit `REVOKE ALL … FROM anon`. `forge_invites` has **no `authenticated` policy at all** (definer-RPC-only access).
- **Definer hardening (the 1a.1 lesson):** every Forge function is `SECURITY DEFINER` (helpers `STABLE`) with `SET search_path = ''`, and must `REVOKE EXECUTE … FROM public, anon` then `GRANT … TO authenticated`. Supabase default-grants EXECUTE to `anon` directly, so a `REVOKE FROM public` alone is insufficient — `REVOKE FROM anon` explicitly. (See `reference_supabase_revoke_anon_not_public`.)
- **Routing:** `/forge/**` routes set `export const dynamic = "force-dynamic"` and `revalidate = 0`. The redemption page `/invite/[token]` also sets `force-dynamic` (no static generation of token pages). 404 (not 403) for unauthorized Forge access.
- **Gate reuse:** server actions/pages reuse `requireForge`/`requireElder`/`requireForgeSuperadmin` from `app/forge/lib/auth.ts` (1a.1) — never re-implement auth.

---

## File Structure

- `supabase/migrations/049_forge_invites_members.sql` — **Create.** `forge_invites` + `forge_audit` tables, the role-cap helper, and the membership-management RPCs (mint/redeem/add/remove/change-role/profile/list-invites). One responsibility: the invite + membership-mutation data layer and its security.
- `app/forge/lib/token.ts` — **Create.** `hashToken(raw)` (sha256 hex) shared by mint + redeem. One responsibility: token hashing.
- `app/forge/lib/__tests__/token.test.ts` — **Create.** Unit test for `hashToken`.
- `app/forge/lib/members.ts` — **Create.** Server actions: `mintInvite`, `redeemInvite`, `addMember`, `removeMember`, `changeRole`, `setProfile`, `listMembers`, `listInvites`. One responsibility: the typed server-action surface over the RPCs (+ the invite email).
- `app/forge/lib/__tests__/members.test.ts` — **Create.** Unit tests for the server actions (mock the Supabase client + `sendEmail`).
- `app/invite/[token]/page.tsx` — **Create.** Top-level redemption route (NOT under the `/forge` gate). Requires a session, then renders the NDA acceptance form.
- `app/invite/[token]/AcceptForm.tsx` — **Create.** Client form: confidentiality notice + "type I agree" field → `redeemInvite` → onboarding, or a generic failure message.
- `app/forge/welcome/page.tsx` — **Create.** Gated onboarding host (member-only). Skips itself if `display_name` is already set.
- `app/forge/welcome/OnboardingForm.tsx` — **Create.** Client form: display name + avatar upload → `setProfile` → `/forge`.
- `app/forge/admin/page.tsx` — **Create.** Gated (`requireElder`) roles/invites console (server-fetches members + invites).
- `app/forge/admin/AdminConsole.tsx` — **Create.** Client UI: invite form, members table with capped row actions, pending-invites list.
- `__tests__/forge-anon-leak.test.ts` — **Modify.** Add `forge_invites`/`forge_audit` to `FORGE_TABLES`; add an "anon cannot execute any Forge definer RPC" block (closes spec leak-test step 3 and the 1a.1 gap).

---

## Task 1: Invites + audit + membership-management RPCs (migration 049)

**Files:**
- Create: `supabase/migrations/049_forge_invites_members.sql`
- Verify: Supabase MCP `apply_migration` / `execute_sql` / `get_advisors` (no new file)

**Interfaces:**
- Consumes (from 048): `public.playtest_members`, enum `public.playtest_role`, `public.my_forge_role()`, `public.is_forge_elder_or_super()`, the last-superadmin trigger.
- Produces (consumed by Tasks 2–6):
  - `public.forge_role_outranks(actor_role text, target_role text) returns boolean`
  - `public.forge_mint_invite(p_token_hash text, p_role public.playtest_role, p_set_ids uuid[], p_email text, p_expires_at timestamptz) returns uuid`
  - `public.forge_redeem_invite(p_token_hash text, p_nda_agreed boolean) returns text` (granted role, or NULL on any failure incl. NDA not agreed)
  - `public.forge_add_member(p_user_id uuid, p_role public.playtest_role) returns void`
  - `public.forge_remove_member(p_user_id uuid) returns void`
  - `public.forge_change_role(p_user_id uuid, p_new_role public.playtest_role) returns void`
  - `public.forge_set_profile(p_display_name text, p_avatar_url text) returns void`
  - `public.forge_list_invites() returns table(id uuid, role public.playtest_role, email text, set_ids uuid[], invited_by uuid, expires_at timestamptz, used_at timestamptz, created_at timestamptz)`
  - Tables `public.forge_invites`, `public.forge_audit`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/049_forge_invites_members.sql`:

```sql
-- Forge access layer, part 2: invites, audit, and the membership-management RPCs.
-- Builds on 048 (playtest_members, playtest_role, my_forge_role / is_forge_* helpers,
-- last-superadmin trigger). SCHEMA + FUNCTIONS ONLY — no card data.

-- 0) Record the NDA acknowledgment on the membership row (stamped at redeem).
alter table public.playtest_members add column if not exists nda_agreed_at timestamptz;

-- 1) Invites. Hash-only token. This table has NO authenticated RLS policy: it is a
--    secret store reachable only through the SECURITY DEFINER RPCs below (mirrors
--    api_keys / migration 030). anon is default-denied + explicit revoke.
create table if not exists public.forge_invites (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  role       public.playtest_role not null,
  set_ids    uuid[] not null default '{}',   -- stored for 1a.5; not consumed yet
  email      text,                            -- optional bind to a specific address
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.forge_invites enable row level security;
revoke all on public.forge_invites from anon;

-- 2) Minimal audit. Write-only via definer RPCs; elders+ may read.
create table if not exists public.forge_audit (
  id     bigserial primary key,
  actor  uuid not null references auth.users(id),
  action text not null,
  target text,
  at     timestamptz not null default now()
);
alter table public.forge_audit enable row level security;
drop policy if exists "forge_audit_select" on public.forge_audit;
create policy "forge_audit_select" on public.forge_audit
  for select to authenticated
  using (public.is_forge_elder_or_super());
revoke all on public.forge_audit from anon;
grant select on public.forge_audit to authenticated;

-- 3) Role-cap helper (pure logic, no table access).
create or replace function public.forge_role_outranks(actor_role text, target_role text)
returns boolean language sql immutable set search_path = '' as $$
  select case actor_role
    when 'superadmin' then target_role in ('elder','playtester')
    when 'elder'      then target_role = 'playtester'
    else false
  end;
$$;

-- 4) Mint an invite. Caller's role caps the grantable role. Stores hash only.
create or replace function public.forge_mint_invite(
  p_token_hash text, p_role public.playtest_role, p_set_ids uuid[],
  p_email text, p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.forge_role_outranks(public.my_forge_role(), p_role::text) then
    raise exception 'not authorized to mint a % invite', p_role;
  end if;
  insert into public.forge_invites (token_hash, role, set_ids, email, invited_by, expires_at)
  values (p_token_hash, p_role, coalesce(p_set_ids, '{}'), p_email, auth.uid(),
          coalesce(p_expires_at, now() + interval '7 days'))
  returning id into v_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'invite_minted', v_id::text);
  return v_id;
end; $$;

-- 5) Redeem an invite. Authenticated caller becomes a member after acknowledging
--    the NDA (p_nda_agreed). NO ORACLE: every failure path returns NULL
--    (no-agreement/bad/expired/used/email-mismatch are indistinguishable).
create or replace function public.forge_redeem_invite(p_token_hash text, p_nda_agreed boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_invite public.forge_invites;
begin
  if not coalesce(p_nda_agreed, false) then return null; end if;  -- must accept the NDA
  select * into v_invite from public.forge_invites
   where token_hash = p_token_hash and used_at is null and expires_at > now()
   for update;
  if not found then return null; end if;
  if v_invite.email is not null and v_invite.email is distinct from auth.email() then
    return null;  -- email-bound to someone else; same not-found result
  end if;
  insert into public.playtest_members (user_id, role, invited_by, nda_agreed_at)
  values (auth.uid(), v_invite.role, v_invite.invited_by, now())
  on conflict (user_id) do nothing;
  update public.forge_invites set used_at = now() where id = v_invite.id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'member_added', v_invite.id::text);
  return v_invite.role::text;
end; $$;

-- 6) Direct membership management (no invite). All role-capped against the caller.
--    add_member is INSERT-only (use change_role to modify an existing member —
--    otherwise an elder could downgrade an elder via add_member, bypassing the cap).
create or replace function public.forge_add_member(p_user_id uuid, p_role public.playtest_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.forge_role_outranks(public.my_forge_role(), p_role::text) then
    raise exception 'not authorized to add a % member', p_role;
  end if;
  if exists (select 1 from public.playtest_members where user_id = p_user_id) then
    raise exception 'already a member; use change_role';
  end if;
  insert into public.playtest_members (user_id, role, invited_by)
  values (p_user_id, p_role, auth.uid());
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'member_added', p_user_id::text);
end; $$;

create or replace function public.forge_remove_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target_role text;
begin
  select role::text into v_target_role from public.playtest_members where user_id = p_user_id;
  if v_target_role is null then raise exception 'not a member'; end if;
  if not public.forge_role_outranks(public.my_forge_role(), v_target_role) then
    raise exception 'not authorized to remove a % member', v_target_role;
  end if;
  -- FORWARD DEPENDENCY: card/set ownership reassignment lands when forge_cards/
  -- forge_sets exist (plans 1a.4/1a.5). Deleting the membership row already revokes
  -- all access via RLS — the security-critical effect. The last-superadmin trigger
  -- (048) backstops removal of the final superadmin.
  delete from public.playtest_members where user_id = p_user_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'member_removed', p_user_id::text);
end; $$;

create or replace function public.forge_change_role(p_user_id uuid, p_new_role public.playtest_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_caller text := public.my_forge_role(); v_current text;
begin
  select role::text into v_current from public.playtest_members where user_id = p_user_id;
  if v_current is null then raise exception 'not a member'; end if;
  if not public.forge_role_outranks(v_caller, v_current)
     or not public.forge_role_outranks(v_caller, p_new_role::text) then
    raise exception 'not authorized to change this member''s role';
  end if;
  -- last-superadmin demotion is backstopped by the 048 trigger.
  update public.playtest_members set role = p_new_role where user_id = p_user_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'role_changed', p_user_id::text || ' -> ' || p_new_role::text);
end; $$;

-- 7) Self-service profile (display_name + avatar only; never role).
create or replace function public.forge_set_profile(p_display_name text, p_avatar_url text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.playtest_members
     set display_name = p_display_name, avatar_url = p_avatar_url
   where user_id = auth.uid();
  if not found then raise exception 'not a member'; end if;
end; $$;

-- 8) Admin read: invites WITHOUT token_hash (elders+ only; empty for everyone else).
create or replace function public.forge_list_invites()
returns table(id uuid, role public.playtest_role, email text, set_ids uuid[],
              invited_by uuid, expires_at timestamptz, used_at timestamptz, created_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select id, role, email, set_ids, invited_by, expires_at, used_at, created_at
  from public.forge_invites
  where public.is_forge_elder_or_super()
  order by created_at desc;
$$;

-- 9) Lock down execute: strip anon (Supabase default-grants it directly), grant authenticated.
revoke execute on function public.forge_role_outranks(text, text) from public, anon;
revoke execute on function public.forge_mint_invite(text, public.playtest_role, uuid[], text, timestamptz) from public, anon;
revoke execute on function public.forge_redeem_invite(text, boolean) from public, anon;
revoke execute on function public.forge_add_member(uuid, public.playtest_role) from public, anon;
revoke execute on function public.forge_remove_member(uuid) from public, anon;
revoke execute on function public.forge_change_role(uuid, public.playtest_role) from public, anon;
revoke execute on function public.forge_set_profile(text, text) from public, anon;
revoke execute on function public.forge_list_invites() from public, anon;

grant execute on function public.forge_role_outranks(text, text) to authenticated;
grant execute on function public.forge_mint_invite(text, public.playtest_role, uuid[], text, timestamptz) to authenticated;
grant execute on function public.forge_redeem_invite(text, boolean) to authenticated;
grant execute on function public.forge_add_member(uuid, public.playtest_role) to authenticated;
grant execute on function public.forge_remove_member(uuid) to authenticated;
grant execute on function public.forge_change_role(uuid, public.playtest_role) to authenticated;
grant execute on function public.forge_set_profile(text, text) to authenticated;
grant execute on function public.forge_list_invites() to authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name: `forge_invites_members`, the SQL above).
Expected: `{"success": true}`. If it errors on a missing 048 object (e.g. `my_forge_role`), stop — 048 must be applied first (it is, per PR #119).

- [ ] **Step 3: Verify schema + anon has zero execute on the new functions**

Run via Supabase MCP `execute_sql`:
```sql
select
  to_regclass('public.forge_invites')                                         as invites_tbl,
  to_regclass('public.forge_audit')                                           as audit_tbl,
  has_function_privilege('anon','public.forge_mint_invite(text,public.playtest_role,uuid[],text,timestamptz)','execute') as anon_mint,
  has_function_privilege('anon','public.forge_redeem_invite(text,boolean)','execute')  as anon_redeem,
  has_function_privilege('anon','public.forge_change_role(uuid,public.playtest_role)','execute') as anon_change,
  has_function_privilege('authenticated','public.forge_redeem_invite(text,boolean)','execute') as auth_redeem;
```
Expected: both tables non-null; `anon_mint`, `anon_redeem`, `anon_change` = **false**; `auth_redeem` = **true**.

- [ ] **Step 4: Verify the role-cap (privilege-escalation guard) via JWT-claim impersonation**

Run via Supabase MCP `execute_sql` (sets `auth.uid()`/`my_forge_role()` for the elder seeded… there is none yet, so test the pure cap helper + a mint attempt against a simulated elder by inserting a throwaway elder, then cleaning up):
```sql
do $$
declare elder_uid uuid := '00000000-0000-0000-0000-0000000000e1';
begin
  -- pure cap logic
  assert public.forge_role_outranks('superadmin','elder');
  assert public.forge_role_outranks('elder','playtester');
  assert not public.forge_role_outranks('elder','elder');       -- elder cannot grant elder
  assert not public.forge_role_outranks('superadmin','superadmin'); -- nobody mints superadmin
  assert not public.forge_role_outranks('playtester','playtester');

  -- simulate an elder caller and assert mint of an elder invite is rejected
  insert into auth.users (id, email) values (elder_uid, 'elder-test@example.com')
    on conflict (id) do nothing;
  insert into public.playtest_members (user_id, role) values (elder_uid, 'elder')
    on conflict (user_id) do update set role = 'elder';
  perform set_config('request.jwt.claims', json_build_object('sub', elder_uid)::text, true);
  begin
    perform public.forge_mint_invite('hash-x','elder','{}'::uuid[], null, null);
    raise exception 'CAP FAILED: elder minted an elder invite';
  exception when others then
    if sqlerrm like 'CAP FAILED%' then raise; end if;
    raise notice 'cap ok: %', sqlerrm;
  end;
  -- elder CAN mint a playtester invite
  perform public.forge_mint_invite('hash-pt','playtester','{}'::uuid[], null, null);
  raise notice 'elder minted playtester invite ok';

  -- cleanup
  delete from public.forge_invites where token_hash in ('hash-x','hash-pt');
  delete from public.playtest_members where user_id = elder_uid;
  delete from public.forge_audit where actor = elder_uid;
  delete from auth.users where id = elder_uid;
end $$;
```
Expected: notices `cap ok: not authorized to mint a elder invite` and `elder minted playtester invite ok`; no `CAP FAILED`. (All test rows cleaned up.)

- [ ] **Step 5: Verify redeem has no oracle (expired/used/email-mismatch all → NULL)**

Run via Supabase MCP `execute_sql`:
```sql
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000d2';
begin
  insert into auth.users (id, email) values (u, 'redeemer@example.com') on conflict (id) do nothing;
  -- expired invite
  insert into public.forge_invites (token_hash, role, invited_by, expires_at)
  values ('expired-hash','playtester', u, now() - interval '1 day');
  -- email-bound to someone else
  insert into public.forge_invites (token_hash, role, invited_by, email)
  values ('bound-hash','playtester', u, 'someone-else@example.com');
  perform set_config('request.jwt.claims',
    json_build_object('sub', u, 'email', 'redeemer@example.com')::text, true);
  assert public.forge_redeem_invite('expired-hash', true) is null, 'expired should be null';
  assert public.forge_redeem_invite('bound-hash',   true) is null, 'email-mismatch should be null';
  assert public.forge_redeem_invite('nonexistent',  true) is null, 'unknown should be null';
  assert public.forge_redeem_invite('expired-hash', false) is null, 'no-NDA should be null';
  raise notice 'redeem no-oracle ok';
  -- cleanup
  delete from public.forge_invites where token_hash in ('expired-hash','bound-hash');
  delete from public.playtest_members where user_id = u;
  delete from public.forge_audit where actor = u;
  delete from auth.users where id = u;
end $$;
```
Expected: notice `redeem no-oracle ok`; no assertion failure.

- [ ] **Step 6: Run Supabase security advisors**

Run Supabase MCP `get_advisors` (type: `security`).
Expected: **no** `function_search_path_mutable` or `anon_security_definer_function_executable` finding referencing any new `forge_*` function, and no RLS-disabled finding on `forge_invites`/`forge_audit`. (Pre-existing findings on unrelated objects are out of scope.) Fix any new finding before continuing.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/049_forge_invites_members.sql
git commit -m "feat(forge): invites + audit + membership-management RPCs (049)"
```

---

## Task 2: Token hashing + the invite mint server action (with email)

**Files:**
- Create: `app/forge/lib/token.ts`
- Test: `app/forge/lib/__tests__/token.test.ts`
- Create: `app/forge/lib/members.ts` (this task adds `mintInvite`; later tasks extend the same file)
- Test: `app/forge/lib/__tests__/members.test.ts` (this task adds the `mintInvite` describe block)

**Interfaces:**
- Consumes: `requireElder`/`requireForgeSuperadmin` from `@/app/forge/lib/auth` (1a.1); RPC `forge_mint_invite` (Task 1); `sendEmail` + `wrapEmailInTemplate` from `@/utils/email`.
- Produces (consumed by Tasks 3, 5):
  - `hashToken(raw: string): string` (sha256 hex)
  - `mintInvite(input: { role: ForgeRole; email?: string | null; expiresInDays?: number }): Promise<{ ok: true; url: string } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing test for `hashToken`**

Create `app/forge/lib/__tests__/token.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { hashToken } from "../token";

describe("hashToken", () => {
  it("returns the sha256 hex of the input", () => {
    expect(hashToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
  });
  it("is deterministic and 64 hex chars", () => {
    const h = hashToken("some-token");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("some-token")).toBe(h);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/forge/lib/__tests__/token.test.ts`
Expected: FAIL — cannot resolve `../token`.

- [ ] **Step 3: Implement `hashToken`**

Create `app/forge/lib/token.ts`:
```ts
import { createHash } from "crypto";

/** sha256 hex of a raw invite token. Only the hash is ever stored. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/forge/lib/__tests__/token.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for `mintInvite`**

Create `app/forge/lib/__tests__/members.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({
  requireElder: vi.fn(),
  requireForgeSuperadmin: vi.fn(),
  requireForge: vi.fn(),
}));
vi.mock("@/utils/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  wrapEmailInTemplate: (s: string) => s,
}));

import { requireElder, requireForgeSuperadmin } from "@/app/forge/lib/auth";
import { sendEmail } from "@/utils/email";
import { mintInvite } from "../members";

function ctx(role: string, rpcImpl?: any) {
  return {
    role,
    user: { id: "caller", email: "c@x.com" },
    supabase: { rpc: vi.fn(rpcImpl ?? (async () => ({ data: "invite-id", error: null }))) },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("mintInvite", () => {
  it("rejects when caller is not an elder/superadmin", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await mintInvite({ role: "playtester" });
    expect(r.ok).toBe(false);
  });

  it("an elder cannot mint an elder invite (needs superadmin)", async () => {
    (requireElder as any).mockResolvedValue(ctx("elder"));
    (requireForgeSuperadmin as any).mockResolvedValue(null);
    const r = await mintInvite({ role: "elder" });
    expect(r.ok).toBe(false);
  });

  it("mints: hashes the token (raw never sent to RPC) and emails the URL", async () => {
    const c = ctx("superadmin");
    (requireElder as any).mockResolvedValue(c);
    (requireForgeSuperadmin as any).mockResolvedValue(c);
    const r = await mintInvite({ role: "elder", email: "new@x.com" });
    expect(r.ok).toBe(true);
    // RPC got a 64-hex hash, not a raw base64url token
    const passedHash = (c.supabase.rpc as any).mock.calls[0][1].p_token_hash;
    expect(passedHash).toMatch(/^[0-9a-f]{64}$/);
    // email sent, and the raw token in the URL is NOT the stored hash
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const html = (sendEmail as any).mock.calls[0][0].html as string;
    const url = (r as any).url as string;
    expect(html).toContain(url);
    expect(url).toContain("/invite/");
    expect(url).not.toContain(passedHash);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- app/forge/lib/__tests__/members.test.ts`
Expected: FAIL — cannot resolve `../members` / `mintInvite` not exported.

- [ ] **Step 7: Implement `mintInvite` in `app/forge/lib/members.ts`**

Create `app/forge/lib/members.ts`:
```ts
"use server";

import { randomBytes } from "crypto";
import { requireElder, requireForgeSuperadmin, type ForgeRole } from "@/app/forge/lib/auth";
import { hashToken } from "@/app/forge/lib/token";
import { sendEmail, wrapEmailInTemplate } from "@/utils/email";

function siteUrl(): string {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return base.replace(/\/$/, "");
}

export async function mintInvite(input: {
  role: ForgeRole;
  email?: string | null;
  expiresInDays?: number;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  // Elder gate first; an elder invite additionally needs superadmin.
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (input.role === "elder" && !(await requireForgeSuperadmin())) {
    return { ok: false, error: "Only a superadmin can invite an elder" };
  }
  if (input.role === "superadmin") return { ok: false, error: "Superadmin is not invitable" };

  const raw = randomBytes(32).toString("base64url");
  const days = input.expiresInDays && input.expiresInDays > 0 ? input.expiresInDays : 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await ctx.supabase.rpc("forge_mint_invite", {
    p_token_hash: hashToken(raw),
    p_role: input.role,
    p_set_ids: [],
    p_email: input.email ?? null,
    p_expires_at: expiresAt,
  });
  if (error) return { ok: false, error: "Could not mint invite" };

  const url = `${siteUrl()}/invite/${raw}`;
  const body = `
    <h1 style="font-size:22px;margin:0 0 12px 0;">You're invited to The Forge</h1>
    <p>You've been invited to join The Forge as a <strong>${input.role}</strong>.</p>
    <p style="margin:24px 0;"><a href="${url}"
       style="background:#10b981;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">Accept invite</a></p>
    <p style="color:#71717a;font-size:13px;">This link expires in ${days} day(s) and can be used once. If you didn't expect this, ignore it.</p>`;
  if (input.email) {
    await sendEmail({ to: input.email, subject: "Your Forge invite", html: wrapEmailInTemplate(body) });
  }
  return { ok: true, url };
}
```
(Note: when `email` is omitted the inviter shares the returned `url` manually; the email send is skipped.)

- [ ] **Step 8: Run both test files to verify they pass**

Run: `npm test -- app/forge/lib/__tests__/token.test.ts app/forge/lib/__tests__/members.test.ts`
Expected: PASS (2 + 3 tests).

- [ ] **Step 9: Commit**

```bash
git add app/forge/lib/token.ts app/forge/lib/__tests__/token.test.ts app/forge/lib/members.ts app/forge/lib/__tests__/members.test.ts
git commit -m "feat(forge): hashToken + mintInvite server action (hash-only token, Resend email)"
```

---

## Task 3: NDA-gated redemption flow — `redeemInvite` action + `/invite/[token]` acceptance form

**Files:**
- Modify: `app/forge/lib/members.ts` (add `redeemInvite`)
- Modify: `app/forge/lib/__tests__/members.test.ts` (add the `redeemInvite` describe block)
- Create: `app/invite/[token]/page.tsx`
- Create: `app/invite/[token]/AcceptForm.tsx`

**Interfaces:**
- Consumes: RPC `forge_redeem_invite` (Task 1); `hashToken` (Task 2); `createClient` from `@/utils/supabase/server`.
- Produces (consumed by the page + form):
  - `redeemInvite(rawToken: string, agreement: string): Promise<{ ok: true; role: ForgeRole } | { ok: false }>` — `agreement` must normalize to `"i agree"` (trimmed, lowercased) or redemption is refused.

- [ ] **Step 1: Write the failing test for `redeemInvite`**

Add to `app/forge/lib/__tests__/members.test.ts` (append; reuse the existing mocks). First extend the server mock to include `createClient`:
```ts
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "@/utils/supabase/server";
import { redeemInvite } from "../members";

describe("redeemInvite", () => {
  it("returns the role on success, hashes the token, and passes p_nda_agreed=true for 'I agree'", async () => {
    const rpc = vi.fn(async () => ({ data: "playtester", error: null }));
    (createClient as any).mockResolvedValue({ rpc });
    const r = await redeemInvite("raw-token-123", "  I Agree ");
    expect(r).toEqual({ ok: true, role: "playtester" });
    expect(rpc.mock.calls[0][1].p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rpc.mock.calls[0][1].p_token_hash).not.toBe("raw-token-123");
    expect(rpc.mock.calls[0][1].p_nda_agreed).toBe(true);
  });
  it("passes p_nda_agreed=false when the text is not 'I agree'", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    (createClient as any).mockResolvedValue({ rpc });
    const r = await redeemInvite("raw-token-123", "nope");
    expect(r).toEqual({ ok: false });
    expect(rpc.mock.calls[0][1].p_nda_agreed).toBe(false);
  });
  it("returns {ok:false} when the RPC yields null (no oracle)", async () => {
    (createClient as any).mockResolvedValue({ rpc: vi.fn(async () => ({ data: null, error: null })) });
    expect(await redeemInvite("bad", "I agree")).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/forge/lib/__tests__/members.test.ts`
Expected: FAIL — `redeemInvite` not exported.

- [ ] **Step 3: Implement `redeemInvite`**

Add to `app/forge/lib/members.ts`:
```ts
import { createClient } from "@/utils/supabase/server";

export async function redeemInvite(
  rawToken: string,
  agreement: string
): Promise<{ ok: true; role: ForgeRole } | { ok: false }> {
  const agreed = agreement.trim().toLowerCase() === "i agree";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("forge_redeem_invite", {
    p_token_hash: hashToken(rawToken),
    p_nda_agreed: agreed,
  });
  if (error || (data !== "superadmin" && data !== "elder" && data !== "playtester")) {
    return { ok: false };
  }
  return { ok: true, role: data as ForgeRole };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/forge/lib/__tests__/members.test.ts`
Expected: PASS (mint 3 + redeem 2).

- [ ] **Step 5: Write the redemption page (auth gate → render the acceptance form)**

Create `app/invite/[token]/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import AcceptForm from "./AcceptForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };

export default async function InviteRedemptionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Must be signed in to bind the invite to a real auth.users.id.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?redirectTo=${encodeURIComponent(`/invite/${token}`)}`);
  }

  // Redemption happens only after the NDA is accepted, inside the form.
  return <AcceptForm token={token} />;
}
```

- [ ] **Step 6: Write the NDA acceptance form (client)**

Create `app/invite/[token]/AcceptForm.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { redeemInvite } from "@/app/forge/lib/members";

export default function AcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const agreed = text.trim().toLowerCase() === "i agree";

  async function accept() {
    setBusy(true);
    setFailed(false);
    const r = await redeemInvite(token, text);
    setBusy(false);
    if (r.ok) router.push("/forge/welcome");
    else setFailed(true);
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Accept your Forge invite
      </h1>
      <div className="mt-4 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Before you enter — an unofficial NDA</p>
        <p className="mt-2">
          The Forge holds unreleased, confidential card designs. By accepting, you agree not to
          share, screenshot, post, or otherwise disclose any unreleased card content — names, art,
          abilities, anything — outside the Forge until it is officially published.
        </p>
      </div>
      <label className="mt-4 block text-sm font-medium">
        Type <span className="font-semibold">I agree</span> to continue
        <input
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="I agree"
          autoComplete="off"
        />
      </label>
      {failed && (
        <p className="mt-3 text-sm text-muted-foreground">
          This invite link is invalid, expired, or already used. Ask whoever invited you for a fresh link.
        </p>
      )}
      <button
        onClick={accept}
        disabled={!agreed || busy}
        className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Entering…" : "Accept & enter the Forge"}
      </button>
    </main>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `app/invite/**` or `app/forge/lib/members.ts`.

- [ ] **Step 8: Commit**

```bash
git add app/forge/lib/members.ts app/forge/lib/__tests__/members.test.ts "app/invite/[token]/page.tsx" "app/invite/[token]/AcceptForm.tsx"
git commit -m "feat(forge): NDA-gated /invite/[token] acceptance flow (type 'I agree', no-oracle)"
```

---

## Task 4: Onboarding — `setProfile` action + `/forge/welcome` (display name + avatar)

**Files:**
- Modify: `app/forge/lib/members.ts` (add `setProfile`)
- Modify: `app/forge/lib/__tests__/members.test.ts` (add the `setProfile` block)
- Create: `app/forge/welcome/page.tsx`
- Create: `app/forge/welcome/OnboardingForm.tsx`

**Interfaces:**
- Consumes: `requireForge` (1a.1); RPC `forge_set_profile` (Task 1); the public `avatars` storage bucket; `createClient` from `@/utils/supabase/client` (client upload).
- Produces:
  - `setProfile(input: { displayName: string; avatarUrl?: string | null }): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Write the failing test for `setProfile`**

Add to `app/forge/lib/__tests__/members.test.ts` (the `requireForge` mock already exists from Task 2):
```ts
import { requireForge } from "@/app/forge/lib/auth";
import { setProfile } from "../members";

describe("setProfile", () => {
  it("rejects a non-member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect((await setProfile({ displayName: "X" })).ok).toBe(false);
  });
  it("rejects an empty display name", async () => {
    (requireForge as any).mockResolvedValue({ supabase: { rpc: vi.fn() } });
    expect((await setProfile({ displayName: "   " })).ok).toBe(false);
  });
  it("calls forge_set_profile for a member", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    (requireForge as any).mockResolvedValue({ supabase: { rpc } });
    const r = await setProfile({ displayName: "Tim", avatarUrl: "https://x/y.png" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_set_profile", {
      p_display_name: "Tim",
      p_avatar_url: "https://x/y.png",
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/forge/lib/__tests__/members.test.ts`
Expected: FAIL — `setProfile` not exported.

- [ ] **Step 3: Implement `setProfile`**

Add to `app/forge/lib/members.ts` (import `requireForge` alongside the existing auth imports):
```ts
export async function setProfile(input: {
  displayName: string;
  avatarUrl?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const name = input.displayName.trim();
  if (!name) return { ok: false, error: "Display name is required" };
  if (name.length > 60) return { ok: false, error: "Display name too long" };
  const { error } = await ctx.supabase.rpc("forge_set_profile", {
    p_display_name: name,
    p_avatar_url: input.avatarUrl ?? null,
  });
  if (error) return { ok: false, error: "Could not save profile" };
  return { ok: true };
}
```
(Update the `import { requireElder, requireForgeSuperadmin, type ForgeRole }` line in `members.ts` to also import `requireForge`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/forge/lib/__tests__/members.test.ts`
Expected: PASS (mint 3 + redeem 2 + setProfile 3).

- [ ] **Step 5: Write the gated onboarding host page**

Create `app/forge/welcome/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import OnboardingForm from "./OnboardingForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeWelcomePage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  // Skip onboarding if the profile is already set.
  const { data } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .single();
  if (data?.display_name) redirect("/forge");
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Welcome to The Forge
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You're in as <span className="font-medium">{ctx.role}</span>. Set up your profile.
      </p>
      <OnboardingForm />
    </main>
  );
}
```

- [ ] **Step 6: Write the client onboarding form (display name + avatar upload)**

Create `app/forge/welcome/OnboardingForm.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { setProfile } from "@/app/forge/lib/members";

export default function OnboardingForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAvatar(file: File) {
    const supabase = createClient();
    const fileName = `forge-${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(fileName, file);
    if (upErr) return setError("Avatar upload failed");
    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(fileName);
    setAvatarUrl(publicUrl);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await setProfile({ displayName, avatarUrl });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Could not save");
    router.push("/forge");
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm font-medium">
        Display name
        <input
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          required
        />
      </label>
      <label className="block text-sm font-medium">
        Avatar (optional)
        <input
          type="file"
          accept="image/*"
          className="mt-1 block w-full text-sm"
          onChange={(e) => e.target.files?.[0] && handleAvatar(e.target.files[0])}
        />
      </label>
      {avatarUrl && <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={busy || !displayName.trim()}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Enter the Forge"}
      </button>
    </form>
  );
}
```
(Per the spec, Forge art uses plain `<img>`, never `next/image` — applied here for the avatar preview too.)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `app/forge/welcome/**` or `members.ts`.

- [ ] **Step 8: Commit**

```bash
git add app/forge/lib/members.ts app/forge/lib/__tests__/members.test.ts app/forge/welcome/page.tsx app/forge/welcome/OnboardingForm.tsx
git commit -m "feat(forge): onboarding — setProfile RPC action + /forge/welcome (name + avatar)"
```

---

## Task 5: `/forge/admin` — roles + invites console

**Files:**
- Modify: `app/forge/lib/members.ts` (add `addMember`, `removeMember`, `changeRole`, `listMembers`, `listInvites`)
- Modify: `app/forge/lib/__tests__/members.test.ts` (add blocks for the new actions)
- Create: `app/forge/admin/page.tsx`
- Create: `app/forge/admin/AdminConsole.tsx`

**Interfaces:**
- Consumes: `requireElder`, `requireForgeSuperadmin`, `requireForge` (1a.1); RPCs `forge_add_member`, `forge_remove_member`, `forge_change_role`, `forge_list_invites` (Task 1); `mintInvite` (Task 2); the `playtest_members` SELECT policy (1a.1).
- Produces (consumed by the console):
  - `changeRole(userId: string, newRole: ForgeRole): Promise<{ ok: boolean; error?: string }>`
  - `removeMember(userId: string): Promise<{ ok: boolean; error?: string }>`
  - `listMembers(): Promise<Array<{ user_id: string; role: ForgeRole; display_name: string | null; created_at: string }>>`
  - `listInvites(): Promise<Array<{ id: string; role: ForgeRole; email: string | null; expires_at: string; used_at: string | null }>>`
  - `addMember(userId: string, role: ForgeRole): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Write the failing tests for the management actions**

Add to `app/forge/lib/__tests__/members.test.ts`:
```ts
import { changeRole, removeMember, addMember } from "../members";

describe("changeRole / removeMember / addMember", () => {
  it("changeRole rejects non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await changeRole("u", "playtester")).ok).toBe(false);
  });
  it("changeRole calls forge_change_role for an elder", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    (requireElder as any).mockResolvedValue({ supabase: { rpc } });
    const r = await changeRole("u9", "playtester");
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_change_role", { p_user_id: "u9", p_new_role: "playtester" });
  });
  it("removeMember surfaces an RPC error", async () => {
    const rpc = vi.fn(async () => ({ error: { message: "not authorized to remove a elder member" } }));
    (requireElder as any).mockResolvedValue({ supabase: { rpc } });
    const r = await removeMember("u9");
    expect(r.ok).toBe(false);
  });
  it("addMember calls forge_add_member", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    (requireElder as any).mockResolvedValue({ supabase: { rpc } });
    const r = await addMember("u2", "playtester");
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_add_member", { p_user_id: "u2", p_role: "playtester" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/forge/lib/__tests__/members.test.ts`
Expected: FAIL — the new actions aren't exported.

- [ ] **Step 3: Implement the management + list actions**

Add to `app/forge/lib/members.ts` (add `revalidatePath` import from `next/cache`):
```ts
import { revalidatePath } from "next/cache";

export async function addMember(
  userId: string,
  role: ForgeRole
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_add_member", { p_user_id: userId, p_role: role });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/forge/admin");
  return { ok: true };
}

export async function removeMember(userId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_remove_member", { p_user_id: userId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/forge/admin");
  return { ok: true };
}

export async function changeRole(
  userId: string,
  newRole: ForgeRole
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_change_role", {
    p_user_id: userId,
    p_new_role: newRole,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/forge/admin");
  return { ok: true };
}

export async function listMembers() {
  const ctx = await requireElder();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("playtest_members")
    .select("user_id, role, display_name, created_at")
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function listInvites() {
  const ctx = await requireElder();
  if (!ctx) return [];
  const { data } = await ctx.supabase.rpc("forge_list_invites");
  return data ?? [];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/forge/lib/__tests__/members.test.ts`
Expected: PASS (all prior + 4 new).

- [ ] **Step 5: Write the gated admin page (server)**

Create `app/forge/admin/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { requireElder } from "@/app/forge/lib/auth";
import { listMembers, listInvites } from "@/app/forge/lib/members";
import AdminConsole from "./AdminConsole";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeAdminPage() {
  const ctx = await requireElder();
  if (!ctx) notFound();
  const [members, invites] = await Promise.all([listMembers(), listInvites()]);
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Forge Members
      </h1>
      <AdminConsole callerRole={ctx.role} members={members} invites={invites} />
    </main>
  );
}
```

- [ ] **Step 6: Write the admin console (client)**

Create `app/forge/admin/AdminConsole.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ForgeRole } from "@/app/forge/lib/auth";
import { mintInvite, changeRole, removeMember } from "@/app/forge/lib/members";

type Member = { user_id: string; role: ForgeRole; display_name: string | null; created_at: string };
type Invite = { id: string; role: ForgeRole; email: string | null; expires_at: string; used_at: string | null };

// Roles this caller may grant/manage (mirrors forge_role_outranks server-side).
function grantable(caller: ForgeRole): ForgeRole[] {
  if (caller === "superadmin") return ["elder", "playtester"];
  if (caller === "elder") return ["playtester"];
  return [];
}

export default function AdminConsole({
  callerRole,
  members,
  invites,
}: {
  callerRole: ForgeRole;
  members: Member[];
  invites: Invite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<ForgeRole>(grantable(callerRole)[0] ?? "playtester");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const canManage = new Set(grantable(callerRole));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? okMsg : r.error ?? "Failed");
      if (r.ok) router.refresh();
    });
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setInviteUrl(null);
    const r = await mintInvite({ role: inviteRole, email: inviteEmail || null });
    if (!r.ok) return setMsg(r.error);
    setInviteUrl(r.url);
    setMsg(inviteEmail ? "Invite emailed." : "Invite link created.");
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-8">
      <section>
        <h2 className="text-lg font-medium">Invite a member</h2>
        <form onSubmit={submitInvite} className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Role
            <select
              className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as ForgeRole)}
            >
              {grantable(callerRole).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Email (optional)
            <input
              type="email"
              className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <button className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" disabled={pending}>
            Mint invite
          </button>
        </form>
        {inviteUrl && (
          <p className="mt-2 break-all text-xs text-muted-foreground">
            Link: <code>{inviteUrl}</code>
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Members ({members.length})</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">Name</th><th>Role</th><th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const editable = canManage.has(m.role);
              return (
                <tr key={m.user_id} className="border-t">
                  <td className="py-2">{m.display_name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td>
                    {editable ? (
                      <select
                        className="rounded border bg-background px-1.5 py-1 text-xs"
                        defaultValue={m.role}
                        onChange={(e) => run(() => changeRole(m.user_id, e.target.value as ForgeRole), "Role updated")}
                        disabled={pending}
                      >
                        {grantable(callerRole).map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      m.role
                    )}
                  </td>
                  <td className="text-right">
                    {editable && (
                      <button
                        className="text-xs text-red-500 hover:underline"
                        onClick={() => run(() => removeMember(m.user_id), "Member removed")}
                        disabled={pending}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-medium">Pending invites</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {invites.filter((i) => !i.used_at).map((i) => (
            <li key={i.id} className="text-muted-foreground">
              {i.role} · {i.email ?? "link-only"} · expires {new Date(i.expires_at).toLocaleDateString()}
            </li>
          ))}
          {invites.filter((i) => !i.used_at).length === 0 && (
            <li className="text-muted-foreground">None.</li>
          )}
        </ul>
      </section>

      {msg && <p aria-live="polite" className="text-sm">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `app/forge/admin/**` or `members.ts`.

- [ ] **Step 8: Commit**

```bash
git add app/forge/lib/members.ts app/forge/lib/__tests__/members.test.ts app/forge/admin/page.tsx app/forge/admin/AdminConsole.tsx
git commit -m "feat(forge): /forge/admin roles + invites console (capped row actions)"
```

---

## Task 6: Extend the keystone anon-leak guardrail (tables + RPC grants)

**Files:**
- Modify: `__tests__/forge-anon-leak.test.ts`

**Interfaces:**
- Consumes: anon Supabase client; the new `forge_invites`/`forge_audit` tables (Task 1); all Forge `SECURITY DEFINER` RPCs (1a.1 + Task 1).
- Produces: `npm run test:security` now also fails if anon can read the new tables OR execute any Forge definer RPC (spec leak-test step 3; also closes the 1a.1 `forge_role_of` gap).

- [ ] **Step 1: Add the new tables to `FORGE_TABLES`**

In `__tests__/forge-anon-leak.test.ts`, change:
```ts
const FORGE_TABLES = ["playtest_members"];
```
to:
```ts
const FORGE_TABLES = ["playtest_members", "forge_invites", "forge_audit"];
```

- [ ] **Step 2: Add the "anon cannot execute any Forge definer RPC" block**

Append inside the `describe.runIf(ENABLED)(...)` body (after the table loop), using the same `anon` client:
```ts
  // Spec leak-test step 3: no Forge SECURITY DEFINER function is callable by anon.
  // (Calling with empty/placeholder args is fine — anon lacks EXECUTE, so PostgREST
  // rejects before the body runs. A success here means a grant leaked.)
  const FORGE_RPCS: Array<[string, Record<string, unknown>]> = [
    ["my_forge_role", {}],
    ["forge_role_of", { uid: "00000000-0000-0000-0000-000000000000" }],
    ["is_forge_member", {}],
    ["is_forge_elder_or_super", {}],
    ["forge_role_outranks", { actor_role: "elder", target_role: "playtester" }],
    ["forge_mint_invite", { p_token_hash: "x", p_role: "playtester", p_set_ids: [], p_email: null, p_expires_at: null }],
    ["forge_redeem_invite", { p_token_hash: "x", p_nda_agreed: false }],
    ["forge_add_member", { p_user_id: "00000000-0000-0000-0000-000000000000", p_role: "playtester" }],
    ["forge_remove_member", { p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_change_role", { p_user_id: "00000000-0000-0000-0000-000000000000", p_new_role: "playtester" }],
    ["forge_set_profile", { p_display_name: "x", p_avatar_url: null }],
    ["forge_list_invites", {}],
  ];

  for (const [fn, args] of FORGE_RPCS) {
    it(`anon cannot execute ${fn}`, async () => {
      const { error } = await anon.rpc(fn, args);
      expect(error, `anon was able to execute ${fn} — a definer grant leaked`).not.toBeNull();
    });
  }
```

- [ ] **Step 3: Confirm the default unit run still skips it (hermetic)**

Run: `npm test -- forge-anon-leak`
Expected: suite **skipped** (no `FORGE_LEAK_TEST=1`).

- [ ] **Step 4: Run the security test against the real DB**

Run: `npm run test:security`
Expected: **PASS** — anon sees zero rows in `playtest_members`/`forge_invites`/`forge_audit`, and every `anon cannot execute <fn>` test passes. If any RPC test fails, that function still has an anon grant — add `revoke execute on function … from anon;` to migration 049 and re-apply before continuing.

- [ ] **Step 5: Commit**

```bash
git add __tests__/forge-anon-leak.test.ts
git commit -m "test(forge): extend anon-leak guardrail to invites/audit tables + definer-RPC grants"
```

---

## Self-Review

**Spec coverage (Invites, onboarding & member management slice):**
- Hash-only invite token (`randomBytes(32)` base64url, sha256 stored, raw never in DB) → Task 1 (`forge_invites`, no token in body) + Task 2 (`hashToken`, mint). ✅
- Mint role-capped by inviter's role; stored role authoritative → Task 1 (`forge_mint_invite` + `forge_role_outranks`); Task 2 (elder-needs-superadmin for elder invites). ✅
- Single-use + expiry + optional email-bind; redeem in one transaction; no oracle → Task 1 (`forge_redeem_invite`, `FOR UPDATE`, NULL on every failure) + Task 3 (generic failure message). ✅
- **NDA gate on acceptance (type "I agree"):** UX (disabled button) + server action re-validation + DB-boundary refusal (`p_nda_agreed`) + `nda_agreed_at` record → Task 1 (column + RPC) + Task 3 (AcceptForm + `redeemInvite`). Applies to every invite (elders + playtesters). ✅
- Invites reachable only via definer RPCs (no authenticated table policy) → Task 1 (no policy on `forge_invites`) + Task 5 (`forge_list_invites` for the admin read). ✅
- `add_member`/`remove_member`/`change_role` role-capped server-side; removal keeps work (forward-deferred) → Task 1 (RPCs; removal documented forward dependency) + Task 5 (actions/UI). ✅
- Redemption requires auth; binds to `auth.users.id`; bad tokens 404-ish → Task 3 (`/invite/[token]` redirects to sign-in, generic failure). ✅
- Onboarding (elder/superadmin): welcome + display name + optional avatar, land on desk → Task 4 (`/forge/welcome`, `forge_set_profile`, avatar via `avatars` bucket). ✅
- `/forge/admin`: invites + roles → Task 5 (gated `requireElder`, capped UI). ✅
- Keystone broadened: new tables + "no definer fn granted to anon" → Task 6. ✅
- **Deferred to later plans (forced, not gaps):** card/set ownership reassignment in `remove_member` + sole-elder reassignment (1a.4/1a.5); invite `set_ids`→set-grant wiring (1a.5); onboarding "jot idea / open set" + checklist (1a.4/1a.5); Realtime channel leak-test rows + route-404 + art-proxy leak checks (1a.3+). Each listed in the "Forced deferrals" note and in-code comments.

**Placeholder scan:** none — every step has runnable SQL/TS/commands. The two in-code "FORWARD DEPENDENCY" comments mark intentional, dependency-blocked deferrals, not unfinished steps.

**Type consistency:** `ForgeRole` (from 1a.1 `app/forge/lib/auth.ts`) is reused everywhere. RPC names match between Task 1 (defined) and Tasks 2–6 (called): `forge_mint_invite`, `forge_redeem_invite`, `forge_add_member`, `forge_remove_member`, `forge_change_role`, `forge_set_profile`, `forge_list_invites`, `forge_role_outranks`. RPC param names (`p_token_hash`, `p_nda_agreed`, `p_role`, `p_set_ids`, `p_email`, `p_expires_at`, `p_user_id`, `p_new_role`, `p_display_name`, `p_avatar_url`) match between the SQL signatures and the `.rpc(...)` call sites. The `grantable()` cap in `AdminConsole.tsx` mirrors `forge_role_outranks` server-side (UI convenience only; the RPC is authoritative).

---

## Remaining Phase 1a plans (roadmap — written after this one)

3. **1a.3 — Private art pipeline:** private Vercel Blob (`access:'private'`) + UUID keys; authed `/forge/api/art/[cardId]` proxy + `?download=1`; lint forbidding `<Image>` under `app/forge/**`; broadens the leak test with the route-404 + art-proxy checks.
4. **1a.4 — Card studio + ideas library:** `forge_cards` (+ `working_snapshot`), DesignCard schema, quick-draft/full studio with live preview + placeholder art, `/forge/ideas`. Wires `forge_remove_member` card-ownership reassignment and the onboarding "jot an idea" path.
5. **1a.5 — Sets, lifecycle, dashboard, print:** `forge_sets`/`forge_set_elders`/`forge_set_grants`, set notes + 2-D targets, share-move/publish/approve/archive/delete/send-back lifecycle + `card_versions`, Brigade×Type dashboard, "download all for printer." Wires invite `set_ids`→grants, sole-elder reassignment, and the onboarding "open a set" path.

Then Phase 1b (collaborative review) and Phase 2 (playtester play) as separate plan sets.
