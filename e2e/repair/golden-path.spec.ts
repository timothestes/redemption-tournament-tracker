import { test, expect } from "../fixtures";

test("host repairs a past-round score and standings reflect the change", async ({ page, seeded }) => {
  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // The repair pencil button is labeled "Repair result for {p1} vs {p2}" per Task 10.
  const repairBtn = page.getByRole("button", { name: /repair result for alice vs bob/i });
  await repairBtn.click();

  // Repair dialog opens (mode="repair", title "Repair result").
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/repair result/i)).toBeVisible();

  // The dialog uses a ScoreSelector that renders buttons 0..max_score per player.
  // To set player2 to 3 (was 0), click the "3" option in the second selector group.
  // The ScoreSelector groups don't have stable role-based selectors, so fall back to
  // clicking the visible button labeled "3" inside the dialog scope. There are two
  // sets of 0-5 buttons; pick the second column by .nth(...).
  //
  // This selector is best-effort and may need adjustment when the test is first run.
  // The dialog body has the player2 row second; the "3" button in that row should be:
  await dialog.getByRole("button", { name: /^3$/ }).nth(1).click();

  // Fill the optional reason field.
  await dialog.getByPlaceholder(/why are you repairing/i).fill("scorer mistake");

  // Submit the repair.
  await dialog.getByRole("button", { name: /^repair$/i }).click();

  // Dialog closes after success.
  await expect(dialog).toBeHidden({ timeout: 5_000 });

  // Success toast shows.
  await expect(page.getByText(/result repaired/i)).toBeVisible({ timeout: 5_000 });

  // Switch to Participants tab to see standings amended badge.
  await page.getByRole("tab", { name: /participants/i }).click();
  // Both Alice and Bob's rows should now have "amended" badges visible.
  await expect(page.getByRole("status").filter({ hasText: /^amended$/i }).first()).toBeVisible({ timeout: 5_000 });

  // Audit log panel (host-only) should reflect the new entry with the reason.
  await expect(page.getByText(/scorer mistake/i)).toBeVisible({ timeout: 5_000 });
});
