# Forge Missives — Implementation Plan

Elder→member email announcements for The Forge. Elders (and the superadmin) compose a
plain-text missive, target Forge members (all / elders / playtesters / by set / individual),
test-send it to themselves, then send. Emails are forge-themed (ash/ember), always carry the
sender's identity (display name + auth email) in the signature, always carry a confidentiality
notice, and direct replies to Discord DMs (with `Reply-To` set to the sender as a backstop).

Reconciled from two independent architect plans; consensus decisions are binding.

## Global Constraints (binding for every task)

- **Workspace**: work ONLY inside the worktree
  `/Users/timestes/projects/redemption-tournament-tracker/.claude/worktrees/forge-missives`
  (branch `forge-missives`). Use absolute paths. There is a sibling checkout at
  `/Users/timestes/projects/redemption-tournament-tracker` where another agent is working —
  do NOT read from or write to it.
- **Access control**: only Forge elders and the superadmin may use any part of this feature.
  Every server action starts with `requireElder()` from `app/forge/lib/auth.ts` and returns
  an error/empty result when it fails. The page 404s via `notFound()`. Every new DB function
  self-gates with `public.is_forge_elder_or_super()` (returning zero rows or raising), so the
  DB enforces this independently of the app layer. Playtesters must never see the feature.
- **TypeScript**: `tsconfig.json` has `strict: false`, which breaks `if (r.ok) / else` union
  narrowing on discriminated unions. Use explicit comparisons: `if (r.ok === false)`.
- **Style**: match existing code. Server actions mirror `app/forge/lib/members.ts`
  (`"use server"`, `{ ok, error? }` result shapes). UI mirrors `app/forge/admin/AdminConsole.tsx`
  (plain Tailwind, `rounded-md border bg-background px-2 py-1.5 text-sm` controls, sections with
  `h2.text-lg.font-medium`, `useTransition` + inline status message). Never use `focus:ring-*`
  classes on form controls. Keep the UI minimal and functional — a UI refresh is happening in
  parallel; do not restyle anything that already exists.
- **Email HTML**: table-based layout, `role="presentation"`, ALL styles inline, max-width 600px.
  No external images, no external fonts, no `<style>` blocks that carry the design (a client
  that strips `<head>` must still render correctly).
- **Verification**: `npm run test` (vitest) passes from the worktree root before committing.
- **Commits**: commit in the worktree; message style `Forge: <what>` matching repo history;
  end the message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do not modify any file a task does not list.

## Task 1: Migration 062 + `sendEmail` reply-to support

**Files:**
- CREATE `supabase/migrations/062_forge_missives.sql` (worktree-absolute:
  `/Users/timestes/projects/redemption-tournament-tracker/.claude/worktrees/forge-missives/supabase/migrations/062_forge_missives.sql`)
- MODIFY `utils/email.ts` (same worktree root)

**Migration — use this SQL verbatim** (it follows the established patterns of migrations
048/049: SECURITY DEFINER + `set search_path = ''`, no-oracle empty results for non-elders,
explicit `revoke ... from public, anon` because Supabase default-grants EXECUTE to anon,
`forge_audit` stamps on writes):

