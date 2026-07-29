import { test, expect } from "../fixtures";
import {
  dialog,
  dialogBox,
  EDIT_DIALOG_HEADING,
  EDIT_SUCCESS_TOAST,
  editResultPencil,
  gotoRounds,
  REASON_PLACEHOLDER,
  saveEdit,
  setScore,
} from "./helpers";

const VIEWPORT = { width: 375, height: 667 }; // iPhone SE
test.use({ viewport: VIEWPORT });

test("past-result edit is usable on a phone-sized viewport", async ({ page, seeded }) => {
  await gotoRounds(page, seeded.tournamentId, 1);

  // Below md the table is display:none and the card list takes over, so this
  // resolves to the mobile pencil.
  const pencil = editResultPencil(page, "Alice", "Bob");
  await expect(pencil).toBeVisible();

  // Touch target: match-edit renders the trigger w-11 h-11 and the mobile card
  // wraps it in a matching w-11 h-11 box, so 44×44 is the contract.
  const box = await pencil.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await pencil.click();

  const d = dialog(page);
  await expect(d.getByRole("heading", { name: EDIT_DIALOG_HEADING })).toBeVisible();

  // The overlay carries role="dialog" and is fixed inset-0, so measure the box
  // inside it. It is centred (not a bottom sheet) and capped at
  // max-h-[calc(100dvh-2rem)], so what matters on a phone is that it fits:
  // no horizontal overflow and no vertical clipping.
  const modal = dialogBox(page);
  const modalBox = await modal.boundingBox();
  expect(modalBox).not.toBeNull();
  expect(modalBox!.x).toBeGreaterThanOrEqual(0);
  expect(modalBox!.x + modalBox!.width).toBeLessThanOrEqual(VIEWPORT.width);
  expect(modalBox!.y).toBeGreaterThanOrEqual(0);
  expect(modalBox!.y + modalBox!.height).toBeLessThanOrEqual(VIEWPORT.height);

  // Every score option in both rows has to be tappable without scrolling
  // sideways — six 40px buttons plus gaps is the tightest row in the app.
  for (const row of [0, 1]) {
    for (const score of [0, 5]) {
      const b = d.getByRole("button", { name: new RegExp(`^${score}$`) }).nth(row);
      const bb = await b.boundingBox();
      expect(bb).not.toBeNull();
      expect(bb!.x).toBeGreaterThanOrEqual(0);
      expect(bb!.x + bb!.width).toBeLessThanOrEqual(VIEWPORT.width);
    }
  }

  await setScore(d, 2, 3);
  await d.getByPlaceholder(REASON_PLACEHOLDER).fill("phone edit");

  // Submit must be on-screen, not pushed below the fold by the score rows.
  const submit = d.getByRole("button", { name: /^save$/i });
  const submitBox = await submit.boundingBox();
  expect(submitBox).not.toBeNull();
  expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(VIEWPORT.height);

  await saveEdit(d);
  await expect(d).toBeHidden();
  await expect(page.getByText(EDIT_SUCCESS_TOAST, { exact: true })).toBeVisible();

  // The mobile card reflects the corrected result. The card layout shows no
  // raw score — only the derived per-round line — so assert on that: Alice's
  // differential moves +5 → +2 and Bob's −5 → −2.
  const card = page.locator("div.md\\:hidden > div").filter({ hasText: "Alice" }).first();
  await expect(card).toContainText("Match Pts 3 · Diff 2");
  await expect(card).toContainText("Match Pts 0 · Diff -2");
});
