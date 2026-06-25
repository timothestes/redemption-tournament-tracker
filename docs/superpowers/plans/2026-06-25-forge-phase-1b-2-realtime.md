# The Forge — Phase 1b.2: Realtime Collaboration Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 1b.1 review layer live — live comments/proposals, presence + a soft "also editing" collision warning, and live review-queue badges / set-notes / progress — over private, per-topic-authorized Supabase Realtime channels.

**Architecture:** Broadcast-from-Database. `AFTER` triggers on the four Forge tables call `realtime.broadcast_changes()` to private topics `forge:card:{id}` / `forge:set:{id}`; receipt is gated by RLS on `realtime.messages` whose predicate (`_forge_can_read_topic`) reuses the existing table read-rules so Realtime visibility equals table RLS. Clients subscribe once per page-context: a single `'change'` broadcast event drives a debounced `router.refresh()` (every live surface renders from server props), and a presence track on the card channel drives the avatar row + collision banner. No change to the `supabase_realtime` publication or `REPLICA IDENTITY` — `/board` is untouched.

**Tech Stack:** Next.js 15 App Router, React 19, `@supabase/ssr` browser client (`utils/supabase/client.ts`), `@supabase/supabase-js` Realtime (broadcast + presence), Postgres (Supabase) triggers + RLS, Vitest.

## Global Constraints

- **Hard constraint:** nothing about prerelease Forge cards may reach a **non-member**. Realtime is delivered only on **private** channels (`config: { private: true }`); join/receive is gated by RLS on `realtime.messages`. (Spec §"Security spine".)
- **Per-topic authz = table RLS.** The `realtime.messages` predicate is `public._forge_can_read_topic(realtime.topic())`, which reuses `_forge_can_read_card` (053) for `forge:card:%` and `is_forge_set_elder` ∨ `is_forge_superadmin` (052/051) for `forge:set:%`. No member-level shortcut.
- **No publication / `REPLICA IDENTITY` changes.** `realtime.broadcast_changes()` rides Realtime's internal messaging. Do **not** touch `supabase_realtime` (it holds `/board`'s `rounds`,`tournaments`).
- **"Allow public access" Realtime setting stays ON** (required by `/board`); safe because private and public same-named topics are distinct channels.
- **Topic format is exact:** `forge:card:{uuid}` / `forge:set:{uuid}`, **no sub-suffixes** (the RLS predicate parses `split_part(topic,':',3)::uuid`). Builders in `app/forge/lib/realtime.ts` are the single source of truth and must match the trigger SQL byte-for-byte.
- **Broadcast event name is the constant `'change'`** (operation carried in the payload), so each client registers exactly one `.on('broadcast', { event: 'change' }, …)`.
- **Every `/forge` page keeps its own `requireForge()` gate** (no `/forge` middleware; the `forge-gate-first` guardrail enforces this). This slice adds no new routes, but any new client component must be mounted inside an already-gated page/layout.
- **SECURITY DEFINER + `set search_path = ''`** on every new function; **REVOKE … FROM public, anon** then **GRANT EXECUTE … TO authenticated** for any function reachable in a policy; trigger functions revoke from public/anon and grant nothing (they fire via the trigger). Anon-leak guardrail (`__tests__/forge-anon-leak.test.ts`) is the keystone — extend it.
- **Migration numbering:** next is `054`. Filename `supabase/migrations/054_forge_realtime.sql`.
- **`tsconfig` has `strict:false`** → discriminated-union narrowing on `if (r.ok)` is broken; use `r.ok === false`. Only `npm run build` typechecks (Vitest/esbuild does not).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/054_forge_realtime.sql` (create) | `_forge_can_read_topic` helper; two `realtime.messages` policies; `forge_broadcast_change` trigger fn + 4 triggers; grants/revokes. |
| `__tests__/forge-anon-leak.test.ts` (modify) | Add `_forge_can_read_topic` to the anon-cannot-exec probes; add a Realtime section asserting anon (and a member on a foreign topic) cannot join a private `forge:*` channel. |
| `app/forge/lib/realtime.ts` (create) | Pure topic builders `forgeCardTopic`/`forgeSetTopic`; `ensureRealtimeAuth(supabase)`. |
| `app/forge/lib/__tests__/realtime.test.ts` (create) | Unit tests for the topic builders. |
| `app/forge/lib/useForgeRealtime.ts` (create, `"use client"`) | `useForgeRefresh(topic)`; `useForgeCardChannel(topic, me)`; `ForgePresenceMeta` type. |
| `app/forge/cards/[cardId]/PresenceBar.tsx` (create, `"use client"`) | Presentational avatar row + collision banner. |
| `app/forge/cards/[cardId]/StudioEditor.tsx` (modify) | Mount `useForgeCardChannel` when in a set; render `PresenceBar`; toggle `editing` on focus/blur. |
| `app/forge/cards/[cardId]/page.tsx` (modify) | Fetch current member display name; pass `currentUser` + `setId` to `StudioEditor`. |
| `app/forge/sets/[setId]/SetRealtime.tsx` (create, `"use client"`) | Mounts `useForgeRefresh(forgeSetTopic(setId))`; renders nothing. |
| `app/forge/sets/[setId]/layout.tsx` (modify) | Render `<SetRealtime setId={setId} />` so liveness spans all set tabs + the nav badge. |
| `app/forge/sets/[setId]/notes/NotesEditor.tsx` (modify) | Dirty-guarded sync of a refreshed `initial` into the buffer (viewers live, author protected). |

---

## Task 1: Migration 054 — Realtime authorization + broadcast triggers

**Files:**
- Create: `supabase/migrations/054_forge_realtime.sql`

**Interfaces:**
- Consumes (existing helpers): `public._forge_can_read_card(p_card_id uuid)` (053), `public.is_forge_set_elder(p_set_id uuid)` (052), `public.is_forge_superadmin()` (051).
- Produces: `public._forge_can_read_topic(text) → boolean`; `public.forge_broadcast_change()` trigger fn; triggers `forge_sets_broadcast`, `forge_cards_broadcast`, `card_proposals_broadcast`, `card_comments_broadcast`; policies `"forge realtime receive"` / `"forge realtime presence-send"` on `realtime.messages`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/054_forge_realtime.sql`:

