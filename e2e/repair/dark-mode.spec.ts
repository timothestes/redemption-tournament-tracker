import { test, expect } from "../fixtures";

test("repair golden path works in dark mode", async ({ page, seeded }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // Body background should not be pure white (sanity check that dark theme applied).
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe("rgb(255, 255, 255)");

  // Repair golden path.
  const pencil = page.getByRole("button", { name: /repair result for alice vs bob/i });
  await pencil.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^3$/ }).nth(1).click();
  await dialog.getByRole("button", { name: /^repair$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });

  // Switch to participants tab and verify amended badge is visible (and readable) in dark mode.
  await page.getByRole("tab", { name: /participants/i }).click();
  await expect(page.getByRole("status").filter({ hasText: /^amended$/i }).first()).toBeVisible({ timeout: 5_000 });

  // Visual-regression snapshot for the standings view in dark mode.
  // First run will produce the baseline; subsequent runs compare.
  await expect(page).toHaveScreenshot("repair-dark-mode-standings.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
