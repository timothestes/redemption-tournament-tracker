import { test, expect } from "../fixtures";
import { admin } from "../seed";
import {
  adminMenuItem,
  dialog,
  dialogTitled,
  EDIT_DIALOG_HEADING,
  gotoRounds,
  MENU_EDIT_PAST_RESULT,
  openAdminMenu,
  PICKER_HEADING,
  PICKER_SEARCH_PLACEHOLDER,
  REASON_PLACEHOLDER,
  saveEdit,
  setScore,
} from "./helpers";

test("picker lets host jump straight to a past match's edit dialog", async ({
  page,
  seeded,
}) => {
  // The picker reaches any completed round from wherever the host is standing,
  // so stay on the default (current) round — that's the point of this route.
  await gotoRounds(page, seeded.tournamentId);

  await openAdminMenu(page);
  await adminMenuItem(page, MENU_EDIT_PAST_RESULT).click();

  const picker = dialogTitled(page, PICKER_HEADING);
  await expect(picker).toBeVisible();

  // The round select defaults to current_round − 1 — the round just finished.
  await expect(picker.getByRole("combobox")).toHaveValue("1");

  // Round 1 has both of its matches listed up front…
  const aliceItem = picker.getByRole("button", { name: "Alice vs Bob" });
  await expect(aliceItem).toBeVisible();
  await expect(picker.getByRole("button", { name: "Carol vs Dave" })).toBeVisible();

  // …and searching by player name narrows it to one.
  await picker.getByPlaceholder(PICKER_SEARCH_PLACEHOLDER).fill("Alice");
  await expect(picker.getByRole("button", { name: "Carol vs Dave" })).toHaveCount(0);
  await expect(aliceItem).toBeVisible();
  await aliceItem.click();

  // The picker closes and the edit dialog opens on the match it picked.
  await expect(picker).toBeHidden();
  const editDialog = dialog(page);
  await expect(
    editDialog.getByRole("heading", { name: EDIT_DIALOG_HEADING }),
  ).toBeVisible();
  await expect(editDialog).toContainText("Alice Lost Souls (score):");
  await expect(editDialog).toContainText("Bob Lost Souls (score):");
  // Round 1 ≠ current_round, so this is a past-round correction and must ask why.
  await expect(editDialog.getByPlaceholder(REASON_PLACEHOLDER)).toBeVisible();

  // It's a working editor, not just a shell — the picker route has its own
  // onRepairSuccess wiring (no toast, unlike the in-table pencil), so verify
  // the write landed rather than the notification.
  await setScore(editDialog, 2, 4);
  await editDialog.getByPlaceholder(REASON_PLACEHOLDER).fill("picker route");
  await saveEdit(editDialog);
  await expect(editDialog).toBeHidden();

  await expect
    .poll(async () => {
      const { data } = await admin!
        .from("matches")
        .select("player1_score, player2_score")
        .eq("tournament_id", seeded.tournamentId)
        .eq("round", 1)
        .eq("player1_id", seeded.participantIds[0])
        .single();
      return data;
    })
    .toEqual({ player1_score: 5, player2_score: 4 });
});
