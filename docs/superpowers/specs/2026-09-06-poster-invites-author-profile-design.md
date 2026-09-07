# Poster invites & author profile

**Date:** 2026-09-06
**Status:** Approved design, pre-implementation
**Context:** The articles feature (`docs/superpowers/specs/2026-09-05-articles-design.md`,
PR #356) already scopes editing correctly — a poster can only create/edit
their own posts, the superuser can edit any post. Verified end-to-end
(RLS, server actions, page gating, client `EditLink`) before writing this
spec; there is no bug there. What's missing is (1) an easy, scalable way for
the superuser to grant `publish_posts` to new people, with one dedicated
place to manage it, and (2) a self-service author identity (avatar + short
bio) that renders on the articles a poster writes.

## 1. Purpose & scope

Two additions to the articles feature, both built by copying patterns
already proven elsewhere in this codebase:

- **Poster invites**, modeled directly on the Forge's invite system
  (`forge_invites` / `forge_mint_invite` / `forge_redeem_invite`, migration
  049). The superuser mints a link (optionally bound to an email, which also
  triggers an automatic email via Resend); the recipient signs in and
  redeems it, which grants them `publish_posts` without touching any other
  permission they might already hold.
- **A dedicated "Posters" space** on the existing superuser portal
  (`/admin/permissions`) — invite box, pending invites, current posters with
  one-click revoke. This is the answer to "make sure the super admin has a
  space to do all of this": one section, not a checkbox buried in the big
  admin-permissions grid.
- **Author avatar + bio**, stored on `public.profiles` (global columns, not
  posts-specific), self-edited from a small panel on `/admin/posts`, using
  the same Supabase Storage `avatars` bucket the tournament-registration
  photo upload and the Forge onboarding flow already write to. Rendered as
  an "About the author" block on the full article page only (not the
  `/articles` index cards — out of scope, see §7).

Locked decisions (owner-approved 2026-09-06):

- Invites are per-poster (grant `publish_posts` only); minting is
  superuser-only.
- An invite may be bound to a specific email (checked on redemption) or left
  open (anyone with the link who's signed in can redeem it) — mirrors Forge.
- Redeeming an invite **merges** `publish_posts` into the caller's existing
  `admin_users.permissions`; it never overwrites permissions they already
  hold from something else (e.g. `manage_tags`).
- Revoking a poster removes only `publish_posts`, not their other
  permissions, and does not touch their published posts (content stays
  live, per the original spec's §4).
- Author bio is capped at 500 characters (same cap as `posts.excerpt`).
  Avatar is a plain image URL, validated app-side (https), no DB constraint
  — consistent with how `profiles` has no format constraints today.
- The bio/avatar panel lives on `/admin/posts` (already gated to
  posters+superuser); no new route.

## 2. Current state (what this builds on)

- **Ownership gating already correct** — `posts_update_owner_or_super` /
  `posts_delete_owner_or_super` (migration 095) require `author_id =
  auth.uid()` AND `publish_posts`, or `is_superuser()`. Server actions
  (`app/admin/posts/actions.ts`) call `canEditPost()` on top of RLS.
  `listMyPostsAction` filters to `author_id = ctx.user.id` unless
  `isSuperuser`. `EditLink.tsx` gates client-side the same way. Nothing here
  changes.
- **`is_superuser()`** (migration 062): `auth.uid() = '<hardcoded uuid>'`,
  one person, Tim. That's the superadmin for posts already.
- **The Forge invite system is the template to copy**, not just an
  inspiration:
  - `forge_invites` table: `token_hash` (sha256 of a `randomBytes(32)`
    base64url token — only the hash is ever stored), `email` (nullable
    bind), `invited_by`, `expires_at` (default +7 days), `used_at`.
  - `forge_mint_invite(token_hash, ...)` — SECURITY DEFINER, caller-role
    checked in SQL.
  - `forge_redeem_invite(token_hash, ...)` — SECURITY DEFINER, "no oracle":
    every failure path (bad/expired/used/email-mismatch) returns the same
    null, so a fishing attempt can't distinguish reasons.
  - `app/forge/lib/token.ts`: `hashToken(raw)` — `sha256(raw)` hex, reusable
    verbatim.
  - `app/forge/lib/members.ts::mintInvite` — mints, builds
    `${siteUrl()}/invite/${raw}`, and calls `sendEmail()` +
    `wrapEmailInTemplate()` when an email was given. `siteUrl()` is a small
    local helper (`VERCEL_PROJECT_PRODUCTION_URL` → `NEXT_PUBLIC_SITE_URL` →
    localhost) — copy it rather than share it across features.
  - `app/invite/[token]/page.tsx` + `AcceptForm.tsx` — server page redirects
    to `/sign-in?redirectTo=...` if logged out (an invite must bind to a
    real `auth.uid()`), then a client form calls the redeem server action
    and routes on success.
- **`admin_users`** (migrations 005, 062): `user_id` PK, `permissions
  text[] not null default '{}'`, `created_by`. All writes go through
  SECURITY DEFINER RPCs (`super_set_admin_permissions`, `super_remove_admin`
  wipes the whole row) — never a direct table write, per migration 093's
  fix. `super_set_admin_permissions` **replaces** the whole array, so the
  existing `/admin/permissions` "Save" button already does read-modify-write
  in the client (`PermissionsPortal.tsx`) — the new Posters revoke button
  reuses that exact same action, computed with `publish_posts` removed.
- **`avatars` Supabase Storage bucket** already exists and is already
  general-purpose: tournament registration photos
  (`app/register/page.tsx`), and Forge onboarding avatars
  (`app/forge/welcome/OnboardingForm.tsx`) both upload straight from the
  browser with `supabase.storage.from("avatars").upload(fileName, file)`
  then `getPublicUrl()`, naming files `${prefix}-${Date.now()}-${file.name}`
  ("forge-...", in the Forge case). No new bucket, no new RLS, no upload
  route — copy this client-side pattern with prefix `"poster-"`.
- **`profiles`** (migration 007): `id`, `username`, publicly readable,
  self-updatable (`auth.uid() = id`, no separate `WITH CHECK` — Postgres
  falls back to the `USING` clause, so this already permits self-updating
  arbitrary columns including a new `avatar_url`/`bio`). No new RLS needed.
- **Articles query layer** (`app/articles/lib/queries.ts`): `COLUMNS`
  currently embeds `author:profiles(username)`; `PublicPost.author` is
  `{ username: string | null } | null`. `ARTICLES_TAG` +
  `revalidateTag`/`revalidatePath` is how writes bust the public cache.
  `postByline()` prefers the WordPress-import `author_name` override, then
  `author?.username` — imported posts may have no real poster behind them.

## 3. Data model

### 3.1 Migration `097_poster_invites.sql`

```sql
create table public.poster_invites (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email      text,                          -- optional bind to a specific address
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.poster_invites enable row level security;
revoke all on public.poster_invites from anon, authenticated;
```

No authenticated RLS policy — same posture as `forge_invites`: a secret
store reachable only through the SECURITY DEFINER RPCs below.

```sql
create or replace function public.mint_poster_invite(p_token_hash text, p_email text, p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  insert into public.poster_invites (token_hash, email, invited_by, expires_at)
  values (p_token_hash, p_email, auth.uid(), coalesce(p_expires_at, now() + interval '7 days'))
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.redeem_poster_invite(p_token_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_invite public.poster_invites;
begin
  select * into v_invite from public.poster_invites
   where token_hash = p_token_hash and used_at is null and expires_at > now()
   for update;
  if not found then return false; end if;
  if v_invite.email is not null and v_invite.email is distinct from auth.email() then
    return false;  -- email-bound to someone else; same false as any other failure
  end if;
  insert into public.admin_users (user_id, permissions, created_by)
  values (auth.uid(), array['publish_posts'], v_invite.invited_by)
  on conflict (user_id) do update
    set permissions = case
      when 'publish_posts' = any(admin_users.permissions) then admin_users.permissions
      else admin_users.permissions || 'publish_posts'
    end;
  update public.poster_invites set used_at = now() where id = v_invite.id;
  return true;
end; $$;
```

**Correction:** the `||` operator here is ambiguous in Postgres and throws 22P02 on every successful redemption — use `array_append(admin_users.permissions, 'publish_posts')` instead. Fixed in migration 099 after this was caught by Task 6's live-DB tests.

```sql
-- Admin read: invites WITHOUT token_hash, superuser only.
create or replace function public.list_poster_invites()
returns table(id uuid, email text, invited_by uuid, expires_at timestamptz, used_at timestamptz, created_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select id, email, invited_by, expires_at, used_at, created_at
  from public.poster_invites
  where public.is_superuser()
  order by created_at desc;
$$;

revoke execute on function public.mint_poster_invite(text, text, timestamptz) from public, anon;
revoke execute on function public.redeem_poster_invite(text) from public, anon;
revoke execute on function public.list_poster_invites() from public, anon;
grant execute on function public.mint_poster_invite(text, text, timestamptz) to authenticated;
grant execute on function public.redeem_poster_invite(text) to authenticated;
grant execute on function public.list_poster_invites() to authenticated;
```

`on conflict (user_id) do update` is the merge behavior: an existing admin
(say, someone with `manage_tags`) who redeems a poster invite keeps
`manage_tags` and gains `publish_posts`; redeeming twice is a no-op, not a
duplicate.

### 3.2 Migration `098_author_profile.sql`

```sql
alter table public.profiles
  add column avatar_url text,
  add column bio text check (bio is null or char_length(bio) <= 500);
```

No RLS change — the existing `auth.uid() = id` self-update policy already
covers these columns.

## 4. Server actions & RPC wiring

### 4.1 `app/admin/posts/lib/invites.ts` (new, `"use server"`)

Poster-invite logic lives next to the rest of the posts feature (not inside
`app/admin/permissions/`), the same way Forge invite logic lives in
`app/forge/lib/members.ts` rather than in the permissions portal:

- `mintPosterInvite(email?: string, expiresInDays = 7)` — gates on
  `requireSuperuser()` (imported from
  `@/app/admin/permissions/lib/auth`), generates the raw token
  (`randomBytes(32).toString("base64url")`), calls
  `mint_poster_invite` with its `hashToken()` hash, builds
  `${siteUrl()}/invite/poster/${raw}`, and — when `email` is given — sends
  it via `sendEmail()` + `wrapEmailInTemplate()` (copy `siteUrl()` locally,
  same as `members.ts` does; don't import it cross-feature). Returns
  `{ ok: true, url }` or `{ ok: false, error }`.
- `listPosterInvites()` — gates on `requireSuperuser()`, calls
  `list_poster_invites`, returns the rows (or `[]` if not authorized —
  matches `listAdmins()`'s posture of failing closed rather than throwing).
- `redeemPosterInvite(token: string)` — no superuser gate (the caller is the
  invitee); requires a signed-in Supabase session (the calling page already
  redirects to sign-in otherwise). Calls `redeem_poster_invite` with the
  hash; returns `{ ok: boolean }`.

### 4.2 `/admin/permissions` — the "Posters" section

`app/admin/permissions/page.tsx` additionally calls `listPosterInvites()`
and passes it into `PermissionsPortal` as `initialPosterInvites`.
`PermissionsPortal.tsx` gets a new section, placed between "App admins" and
"Forge members" (it's people-management, same family as both):

- **Current posters**: filtered client-side from the existing `admins` prop
  (`a.permissions.includes("publish_posts")`) — no new query. Each row: name/
  email, a "Revoke" button that calls the *existing* `setAdminPermissions`
  action with that admin's permissions minus `publish_posts` (same action
  the big matrix's Save button uses; no new RPC for revoke).
- **Invite by email**: a text input + "Create invite" button calling
  `mintPosterInvite(email || undefined)`. On success, show the returned link
  in a copyable field (`readOnly` input + a "Copy" button) regardless of
  whether an email was given — the email send is a bonus, not the only path,
  so a bad/typo'd address never blocks getting Tim a link he can paste into
  Discord/text himself.
- **Pending invites**: `initialPosterInvites` rendered as a small list
  (email or "open link", expires, used/unused) — same shape as
  `forge_list_invites`'s consumer, no need to look at `/forge/admin` for
  this since it's simple enough to inline here.

This satisfies "make sure the super admin has a space to do all of this":
one section of one page — invite, watch pending invites, see current
posters, revoke — no trip through the big permissions grid for this
workflow at all (that grid still exists, for the other admin permissions).

### 4.3 `/invite/poster/[token]` (new route)

- `app/invite/poster/[token]/page.tsx` — copy of `app/invite/[token]/page.tsx`
  structure: redirect to `/sign-in?redirectTo=/invite/poster/<token>` if
  logged out; otherwise render `AcceptPosterForm`. No NDA text (that's
  Forge-specific); header can be plain ("You're invited to post").
- `app/invite/poster/[token]/AcceptPosterForm.tsx` — a client component,
  single "Accept & start posting" button (no typed confirmation — there's no
  NDA to agree to), calls `redeemPosterInvite(token)`, routes to
  `/admin/posts` on success, shows "This invite link is invalid, expired, or
  already used." on failure (same no-oracle message Forge uses, and true
  here too since `redeem_poster_invite` never distinguishes reasons).

### 4.4 Author profile — `app/admin/posts/lib/authorProfile.ts` (new, `"use server"`)

- `updateAuthorProfileAction(bio: string | null, avatarUrl: string | null)`
  — gates on `requirePoster()` (existing, from
  `app/admin/posts/lib/auth.ts`). Validates: `bio` trimmed, ≤ 500 chars;
  `avatarUrl` either `null` or matches `/^https:\/\//` (same check
  `validatePatch` already uses for `cover_image_url`). Updates
  `profiles` (`avatar_url`, `bio`) for `ctx.user.id`. Then revalidates: the
  caller's published post slugs (query `posts` for
  `author_id = ctx.user.id and status = 'published'`, `revalidatePath` each)
  plus `/articles`. Returns `ActionResult` (same `{ success, error? }` shape
  as the rest of `app/admin/posts/actions.ts` — branch on `=== false`, not
  truthiness, per the repo's `strict: false` gotcha).

### 4.5 `/admin/posts` — author profile panel

`app/admin/posts/page.tsx` additionally fetches the caller's own
`profiles` row (`username, avatar_url, bio`) and passes it to a new
`AuthorProfileCard` (`app/admin/posts/components/AuthorProfileCard.tsx`,
`"use client"`), rendered above the Drafts/Published sections:

- Avatar: current image (or a neutral placeholder) + "Change" file input.
  Upload is direct client → Storage, exactly like
  `OnboardingForm.handleAvatar` — `supabase.storage.from("avatars").upload(
  \`poster-${Date.now()}-${file.name}\`, file)` then `getPublicUrl()`. No
  upload route, no size/type gate beyond what the browser's file picker
  already implies (images only) — this mirrors the Forge onboarding flow
  exactly, which has none either.
- Bio: a `<textarea>`, live character count against the 500 cap.
  - Save button calls `updateAuthorProfileAction`; disabled while an upload
  is in flight; errors surface inline (not silently), consistent with the
  editor's own error handling.

### 4.6 Rendering — `/articles/[slug]`

- `app/articles/lib/queries.ts`: `COLUMNS` embeds
  `author:profiles(username, avatar_url, bio)`; `PublicPost.author` gains
  `avatar_url: string | null` and `bio: string | null`.
- New `app/articles/components/AuthorBio.tsx` (server component, pure
  props): renders an avatar + username + bio in a raised-surface card
  (no 1px border, matching the design system) below the article body.
  Renders **nothing** when both `avatar_url` and `bio` are null/empty —
  imported WordPress posts and posters who never filled this in get no
  empty box. `app/articles/[slug]/page.tsx` renders
  `<AuthorBio author={post.author} />` after `<ArticleBody>`.
- Index cards (`PostCard.tsx`) are untouched — explicitly out of scope
  (§7).

## 5. Nav & wiring checklist

- No new nav entries — `/admin/permissions` and `/admin/posts` already
  exist and are linked from the Admin dropdown.
- `app/invite/poster/[token]/` is a new, unlisted route (like
  `app/invite/[token]/`) — reached only via a minted link.
- No new env vars — `RESEND_API_KEY`/`FROM_EMAIL` and `BLOB_READ_WRITE_TOKEN`
  are unused here; this uses the existing `avatars` Storage bucket, which
  needs no token.

## 6. Testing

- **Unit (vitest):** `hashToken` reuse needs no new test (already covered
  by Forge's). New: a small test for the `bio` length validation in
  `authorProfile.ts` (trim, 500-char boundary) and for `AuthorBio`
  rendering nothing when both fields are empty.
- **RLS/RPC leak test (vitest, live DB, opt-in like
  `__tests__/posts-anon-leak.test.ts`):** redeeming an email-bound invite
  with a different authenticated email fails (returns `false`); redeeming
  twice is idempotent (second call returns `false`, permissions unchanged);
  redeeming merges into an existing admin row without dropping its other
  permissions; `list_poster_invites()` and `mint_poster_invite()` both
  return nothing/raise for a non-superuser caller.
- **E2E (Playwright):** mint an invite as the superuser test account
  (service-role-seeded), sign in as a second test user, visit
  `/invite/poster/<token>`, accept, assert `/admin/posts` is now reachable
  and `publish_posts` shows in `get_my_admin_permissions()`; revoke from the
  Posters panel, assert `/admin/posts` 404s again.
- **Type gate:** `npx tsc --noEmit`.

## 7. Out of scope (explicit)

- Showing avatar/bio on the `/articles` index cards or in the RSS feed —
  full article page only, per §1.
- Multiple invite roles/tiers for posters (Forge's elder/playtester
  distinction has no analog here — `publish_posts` is the only key this
  grants).
- Un-inviting/expiring an invite early (an unused invite just sits until
  `expires_at`; superuser can always revoke the *permission* once granted,
  which is the security-relevant action).
- Editing another poster's bio/avatar as the superuser (they can already
  edit any *post*; profile self-service stays self-only, matching how
  `profiles` self-update has always worked).
- Rate-limiting invite minting — superuser-only action, same trust level as
  every other `super_*` RPC.

## 8. Hazards for implementers

- **Worktree only.** This spec was written in `../rtt-poster-invites` on
  `feat/poster-invites-author-profile`; continue there, absolute paths, never
  touch the main checkout.
- **Migration order.** 097 and 098 both assume 096 is the latest live
  migration (it is, as of this spec). If another PR lands a 097 first,
  renumber both to stay after it.
- **`super_set_admin_permissions` replaces the whole array** — the Posters
  panel's revoke button must compute "current permissions minus
  `publish_posts`" client-side (as `PermissionsPortal.tsx` already does for
  every checkbox toggle) rather than assuming a partial update exists.
- **No inline `admin_users` subqueries** (093) — `redeem_poster_invite`
  writes to `admin_users` directly because it's SECURITY DEFINER, which is
  the sanctioned path; nothing here adds a new RLS policy that reads
  `admin_users`.
- **`redeem_poster_invite` must stay a no-oracle boolean** — do not let a
  future edit leak *why* redemption failed (bad token vs. wrong email vs.
  expired) the way `forge_redeem_invite` deliberately doesn't either.
- **`strict: false`**: branch on `=== false`, not truthiness, on every
  `ActionResult`/`{ ok }` union here too.
- **Server client never in `"use client"` files** — `AuthorProfileCard.tsx`
  and `AcceptPosterForm.tsx` use `utils/supabase/client.ts` for the direct
  Storage upload and for reading the session; the actions they call live in
  `"use server"` files.
- **Revalidate on profile save** — a bio/avatar change is invisible on
  already-rendered article pages until either `revalidatePath` runs (per
  §4.4) or the hourly ISR window passes; don't skip the explicit
  revalidation loop to save a query.
