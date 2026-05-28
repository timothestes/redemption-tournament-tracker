import { test, expect } from "../fixtures";
import { admin } from "../seed";

test("host unlocks and re-pairs when current round has scored matches", async ({ page, seeded }) => {
  // Seed round 2 paired with ONE scored match.
  await admin!.from("matches").insert([
    { tournament_id: seeded.tournamentId, round: 2, match_order: 1,
      player1_id: seeded.participantIds[0], player2_id: seeded.participantIds[2],
      player1_score: 5, player2_score: 0,
      winner_id: seeded.participantIds[0], is_tie: false },
    { tournament_id: seeded.tournamentId, round: 2, match_order: 2,
      player1_id: seeded.participantIds[1], player2_id: seeded.participantIds[3],
      player1_score: null, player2_score: null },
  ]);
  await admin!.from("rounds").insert({
    tournament_id: seeded.tournamentId, round_number: 2, is_completed: false,
  });

  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // Open the host overflow menu.
  await page.getByRole("button", { name: /more host actions/i }).click();

  // Re-pair menu item should be disabled because scores exist.
  const rePair = page.getByRole("menuitem", { name: /^re-pair current round$/i });
  await expect(rePair).toBeDisabled();

  // Unlock entry is rendered in the same menu when scores exist.
  await page.getByRole("menuitem", { name: /unlock and re-pair/i }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: /unlock and re-pair/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/alice/i)).toBeVisible(); // Alice was in the scored round 2 match
  await dialog.getByLabel(/i confirm these results will be permanently deleted/i).check();
  await dialog.getByRole("button", { name: /unlock and regenerate/i }).click();

  // Confirm new pairings exist; the prior scored row is gone.
  await page.waitForTimeout(500);
  const { data: scored } = await admin!.from("matches")
    .select("id, player1_score")
    .eq("tournament_id", seeded.tournamentId)
    .eq("round", 2)
    .not("player1_score", "is", null);
  expect(scored?.length ?? 0).toBe(0);
});
