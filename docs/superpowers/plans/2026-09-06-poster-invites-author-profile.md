# Poster invites & author profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the superuser invite anyone to become a poster (scalable, one dedicated screen), and let posters upload an avatar + short bio that renders on the articles they write.

**Architecture:** Two additions, both copied from patterns already proven in this codebase. (1) A `poster_invites` table + 3 SECURITY DEFINER RPCs, modeled byte-for-byte on the Forge's `forge_invites`/`forge_mint_invite`/`forge_redeem_invite` (migration 049) — mint (superuser-only), redeem (any signed-in user, merges `publish_posts` into their existing `admin_users.permissions`), list (superuser-only). A new "Posters" section on the existing `/admin/permissions` portal is the superuser's one screen for all of it: invite, pending invites, current posters, revoke. (2) Two new nullable columns on `public.profiles` (`avatar_url`, `bio`), self-edited from a small panel on `/admin/posts`, uploaded to the same `avatars` Supabase Storage bucket the Forge onboarding flow and tournament registration already use — no new RLS, no new bucket, no new upload route.

**Tech Stack:** Next.js 15 App Router server actions, Supabase Postgres (RLS + SECURITY DEFINER RPCs), Supabase Storage, Resend (`utils/email.ts`), vitest (mocked unit tests + opt-in live-DB RLS tests).

**Spec:** `docs/superpowers/specs/2026-09-06-poster-invites-author-profile-design.md`

## Global Constraints

- **Worktree only.** Everything below happens in `/Users/timestes/projects/rtt-poster-invites` on branch `feat/poster-invites-author-profile`. Use absolute paths. Never touch the main checkout.
- **Migration numbers 097 and 098** are next after 096 (`096_posts_import_columns.sql`, already live). If another PR claims 097 first, renumber both files before applying.
- **Migrations 097 and 098 must be applied to the live Supabase project by the orchestrating session (via the Supabase MCP `apply_migration` tool), with the user's explicit confirmation, before Task 3 or later begins.** This is a schema change to the single production database this app uses — it is not a subagent task. See Task 2.5.
- **No inline `admin_users` subqueries in RLS policies** (migration 093's fix) — the one place this plan writes to `admin_users` is inside a SECURITY DEFINER function (`redeem_poster_invite`), which is the sanctioned path.
- **`redeem_poster_invite` returns a plain boolean and must stay a no-oracle result** — bad token, wrong email, expired, and already-used must all return `false` with no way to tell them apart from the caller's side, exactly like `forge_redeem_invite`.
- **`strict: false`**: every `ActionResult`/`{ ok }` union in this plan is branched with `=== false`, never truthiness.
- **Server client never in `"use client"` files.** `AuthorProfileCard.tsx` and `AcceptPosterForm.tsx` use `utils/supabase/client.ts` (and, for `AcceptPosterForm.tsx`, a directly-imported server action); the RPC/DB logic they call lives in `"use server"` files.
- **No hand-added `focus:ring-*` classes on bespoke form controls** — match `PermissionsPortal.tsx`'s existing plain `<input>`/`<button>` styling (no ring classes) and `PostEditor.tsx`'s existing bespoke `<textarea>` styling (`outline-none`, no ring) for every new raw control in this plan. The shadcn `Button`/`Input` components keep their own built-in focus styles unchanged — this rule is about not adding new ring classes, not stripping existing ones.
- **Bio cap is 500 characters**, same as `posts.excerpt`. Avatar URL is validated app-side as `^https:\/\//`, no DB constraint (matches how `profiles` has no format constraints today).
- **`npx tsc --noEmit`** after every task that touches `.ts`/`.tsx` files; never run `next build` while `npm run dev` is running (shared `.next`, see the dev-server memory).

---

### Task 1: Migration — `poster_invites` table + RPCs

**Files:**
- Create: `supabase/migrations/097_poster_invites.sql`

**Interfaces:**
- Produces: `public.poster_invites` table; RPCs `mint_poster_invite(p_token_hash text, p_email text, p_expires_at timestamptz) returns uuid`, `redeem_poster_invite(p_token_hash text) returns boolean`, `list_poster_invites() returns table(id uuid, email text, invited_by uuid, expires_at timestamptz, used_at timestamptz, created_at timestamptz)`. All three are `grant execute ... to authenticated` only (anon revoked).

- [ ] **Step 1: Write the migration file**

```sql
-- 097_poster_invites.sql
-- Scalable poster invites, modeled on forge_invites (049). Spec:
-- docs/superpowers/specs/2026-09-06-poster-invites-author-profile-design.md

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

-- Mint: superuser-only. Stores a hash of the raw token; the raw token is
-- never persisted (mirrors forge_mint_invite).
create or replace function public.mint_poster_invite(p_token_hash text, p_email text, p_expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  insert into public.poster_invites (token_hash, email, invited_by, expires_at)
  values (p_token_hash, p_email, auth.uid(), coalesce(p_expires_at, now() + interval '7 days'))
  returning id into v_id;
  return v_id;
end;
$$;

-- Redeem: any authenticated caller. No oracle — every failure path (bad
-- token, wrong bound email, expired, already used) returns false, mirroring
-- forge_redeem_invite's "every failure path returns the same thing" rule.
-- Merges 'publish_posts' into the caller's existing admin_users row (or
-- creates one) rather than overwriting other permissions they may hold.
create or replace function public.redeem_poster_invite(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
end;
$$;
```

**Correction:** the `||` operator here is ambiguous in Postgres and throws 22P02 on every successful redemption — use `array_append(admin_users.permissions, 'publish_posts')` instead. Fixed in migration 099 after this was caught by Task 6's live-DB tests.

```sql
-- Admin read: invites WITHOUT token_hash, superuser only (empty for everyone else).
create or replace function public.list_poster_invites()
returns table(id uuid, email text, invited_by uuid, expires_at timestamptz, used_at timestamptz, created_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
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

- [ ] **Step 2: Review the SQL by hand**

Check: every function is `security definer` + `set search_path = ''` + fully
schema-qualified (`public.poster_invites`, `public.admin_users`,
`auth.uid()`, `auth.email()`); `poster_invites` has no policy and anon+
authenticated are revoked outright (secret store, reachable only through the
RPCs — same posture as `forge_invites`); the three `grant execute` lines
target `authenticated` only. Do **not** apply this migration yet — that's
Task 2.5, after Task 2 is also written.

- [ ] **Step 3: Commit**

```bash
cd /Users/timestes/projects/rtt-poster-invites
git add supabase/migrations/097_poster_invites.sql
git commit -m "feat(db): poster_invites table + mint/redeem/list RPCs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — author avatar + bio on `profiles`

**Files:**
- Create: `supabase/migrations/098_author_profile.sql`

**Interfaces:**
- Produces: `public.profiles.avatar_url text` (nullable), `public.profiles.bio text` (nullable, `char_length(bio) <= 500`). No RLS change — the existing `auth.uid() = id` self-update policy (migration 007) already covers new columns.

- [ ] **Step 1: Write the migration file**

```sql
-- 098_author_profile.sql
-- Self-service author avatar + bio, rendered on articles. Spec:
-- docs/superpowers/specs/2026-09-06-poster-invites-author-profile-design.md

alter table public.profiles
  add column avatar_url text,
  add column bio text check (bio is null or char_length(bio) <= 500);
```

- [ ] **Step 2: Commit**

```bash
cd /Users/timestes/projects/rtt-poster-invites
git add supabase/migrations/098_author_profile.sql
git commit -m "feat(db): avatar_url + bio columns on profiles

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2.5: Apply migrations 097 + 098 to the live Supabase project — ORCHESTRATOR ONLY

**Do not dispatch this as a subagent task.** This writes schema to the one
production Supabase project the app uses. The orchestrating session:

1. Confirms with the user before running anything.
2. Applies `097_poster_invites.sql` then `098_author_profile.sql`, in order,
   via the Supabase MCP `apply_migration` tool (or `mcp__supabase__apply_migration`
   / `mcp__claude_ai_Supabase__apply_migration`, whichever this session has).
3. Spot-checks with `list_tables`/a quick `select` that `poster_invites`
   exists and `profiles` has the two new columns.

Every later task assumes this has happened — RPC calls and `profiles`
column reads/writes will fail against a database that doesn't have them yet.

---

### Task 3: `app/admin/posts/lib/invites.ts` — mint/list/redeem

**Files:**
- Create: `app/admin/posts/lib/invites.ts`
- Test: `app/admin/posts/lib/__tests__/invites.test.ts`

**Interfaces:**
- Consumes: `requireSuperuser(): Promise<{ supabase, user: { id, email } } | null>` from `@/app/admin/permissions/lib/auth`; `hashToken(raw: string): string` from `@/app/forge/lib/token`; `sendEmail`, `wrapEmailInTemplate` from `@/utils/email`; `createClient()` from `@/utils/supabase/server`.
- Produces: `mintPosterInvite(email?: string | null, expiresInDays?: number): Promise<{ ok: true; url: string } | { ok: false; error: string }>`, `listPosterInvites(): Promise<PosterInviteRow[]>`, `redeemPosterInvite(token: string): Promise<{ ok: boolean }>`, `type PosterInviteRow = { id: string; email: string | null; invited_by: string; expires_at: string; used_at: string | null; created_at: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// app/admin/posts/lib/__tests__/invites.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/admin/permissions/lib/auth", () => ({ requireSuperuser: vi.fn() }));
vi.mock("@/utils/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  wrapEmailInTemplate: (s: string) => s,
}));
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));

