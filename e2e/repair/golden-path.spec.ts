import { test, expect } from "../fixtures";
import {
  dialog,
  editHistory,
  editPastResult,
  editResultPencil,
  gotoRounds,
  openRound,
  PAGE_READY_TIMEOUT,
} from "./helpers";

// This spec reads the desktop match table (`hidden md:table`) and the standings
// table, so pin a ≥md viewport rather than inheriting it from the project —
// `npm run test:e2e` also runs the iPhone project, where those are display:none.
test.use({ viewport: { width: 1280, height: 800 } });

test("host edits a past-round score and standings reflect the change", async ({
  page,
  seeded,
}) => {
  // The pencil only renders for the host on a COMPLETED round, and the Rounds
  // panel opens on current_round (2). Round 1 is the completed one in the seed.
  await gotoRounds(page, seeded.tournamentId, 1);

  const row = page.getByRole("row").filter({ hasText: "Alice" });
  await expect(row).toContainText("5–0");

  await editPastResult(page, {
    p1: "Alice",
    p2: "Bob",
    p2Score: 3,
    reason: "scorer mistake",
  });

  // The round table re-renders with the corrected result and the per-round
  // differential recomputed from it (Alice +2 / Bob −2, was +5 / −5).
  await expect(row).toContainText("5–3");
  await expect(row).toContainText("2 / -2");

  // Host-only audit trail: one entry, old → new, carrying the reason.
  const history = editHistory(page);
  await expect(history).toBeVisible();
  await history.locator("summary").click();
  const entry = history.locator("li").first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText("5-0 → 5-3");
  await expect(entry).toContainText("scorer mistake");

  // Standings pick up the corrected differential. Alice still took the max
  // score so her MP is unchanged at 3; only Diff moves, 5 → 2.
  await page.getByRole("tablist").getByText("Standings", { exact: true }).click();
  const aliceStanding = page.getByRole("row").filter({ hasText: "Alice" });
  await expect(aliceStanding).toBeVisible({ timeout: PAGE_READY_TIMEOUT });
  await expect(aliceStanding.getByRole("cell").nth(3)).toHaveText("3");
  await expect(aliceStanding.getByRole("cell").nth(4)).toHaveText("2");

  // Reopening the dialog preselects the SAVED score, not the pre-edit one —
  // guards match-edit's "seed both scores from the match on open" behaviour.
  // (Leaving and re-entering the Rounds tab remounts the panel — TournamentRounds
  // is keyed on activeTab — so it lands back on current_round and needs the hop.)
  await page.getByRole("tablist").getByText("Rounds", { exact: true }).click();
  await openRound(page, 1);
  await editResultPencil(page, "Alice", "Bob").click();
  await expect(
    dialog(page).getByRole("button", { name: /^3$/ }).nth(1),
  ).toHaveClass(/bg-primary/);
});
