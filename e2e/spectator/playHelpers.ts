import { expect, type Page } from "@playwright/test";
import type { SeededPlayer } from "../spectatorSeed";

// Shared driving helpers for the spectator / lobby-lifecycle e2e specs. These
// run real browser contexts against the live SpacetimeDB dev module, logging in
// seeded users and walking them through the multiplayer flow.

/** Log a seeded user in through the sign-in UI on the given page. */
export async function login(page: Page, user: SeededPlayer) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
    timeout: 15_000,
  });
}

/**
 * Host a public game and return its 4-char code. The passed page stays in the
 * waiting room afterwards, holding the host connection (and thus the game)
 * alive until the caller closes its context.
 */
export async function hostGame(page: Page): Promise<string> {
  await page.goto("/play");
  const createBtn = page.getByRole("button", { name: /create game/i });
  await expect(createBtn).toBeEnabled({ timeout: 15_000 });
  await createBtn.click();
  await page.waitForURL(/\/play\/[A-Z0-9]{4}$/, { timeout: 20_000 });
  const code = page.url().split("/").pop()!;
  // Confirm the waiting room actually mounted with this code.
  await expect(page.getByText("GAME CODE")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  return code;
}

/** Join an existing game by code from the lobby (Spectate off). */
export async function joinGame(page: Page, code: string) {
  await page.goto("/play");
  const codeBox = page.getByRole("textbox", { name: /game code/i });
  await expect(codeBox).toBeVisible({ timeout: 15_000 });
  await codeBox.fill(code);
  const joinBtn = page.getByRole("button", { name: /^join$/i });
  await expect(joinBtn).toBeEnabled({ timeout: 15_000 });
  await joinBtn.click();
  await page.waitForURL(new RegExp(`/play/${code}$`), { timeout: 20_000 });
}

/**
 * Drive both players from the pregame ceremony into `playing`:
 *  - the roll winner clicks "I'll go first" (the loser auto-acks; the reveal
 *    auto-acks) — both pages attempt it, only the winner's button exists.
 * Resolves once both player pages have left the pregame UI (board mounted).
 */
export async function bothReachPlaying(host: Page, joiner: Page) {
  // choosing — the roll winner picks first; only the winner's page has the button
  // (and even that auto-resolves on a timer).
  for (const p of [host, joiner]) {
    try {
      await p.getByRole("button", { name: /go first/i }).first().click({ timeout: 25_000 });
    } catch { /* this page lost the roll, or it auto-resolved */ }
  }
  // playing — the pregame ceremony overlay (roll/choose UI) is gone on both pages.
  // The Konva canvas is mounted behind the overlay the whole time, so absence of
  // the roll UI — not canvas presence — is the playing signal.
  for (const p of [host, joiner]) {
    await expect(p.getByText(/win the roll/i)).toHaveCount(0, { timeout: 45_000 });
    await expect(p.getByRole("button", { name: /go first/i })).toHaveCount(0, {
      timeout: 45_000,
    });
  }
}