```sql
-- 062_forge_missives.sql
-- Forge Missives: elder→member email. Directory RPC (emails live only in auth.users)
-- + sent-missive log. Follows 048/049 definer/no-oracle/revoke patterns.

-- 1) Sent-missive log. Read: elders+. Write: only via forge_log_missive below.
create table if not exists public.forge_missives (
  id              uuid primary key default gen_random_uuid(),
  sender          uuid not null references auth.users(id),
  subject         text not null,
  body_text       text not null,          -- raw composed body, pre-template
  recipient_ids   uuid[] not null,
  recipient_count int not null,
  sent_at         timestamptz not null default now()
);
alter table public.forge_missives enable row level security;
drop policy if exists "forge_missives_select" on public.forge_missives;
create policy "forge_missives_select" on public.forge_missives
  for select to authenticated using (public.is_forge_elder_or_super());
revoke all on public.forge_missives from anon;
grant select on public.forge_missives to authenticated;
-- no insert/update/delete policies: writes land via forge_log_missive only

-- 2) Member directory with emails (auth.users) + set scoping for targeting.
--    NO ORACLE: returns zero rows for non-elders (mirrors forge_list_invites).
--    set_ids = grants ∪ set-elderships, so "everyone on set X" includes that
--    set's elders as well as granted playtesters.
create or replace function public.forge_member_directory()
returns table(user_id uuid, display_name text, role public.playtest_role,
              email text, set_ids uuid[])
language sql security definer stable set search_path = '' as $$
  select m.user_id, m.display_name, m.role, u.email::text,
         coalesce((
           select array_agg(distinct s.set_id) from (
             select g.set_id from public.forge_set_grants g where g.user_id = m.user_id
             union
             select e.set_id from public.forge_set_elders e where e.user_id = m.user_id
           ) s
         ), '{}')
  from public.playtest_members m
  join auth.users u on u.id = m.user_id
  where public.is_forge_elder_or_super()
  order by m.role, m.display_name nulls last;
$$;

-- 3) Log a sent missive (elders+; also stamps forge_audit).
create or replace function public.forge_log_missive(
  p_subject text, p_body_text text, p_recipient_ids uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_forge_elder_or_super() then
    raise exception 'not authorized';
  end if;
  insert into public.forge_missives (sender, subject, body_text, recipient_ids, recipient_count)
  values (auth.uid(), p_subject, p_body_text, coalesce(p_recipient_ids, '{}'),
          coalesce(array_length(p_recipient_ids, 1), 0))
  returning id into v_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'missive_sent', v_id::text);
  return v_id;
end; $$;

-- 4) Lock down execute (Supabase default-grants anon directly; strip it — cf. 048 §3).
revoke execute on function public.forge_member_directory() from public, anon;
revoke execute on function public.forge_log_missive(text, text, uuid[]) from public, anon;
grant execute on function public.forge_member_directory() to authenticated;
grant execute on function public.forge_log_missive(text, text, uuid[]) to authenticated;
```

**`utils/email.ts` change — minimal and backward-compatible.** Extend `EmailOptions` with two
optional fields and pass them through to the Resend REST payload:

```ts
interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;     // overrides FROM_EMAIL / default
  replyTo?: string;  // maps to Resend "reply_to"
}
```

In `sendEmail`, destructure the new fields; in the `fetch` body use
`from: from ?? fromEmail` and include `...(replyTo ? { reply_to: replyTo } : {})`.
No other behavior changes; existing callers are unaffected.

**Tests/verification for this task:** `npm run test` passes (proves no existing caller broke).
No new tests required (SQL is not unit-testable here; the email.ts change is a passthrough).

## Task 2: Forge missive email template

**Files:**
- CREATE `app/forge/lib/missiveTemplate.ts`
- CREATE `app/forge/lib/__tests__/missiveTemplate.test.ts`

A plain TypeScript module (NOT `"use server"` — sync pure functions) exporting:

```ts
export function escapeHtml(s: string): string;
// Escapes the raw plain-text body, substitutes {name} with the (escaped) recipient
// name, converts blank-line-separated blocks to <p style="margin:0 0 16px 0;"> and
// single newlines to <br>.
export function missiveBodyHtml(body: string, recipientName: string): string;
export function wrapForgeMissive(opts: {
  bodyHtml: string;      // output of missiveBodyHtml
  senderName: string;    // Forge display name — already guaranteed non-empty by caller
  senderEmail: string;   // sender's auth email
}): string;              // full HTML document
```

Implementation notes: `escapeHtml` escapes `& < > " '`. In `missiveBodyHtml`, escape the whole
body FIRST, then replace `{name}` (regex `/\{name\}/g`) with `escapeHtml(recipientName)` —
`{name}` survives escaping since it has no special chars. `wrapForgeMissive` must also
escape `senderName`/`senderEmail` where injected.

**Design (binding).** This is the deliverable the product owner cares most about — a dark,
fire-and-ash forge aesthetic that still renders in Gmail/Outlook/Apple Mail. Structure it as
the same email-safe skeleton as `wrapEmailInTemplate` in `utils/email.ts` (outer full-width
table, centered 600px inner table, `role="presentation"`, inline styles, `<!DOCTYPE html>`,
meta charset + viewport) but fully forge-branded — no site logo, no nationals footer.

Palette:
- Outer page background `#0c0a09` (ash black); outer padding `40px 16px`.
- Panel: background `#1b1613`, border `1px solid #33261e`, `border-radius:12px`,
  `overflow:hidden`.