```sql
-- 054_forge_realtime.sql
-- Phase 1b.2: Realtime collaboration layer (Broadcast from Database).
-- Live comments/proposals/cards/sets over PRIVATE, per-topic-authorized channels.
-- No change to the supabase_realtime publication or REPLICA IDENTITY:
-- realtime.broadcast_changes() rides Realtime's own internal messaging.

-- 1. Topic read-authorization helper. Mirrors table RLS exactly:
--    forge:card:{uuid} -> _forge_can_read_card ; forge:set:{uuid} -> set-elder/super.
create or replace function public._forge_can_read_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_topic like 'forge:card:%' then
    begin
      v_id := (split_part(p_topic, ':', 3))::uuid;
    exception when others then
      return false;
    end;
    return public._forge_can_read_card(v_id);
  elsif p_topic like 'forge:set:%' then
    begin
      v_id := (split_part(p_topic, ':', 3))::uuid;
    exception when others then
      return false;
    end;
    return public.is_forge_set_elder(v_id) or public.is_forge_superadmin();
  end if;
  return false;
end;
$$;

revoke all on function public._forge_can_read_topic(text) from public;
revoke all on function public._forge_can_read_topic(text) from anon;
grant execute on function public._forge_can_read_topic(text) to authenticated;

-- 2. realtime.messages RLS — the join/receive gate. select = receive broadcasts +
--    others' presence + JOIN; insert = publish own presence. Both reuse the predicate.
drop policy if exists "forge realtime receive" on realtime.messages;
create policy "forge realtime receive"
  on realtime.messages
  for select
  to authenticated
  using ( public._forge_can_read_topic((select realtime.topic())) );

drop policy if exists "forge realtime presence-send" on realtime.messages;
create policy "forge realtime presence-send"
  on realtime.messages
  for insert
  to authenticated
  with check ( public._forge_can_read_topic((select realtime.topic())) );

-- 3. Broadcast-on-write trigger function. Fans out to the card topic and (when the
--    card is in a set) the set topic, so a card page reacts to its card and a set
--    page reacts to its whole set. NEW/OLD chosen by TG_OP (records can't coalesce).
create or replace function public.forge_broadcast_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_set uuid;
begin
  if TG_OP = 'DELETE' then v_row := OLD; else v_row := NEW; end if;

  if TG_TABLE_NAME = 'forge_sets' then
    perform realtime.broadcast_changes(
      'forge:set:' || v_row.id::text,
      'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);

  elsif TG_TABLE_NAME = 'forge_cards' then
    perform realtime.broadcast_changes(
      'forge:card:' || v_row.id::text,
      'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
    if v_row.set_id is not null then
      perform realtime.broadcast_changes(
        'forge:set:' || v_row.set_id::text,
        'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
    end if;

  else  -- card_proposals, card_comments (both carry card_id)
    perform realtime.broadcast_changes(
      'forge:card:' || v_row.card_id::text,
      'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
    select c.set_id into v_set from public.forge_cards c where c.id = v_row.card_id;
    if v_set is not null then
      perform realtime.broadcast_changes(
        'forge:set:' || v_set::text,
        'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
    end if;
  end if;

  return null;  -- AFTER trigger: return value ignored
end;
$$;

revoke all on function public.forge_broadcast_change() from public;
revoke all on function public.forge_broadcast_change() from anon;

drop trigger if exists forge_sets_broadcast on public.forge_sets;
create trigger forge_sets_broadcast
  after insert or update or delete on public.forge_sets
  for each row execute function public.forge_broadcast_change();

drop trigger if exists forge_cards_broadcast on public.forge_cards;
create trigger forge_cards_broadcast
  after insert or update or delete on public.forge_cards
  for each row execute function public.forge_broadcast_change();

drop trigger if exists card_proposals_broadcast on public.card_proposals;
create trigger card_proposals_broadcast
  after insert or update or delete on public.card_proposals
  for each row execute function public.forge_broadcast_change();

drop trigger if exists card_comments_broadcast on public.card_comments;
create trigger card_comments_broadcast
  after insert or update or delete on public.card_comments
  for each row execute function public.forge_broadcast_change();
```

