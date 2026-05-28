import { test, expect } from "../fixtures";

test.use({ viewport: { width: 375, height: 667 } });

test("repair golden path works on mobile viewport (iPhone SE)", async ({ page, seeded }) => {
  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // Find the repair pencil for Alice vs Bob.
  const pencil = page.getByRole("button", { name: /repair result for alice vs bob/i });
  await expect(pencil).toBeVisible();

  // Verify the hit area is at least 44x44.
  const box = await pencil.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await pencil.click();

  // The dialog renders bottom-sheet on mobile — anchored to the bottom half.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  // Bottom-anchored: the dialog's bottom edge should be close to the viewport bottom (667).
  expect(dialogBox!.y + dialogBox!.height).toBeGreaterThan(400);

  // Set player2 score to 3 (was 0). Brittle selector — first run will tune.
  await dialog.getByRole("button", { name: /^3$/ }).nth(1).click();

  // The primary submit "Repair" should be reachable in the bottom half.
  const submit = dialog.getByRole("button", { name: /^repair$/i });
  const submitBox = await submit.boundingBox();
  expect(submitBox).not.toBeNull();
  expect(submitBox!.y).toBeGreaterThan(333); // lower half of 667

  await submit.click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });
});
