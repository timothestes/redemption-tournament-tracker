import { FormatId, normalizeTournamentFormat } from "../../lib/formats";
import { categoryDefaults, requireDecklistsDefault } from "./categoryDefaults";
import { buildTournamentName, isNameFrozen } from "./naming";

// An event's "type" is two orthogonal things: its sanctioning tier (Regional,
// State, …) and its category/format (Type 2, Paragon, …). Changing either
// cascades into the frozen name; changing the category also cascades into the
// settings derived from it. One rule governs that cascade: derived values the
// host never overrode follow the new category; anything the host changed stays
// put. Kept pure so the Settings preview and the persisted patch are computed
// by the same code and can't disagree.

export interface EventTypeCurrent {
  name: string;
  tier: string | null;
  category: string | null;
  deck_format: string | null;
  max_score: number | null;
  round_length: number | null;
  require_decklists: boolean | null;
  created_at: string;
}

export interface EventTypeNext {
  tier: string | null;
  category: string;
  /** Read only when category is "Unofficial" — the one case with no category to derive a format from. */
  unofficialFormat?: FormatId | "Other";
}

export interface EventTypePlan {
  tier: string | null;
  category: string;
  deck_format: FormatId | "Other";
  name?: string;
  max_score?: number;
  round_length?: number;
  require_decklists?: boolean;
}

// "{Mon D, YYYY} {subject} Tournament[ — {City}]" — the frozen form from
// buildTournamentName, where subject is the tier and category together. Only
// the date and city are read back out; tier and category come from columns, so
// there's no need to disambiguate them inside the subject.
//
// Capturing the date rather than reformatting it matters: created_at is UTC
// while the stored name was generated in the host's timezone (created_at
// 2026-07-29T01:15Z on an event named "Jul 28, 2026 …"), so reformatting would
// shift the date by a day.
const FROZEN_NAME_RE = /^(.+?, \d{4}) (.+) Tournament(?: — (.+))?$/;

export function renameForEventType(
  currentName: string,
  next: { tier: string | null; category: string },
  createdAt: string
): string {
  const subject = [next.tier, next.category].filter(Boolean).join(" ");
  const m = currentName.match(FROZEN_NAME_RE);
  if (m) {
    const [, date, , city] = m;
    return `${date} ${subject} Tournament${city ? ` — ${city}` : ""}`;
  }
  // Free-form name (an Unofficial event being promoted to an official
  // category). Rebuild from the creation date, keeping any city suffix.
  const city = currentName.includes(" — ")
    ? currentName.split(" — ").slice(1).join(" — ")
    : undefined;
  return buildTournamentName(next.category, {
    date: new Date(createdAt),
    city,
    tier: next.tier,
  });
}

export function planEventTypeChange(
  current: EventTypeCurrent,
  next: EventTypeNext,
  opts: { maxScoreLocked: boolean }
): EventTypePlan {
  const nextDefaults = categoryDefaults(next.category);
  // A tournament created before categories existed has no old defaults to
  // compare against, so nothing counts as "still at the default" and no
  // derived field gets re-seeded.
  const oldDefaults = current.category ? categoryDefaults(current.category) : null;

  // Format is derived from the category everywhere except Unofficial. Omitting
  // the format there keeps whatever was already in force rather than resetting
  // to "Other" and silently disabling the decklist requirement.
  const deckFormat: FormatId | "Other" =
    next.category === "Unofficial"
      ? next.unofficialFormat ?? normalizeTournamentFormat(current.deck_format) ?? "Other"
      : nextDefaults.deck_format;

  const plan: EventTypePlan = {
    tier: next.tier,
    category: next.category,
    deck_format: deckFormat,
  };

  // Only official categories have a frozen name to regenerate — an Unofficial
  // event's name is the host's own, tier change or not.
  if (isNameFrozen(next.category)) {
    const name = renameForEventType(current.name, next, current.created_at);
    if (name !== current.name) plan.name = name;
  }

  if (
    oldDefaults &&
    !opts.maxScoreLocked &&
    current.max_score === oldDefaults.max_score &&
    nextDefaults.max_score !== current.max_score
  ) {
    plan.max_score = nextDefaults.max_score;
  }

  if (
    oldDefaults &&
    current.round_length === oldDefaults.round_length &&
    nextDefaults.round_length !== current.round_length
  ) {
    plan.round_length = nextDefaults.round_length;
  }

  const wasRequired = current.require_decklists === true;
  let requireDecklists = wasRequired;
  if (oldDefaults && wasRequired === requireDecklistsDefault(current.category)) {
    requireDecklists = requireDecklistsDefault(next.category);
  }
  // Hard invariant, overriding the re-seed rule: an event with no specific
  // format cannot require decklists — every player would be bounced with
  // `decklist_required` (app/join/actions.ts), making the event unjoinable.
  // The rule alone doesn't prevent this: a host who turns the toggle on for
  // Type A (default off) and then switches to Booster Draft keeps it on.
  if (deckFormat === "Other") requireDecklists = false;
  if (requireDecklists !== wasRequired) plan.require_decklists = requireDecklists;

  return plan;
}