- [ ] **Step 2: Apply the migration** *(sensitive — confirm with the user first; touches `realtime.messages` RLS on the live prod DB)*

Apply via the Supabase MCP (`apply_migration`, name `054_forge_realtime`) or `supabase db push`. **This is an outward-facing, hard-to-reverse change — get explicit go-ahead before applying, per the established Forge migration protocol.**

- [ ] **Step 3: Verify objects exist + advisors clean**

Run (Supabase MCP `execute_sql` or psql):
```sql
select proname from pg_proc where proname in ('_forge_can_read_topic','forge_broadcast_change');
select polname from pg_policies where schemaname='realtime' and tablename='messages' and polname like 'forge realtime%';
select tgname from pg_trigger where tgname like '%_broadcast' and not tgisinternal;
select 1 from pg_proc where proname = 'broadcast_changes' and pronamespace = 'realtime'::regnamespace;  -- precondition
```
Expected: 2 functions, 2 policies, 4 triggers, and `broadcast_changes` present. Then run `get_advisors(type:"security")` → no new findings attributable to 054.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/054_forge_realtime.sql
git commit -m "feat(forge): migration 054 — realtime broadcast triggers + realtime.messages RLS"
```

---

## Task 2: Extend the anon-leak guardrail to Realtime

**Files:**
- Modify: `__tests__/forge-anon-leak.test.ts`

**Interfaces:**
- Consumes: the live Supabase env (`FORGE_LEAK_TEST=1`), the helper `_forge_can_read_topic`, and (for the per-topic member probe) the existing `ISO_ENABLED` seeded foreign card.
- Produces: new assertions only.

- [ ] **Step 1: Add the new RPC to the anon-cannot-exec list**

In the `FORGE_RPCS` array, add one entry (place it after the `_forge_is_card_field` line):
```ts
    ["_forge_can_read_topic", { p_topic: "forge:card:00000000-0000-0000-0000-000000000000" }],
