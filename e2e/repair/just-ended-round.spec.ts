import { test, expect } from "../fixtures";
import { admin } from "../seed";
import { editResultPencil, gotoRounds, openRound, PAGE_READY_TIMEOUT } from "./helpers";

test("a round ended in-session is immediately editable without a reload", async ({
  page,
  seeded,
}) => {
  // Round 2 live (started, not completed) with both results already in, so
  // End Round has everything it needs.
  await admin!.from("matches").insert([
    { tournament_id: seeded.tournamentId, round: 2, match_order: 1,
      player1_id: seeded.participantIds[0], player2_id: seeded.participantIds[2],
      player1_score: 5, player2_score: 0, winner_id: seeded.participantIds[0], is_tie: false },
    { tournament_id: seeded.tournamentId, round: 2, match_order: 2,
      player1_id: seeded.participantIds[1], player2_id: seeded.participantIds[3],
      player1_score: 5, player2_score: 2, winner_id: seeded.participantIds[1], is_tie: false },
  ]);
  await admin!.from("rounds").insert({
    tournament_id: seeded.tournamentId, round_number: 2,
    is_completed: false, started_at: new Date().toISOString(),
  });

  await gotoRounds(page, seeded.tournamentId);

  // While the round is live there is no edit-a-past-result pencil — only the
  // live-score pencil ("Edit score: …"). This is the before-state the rest of
  // the test is contrasted against.
  await expect(editResultPencil(page, "Alice", "Carol")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit score: Alice vs Carol" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "End Round" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: /end round 2\?/i });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: /^end round$/i }).click();

  // Ending a round advances the panel to the next round's (empty) pairings.
  await expect(
    page.getByRole("heading", { name: /^round 3 of 3$/i }),
  ).toBeVisible({ timeout: PAGE_READY_TIMEOUT });

  // Page back to the round that just ended: its results are editable right
  // away, with no reload — the pencil comes from live state, not a fresh load.
  await openRound(page, 2);
  await expect(editResultPencil(page, "Alice", "Carol")).toBeVisible();
  await expect(editResultPencil(page, "Bob", "Dave")).toBeVisible();
});
