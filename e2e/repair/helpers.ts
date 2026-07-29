import { expect, type Locator, type Page } from "@playwright/test";

// Selectors for the host result-editing flow, in one place.
//
// These specs were committed in #106 — the same PR that renamed the whole
// feature from "Repair" to "Edit" — so they shipped pointing at copy that had
// already changed and have never passed. Centralizing the selectors here means
// the next rename is a one-file fix instead of eight.
//
// Current copy (components/ui/match-edit.tsx,
// components/ui/RepairPastResultPicker.tsx,
// components/ui/RegeneratePairingsButton.tsx,
// components/ui/UnlockAndRepairDialog.tsx,
// app/tracker/tournaments/[id]/page.tsx):
//
//   pencil aria-label ......... "Edit result for {p1} vs {p2}"  (repair mode)
//                               "Edit score: {p1} vs {p2}"      (live round)
//   dialog heading ............ "Edit result" / "Edit Match"
//   reason placeholder ........ "Why are you editing this?"
//   submit .................... "Save" / "Update"
//   success toast ............. "Match updated."
//   host menu trigger ......... aria-label "Admin actions" (wrench)
//   host menu items ........... "Regenerate pairings", "Unlock & regenerate…",
//                               "Edit a past result", "End tournament"
//   picker heading ............ "Edit a past result", search "Player name"
//   regenerate confirm ........ "Regenerate pairings for Round {n}?" / "Regenerate"
//   unlock confirm ............ "Unlock & regenerate?" / "Unlock and regenerate"

/* ------------------------------------------------------------------ copy */

export const ADMIN_MENU_TRIGGER = /^admin actions$/i;
export const MENU_REGENERATE_PAIRINGS = /^regenerate pairings$/i;
export const MENU_UNLOCK_AND_REGENERATE = /^unlock & regenerate/i;
export const MENU_EDIT_PAST_RESULT = /^edit a past result$/i;

export const EDIT_DIALOG_HEADING = /^edit result$/i;
export const EDIT_SUCCESS_TOAST = "Match updated.";
export const REASON_PLACEHOLDER = /why are you editing this/i;
export const EDIT_HISTORY = /edit history/i;

export const PICKER_HEADING = /^edit a past result$/i;
export const PICKER_SEARCH_PLACEHOLDER = /player name/i;

export const REGENERATE_CONFIRM_CHECKBOX = /i confirm no players have started/i;
export const REGENERATE_CONFIRM_BUTTON = /^regenerate$/i;

export const UNLOCK_DIALOG_HEADING = /^unlock & regenerate\?$/i;
export const UNLOCK_CONFIRM_CHECKBOX =
  /i confirm these results will be permanently deleted/i;
export const UNLOCK_CONFIRM_BUTTON = /^unlock and regenerate$/i;

/**
 * A cold `next dev` route compile plus the tournament page's chain of
 * client-side fetches routinely runs past the 10s default expect timeout on the
 * first assertion of a spec. Everything that waits for the page to *arrive*
 * uses this; assertions about behaviour keep the default so a real regression
 * still fails fast.
 */
export const PAGE_READY_TIMEOUT = 60_000;

/* -------------------------------------------------------------- navigation */

/**
 * `page.goto` that survives the Next App Router.
 *
 * A client-side navigation that is still landing — the sign-in server-action
 * redirect, or a `router.refresh()` after a mutation — aborts an overlapping
 * `goto` with "interrupted by another navigation". That is an artefact of
 * driving an SPA router from outside, not a product failure and not something
 * the page can be asked about, so wait for the interloper and try again.
 */
export async function navigate(page: Page, url: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url);
      return;
    } catch (err) {
      const interrupted = /interrupted by another navigation/i.test(String(err));
      if (!interrupted || attempt >= 3) throw err;
      await page.waitForLoadState("load").catch(() => undefined);
    }
  }
}

/** The "Round {n} of {total}" panel heading — the Rounds tab's readiness signal. */
export function roundHeading(page: Page, round?: number): Locator {
  return page.getByRole("heading", {
    name:
      round === undefined
        ? /^round \d+ of \d+$/i
        : new RegExp(`^round ${round} of \\d+$`, "i"),
  });
}

/**
 * Activate the Rounds tab. The default tab is Participants, and the Rounds
 * tab's flowbite title is a JSX element rather than a plain string, so its
 * computed accessible name isn't reliably "Rounds" — `getByRole("tab", …)`
 * does not find it. Address it by its text within the tablist instead.
 */