- Ember strip: the panel's first row, a `<td>` with `height:6px`,
  `background-color:#9a3412` and
  `background-image:linear-gradient(90deg,#431407,#9a3412,#f59e0b,#9a3412,#431407)`
  (solid color is the Outlook fallback). `font-size:0;line-height:0;` so it stays 6px.
- Title/wordmark `#fafaf9`; body text `#e7e5e4`; amber accent `#fbbf24`; ember orange
  `#f97316`; muted `#a8a29e`; faint `#78716c`; hairlines `#33261e`.

Font stacks (the real Forge fonts — Anton, Arimo — will not load in email clients):
- Display: `Impact, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`, uppercase,
  letter-spaced.
- Body: `Arimo, Arial, 'Helvetica Neue', Helvetica, sans-serif`.

Rows, top to bottom:
1. Ember strip (above).
2. Header cell, centered, `padding:28px 30px 22px`, bottom border `1px solid #33261e`:
   `THE FORGE` (26px display stack, `#fafaf9`, `letter-spacing:4px`) with kicker line below:
   `A MISSIVE FROM THE ELDERS` (11px, `letter-spacing:3px`, `#fbbf24`, uppercase).
3. Body cell `padding:32px 30px`, `color:#e7e5e4`, `font-size:16px`, `line-height:1.7`,
   body font stack: `bodyHtml` content.
4. Signature (inside the same cell, after the content, separated by
   `margin-top:28px; padding-top:18px; border-top:1px solid #33261e`), auto-injected:
   - line 1, `color:#78716c;font-size:12px;`: `Sent from the Forge by`
   - line 2: `<strong style="color:#fafaf9;">{senderName}</strong>
     <span style="color:#a8a29e;"> — Elder of the Forge</span>`
   - line 3, `color:#a8a29e;font-size:13px;`: `{senderEmail}`
5. Confidentiality block — its own row, `padding:0 30px 28px`: an inner box with
   `background:#201409; border:1px solid #7c2d12; border-left:4px solid #ea580c;
   border-radius:6px; padding:16px 18px; font-size:13px; line-height:1.6; color:#d6d3d1;`.
   Copy VERBATIM (lead phrase styled `color:#fbbf24;font-weight:bold;`):
   > **Keep it in the Forge.** Everything in this missive — card designs, names, mechanics,
   > set details, images, and timelines — is confidential playtest material. Do not share,
   > screenshot, forward, or discuss it outside the Forge. You are reading this because the
   > elders trust you with unfinished work; that trust is what makes the Forge possible.
   > Guard it.
6. Footer row: `padding:20px 30px 26px`, top border `1px solid #33261e`, centered, 12px,
   `color:#78716c`. Copy VERBATIM (sender name repeated; `#a8a29e` for the strong tags):
   > **Need to respond?** DM **{senderName}** on Discord — that's where the Forge talks.
   > Replies to this email reach {senderName} as a backstop, but Discord is faster.

   then on its own line, italic, `color:#57534e`, `letter-spacing:1px`:
   > Forged in fire. Kept in shadow.

**Tests** (`app/forge/lib/__tests__/missiveTemplate.test.ts`, plain vitest, no mocks needed):
- `escapeHtml` escapes `<script>` / `&` / quotes.
- `missiveBodyHtml("Hi {name},\n\nRound two begins.", "Ada")` contains `Hi Ada,`, two `<p`
  blocks, no raw `{name}`.
- `missiveBodyHtml` with a recipient name containing `<` escapes it.
- `missiveBodyHtml("a\nb", "x")` produces `a<br>b` (single newline → `<br>`).
- `wrapForgeMissive` output contains: the body html, `THE FORGE`, sender name, sender email,
  `Keep it in the Forge`, `DM`/`Discord` footer copy, and does NOT contain `{name}`.
- `wrapForgeMissive` escapes a malicious senderName (`<img` must not appear unescaped).

## Task 3: Server actions

**Files:**
- CREATE `app/forge/lib/missives.ts`
- CREATE `app/forge/lib/__tests__/missives.test.ts`

