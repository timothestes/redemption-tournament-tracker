# Release resolves open proposals — design

Written 2026-07-27. Fixes the friction where "Propose changes" followed by
"Release update" leaves a proposal that can never be accepted, and greets the
elder with "This proposal is out of date — please re-propose."

Background reading: `prompt_context/forge_versioning.md`.

## The friction

A card has one working draft. Two separate controls both mint a version row
from it:

- **Propose changes** freezes `forge_cards.working_snapshot` into
  `card_proposals` with `base_version_id` = the card's latest version row
  (`forge_create_proposal`, migration 075). An elder later accepts, which mints
  the version.
- **Release update** mints a version directly from `working_snapshot`
  (`forge_publish_card`, migration 072) and touches nothing about open
  proposals.

So Propose-then-Release leaves the proposal with a stale base. Three things go
wrong, in this order:

1. **The badge lies.** The proposal stays `status='open'`, so the corner icon on
   the set grid (`listOpenProposalCounts`) keeps advertising a review that can
   never happen.
2. **The error fires late and reads like data loss.** Only on clicking Accept
   does `forge_accept_proposal` notice `base_version_id <> latest`, close the
   proposal as `superseded`, and return null — surfacing as "This proposal is
   out of date — please re-propose." Nothing is actually broken (the content
   *was* released), but the wording says otherwise.
3. **The "why" is orphaned.** The proposal summary — often the only written
   record of the reasoning — ends up on a `superseded` row instead of attached
   to the version that shipped.

## What this changes

`forge_publish_card` resolves open proposals in the same transaction that mints
the version, so the two doors stop colliding. The Release dialog says what will
happen before you commit to it.

### 1. Release resolves open proposals (migration 083)

After the version insert, inside `forge_publish_card`:

- **The matching proposal** — the oldest open proposal whose
  `proposed_snapshot` equals the released `working_snapshot` — closes as
  `accepted`, with `resulting_version_id` = the new version and
  `closed_by = auth.uid()`. History then renders "Accepted → vN" with the
  proposal's summary, beside the release note. This is the reported case, and
  it now produces no error at all.
- **Every other open proposal** closes as `superseded` with `closed_at` and
  `closed_by` set, and `resulting_version_id` left null. The badge clears at
  release time rather than lying until someone clicks Accept.

Ordering matters: accept the match first, then sweep the rest excluding it.
This mirrors the sibling sweep `forge_accept_proposal` already performs
(075:80-82, 075:106-108), and the transaction-stable `now()` shared by both
updates is what lets `deriveSupersededBy` attribute the sweep to the accepted
proposal.

**Only one proposal may be accepted per release.** Two `accepted` rows pointing
at one version would render as two "Accepted → vN" entries in History. If
several open proposals match, the oldest by `created_at` wins and the rest are
superseded.

**Snapshot equality is jsonb `=`.** Postgres normalizes `jsonb`, so key order
and numeric form do not matter. A `::text` comparison would spuriously miss the
common case.

**The accept branch is gated on elder/superadmin.** `forge_publish_card` admits
the card owner as well (072:26-29), while accepting is elder-only (075:39-42).
A non-elder owner releasing supersedes every open proposal and accepts none, so
`accepted` keeps meaning *an elder decided*. Reaching that path requires
calling the RPC directly — `publish()` in `app/forge/lib/lifecycle.ts` is
already behind `requireElder()`.

No signature change, so `CREATE OR REPLACE` preserves existing grants.

### 2. The Release dialog says what will happen

`app/forge/cards/[cardId]/page.tsx` already loads `openDiffs`; it passes the
open proposals to `StudioEditor` → `LifecycleControls`, which classifies them
against `card.snapshot` (the working draft) and renders one line in the release
dialog above the note field:

- a proposal matches → "1 open proposal will be recorded as accepted by this
  release. Its summary is kept in the card's history."
- none matches → "1 open proposal will be closed as out of date. Review it
  first if you still want it."
- both → both lines.

Classification uses a new `sameSnapshot(a, b)` helper in
`app/forge/lib/cardDiff.ts`: a sorted-key canonical compare that mirrors SQL
jsonb equality. It exists only to choose dialog wording — behavior is decided
server-side — so drift can misword the dialog but can never change what the
release does.

`sameSnapshot` is deliberately NOT `diffCards(a, b).length === 0`.
`DIFF_FIELDS` omits `specialAbility`, `legality`, `rarity`, `artistCredit` and
`cardFrame`, so a diff-based comparison would call two genuinely different
snapshots equal.

### 3. Honest copy on the residual race

After (1), a stale base is only reachable when someone releases the card while
another elder has the review open. `acceptProposal` in
`app/forge/lib/proposals.ts` stops saying "please re-propose" and says what
happened: "A newer version was released while this was open, so this proposal
was closed. Re-propose from the current draft if the change is still needed."

## What this deliberately does not change

- **The stale-base guard in `forge_accept_proposal` stays.** It is now a
  backstop for the concurrent-release race rather than the routine path.
- **No re-basing of stale proposals.** Re-basing was considered and rejected.
  A proposal is not a branch: `createProposal` freezes the *shared*
  `working_snapshot`, and everyone who can propose can also write it, so a
  non-matching open proposal is almost always an earlier point on the same
  timeline, not a competing idea. Re-basing would make "Accept" a one-click
  rollback of the release that just happened. Its only justification — that the
  recomputed diff shows the elder what they are applying — is false, because
  Accept writes the whole snapshot while the diff renders only `DIFF_FIELDS`.
- **`historyView.ts` and `CardHistory.tsx` are untouched.** Both cases already
  render correctly: an accepted match shows "Accepted → vN", and a superseded
  proposal with no accepted sibling shows "Out of date — a direct release
  replaced the version it was based on" (`CardHistory.tsx:82-84`).
- **The authorization asymmetry between `forge_publish_card` (owner allowed)
  and `forge_accept_proposal` (elder only) is left alone**, beyond the gate in
  (1). Tightening the release gate is a separate decision.

## Known gap, not fixed here

If elder X proposes and elder Y then reshapes the shared draft and releases,
X's proposal closes as superseded with no deny reason and no review. Its
`proposed_snapshot` survives on the row forever, but nothing in the UI can
restore it. Re-basing would not fix this either — accepting the rebased
proposal would clobber Y's release. The real fix is a "load this proposal into
the working draft" action on closed proposals, which is separate work.

## Testing

- `app/forge/lib/__tests__/cardDiff.test.ts` — `sameSnapshot`: key order and
  nesting ignored; a change confined to a non-`DIFF_FIELDS` key (e.g.
  `rarity`) reports NOT equal, where `diffCards` reports no changes.
- `app/forge/lib/__tests__/lifecycleCopy.test.ts` — the release-dialog warning
  builder, over: no open proposals (no line), one matching, one non-matching,
  and both.
- Migration 083 is exercised manually against the Forge on a preview
  deployment: propose → release → confirm History shows "Accepted → vN" with
  the summary, the grid badge is gone, and no error appears.
