import { test, expect } from "../fixtures";

test("picker lets host jump to a specific past match's repair dialog", async ({ page, seeded }) => {
  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // Open the picker.
  await page.getByRole("button", { name: /repair past result/i }).click();

  const picker = page.getByRole("dialog").filter({ hasText: /repair past result/i });
  await expect(picker).toBeVisible();

  // Round dropdown defaults to most-recently-completed round (1 in this seed).
  // Type a player name into the search.
  await picker.getByPlaceholder(/player name/i).fill("Alice");

  // The Alice vs Bob list item should appear.
  const aliceItem = picker.getByRole("button", { name: /alice vs bob/i });
  await expect(aliceItem).toBeVisible();
  await aliceItem.click();

  // The picker closes and the repair dialog opens for that match.
  await expect(picker).toBeHidden();
  const repairDialog = page.getByRole("dialog").filter({ hasText: /repair result/i });
  await expect(repairDialog).toBeVisible();
});
