import { test, expect } from "../fixtures";
import { admin } from "../seed";

test("just-ended round immediately shows repair pencil on its matches", async ({ page, seeded }) => {
  // Add round 2 matches WITH scores so we can end the round.
  await admin!.from("matches").insert([
    { tournament_id: seeded.tournamentId, round: 2, match_order: 1,
      player1_id: seeded.participantIds[0], player2_id: seeded.participantIds[2],
      player1_score: 5, player2_score: 0, winner_id: seeded.participantIds[0], is_tie: false },
    { tournament_id: seeded.tournamentId, round: 2, match_order: 2,
      player1_id: seeded.participantIds[1], player2_id: seeded.participantIds[3],
      player1_score: 5, player2_score: 2, winner_id: seeded.participantIds[1], is_tie: false },
  ]);
  await admin!.from("rounds").insert({
    tournament_id: seeded.tournamentId, round_number: 2, is_completed: false,
  });

  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // End the active round (this triggers handleEndRound in page.tsx).
  // Button label varies; try common forms.
  const endRoundBtn = page.getByRole("button", { name: /end round/i }).first();
  await endRoundBtn.click();

  // Wait for the round to be marked completed (handleEndRound updates state).
  await expect(page.getByRole("button", { name: /repair result for alice vs carol/i })).toBeVisible({ timeout: 5_000 });
});
