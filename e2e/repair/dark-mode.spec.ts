import { test, expect } from "../fixtures";
import {
  dialog,
  dialogBox,
  EDIT_DIALOG_HEADING,
  editPastResult,
  editResultPencil,
  gotoRounds,
  PAGE_READY_TIMEOUT,
} from "./helpers";

/** "rgb(r, g, b)" / "rgba(...)" -> perceived luminance 0..255. */
function luminance(color: string): number {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// NOTE: this spec used to end in `toHaveScreenshot("repair-dark-mode-standings.png")`
// with no committed baseline, so the first run on any machine silently minted
// a baseline from that machine's font rendering, GPU and scrollbars — after
// which it would fail for everyone else and for CI. A snapshot nobody can
// reproduce isn't a regression test, it's a tripwire. The dark-mode properties
// that actually matter here are asserted directly instead: the theme applied,
// the surfaces the edit flow renders on are genuinely dark, and the flow still
// completes with legible contrast.
// Reads the desktop match/standings tables — see golden-path.spec.ts.
test.use({ viewport: { width: 1280, height: 800 } });

test("the past-result edit flow works, and stays dark, in dark mode", async ({
  page,
  seeded,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoRounds(page, seeded.tournamentId, 1);

  // next-themes runs with attribute="class" + defaultTheme="system".
  await expect(page.locator("html")).toHaveClass(/dark/);

  const bodyBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(luminance(bodyBg)).toBeLessThan(96);

  // The dialog has its own --dialog-bg token, so check the modal surface too
  // rather than trusting the page background to speak for it.
  await editResultPencil(page, "Alice", "Bob").click();
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: EDIT_DIALOG_HEADING })).toBeVisible();

  const modal = dialogBox(page);
  const modalStyle = await modal.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, fg: s.color };
  });
  expect(luminance(modalStyle.bg)).toBeLessThan(96);
  // Dark surface, light text — catches the "dark class applied but tokens
  // didn't follow" failure mode that a pure background check would miss.
  expect(luminance(modalStyle.fg)).toBeGreaterThan(luminance(modalStyle.bg) + 64);

  await page.keyboard.press("Escape");
  await expect(d).toBeHidden();

  // The flow itself still works end to end under the dark theme.
  await editPastResult(page, {
    p1: "Alice", p2: "Bob", p2Score: 3, reason: "dark mode",
  });
  await expect(page.getByRole("row").filter({ hasText: "Alice" })).toContainText("5–3");

  // Standings render dark too — the tab this spec used to screenshot.
  await page.getByRole("tablist").getByText("Standings", { exact: true }).click();
  const standingsRow = page.getByRole("row").filter({ hasText: "Alice" });
  await expect(standingsRow).toBeVisible({ timeout: PAGE_READY_TIMEOUT });
  const rowStyle = await standingsRow.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fg: s.color };
  });
  expect(luminance(rowStyle.fg)).toBeGreaterThan(128);
});
