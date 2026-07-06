# Forge nav entry (under the Admin dropdown)

**Date:** 2026-07-05
**Status:** Approved design, ready for planning

## Problem

The Forge (`/forge`) is a hidden, invite-only area. Everything under it calls
`requireForge()` and returns a hard `404` to non-members, so the area is
invisible by design. The side effect: a Forge member browsing the normal side of
the app has **no way to navigate to the Forge** — they must type the URL by hand.

We want a member-only entry point that adds **zero clutter** to the top nav.

## Decision

Put a "The Forge" link **inside the existing top-nav "Admin" dropdown**, rendered
only for Forge members. No new top-level nav item.

Rejected alternatives (deferred, not needed now):
- A dedicated top-level "Forge" nav item — most discoverable, but adds nav clutter.
- An account/user-cluster menu — requires building an account dropdown that
  doesn't exist today.
- Contextual entry from Deck Builder / Play — no persistent global entry.

## Key constraint: Forge membership ≠ app admin

Forge roles live in their own `playtest_members` table, deliberately **not**
overloading `admin_users` (per the original Forge spec). The two are independent
axes — a person can be an app admin, a Forge member, both, or neither. A trusted
card playtester or elder may have **no** app-admin powers.

Today the Admin dropdown renders only when `useIsAdmin()` is true. If we simply
dropped the link inside it, Forge members who aren't app admins would never see
the dropdown at all. So the dropdown's render condition must widen.

## Design

### 1. Membership detection

Extend [`AdminProvider`](../../../components/providers/AdminProvider.tsx) to also
call the existing `my_forge_role` RPC inside its `checkAdminStatus` effect, and
add `isForgeMember: boolean` to `AdminState` / the context.

- `my_forge_role` returns the caller's own Forge role (`superadmin` | `elder` |
  `playtester`) or null, enforced by RLS. `isForgeMember = role is one of those`.
- Fetched in the same pass as the admin checks, so it resolves atomically with
  the rest of the nav — no flash-in of the link.
- **Fail-closed**: any RPC error or null role → `isForgeMember: false`.
- `useIsAdmin()` already surfaces the whole context, so consumers read
  `isForgeMember` from the same hook. No new provider or hook.

### 2. Dropdown trigger

In [`top-nav.tsx`](../../../components/top-nav.tsx), change the Admin dropdown's
render condition from `isAdmin` to `isAdmin || isForgeMember`, in **both** the
desktop dropdown and the mobile Admin section.

The dropdown label stays **"Admin"** for everyone — including Forge-only members
who see only "The Forge" inside it. (Two independent reviewers chose this over a
dynamic per-user label: a second nav vocabulary that exists nowhere else adds
branching logic and fragments the nav to fix a nitpick a member resolves in one
click. If the wording ever draws a real complaint, relabeling later is a trivial
follow-up.)

### 3. The Forge link

Inside the dropdown, **below** the existing admin links, gated on
`isForgeMember`:
- A divider (matching the existing dropdown divider style).
- A "The Forge" link with an anvil icon (`GiAnvil` from `react-icons/gi`) →
  `/forge`.
- Added to **both** the desktop dropdown and the mobile Admin section, following
  the existing link markup/styles in each.

The admin links themselves stay gated on their existing `permissions`/`isAdmin`
checks — unchanged. An admin who is not a Forge member sees no Forge link; a
Forge member who is not an admin sees only the Forge link.

### 4. Safety

Nothing here touches card data:
- `my_forge_role` returns only the caller's own role under RLS — no set/card data.
- `/forge` still hard-404s for non-members regardless of what the nav renders, so
  a stale or mis-shown link cannot leak anything.
- Logged-out users: no RPC identity, `isForgeMember` false, no change to the nav.

## Non-goals

- No new top-level nav item.
- No account menu.
- No change to Forge role semantics, RPCs, or RLS.
- Ideas B (account menu) and C (contextual Deck Builder / Play entry) stay
  deferred.

## Verification

- Forge member who is **not** an app admin: Admin dropdown appears (labeled
  "Admin"), contains only "The Forge" → `/forge`.
- App admin who is **not** a Forge member: dropdown unchanged, no Forge link.
- User who is **both**: dropdown shows admin links + divider + The Forge.
- Non-member / logged-out: no Forge link; dropdown behaves exactly as today.
- Desktop and mobile both covered.