```

- [ ] **Step 2: Add a Realtime join-rejection helper + anon test**

Inside the `describe.runIf(ENABLED)` block (after the RPC loop, before the member-isolation `describe`), add:
```ts
  // Realtime: a non-member (anon) must not be able to JOIN a private forge topic.
  // A successful join is the only way to receive broadcasts/presence, so a rejected
  // join (CHANNEL_ERROR / timeout, never SUBSCRIBED) proves the channel can't leak.
  function joinStatus(
    client: ReturnType<typeof createClient>,
    topic: string,
    timeoutMs = 8000
  ): Promise<string> {
    return new Promise((resolve) => {
      const ch = client.channel(topic, { config: { private: true } });
      const done = (status: string) => {
        clearTimeout(timer);
        client.removeChannel(ch);
        resolve(status);
      };
      const timer = setTimeout(() => done("TIMEOUT"), timeoutMs);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "CLOSED") {
          done(status);
        }
      });
    });
  }

  it("anon cannot join a private forge card channel", async () => {
    const client = createClient(URL!, ANON!);
    const status = await joinStatus(client, "forge:card:00000000-0000-0000-0000-000000000000");
    expect(status, `anon joined a forge channel (status: ${status})`).not.toBe("SUBSCRIBED");
  });

  it("anon cannot join a private forge set channel", async () => {
    const client = createClient(URL!, ANON!);
    const status = await joinStatus(client, "forge:set:00000000-0000-0000-0000-000000000000");
    expect(status, `anon joined a forge channel (status: ${status})`).not.toBe("SUBSCRIBED");
  });
```

- [ ] **Step 3: Add a per-topic member-boundary probe inside the `ISO_ENABLED` block**

The isolation block already seeds a foreign-owned card (`foreignId`) and signs in the test member. Inside its `try` (after the existing `forge_cards` row assertion), add a Realtime check that the signed-in member — who can't *read* that card — also can't *join* its topic:
```ts
        // ...and cannot join that card's realtime topic (per-topic authz = table RLS).
        await member.realtime.setAuth(
          (await member.auth.getSession()).data.session!.access_token
        );
        const rtStatus = await joinStatus(member, `forge:card:${foreignId}`);
        expect(rtStatus, `member joined a foreign card's channel (status: ${rtStatus})`).not.toBe("SUBSCRIBED");
