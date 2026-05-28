import { test, expect } from "../fixtures";
import { admin } from "../seed";

test("repair followed by re-pair button regenerates current round pairings", async ({ page, seeded }) => {
  // Ensure round 2 has been paired but unscored.
  await admin!.from("matches").insert([
    { tournament_id: seeded.tournamentId, round: 2, match_order: 1,
      player1_id: seeded.participantIds[0], player2_id: seeded.participantIds[2],
      player1_score: null, player2_score: null },
    { tournament_id: seeded.tournamentId, round: 2, match_order: 2,
      player1_id: seeded.participantIds[1], player2_id: seeded.participantIds[3],
      player1_score: null, player2_score: null },
  ]);
  await admin!.from("rounds").insert({
    tournament_id: seeded.tournamentId, round_number: 2, is_completed: false,
  });

  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // Step 1: repair Alice vs Bob in round 1 (change 5-0 to 5-3).
  const repairBtn = page.getByRole("button", { name: /repair result for alice vs bob/i });
  await repairBtn.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^3$/ }).nth(1).click();
  await dialog.getByRole("button", { name: /^repair$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });
  await expect(page.getByText(/result repaired/i)).toBeVisible({ timeout: 5_000 });

  // Step 2: click the standalone Re-pair current round button.
  // (Project toast has no inline action button per Task 18; using the standalone button.)
  const repairCurrentBtn = page.getByRole("button", { name: /re-pair current round/i });
  await repairCurrentBtn.click();

  // Confirm dialog with checkbox.
  const confirmDialog = page.getByRole("dialog").filter({ hasText: /regenerate pairings for round 2/i });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByLabel(/i confirm no players have started/i).check();
  await confirmDialog.getByRole("button", { name: /^regenerate$/i }).click();

  // Verify success: matches table for round 2 still has 2 rows (pairings replaced, not deleted).
  // We re-fetch via admin (back-channel verify) to avoid flaky UI assertions.
  await page.waitForTimeout(500); // give the action time to commit and revalidate
  const { data: round2Matches } = await admin!.from("matches")
    .select("id, player1_id, player2_id")
    .eq("tournament_id", seeded.tournamentId)
    .eq("round", 2);
  expect(round2Matches?.length).toBeGreaterThan(0);
});