`"use server"` module mirroring `app/forge/lib/members.ts`. Imports: `requireElder` +
`ForgeRole` from `@/app/forge/lib/auth`, `sendEmail` from `@/utils/email`,
`missiveBodyHtml`/`wrapForgeMissive` from `@/app/forge/lib/missiveTemplate`,
`revalidatePath` from `next/cache`.

```ts
export type MissiveMember = {
  userId: string;
  displayName: string | null;
  role: ForgeRole;
  email: string;
  setIds: string[];
};

const MAX_RECIPIENTS = 100;      // Resend free tier: 100/day
const SEND_DELAY_MS = 600;       // Resend default rate limit: 2 req/s

export async function getMissiveDirectory(): Promise<{
  members: MissiveMember[];
  sets: { id: string; name: string }[];
}>;

export async function sendMissive(input: {
  subject: string;
  body: string;
  recipientIds: string[];
}): Promise<{ ok: boolean; sent: number; failed: number; error?: string }>;

export async function sendMissiveTest(input: {
  subject: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }>;

export async function listRecentMissives(): Promise<
  { id: string; sender: string; subject: string; recipientCount: number; sentAt: string }[]
>;
```

**`getMissiveDirectory`**: `requireElder()`; on null return `{ members: [], sets: [] }`.
Call `ctx.supabase.rpc("forge_member_directory")` and map rows
(`user_id/display_name/role/email/set_ids` → camelCase, `set_ids ?? []`). Sets:
`ctx.supabase.from("forge_sets").select("id, name").order("name")` (RLS already scopes what
this elder can see). Nulls → empty arrays.

**`sendMissive`** — the load-bearing action:
1. `requireElder()`; on null `{ ok: false, sent: 0, failed: 0, error: "Not authorized" }`.
2. Validate: trimmed subject 1–150 chars; trimmed body 1–20000 chars; recipientIds length
   1–MAX_RECIPIENTS (over cap → error asking to split the send). Clear error strings.
3. Fetch the directory RPC once. Find the sender's own row (`user_id === ctx.user.id`).
   If the sender has no `display_name`, return
   `{ ok: false, ..., error: "Set your Forge display name before sending a missive." }` —
   missives are never anonymous.
4. Resolve recipients by INTERSECTING `input.recipientIds` with the directory (unknown ids
   dropped silently; emails only ever come from the directory — the client can never supply
   an arbitrary address). Dedupe by userId; drop rows with null/empty email. Zero valid
   recipients → error.
5. For each recipient: personalize
   `wrapForgeMissive({ bodyHtml: missiveBodyHtml(body, r.displayName ?? "Forge member"), senderName, senderEmail: ctx.user.email ?? "" })`
   and `sendEmail({ to: r.email, subject: "[Forge] " + subject, html, from: FORGE_FROM, replyTo: ctx.user.email ?? undefined })`
   where `const FORGE_FROM = process.env.FORGE_FROM_EMAIL || "The Forge <noreply@landofredemption.com>"`.
   Send sequentially; `await new Promise((r) => setTimeout(r, SEND_DELAY_MS))` BETWEEN sends
   (not after the last). Count sent/failed off `result.success` like `sendBulkEmail` in
   `app/admin/registrations/actions.ts`.
6. Log via `ctx.supabase.rpc("forge_log_missive", { p_subject, p_body_text, p_recipient_ids })`
   with the attempted recipient userIds (log even when some sends failed; skip only if all
   validation failed before any send). Then `revalidatePath("/forge/missives")`.
7. Return `{ ok: failed === 0, sent, failed, error: failed > 0 ? "Some sends failed" : undefined }`.

**`sendMissiveTest`**: same gate + subject/body validation + display-name guard; renders the
IDENTICAL pipeline for the sender only (`{name}` → own displayName), subject
`"[TEST] [Forge] " + subject`, to `ctx.user.email`, same `from`/`replyTo`. NOT logged, no
revalidate, no delay.

**`listRecentMissives`**: gate; `ctx.supabase.from("forge_missives")
.select("id, sender, subject, recipient_count, sent_at").order("sent_at", { ascending: false })
.limit(20)`; map to camelCase.