```
(`joinStatus` is in the enclosing `ENABLED` describe scope, so it is in scope here.)

- [ ] **Step 4: Run the security suite**

Run: `FORGE_LEAK_TEST=1 npm run test:security`
Expected: all Forge anon-leak tests pass, including the new `_forge_can_read_topic` probe and the two anon channel-join tests (status `CHANNEL_ERROR`/`TIMEOUT`, never `SUBSCRIBED`). If `FORGE_TEST_*` env is present, the member per-topic probe also passes.

- [ ] **Step 5: Commit**

```bash
git add __tests__/forge-anon-leak.test.ts
git commit -m "test(forge): extend anon-leak guardrail to realtime channel joins + _forge_can_read_topic"
```

---

## Task 3: `realtime.ts` — topic builders + auth helper (TDD)

**Files:**
- Create: `app/forge/lib/realtime.ts`
- Test: `app/forge/lib/__tests__/realtime.test.ts`

**Interfaces:**
- Produces: `forgeCardTopic(cardId: string): string`; `forgeSetTopic(setId: string): string`; `ensureRealtimeAuth(supabase): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `app/forge/lib/__tests__/realtime.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { forgeCardTopic, forgeSetTopic } from "@/app/forge/lib/realtime";

describe("forge realtime topics", () => {
  it("builds a card topic with no sub-suffix", () => {
    expect(forgeCardTopic("abc-123")).toBe("forge:card:abc-123");
  });
  it("builds a set topic with no sub-suffix", () => {
    expect(forgeSetTopic("set-9")).toBe("forge:set:set-9");
  });
  it("topics have exactly 3 colon-separated parts (RLS parses split_part(.,3))", () => {
    expect(forgeCardTopic("u").split(":").length).toBe(3);
    expect(forgeSetTopic("u").split(":").length).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/forge/lib/__tests__/realtime.test.ts`
Expected: FAIL — cannot resolve `@/app/forge/lib/realtime`.

- [ ] **Step 3: Implement `realtime.ts`**

Create `app/forge/lib/realtime.ts`:
```ts
// Client-side Forge Realtime helpers. Imported only by client components.
// Topic builders are the SINGLE SOURCE OF TRUTH for the topic format and must
// match supabase/migrations/054 byte-for-byte (no sub-suffixes: the realtime.messages
// RLS predicate parses split_part(topic, ':', 3)::uuid).
import type { SupabaseClient } from "@supabase/supabase-js";

export const forgeCardTopic = (cardId: string) => `forge:card:${cardId}`;
export const forgeSetTopic = (setId: string) => `forge:set:${setId}`;

// Private channels require the member JWT on the socket before join.
export async function ensureRealtimeAuth(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) await supabase.realtime.setAuth(token);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/forge/lib/__tests__/realtime.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/realtime.ts app/forge/lib/__tests__/realtime.test.ts
git commit -m "feat(forge): realtime topic builders + ensureRealtimeAuth (TDD)"
```

---

## Task 4: `useForgeRealtime.ts` — refresh + card-channel hooks

**Files:**
- Create: `app/forge/lib/useForgeRealtime.ts`

**Interfaces:**
- Consumes: `createClient` (`@/utils/supabase/client`), `forge` topic via the caller, `ensureRealtimeAuth` (Task 3).
- Produces: `type ForgePresenceMeta = { userId: string; displayName: string | null; editing: boolean }`; `useForgeRefresh(topic: string | null): void`; `useForgeCardChannel(topic: string | null, me: ForgePresenceMeta): { others: ForgePresenceMeta[]; setEditing: (v: boolean) => void }`.

- [ ] **Step 1: Implement the hooks**

Create `app/forge/lib/useForgeRealtime.ts`:
```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { ensureRealtimeAuth } from "@/app/forge/lib/realtime";

export type ForgePresenceMeta = {
  userId: string;
  displayName: string | null;
  editing: boolean;
};

// Debounced router.refresh() on every 'change' broadcast for `topic`.
// A no-op when topic is null (e.g. a setless private card).
export function useForgeRefresh(topic: string | null): void {
  const router = useRouter();
  useEffect(() => {
    if (!topic) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ping = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    (async () => {
      await ensureRealtimeAuth(supabase);
      if (cancelled) return;
      channel = supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "change" }, ping)
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [topic, router]);
}

// One card channel: presence (who's here / editing) + 'change' -> debounced refresh.
// `setEditing` re-tracks the local member's presence so others see the collision state.
export function useForgeCardChannel(
  topic: string | null,
  me: ForgePresenceMeta,
): { others: ForgePresenceMeta[]; setEditing: (v: boolean) => void } {
  const router = useRouter();
  const [others, setOthers] = useState<ForgePresenceMeta[]>([]);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const editingRef = useRef<boolean>(me.editing);

  // Depend on primitive fields, not the `me` object identity (which changes each render).
  const { userId, displayName } = me;

  useEffect(() => {
    if (!topic) return;
    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ping = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    (async () => {
      await ensureRealtimeAuth(supabase);
      if (cancelled) return;
      const ch = supabase.channel(topic, {
        config: { private: true, presence: { key: userId } },
      });
      ch.on("broadcast", { event: "change" }, ping);
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState() as Record<string, ForgePresenceMeta[]>;
        const list = Object.entries(state)
          .filter(([key]) => key !== userId)
          .flatMap(([, metas]) => metas);
        setOthers(list);
      });
      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ userId, displayName, editing: editingRef.current });
        }
      });
      channelRef.current = ch;
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [topic, userId, displayName, router]);

  const setEditing = useCallback(
    (v: boolean) => {
      editingRef.current = v;
      const ch = channelRef.current;
      if (ch) void ch.track({ userId, displayName, editing: v });
    },
    [userId, displayName],
  );

  return { others, setEditing };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "useForgeRealtime" || echo "no type errors in useForgeRealtime"`
