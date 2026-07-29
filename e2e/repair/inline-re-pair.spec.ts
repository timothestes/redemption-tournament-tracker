import { test, expect } from "../fixtures";
import { admin } from "../seed";
import {
  adminMenuItem,
  dialog,
  editPastResult,
  gotoRounds,
  MENU_REGENERATE_PAIRINGS,
  openAdminMenu,
  REGENERATE_CONFIRM_BUTTON,
  REGENERATE_CONFIRM_CHECKBOX,
} from "./helpers";

test("editing a past result then regenerating replaces the current round's pairings", async ({
  page,
  seeded,
}) => {
  // Round 2 is paired but unscored — the state in which "Regenerate pairings"
  // is allowed without unlocking.
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

  const before = await admin!.from("matches")
    .select("id")
    .eq("tournament_id", seeded.tournamentId)
    .eq("round", 2);
  const beforeIds = (before.data ?? []).map((m) => m.id);
  expect(beforeIds).toHaveLength(2);

  // Step 1: correct Alice vs Bob in round 1 (5-0 → 5-3).
  await gotoRounds(page, seeded.tournamentId, 1);
  await editPastResult(page, { p1: "Alice", p2: "Bob", p2Score: 3, reason: "misheard" });

  // Step 2: regenerate round 2's pairings off the corrected standings.
  await openAdminMenu(page);
  const regenerate = adminMenuItem(page, MENU_REGENERATE_PAIRINGS);
  await expect(regenerate).toBeEnabled();
  await regenerate.click();

  const confirm = dialog(page).filter({ hasText: /regenerate pairings for round 2\?/i });
  await expect(confirm).toBeVisible();

  // The confirm button is gated on the checkbox.
  const submit = confirm.getByRole("button", { name: REGENERATE_CONFIRM_BUTTON });
  await expect(submit).toBeDisabled();
  await confirm.getByLabel(REGENERATE_CONFIRM_CHECKBOX).check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(confirm).toBeHidden();

  // The RPC deletes and re-inserts, so round 2 keeps 2 unscored pairings but
  // none of the original rows survive.
  await expect
    .poll(async () => {
      const { data } = await admin!.from("matches")
        .select("id, player1_score")
        .eq("tournament_id", seeded.tournamentId)
        .eq("round", 2);
      return {
        count: data?.length ?? 0,
        reused: (data ?? []).filter((m) => beforeIds.includes(m.id)).length,
        scored: (data ?? []).filter((m) => m.player1_score !== null).length,
      };
    })
    .toEqual({ count: 2, reused: 0, scored: 0 });
});