import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { sendEmail } from "@/utils/email";
import { createClient } from "@/utils/supabase/server";
import { mintPosterInvite, listPosterInvites, redeemPosterInvite } from "../invites";

function ctx(rpcImpl?: (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>) {
  return {
    user: { id: "caller", email: "c@x.com" },
    supabase: { rpc: vi.fn(rpcImpl ?? (async () => ({ data: null, error: null }))) },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("mintPosterInvite", () => {
  it("rejects when the caller is not the superuser", async () => {
    (requireSuperuser as any).mockResolvedValue(null);
    const r = await mintPosterInvite("x@y.com");
    expect(r.ok).toBe(false);
  });

  it("mints: hashes the token (raw never sent to RPC) and emails the URL", async () => {
    const c = ctx();
    (requireSuperuser as any).mockResolvedValue(c);
    const r = await mintPosterInvite("new@x.com");
    expect(r.ok).toBe(true);
    const passedHash = (c.supabase.rpc as any).mock.calls[0][1].p_token_hash;
    expect(passedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const html = (sendEmail as any).mock.calls[0][0].html as string;
    const url = (r as { url: string }).url;
    expect(html).toContain(url);
    expect(url).toContain("/invite/poster/");
    expect(url).not.toContain(passedHash);
  });

  it("does not email when no address is given, but still returns a copyable link", async () => {
    const c = ctx();
    (requireSuperuser as any).mockResolvedValue(c);
    const r = await mintPosterInvite(null);
    expect(r.ok).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((r as { url: string }).url).toContain("/invite/poster/");
  });
});

describe("listPosterInvites", () => {
  it("returns [] when the caller is not the superuser", async () => {
    (requireSuperuser as any).mockResolvedValue(null);
    expect(await listPosterInvites()).toEqual([]);
  });

  it("returns the RPC rows for the superuser", async () => {
    const rows = [{ id: "1", email: null, invited_by: "u", expires_at: "t", used_at: null, created_at: "t" }];
    (requireSuperuser as any).mockResolvedValue(ctx(async () => ({ data: rows, error: null })));
    expect(await listPosterInvites()).toEqual(rows);
  });
});

describe("redeemPosterInvite", () => {
  it("hashes the token and returns ok:true on success", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    (createClient as any).mockResolvedValue({ rpc });
    const r = await redeemPosterInvite("raw-token-123");
    expect(r).toEqual({ ok: true });
    expect((rpc as any).mock.calls[0][1].p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((rpc as any).mock.calls[0][1].p_token_hash).not.toBe("raw-token-123");
  });

  it("returns ok:false when the RPC yields false (no oracle)", async () => {
    (createClient as any).mockResolvedValue({ rpc: vi.fn(async () => ({ data: false, error: null })) });
    expect(await redeemPosterInvite("bad")).toEqual({ ok: false });
  });

  it("returns ok:false on an RPC error", async () => {
    (createClient as any).mockResolvedValue({ rpc: vi.fn(async () => ({ data: null, error: { message: "x" } })) });
    expect(await redeemPosterInvite("bad")).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/admin/posts/lib/__tests__/invites.test.ts`
Expected: FAIL — `../invites` has no exports yet.

- [ ] **Step 3: Write the implementation**

```ts
// app/admin/posts/lib/invites.ts
"use server";

import { randomBytes } from "crypto";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { hashToken } from "@/app/forge/lib/token";
import { sendEmail, wrapEmailInTemplate } from "@/utils/email";
import { createClient } from "@/utils/supabase/server";

export type PosterInviteRow = {
  id: string;
  email: string | null;
  invited_by: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

// Local copy, not a cross-feature import — app/forge/lib/members.ts has its
// own identical helper for the same reason.
function siteUrl(): string {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return base.replace(/\/$/, "");
}

export async function mintPosterInvite(
  email?: string | null,
  expiresInDays = 7
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await requireSuperuser();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const raw = randomBytes(32).toString("base64url");
  const days = expiresInDays > 0 ? expiresInDays : 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const cleanEmail = email && email.trim() ? email.trim() : null;

  const { error } = await ctx.supabase.rpc("mint_poster_invite", {
    p_token_hash: hashToken(raw),
    p_email: cleanEmail,
    p_expires_at: expiresAt,
  });
  if (error) return { ok: false, error: "Could not mint invite" };

  const url = `${siteUrl()}/invite/poster/${raw}`;
  if (cleanEmail) {
    const body = `
      <h1 style="font-size:22px;margin:0 0 12px 0;">You're invited to post on RedemptionCCG App</h1>
      <p>You've been invited to write articles at <a href="${siteUrl()}/articles">/articles</a>.</p>
      <p style="margin:24px 0;"><a href="${url}"
         style="background:#10b981;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">Accept invite</a></p>
      <p style="color:#71717a;font-size:13px;">This link expires in ${days} day(s) and can be used once. If you didn't expect this, ignore it.</p>`;
    await sendEmail({ to: cleanEmail, subject: "You're invited to post", html: wrapEmailInTemplate(body) });
  }
  return { ok: true, url };
}

export async function listPosterInvites(): Promise<PosterInviteRow[]> {
  const ctx = await requireSuperuser();
  if (!ctx) return [];
  const { data } = await ctx.supabase.rpc("list_poster_invites");
  return (data as PosterInviteRow[] | null) ?? [];
}

export async function redeemPosterInvite(token: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_poster_invite", { p_token_hash: hashToken(token) });
  if (error) return { ok: false };
  return { ok: data === true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/admin/posts/lib/__tests__/invites.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Type-check and commit**

```bash
cd /Users/timestes/projects/rtt-poster-invites
npx tsc --noEmit
git add app/admin/posts/lib/invites.ts app/admin/posts/lib/__tests__/invites.test.ts
git commit -m "feat(posts): mint/list/redeem poster invite server actions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `/invite/poster/[token]` route

**Files:**
- Create: `app/invite/poster/[token]/page.tsx`
- Create: `app/invite/poster/[token]/AcceptPosterForm.tsx`

**Interfaces:**
- Consumes: `redeemPosterInvite(token: string): Promise<{ ok: boolean }>` (Task 3).

- [ ] **Step 1: Write the page (redirects to sign-in if logged out)**

```tsx
// app/invite/poster/[token]/page.tsx
import { redirect } from "next/navigation";
import { Newspaper } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import AcceptPosterForm from "./AcceptPosterForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };

export default async function InvitePosterPage({
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
    redirect(`/sign-in?redirectTo=${encodeURIComponent(`/invite/poster/${token}`)}`);
  }

  return (
    <div>
      <header className="flex items-center justify-center gap-2 border-b py-4">
        <Newspaper className="h-5 w-5" aria-hidden="true" />
        <span className="text-lg" style={{ fontFamily: "Cinzel, serif" }}>
          RedemptionCCG App
        </span>
      </header>
      <AcceptPosterForm token={token} />
    </div>
  );
}
```

- [ ] **Step 2: Write the accept form**

```tsx
// app/invite/poster/[token]/AcceptPosterForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { redeemPosterInvite } from "@/app/admin/posts/lib/invites";

export default function AcceptPosterForm({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function accept() {
    setBusy(true);
    setFailed(false);
    const r = await redeemPosterInvite(token);
    setBusy(false);
    if (r.ok) router.push("/admin/posts");
    else setFailed(true);
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        You&apos;re invited to post
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Accepting lets you write and publish your own articles at /articles. You can only edit
        your own posts.
      </p>
      {failed && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          This invite link is invalid, expired, or already used. Ask whoever invited you for a fresh link.
        </p>
      )}
      <Button onClick={accept} disabled={busy} className="mt-4 w-full">
        {busy ? "Accepting…" : "Accept & start posting"}
      </Button>
    </main>
  );
}
```

- [ ] **Step 3: Type-check and commit**

```bash
cd /Users/timestes/projects/rtt-poster-invites
npx tsc --noEmit
git add app/invite/poster/
git commit -m "feat(posts): /invite/poster/[token] redemption page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: "Posters" section on `/admin/permissions`

**Files:**
- Modify: `app/admin/permissions/page.tsx`
- Modify: `app/admin/permissions/PermissionsPortal.tsx`

**Interfaces:**
- Consumes: `listPosterInvites()`, `mintPosterInvite()` (Task 3); existing `admins` state, `setAdminPermissions` action, `busyId`/`error`/`setEdits` state already in `PermissionsPortal.tsx`.

- [ ] **Step 1: Wire the server loader in `page.tsx`**

```tsx
// app/admin/permissions/page.tsx
import { notFound } from "next/navigation";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { listMembers } from "@/app/forge/lib/members";
import { listPosterInvites } from "@/app/admin/posts/lib/invites";
import { listAdmins } from "./actions";
import PermissionsPortal, { type ForgeMemberRow } from "./PermissionsPortal";
import TopNav from "@/components/top-nav";

export const metadata = { title: "Permissions" };
export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  const ctx = await requireSuperuser();
  if (!ctx) notFound();

  const [admins, forgeMembers, posterInvites] = await Promise.all([
    listAdmins(),
    listMembers(),
    listPosterInvites(),
  ]);

  return (
    <>
      <TopNav />
      <PermissionsPortal
        initialAdmins={admins}
        forgeMembers={forgeMembers as ForgeMemberRow[]}
        initialPosterInvites={posterInvites}
        selfId={ctx.user.id}
      />
    </>
  );
}
```

- [ ] **Step 2: Add the `initialPosterInvites` prop, invite state, and `revokePoster` to `PermissionsPortal.tsx`**

Add the import (with the other imports at the top):

```tsx
import { mintPosterInvite, type PosterInviteRow } from "@/app/admin/posts/lib/invites";
```

Change the props type and destructuring:

```tsx
export default function PermissionsPortal({
  initialAdmins,
  forgeMembers,
  initialPosterInvites,
  selfId,
}: {
  initialAdmins: AdminRow[];
  forgeMembers: ForgeMemberRow[];
  initialPosterInvites: PosterInviteRow[];
  selfId: string;
}) {
```

Add new state right after the existing `admins`/`edits`/`busyId`/`error` state declarations:

```tsx
  const [posterEmail, setPosterEmail] = useState("");
  const [posterBusy, setPosterBusy] = useState(false);
  const [posterLink, setPosterLink] = useState<string | null>(null);
```

Add two new handlers, near `remove`/`addAdmin`:

```tsx
  const revokePoster = async (row: AdminRow) => {
    if (!window.confirm(`Remove posting access for ${row.username ?? row.email ?? row.user_id}?`)) return;
    setBusyId(row.user_id);
    setError(null);
    const next = row.permissions.filter((k) => k !== "publish_posts");
    const r = await setAdminPermissions(row.user_id, next);
    if (r.ok === false) {
      setError(r.error ?? "Revoke failed");
    } else {
      setAdmins((rows) => rows.map((a) => (a.user_id === row.user_id ? { ...a, permissions: next } : a)));
      setEdits((e) => {
        const { [row.user_id]: _, ...rest } = e;
        return rest;
      });
    }
    setBusyId(null);
  };

  const createPosterInvite = async () => {
    setPosterBusy(true);
    setError(null);
    setPosterLink(null);
    const r = await mintPosterInvite(posterEmail.trim() || null);
    if (r.ok === false) {
      setError(r.error ?? "Could not create invite");
    } else {
      setPosterLink(r.url);
      setPosterEmail("");
      router.refresh(); // re-fetches listPosterInvites() via the server page
    }
    setPosterBusy(false);
  };
```

- [ ] **Step 3: Insert the "Posters" section into the JSX**

Insert this whole `<section>` between the closing `</section>` of "App admins"
and the opening comment `{/* Forge members ... */}`:

```tsx
      {/* Posters --------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Posters</h2>
        <p className="text-sm text-muted-foreground">
          Grants publish_posts — a poster can write and publish their own articles at /articles,
          and edit only their own.
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Poster</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {admins
                .filter((a) => a.permissions.includes("publish_posts"))
                .map((row) => (
                  <tr key={row.user_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.username ?? "(no username)"}</div>
                      <div className="text-xs text-muted-foreground">{row.email}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => revokePoster(row)}
                        disabled={busyId === row.user_id}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-red-600 hover:border-red-300"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              {admins.filter((a) => a.permissions.includes("publish_posts")).length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">
                    No posters yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="max-w-md space-y-2">
          <label className="text-sm font-medium" htmlFor="poster-email">
            Invite a poster
          </label>
          <div className="flex gap-2">
            <input
              id="poster-email"
              value={posterEmail}
              onChange={(e) => setPosterEmail(e.target.value)}
              placeholder="Email (optional — leave blank for an open link)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={createPosterInvite}
              disabled={posterBusy}
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              {posterBusy ? "Creating…" : "Create invite"}
            </button>
          </div>
          {posterLink && (
            <div className="flex gap-2">
              <input
                readOnly
                value={posterLink}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
              <button
                onClick={() => navigator.clipboard.writeText(posterLink)}
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Invite</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {initialPosterInvites.map((inv) => (
                <tr key={inv.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{inv.email ?? "(open link)"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(inv.expires_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    {inv.used_at ? (
                      <span className="text-xs text-muted-foreground">used</span>
                    ) : new Date(inv.expires_at) < new Date() ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">expired</span>
                    ) : (
                      <span className="text-xs font-medium text-foreground">pending</span>
                    )}
                  </td>
                </tr>
              ))}
              {initialPosterInvites.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    No invites yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (`router` is already in scope from the existing `useRouter()` call at the top of the component.)

- [ ] **Step 5: Manual check and commit**

Run `npm run dev`, sign in as the superuser, visit `/admin/permissions`,
confirm the "Posters" section renders between "App admins" and "Forge
members", "Create invite" (blank email) returns a copyable `/invite/poster/…`
link, and typing an email and creating an invite does not error (email
delivery itself needs `RESEND_API_KEY` — if unset, `sendEmail` logs a warning
and returns `{ success: false }`, which `mintPosterInvite` doesn't check, by
design: a missing mail configuration must never block getting a copyable
link).

```bash
cd /Users/timestes/projects/rtt-poster-invites
npx tsc --noEmit
git add app/admin/permissions/page.tsx app/admin/permissions/PermissionsPortal.tsx
git commit -m "feat(admin): Posters section on the permissions portal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Live-DB RLS/RPC tests for poster invites

**Files:**
- Create: `__tests__/poster-invites-leak.test.ts`
- Modify: `__tests__/superuser-anon-leak.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `deleteTestUser(admin, id)` from `../e2e/deleteUser` (same helper `posts-anon-leak.test.ts` uses).

- [ ] **Step 1: Write the new live-DB test file**

```ts
// __tests__/poster-invites-leak.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { deleteTestUser } from "../e2e/deleteUser";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = process.env.FORGE_LEAK_TEST === "1" && !!URL && !!ANON && !!SERVICE;

type TestUser = { id: string; email: string; client: SupabaseClient };
const PASSWORD = "Testpass12345";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const createdUserIds: string[] = [];

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function makeUser(admin: SupabaseClient, permissions: string[]): Promise<TestUser> {
  const email = `poster-invite-${stamp}-${Math.random().toString(36).slice(2, 5)}@e2e.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  createdUserIds.push(data.user.id);
  if (permissions.length > 0) {
    const { error: permErr } = await admin.from("admin_users").insert({ user_id: data.user.id, permissions });
    if (permErr) throw new Error(`admin_users insert failed: ${permErr.message}`);
  }
  const client = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw new Error(`sign-in failed: ${signInErr.message}`);
  return { id: data.user.id, email, client };
}

// Seeded directly with the service-role client (bypassing mint_poster_invite's
// is_superuser() gate), same as posts-anon-leak.test.ts seeds posts directly.
async function seedInvite(
  admin: SupabaseClient,
  invitedBy: string,
  opts: { email?: string | null; expiresAt?: string } = {}
): Promise<string> {
  const raw = `raw-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await admin.from("poster_invites").insert({
    token_hash: hashToken(raw),
    email: opts.email ?? null,
    invited_by: invitedBy,
    expires_at: opts.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
  });
  if (error) throw new Error(`seed invite failed: ${error.message}`);
  return raw;
}

describe.runIf(ENABLED)("poster invites RLS/RPC guardrail", () => {
  let admin: SupabaseClient;
  let poster: TestUser;
  let other: TestUser;
  let existingAdmin: TestUser;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    [poster, other, existingAdmin] = await Promise.all([
      makeUser(admin, []),
      makeUser(admin, []),
      makeUser(admin, ["manage_tags"]),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdUserIds) {
      await admin.from("admin_users").delete().eq("user_id", id);
      const gone = await deleteTestUser(admin, id);
      expect(gone, `test user ${id} leaked`).toBe(true);
    }
  }, 60_000);

  it("a non-superuser cannot mint an invite", async () => {
    const { data, error } = await poster.client.rpc("mint_poster_invite", {
      p_token_hash: hashToken("nope"),
      p_email: null,
      p_expires_at: null,
    });
    expect(data ?? null).toBeNull();
    expect(error).not.toBeNull();
  });

  it("a non-superuser sees no invites", async () => {
    const { data } = await poster.client.rpc("list_poster_invites");
    expect(data ?? []).toHaveLength(0);
  });

  it("redeeming with an email-bound invite as the wrong person fails and grants nothing", async () => {
    const raw = await seedInvite(admin, poster.id, { email: `nobody-${stamp}@e2e.test` });
    const { data } = await other.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(false);
    const { data: row } = await admin.from("admin_users").select("permissions").eq("user_id", other.id).maybeSingle();
    expect(row).toBeNull();
  });

  it("the bound email can redeem, and gains publish_posts", async () => {
    const raw = await seedInvite(admin, poster.id, { email: poster.email });
    const { data } = await poster.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(true);
    const { data: row } = await admin.from("admin_users").select("permissions").eq("user_id", poster.id).single();
    expect(row?.permissions).toEqual(["publish_posts"]);
  });

  it("an already-used invite cannot be redeemed again", async () => {
    const raw = await seedInvite(admin, poster.id, { email: null });
    const first = await poster.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(first.data).toBe(true);
    const second = await other.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(second.data).toBe(false);
  });

  it("an open (no email) invite can be redeemed by anyone signed in", async () => {
    const raw = await seedInvite(admin, poster.id, { email: null });
    const { data } = await other.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(true);
    const { data: row } = await admin.from("admin_users").select("permissions").eq("user_id", other.id).single();
    expect(row?.permissions).toEqual(["publish_posts"]);
  });

  it("redeeming merges publish_posts without dropping an existing permission", async () => {
    const raw = await seedInvite(admin, poster.id, { email: null });
    const { data } = await existingAdmin.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(true);
    const { data: row } = await admin
      .from("admin_users")
      .select("permissions")
      .eq("user_id", existingAdmin.id)
      .single();
    expect(row?.permissions).toEqual(["manage_tags", "publish_posts"]);
  });

  it("an expired invite cannot be redeemed", async () => {
    const raw = await seedInvite(admin, poster.id, {
      email: null,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { data } = await other.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(false);
  });
});
```

- [ ] **Step 2: Add the three new RPCs to the anon-cannot-execute list**

In `__tests__/superuser-anon-leak.test.ts`, find the `SUPER_RPCS` array and
add these three entries after the `super_remove_admin` line:

```ts
    ["mint_poster_invite", { p_token_hash: "x", p_email: null, p_expires_at: null }],
    ["list_poster_invites", {}],
    ["redeem_poster_invite", { p_token_hash: "x" }],
```

- [ ] **Step 3: Add the new file to `test:security`**

In `package.json`, change:

```json
    "test:security": "FORGE_LEAK_TEST=1 vitest run forge-anon-leak superuser-anon-leak posts-anon-leak",
```

to:

```json
    "test:security": "FORGE_LEAK_TEST=1 vitest run forge-anon-leak superuser-anon-leak posts-anon-leak poster-invites-leak",
```

- [ ] **Step 4: Run the opt-in suite**

Run: `npm run test:security`
Expected: all tests pass, including the new `poster invites RLS/RPC
guardrail` describe block and the three new anon-cannot-execute cases. This
requires `.env.local` with `SUPABASE_SERVICE_ROLE_KEY` set and migrations 097
(Task 2.5) already applied — if either is missing, the suite silently
no-ops (`describe.runIf`) rather than failing; confirm the block actually ran
by checking the test names in the output, not just "0 failed".

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-poster-invites
git add __tests__/poster-invites-leak.test.ts __tests__/superuser-anon-leak.test.ts package.json
git commit -m "test(posts): live-DB RLS/RPC guardrail for poster invites

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `app/admin/posts/lib/authorProfile.ts` — self-service save

**Files:**
- Create: `app/admin/posts/lib/authorProfile.ts`
- Test: `app/admin/posts/lib/__tests__/authorProfile.test.ts`

**Interfaces:**
- Consumes: `requirePoster(): Promise<PosterContext>` from `./auth` (throws `Error("Unauthorized: ...")` on failure — same contract `app/admin/posts/actions.ts` already relies on); `type ActionResult` from `../actions`.
- Produces: `updateAuthorProfileAction(bio: string | null, avatarUrl: string | null): Promise<ActionResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// app/admin/posts/lib/__tests__/authorProfile.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../auth", () => ({ requirePoster: vi.fn() }));

import { revalidatePath } from "next/cache";
import { requirePoster } from "../auth";
import { updateAuthorProfileAction } from "../authorProfile";

function ctx(overrides: { error?: unknown; posts?: { slug: string }[] } = {}) {
  const updateEq = vi.fn(async () => ({ error: overrides.error ?? null }));
  const postsEq2 = vi.fn(async () => ({ data: overrides.posts ?? [] }));
  return {
    user: { id: "u1" },
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "profiles") return { update: vi.fn(() => ({ eq: updateEq })) };
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: postsEq2 })) })) };
      }),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("updateAuthorProfileAction", () => {
  it("rejects a non-poster", async () => {
    (requirePoster as any).mockRejectedValue(new Error("Unauthorized: publish_posts permission required"));
    const r = await updateAuthorProfileAction("hi", null);
    expect(r.success).toBe(false);
  });

  it("rejects a bio over 500 characters", async () => {
    (requirePoster as any).mockResolvedValue(ctx());
    const r = await updateAuthorProfileAction("x".repeat(501), null);
    expect(r).toEqual({ success: false, error: "Bio must be 500 characters or fewer" });
  });

  it("rejects a non-https avatar URL", async () => {
    (requirePoster as any).mockResolvedValue(ctx());
    const r = await updateAuthorProfileAction(null, "http://insecure.example/x.png");
    expect(r).toEqual({ success: false, error: "Avatar must be an https URL" });
  });

  it("saves a trimmed bio and https avatar, and revalidates the author's published posts", async () => {
    const c = ctx({ posts: [{ slug: "hello-world" }] });
    (requirePoster as any).mockResolvedValue(c);
    const r = await updateAuthorProfileAction("  Hi there  ", "https://x/y.png");
    expect(r).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith("/articles");
    expect(revalidatePath).toHaveBeenCalledWith("/articles/hello-world");
  });

  it("surfaces a database error", async () => {
    (requirePoster as any).mockResolvedValue(ctx({ error: { message: "boom" } }));
    const r = await updateAuthorProfileAction("hi", null);
    expect(r).toEqual({ success: false, error: "Could not save your author profile" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/admin/posts/lib/__tests__/authorProfile.test.ts`
Expected: FAIL — `../authorProfile` has no exports yet.

- [ ] **Step 3: Write the implementation**

```ts
// app/admin/posts/lib/authorProfile.ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePoster } from "./auth";
import type { ActionResult } from "../actions";

const MAX_BIO = 500;

export async function updateAuthorProfileAction(
  bio: string | null,
  avatarUrl: string | null
): Promise<ActionResult> {
  try {
    const ctx = await requirePoster();

    const cleanBio = bio && bio.trim() ? bio.trim() : null;
    if (cleanBio && cleanBio.length > MAX_BIO) {
      return { success: false, error: `Bio must be ${MAX_BIO} characters or fewer` };
    }
    const cleanAvatar = avatarUrl && avatarUrl.trim() ? avatarUrl.trim() : null;
    if (cleanAvatar && !/^https:\/\//.test(cleanAvatar)) {
      return { success: false, error: "Avatar must be an https URL" };
    }

    const { error } = await ctx.supabase
      .from("profiles")
      .update({ bio: cleanBio, avatar_url: cleanAvatar })
      .eq("id", ctx.user.id);
    if (error) {
      console.error("updateAuthorProfile:", error);
      return { success: false, error: "Could not save your author profile" };
    }

    // A bio/avatar change is invisible on already-rendered article pages
    // until these run (or the hourly ISR window passes) — revalidate every
    // published slug this author owns, not just the ones edited today.
    const { data: mine } = await ctx.supabase
      .from("posts")
      .select("slug")
      .eq("author_id", ctx.user.id)
      .eq("status", "published");
    revalidatePath("/articles");
    for (const row of (mine ?? []) as { slug: string }[]) revalidatePath(`/articles/${row.slug}`);

    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("Unauthorized")) return { success: false, error: "Unauthorized" };
    console.error("updateAuthorProfileAction failed:", e);
    return { success: false, error: "An unexpected error occurred" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/admin/posts/lib/__tests__/authorProfile.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Type-check and commit**

```bash
cd /Users/timestes/projects/rtt-poster-invites
npx tsc --noEmit
git add app/admin/posts/lib/authorProfile.ts app/admin/posts/lib/__tests__/authorProfile.test.ts
git commit -m "feat(posts): self-service author bio/avatar server action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `AuthorProfileCard.tsx` + wiring into `/admin/posts`

**Files:**
- Create: `app/admin/posts/components/AuthorProfileCard.tsx`
- Modify: `app/admin/posts/page.tsx`

**Interfaces:**
- Consumes: `updateAuthorProfileAction` (Task 7); `ACCEPT`, `validateMediaFile` from `../lib/media`; `createClient()` from `@/utils/supabase/client`.
- Produces: `<AuthorProfileCard username avatarUrl bio />` as `{ username: string | null; initialAvatarUrl: string | null; initialBio: string | null }`.

- [ ] **Step 1: Write `AuthorProfileCard.tsx`**

```tsx
// app/admin/posts/components/AuthorProfileCard.tsx
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import ToastNotification from "@/components/ui/toast-notification";
import { createClient } from "@/utils/supabase/client";
import { ACCEPT, validateMediaFile } from "../lib/media";
import { updateAuthorProfileAction } from "../lib/authorProfile";

const MAX_BIO = 500;
const LABEL = "block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

type Toast = { message: string; type: "success" | "error" } | null;

export default function AuthorProfileCard({
  username,
  initialAvatarUrl,
  initialBio,
}: {
  username: string | null;
  initialAvatarUrl: string | null;
  initialBio: string | null;
}) {
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [bio, setBio] = useState(initialBio ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = validateMediaFile(file, "image");
    if (problem) {
      setToast({ message: problem, type: "error" });
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const fileName = `poster-${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(fileName, file);
    setUploading(false);
    if (upErr) {
      setToast({ message: "Avatar upload failed", type: "error" });
      return;
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(fileName);
    setAvatarUrl(publicUrl);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    const r = await updateAuthorProfileAction(bio, avatarUrl);
    setSaving(false);
    if (r.success === false) {
      setToast({ message: r.error, type: "error" });
    } else {
      setDirty(false);
      setToast({ message: "Author profile saved", type: "success" });
    }
  }

  return (
    <div className="mb-8 rounded-lg bg-card p-4">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Your author profile
      </h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground">
              {username?.slice(0, 1).toUpperCase() ?? "?"}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Change photo"}
          </Button>
          <input ref={fileInput} type="file" accept={ACCEPT.image} className="hidden" onChange={handleAvatarPick} />
        </div>
        <div className="flex-1">
          <label className={LABEL}>
            Bio ({bio.length}/{MAX_BIO})
            <textarea
              value={bio}
              onChange={(e) => {
                setBio(e.target.value.slice(0, MAX_BIO));
                setDirty(true);
              }}
              placeholder="A sentence or two about you — shown on every article you publish."
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-input bg-background p-2 text-sm outline-none"
            />
          </label>
          <Button type="button" className="mt-2 min-h-11" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      <ToastNotification show={toast !== null} message={toast?.message ?? ""} type={toast?.type} onClose={() => setToast(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `app/admin/posts/page.tsx`**

Add the import:

```tsx
import AuthorProfileCard from "./components/AuthorProfileCard";
```

Replace the body of `PostsAdminPage` (the `getPosterContext`/`listMyPostsAction`
call and the JSX that follows it) with:

```tsx
export default async function PostsAdminPage() {
  const ctx = await getPosterContext();
  if (!ctx) notFound(); // invisible to everyone else — portal precedent
  const [r, profileRes] = await Promise.all([
    listMyPostsAction(),
    ctx.supabase.from("profiles").select("username, avatar_url, bio").eq("id", ctx.user.id).single(),
  ]);
  const posts = r.success === false ? [] : r.posts;
  const profile = profileRes.data;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-cinzel text-2xl font-bold sm:text-3xl">Posts</h1>
          <Button asChild className="min-h-11">
            <Link href="/admin/posts/new">New post</Link>
          </Button>
        </div>
        <AuthorProfileCard
          username={profile?.username ?? null}
          initialAvatarUrl={profile?.avatar_url ?? null}
          initialBio={profile?.bio ?? null}
        />
        {r.success === false && <p className="mb-4 text-sm text-destructive">{r.error}</p>}
        <Section heading="Drafts" posts={posts.filter((p) => p.status === "draft")} showAuthor={ctx.isSuperuser} />
        <Section heading="Published" posts={posts.filter((p) => p.status === "published")} showAuthor={ctx.isSuperuser} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check, manual check, and commit**

Run `npm run dev`, sign in as a poster, visit `/admin/posts`, confirm "Your
author profile" renders above the Drafts/Published lists, uploading a photo
shows it immediately, Save is disabled until something changes, and Save
shows a success toast.

```bash
cd /Users/timestes/projects/rtt-poster-invites
npx tsc --noEmit
git add app/admin/posts/components/AuthorProfileCard.tsx app/admin/posts/page.tsx
git commit -m "feat(posts): author profile panel on /admin/posts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Extend the public post query with avatar + bio

**Files:**
- Modify: `app/articles/lib/queries.ts`

**Interfaces:**
- Produces: `PublicPost["author"]` gains `avatar_url: string | null` and `bio: string | null`.

- [ ] **Step 1: Extend `COLUMNS` and the `PublicPost` type**

Change:

```ts
  author: { username: string | null } | null;
```

to:

```ts
  author: { username: string | null; avatar_url: string | null; bio: string | null } | null;
```

Change:

```ts
const COLUMNS =
  "id, slug, title, excerpt, body_md, cover_image_url, tags, status, author_id, author_name, published_at, author:profiles(username)";
```

to:

```ts
const COLUMNS =
  "id, slug, title, excerpt, body_md, cover_image_url, tags, status, author_id, author_name, published_at, author:profiles(username, avatar_url, bio)";
```

- [ ] **Step 2: Type-check and commit**

```bash
cd /Users/timestes/projects/rtt-poster-invites
npx tsc --noEmit
git add app/articles/lib/queries.ts
git commit -m "feat(articles): embed author avatar_url/bio in the post query

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `AuthorBio.tsx` — render on the article page

**Files:**
- Create: `app/articles/components/AuthorBio.tsx`
- Test: `app/articles/components/__tests__/AuthorBio.test.ts`
- Modify: `app/articles/[slug]/page.tsx`

**Interfaces:**
- Consumes: `PublicPost["author"]` (Task 9).
- Produces: `<AuthorBio author={PublicPost["author"]} />` — renders `null` when the author has neither an avatar nor a bio (imported WordPress posts, or a poster who never filled this in).

- [ ] **Step 1: Write the failing test**

```ts
// app/articles/components/__tests__/AuthorBio.test.ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuthorBio from "../AuthorBio";

const render = (author: { username: string | null; avatar_url: string | null; bio: string | null } | null) =>
  renderToStaticMarkup(createElement(AuthorBio, { author }));

describe("AuthorBio", () => {
  it("renders nothing when the author has no avatar and no bio", () => {
    expect(render({ username: "tim", avatar_url: null, bio: null })).toBe("");
  });

  it("renders nothing for a null author (e.g. an imported post)", () => {
    expect(render(null)).toBe("");
  });

  it("renders the bio and a fallback initial when there's no avatar", () => {
    const html = render({ username: "tim", avatar_url: null, bio: "I play Genesis." });
    expect(html).toContain("I play Genesis.");
    expect(html).toContain(">T<");
  });

  it("renders the avatar image when present", () => {
    const html = render({ username: "tim", avatar_url: "https://x/avatar.png", bio: null });
    expect(html).toContain('src="https://x/avatar.png"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/articles/components/__tests__/AuthorBio.test.ts`
Expected: FAIL — `../AuthorBio` does not exist yet.

- [ ] **Step 3: Write the component**

```tsx
// app/articles/components/AuthorBio.tsx
import type { PublicPost } from "../lib/queries";

export default function AuthorBio({ author }: { author: PublicPost["author"] }) {
  if (!author || (!author.avatar_url && !author.bio)) return null;
  return (
    <div className="mt-8 flex gap-4 rounded-lg bg-card p-4">
      {author.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={author.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground">
          {(author.username ?? "?").slice(0, 1).toUpperCase()}
        </div>
      )}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          About {author.username ?? "the author"}
        </p>
        {author.bio && <p className="mt-1 text-sm text-muted-foreground">{author.bio}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/articles/components/__tests__/AuthorBio.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Render it on the article page**

In `app/articles/[slug]/page.tsx`, add the import:

```tsx
import AuthorBio from "../components/AuthorBio";
```

and render it right after `<ArticleBody markdown={post.body_md} />`:

```tsx
        <ArticleBody markdown={post.body_md} />
        <AuthorBio author={post.author} />
```

- [ ] **Step 6: Type-check, manual check, and commit**

Run `npm run dev`, open a published article by a poster who has saved a bio,
confirm the "About <name>" card renders below the body; open one with no
bio/avatar and confirm nothing extra renders.

```bash
cd /Users/timestes/projects/rtt-poster-invites
npx tsc --noEmit
git add app/articles/components/AuthorBio.tsx app/articles/components/__tests__/AuthorBio.test.ts app/articles/[slug]/page.tsx
git commit -m "feat(articles): render author avatar + bio on the article page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end manual verification — ORCHESTRATOR ONLY

**Not a subagent task** — this needs the real superuser session (Tim) for
half of it, and this repo's Playwright e2e suite is documented as broken and
not run anywhere (`docs/superpowers/specs/` memory: no CI runs it, the repair
attempt never passed), so a from-scratch e2e spec here would be unverifiable
busywork. Verify by hand against the running dev server instead:

1. `npm run dev`. Sign in as the superuser. Visit `/admin/permissions` →
   Posters section → create an open-link invite → copy the link.
2. In a private window, sign in (or sign up) as a second, throwaway account.
   Visit the copied `/invite/poster/<token>` link → "Accept & start posting".
   Confirm it redirects to `/admin/posts` and that account can create a
   draft post.
3. Back in the superuser window, confirm the new poster shows up under
   "Current posters" in the Posters section; click Revoke; confirm
   `/admin/posts` 404s for that account afterward (re-check in the private
   window).
4. As a poster with `publish_posts` still active, fill in "Your author
   profile" (upload a photo, write a bio), Save, publish a post, and confirm
   the "About <name>" card renders on the published article at
   `/articles/<slug>`.
5. `npx tsc --noEmit` clean, `npm run test:security` (if `.env.local` has the
   service role key) all passing, `npx vitest run` (full unit suite) passing.

Record the outcome in the PR description; do not claim the feature works
without having done these steps.

---

## Final check before opening the PR

- [ ] Every task above is committed.
- [ ] `npx tsc --noEmit` is clean at HEAD.
- [ ] `npx vitest run` (the default hermetic suite) passes.
- [ ] Task 11's manual walkthrough has been done and its outcome is honestly
      reported (including anything that didn't work).
- [ ] `git push -u origin feat/poster-invites-author-profile` and open the PR
      against `origin/main`, body ending with the required Claude Code footer.