Expected: `no type errors in useForgeRealtime`. (If the project has no standalone tsc script, defer the full check to Task 7's `npm run build`.)

- [ ] **Step 3: Commit**

```bash
git add app/forge/lib/useForgeRealtime.ts
git commit -m "feat(forge): useForgeRefresh + useForgeCardChannel realtime hooks"
```

---

## Task 5: Card presence + collision banner

**Files:**
- Create: `app/forge/cards/[cardId]/PresenceBar.tsx`
- Modify: `app/forge/cards/[cardId]/StudioEditor.tsx`
- Modify: `app/forge/cards/[cardId]/page.tsx`

**Interfaces:**
- Consumes: `useForgeCardChannel` + `ForgePresenceMeta` (Task 4), `forgeCardTopic` (Task 3).
- Produces: `<PresenceBar others={ForgePresenceMeta[]} />`; `StudioEditor` gains props `currentUser: { userId: string; displayName: string | null }` and `setId: string | null`.

- [ ] **Step 1: Create `PresenceBar.tsx`**

Create `app/forge/cards/[cardId]/PresenceBar.tsx`:
```tsx
"use client";

import type { ForgePresenceMeta } from "@/app/forge/lib/useForgeRealtime";

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function PresenceBar({ others }: { others: ForgePresenceMeta[] }) {
  if (others.length === 0) return null;
  // Dedupe by userId (a member may have two tabs open).
  const seen = new Map<string, ForgePresenceMeta>();
  for (const o of others) seen.set(o.userId, o);
  const people = [...seen.values()];
  const editing = people.filter((p) => p.editing);
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {people.map((p) => (
            <span
              key={p.userId}
              title={p.displayName ?? "Member"}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-background bg-muted text-[10px] font-medium text-muted-foreground"
            >
              {initials(p.displayName)}
            </span>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {people.length === 1 ? "1 other person here" : `${people.length} others here`}
        </span>
      </div>
      {editing.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {editing.map((p) => p.displayName ?? "Someone").join(", ")}{" "}
          {editing.length === 1 ? "is" : "are"} also editing this card — changes use last-write-wins.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `StudioEditor.tsx`**

Read the file first. Make these changes:
1. Add imports near the top:
```tsx
import { forgeCardTopic } from "@/app/forge/lib/realtime";
import { useForgeCardChannel } from "@/app/forge/lib/useForgeRealtime";
import PresenceBar from "./PresenceBar";
```
2. Change the component signature to accept the new props:
```tsx
export default function StudioEditor({
  card,
  sets,
  currentUser,
  setId,
}: {
  card: ForgeCardFull;
  sets: ForgeSetSummary[];
  currentUser: { userId: string; displayName: string | null };
  setId: string | null;
}) {
```
3. Inside the component body (after the existing `useState` for `snapshot`), add the channel hook — gated on the card being in a set:
```tsx
  const { others, setEditing } = useForgeCardChannel(
    setId ? forgeCardTopic(card.id) : null,
    { userId: currentUser.userId, displayName: currentUser.displayName, editing: false },
  );
```
4. Render `<PresenceBar others={others} />` at the top of the editor's returned markup (above the form/preview wrapper).
5. Mark the user as editing while the editor has focus. On the outermost wrapping element of the editor's form region, add:
```tsx
  onFocusCapture={() => setEditing(true)}
  onBlurCapture={() => setEditing(false)}
```
(If the editor root is a fragment, wrap the form column in a `<div>` carrying these handlers — do not put them on the live-preview column.)

- [ ] **Step 3: Pass `currentUser` + `setId` from `page.tsx`**

Read `app/forge/cards/[cardId]/page.tsx`. After `requireForge()` yields `ctx`, fetch the member display name (mirror the progress page pattern) and pass the new props to `StudioEditor`:
```tsx
  const { data: meRow } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .single();
  const currentUser = { userId: ctx.user.id, displayName: meRow?.display_name ?? null };
```
Then update the `<StudioEditor .../>` usage to add:
```tsx
      currentUser={currentUser}
      setId={card.setId ?? null}
```
(Use whatever the existing `ForgeCardFull` field for the set is — confirm it's `setId`; if the type exposes `set_id`, use that. If `card` has no set field, derive `setId` from the same query the page already runs.)

- [ ] **Step 4: Build to verify wiring typechecks**

Run: `npm run build`
Expected: compiles clean (no type errors in `StudioEditor`, `PresenceBar`, `page.tsx`). Resolve any `r.ok` narrowing or prop-type mismatches (`strict:false` — see Global Constraints).

- [ ] **Step 5: Commit**

```bash
git add app/forge/cards/[cardId]/PresenceBar.tsx app/forge/cards/[cardId]/StudioEditor.tsx app/forge/cards/[cardId]/page.tsx
git commit -m "feat(forge): card presence avatars + soft collision warning (live)"
```

---

## Task 6: Set-level liveness (review badges, notes, progress)

**Files:**
- Create: `app/forge/sets/[setId]/SetRealtime.tsx`
- Modify: `app/forge/sets/[setId]/layout.tsx`
- Modify: `app/forge/sets/[setId]/notes/NotesEditor.tsx`

**Interfaces:**
- Consumes: `useForgeRefresh` (Task 4), `forgeSetTopic` (Task 3).
- Produces: `<SetRealtime setId={string} />` (renders null).

- [ ] **Step 1: Create `SetRealtime.tsx`**

Create `app/forge/sets/[setId]/SetRealtime.tsx`:
```tsx
"use client";

import { useForgeRefresh } from "@/app/forge/lib/useForgeRealtime";
import { forgeSetTopic } from "@/app/forge/lib/realtime";

// Mounted in the set layout: one subscription drives live review badges (nav tab),
// notes, and progress across every set tab via debounced router.refresh().
export default function SetRealtime({ setId }: { setId: string }) {
  useForgeRefresh(forgeSetTopic(setId));
  return null;
}
```

- [ ] **Step 2: Mount it in the set layout**

Read `app/forge/sets/[setId]/layout.tsx`. It already gates via `requireForge()` + `getSet(setId)` and renders the set nav + `children`. Import and render `<SetRealtime />` once, inside the gated return (the `setId` is already available from `params`):
```tsx
import SetRealtime from "./SetRealtime";
// ...inside the returned JSX, e.g. just before {children}:
      <SetRealtime setId={setId} />
```
(If `setId` is only available as `(await params).setId`, use that local.)

- [ ] **Step 3: Dirty-guarded prop sync in `NotesEditor.tsx`**

So a viewer sees live note updates after a refresh while an active author's buffer is never clobbered, add a guarded sync of `initial → notes`. Insert after the existing autosave `useEffect` (and add `lastServer` ref next to the other refs):
```tsx
  const lastServer = useRef(initial);
  useEffect(() => {
    if (initial === lastServer.current) return;     // our own save / no remote change
    const wasDirty = notes !== lastServer.current;   // local edits not yet reflected
    lastServer.current = initial;
    if (!wasDirty) setNotes(initial);                // safe to adopt the remote value
  }, [initial, notes]);
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean compile across `SetRealtime`, `layout.tsx`, `NotesEditor.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/forge/sets/[setId]/SetRealtime.tsx app/forge/sets/[setId]/layout.tsx app/forge/sets/[setId]/notes/NotesEditor.tsx
git commit -m "feat(forge): live set review badges, notes, and progress via set channel"
```

---

## Task 7: Whole-branch verification, memory, PR

**Files:** none (verification + docs).

- [ ] **Step 1: Full test + build gates**

Run and confirm:
- `npm test` → green except the one known pre-existing unrelated `store-route` failure (record the exact pass count).
- `npm run build` → clean.
- `FORGE_LEAK_TEST=1 npm run test:security` → all Forge anon-leak tests pass, including the new realtime join-rejection tests.
- Supabase `get_advisors(type:"security")` → no new findings from 054.
- `npx vitest run app/forge/lib/__tests__/realtime.test.ts` and the forge gate-first guardrail → green.

- [ ] **Step 2: Manual signed-in smoke (two browser sessions)** — record results in the PR

1. Two tabs on the same set card (`/forge/cards/[id]` where the card is in a set): each shows the other's presence avatar; typing in one shows the amber "also editing" banner in the other.
2. Post a comment / suggestion in tab A → it appears in tab B without reload.
3. Create/accept/deny a proposal in A → B's review panel + the set review-queue badge update.
4. Edit set notes in A → a viewer in B sees the update; an actively-typing author in B is **not** clobbered.
5. Change a card's status/brigade in A → B's progress dashboard updates.
6. Confirm a **setless** private idea card (`/forge/ideas` → open one) still loads and autosaves with no console errors (realtime is correctly skipped).

- [ ] **Step 3: Update the project memory**

Append a `1b.2` status entry to `project_forge_playtesting.md` (and keep the `MEMORY.md` pointer accurate): branch, migration 054 applied, broadcast-from-DB decision + why (over postgres_changes), the `_forge_can_read_topic` per-topic authz, the uniform `router.refresh()` consumption model, leak-test extension, and any logged non-blocking follow-ups.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin forge-phase-1b-2-realtime
gh pr create --title "The Forge — Phase 1b.2: Realtime Collaboration Layer" --body "<summary + the manual-smoke checklist results + 'migration 054 applied to prod'>"
```

---

## Self-review (completed during planning)

- **Spec coverage:** live comments/proposals (Task 5 page refresh + Task 6 nothing extra — card channel in Task 5), presence + collision (Task 5), live review badges (Task 6), live notes (Task 6), live progress (Task 6), private per-topic authz + triggers (Task 1), leak-test extension (Task 2), topic builders/hooks (Tasks 3–4). All spec sections map to a task.
- **Placeholders:** none — every step carries real SQL/TS or an exact edit + command.
- **Type consistency:** `ForgePresenceMeta` defined in Task 4, consumed identically in Tasks 4–5; topic builders defined in Task 3, consumed in Tasks 4–6; `forge_broadcast_change`/`_forge_can_read_topic` names consistent between Task 1 SQL and Task 2 probe. Trigger event name `'change'` matches the client `.on('broadcast', { event: 'change' })` in Task 4.
- **Known soft spots flagged for the implementer:** exact `ForgeCardFull` set-field name (Task 5 Step 3) and the editor's focusable root element (Task 5 Step 2) must be confirmed against the real files; the `tsc --noEmit` availability (Task 4 Step 2) falls back to `npm run build`.