export async function openRoundsTab(page: Page): Promise<void> {
  await page.getByRole("tablist").getByText("Rounds", { exact: true }).click();
  await expect(roundHeading(page)).toBeVisible({ timeout: PAGE_READY_TIMEOUT });
}

/**
 * Page the Rounds panel to a specific round via the flowbite Pagination.
 *
 * The panel opens on `tournament.current_round`, so a completed past round —
 * the only place the edit pencil renders — always needs an explicit hop.
 */
export async function openRound(page: Page, round: number): Promise<void> {
  const pagination = page
    .locator("nav")
    .filter({ has: page.getByRole("button", { name: "Previous" }) });
  await pagination
    .getByRole("button", { name: String(round), exact: true })
    .click();
  await expect(roundHeading(page, round)).toBeVisible({
    timeout: PAGE_READY_TIMEOUT,
  });
}

/** goto the tournament, activate Rounds, and optionally hop to a round. */
export async function gotoRounds(
  page: Page,
  tournamentId: string,
  round?: number,
): Promise<void> {
  await navigate(page, `/tracker/tournaments/${tournamentId}`);
  await openRoundsTab(page);
  if (round !== undefined) await openRound(page, round);
}

/* ------------------------------------------------------------ edit dialog */

/**
 * The per-row pencil that opens the edit dialog for a completed round.
 * Only rendered for the host on a completed round (`isHost && isRoundCompleted`).
 *
 * The desktop table (`hidden md:table`) and the mobile cards (`md:hidden`) both
 * sit in the DOM; `getByRole` ignores `display: none` subtrees, so exactly one
 * matches at any given viewport.
 */
export function editResultPencil(page: Page, p1: string, p2: string): Locator {
  return page.getByRole("button", { name: `Edit result for ${p1} vs ${p2}` });
}

/**
 * The open modal. This is the `fixed inset-0` overlay — components/ui/dialog.tsx
 * puts role="dialog" on the backdrop, not on the box — so never measure it.
 * Use {@link dialogBox} for geometry.
 */
export function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

/** The modal box inside the overlay — the element that is actually laid out. */
export function dialogBox(page: Page): Locator {
  return dialog(page).locator("> div");
}

/**
 * The open modal whose `<h2>` matches `heading`.
 *
 * Filtering by `hasText` would compare against the dialog's ENTIRE text, so an
 * anchored heading regex never matches — address the heading element instead.
 */
export function dialogTitled(page: Page, heading: RegExp): Locator {
  return dialog(page).filter({ has: page.getByRole("heading", { name: heading }) });
}

/**
 * Set a player's score in the edit dialog. The two ScoreSelector rows each
 * render buttons 0..max_score with no group role, so the row is addressed
 * positionally: player 1 is the first block of digit buttons, player 2 the
 * second.
 */
export async function setScore(
  scope: Locator,
  player: 1 | 2,
  score: number,
): Promise<void> {
  await scope
    .getByRole("button", { name: new RegExp(`^${score}$`) })
    .nth(player - 1)
    .click();
}

/** Submit the edit dialog ("Save" in repair mode, "Update" in live-round mode). */
export async function saveEdit(scope: Locator): Promise<void> {
  await scope.getByRole("button", { name: /^save$/i }).click();
}

/**
 * Run a whole past-result edit: open the pencil, set player 2's score,
 * optionally give a reason, save, and wait for the success toast.
 */
export async function editPastResult(
  page: Page,
  opts: { p1: string; p2: string; p2Score: number; reason?: string },
): Promise<void> {
  await editResultPencil(page, opts.p1, opts.p2).click();
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: EDIT_DIALOG_HEADING })).toBeVisible();
  await setScore(d, 2, opts.p2Score);
  if (opts.reason !== undefined) {
    await d.getByPlaceholder(REASON_PLACEHOLDER).fill(opts.reason);
  }
  await saveEdit(d);
  await expect(d).toBeHidden();
  await expect(page.getByText(EDIT_SUCCESS_TOAST, { exact: true })).toBeVisible();
}

/**
 * The host-only per-match `<details>` audit trail rendered under an edited row.
 * `:visible` picks whichever layout (table row vs. mobile card) the current
 * viewport is showing.
 */
export function editHistory(page: Page): Locator {
  return page.locator("details:visible").filter({ hasText: EDIT_HISTORY });
}

/* -------------------------------------------------------------- host menu */

/**
 * Open the wrench menu holding the host-only pairing and result actions. It
 * lives in the Rounds panel header, so the Rounds tab must already be open.
 */
export async function openAdminMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: ADMIN_MENU_TRIGGER }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

export function adminMenuItem(page: Page, name: RegExp): Locator {
  return page.getByRole("menuitem", { name });
}