**Tests** (`missives.test.ts`) — copy the mocking pattern from
`app/forge/lib/__tests__/members.test.ts` exactly (vi.mock `next/cache`,
`@/app/forge/lib/auth`, `@/utils/email`, `@/utils/supabase/server`; do NOT mock
missiveTemplate — let the real template run). Directory RPC mock returns e.g. sender row
(`user_id: "caller"`, display_name "Smith", email "c@x.com", role "elder") + two playtesters.
Cases:
- not-elder → `sendMissive`/`sendMissiveTest`/`getMissiveDirectory` reject/empty.
- empty subject, empty body, 0 recipients, >100 recipients → validation errors, no sendEmail calls.
- sender without display_name → blocked with the display-name error.
- unknown recipientIds are dropped; only directory emails are used (assert `sendEmail` called
  with the directory email, not anything client-supplied).
- happy path 2 recipients: 2 sendEmail calls, subject prefixed `[Forge] `, html contains
  each recipient's name (personalization), `replyTo` = sender email, log RPC called with
  attempted ids, ok true. (2 recipients = one 600ms delay; acceptable test cost. If you
  prefer, use `vi.useFakeTimers` + `advanceTimersByTimeAsync`.)
- one send fails (mock sendEmail second call `{ success: false }`) → `ok === false`,
  `sent === 1`, `failed === 1`, still logged.
- `sendMissiveTest`: sends exactly one email to the caller, subject `[TEST] [Forge] ...`,
  log RPC NOT called.

## Task 4: Page, composer, nav

**Files:**
- CREATE `app/forge/missives/page.tsx`
- CREATE `app/forge/missives/MissiveComposer.tsx`
- MODIFY `app/forge/components/ForgeNav.tsx` (one array entry — nothing else)

**`page.tsx`** — mirror `app/forge/admin/page.tsx` exactly in shape:
`export const dynamic = "force-dynamic"; export const revalidate = 0;`;
`requireElder()` else `notFound()`; load `getMissiveDirectory()` and `listRecentMissives()`
in `Promise.all`; render `<main className="mx-auto max-w-3xl p-6">` with
`<h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>Missives</h1>` and
`<MissiveComposer members={...} sets={...} recent={...} callerId={ctx.user.id} />`.

**`MissiveComposer.tsx`** — `"use client"`, minimal, styled like `AdminConsole.tsx`.
Props: `{ members: MissiveMember-shaped[]; sets: {id,name}[]; recent: {...}[]; callerId: string }`
(re-declare prop types locally like ForgeNav does — do not import server-only modules).
State: `selected: Set<string>`, `subject`, `body`, status message, `useTransition`.

Sections:
1. `h2` "Compose a missive".
   - Recipients: quick-select buttons `All`, `Elders`, `Playtesters`, `None` (buttons REPLACE
     the selection with that group; elders group = role elder or superadmin) plus, when
     `sets.length > 0`, a `<select>` "Everyone on set…" that replaces the selection with
     members whose `setIds` includes the chosen set. Below: a scrollable checkbox list
     (`max-h-64 overflow-y-auto rounded-md border`) of all members — checkbox, display name
     (fallback "(no name)"), small role tag, muted email. Live count line: "N recipient(s)
     selected".
   - Subject: text input; helper text `Sent as: [Forge] <your subject>`.
   - Body: `<textarea rows={10}>`; helper text: `Plain text. {name} becomes each member's
     display name. Your signature and the confidentiality notice are added automatically.`
   - Buttons row: secondary button `Send test to me` → `sendMissiveTest({ subject, body })`;
     primary button `Send to N member(s)` (disabled while pending or when N === 0 or subject/
     body empty) → `window.confirm(...)` then `sendMissive({ subject, body, recipientIds })`.
     On success clear subject/body/selection and show the sent/failed counts; on failure show
     the returned error. Remember `=== false` narrowing.
2. `h2` "Recent missives": list `recent` (subject, sender display name resolved from
   `members` by userId — fallback "Former member", recipientCount, date via
   `new Date(sentAt).toLocaleDateString()`); empty state "No missives sent yet."

**`ForgeNav.tsx`**: in the elder/superadmin branch, after the `Play` item and before the
superadmin-only `Admin` spread, add:
`{ href: "/forge/missives", label: "Missives", match: (p) => p.startsWith("/forge/missives") }`.
The playtester branch is untouched — playtesters never see the tab.

**Tests/verification:** `npm run test` still passes (no new unit tests required for the page —
the actions are covered by Task 3; note in your report that visual verification happens after
merge). `npx tsc --noEmit` if quick; otherwise rely on vitest + review.
