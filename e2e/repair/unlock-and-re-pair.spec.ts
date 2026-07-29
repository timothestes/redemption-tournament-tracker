import { test, expect } from "../fixtures";
import { admin } from "../seed";
import {
  adminMenuItem,
  dialogTitled,
  gotoRounds,
  MENU_REGENERATE_PAIRINGS,
  MENU_UNLOCK_AND_REGENERATE,
  openAdminMenu,
  UNLOCK_CONFIRM_BUTTON,
  UNLOCK_CONFIRM_CHECKBOX,
  UNLOCK_DIALOG_HEADING,
} from "./helpers";

test("host unlocks and regenerates when the current round already has a score", async ({
  page,
  seeded,
}) => {
  // Round 2 paired with ONE scored match — the state that blocks a plain
  // regenerate and surfaces the unlock escape hatch.
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

  await gotoRounds(page, seeded.tournamentId);
  await openAdminMenu(page);

  // Plain regenerate is disabled because a result already exists…
  await expect(adminMenuItem(page, MENU_REGENERATE_PAIRINGS)).toBeDisabled();
  // …and the unlock entry only exists in that same state.
  const unlock = adminMenuItem(page, MENU_UNLOCK_AND_REGENERATE);
  await expect(unlock).toBeVisible();
  await unlock.click();

  const confirm = dialogTitled(page, UNLOCK_DIALOG_HEADING);
  await expect(confirm).toBeVisible();
  // It must name exactly what is about to be destroyed.
  await expect(confirm).toContainText("discard the following 1 result");
  await expect(confirm).toContainText("Alice vs Carol: 5-0");

  const submit = confirm.getByRole("button", { name: UNLOCK_CONFIRM_BUTTON });
  await expect(submit).toBeDisabled();
  await confirm.getByLabel(UNLOCK_CONFIRM_CHECKBOX).check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(confirm).toBeHidden();

  // Round 2 is re-paired from scratch: two matches, no surviving score.
  await expect
    .poll(async () => {
      const { data } = await admin!.from("matches")
        .select("id, player1_score")
        .eq("tournament_id", seeded.tournamentId)
        .eq("round", 2);
      return {
        count: data?.length ?? 0,
        scored: (data ?? []).filter((m) => m.player1_score !== null).length,
      };
    })
    .toEqual({ count: 2, scored: 0 });
});
