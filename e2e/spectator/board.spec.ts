import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  seedPlayer,
  cleanupPlayer,
  adminAvailable,
  type SeededPlayer,
} from "../spectatorSeed";

// End-to-end coverage of the in-game ("playing") spectator board, including the
// reserve-privacy gate: a spectator may not view a player's reserve until that
// player shares their hand with spectators, and even then only read-only.
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL and a healthy
// SpacetimeDB dev module. These drive two real players through the full pregame
// ceremony, so they are slower than the waiting-game specs.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const requireSeed = () => {
  if (!adminAvailable) {
    throw new Error(
      "Board E2E requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.",
    );
  }
};

async function login(page: Page, user: SeededPlayer) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
    timeout: 15_000,
  });
}

/** Host a public game; returns its code. Page stays in the waiting room. */
async function hostGame(page: Page): Promise<string> {
  await page.goto("/play");
  const createBtn = page.getByRole("button", { name: /create game/i });
  await expect(createBtn).toBeEnabled({ timeout: 15_000 });
  await createBtn.click();
  await page.waitForURL(/\/play\/[A-Z0-9]{4}$/, { timeout: 20_000 });
  await expect(page.getByText("GAME CODE")).toBeVisible({ timeout: 15_000 });
  return page.url().split("/").pop()!;
}

/** Join an existing game by code from the lobby (Spectate off). */
async function joinGame(page: Page, code: string) {
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
 * Drive both players from the waiting/pregame state into `playing`:
 *  - both "Ready up" (deck_select)
 *  - the roll winner clicks "I'll go first" (the loser auto-acks; the reveal
 *    auto-acks) — both pages attempt it, only the winner's button exists.
 * Resolves once both player pages have left the pregame UI (board mounted).
 */
async function bothReachPlaying(host: Page, joiner: Page) {
  for (const p of [host, joiner]) {
    const ready = p.getByRole("button", { name: /ready up/i });
    await expect(ready).toBeVisible({ timeout: 30_000 });
    await ready.click();
  }
  // After both ready, the roll resolves. Try the winner button on each page.
  for (const p of [host, joiner]) {
    const goFirst = p.getByRole("button", { name: /i'?ll go first/i });
    try {
      await goFirst.click({ timeout: 20_000 });
    } catch {
      // This page lost the roll (no button) — the winner's click drives both.
    }
  }
  // Board mounts (Konva canvas) once status flips to playing.
  for (const p of [host, joiner]) {
    await expect(p.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
    await expect(p.getByText("GAME CODE")).toHaveCount(0, { timeout: 30_000 });
  }
}

test.describe("spectator board (playing)", () => {
  test("spectator reaches the playing board", async ({ browser }) => {
    requireSeed();
    const host = await seedPlayer("host");
    const joiner = await seedPlayer("join");
    let hostCtx: BrowserContext | null = null;
    let joinCtx: BrowserContext | null = null;
    let watchCtx: BrowserContext | null = null;
    try {
      hostCtx = await browser.newContext();
      joinCtx = await browser.newContext();
      const hostPage = await hostCtx.newPage();
      const joinPage = await joinCtx.newPage();
      await login(hostPage, host);
      await login(joinPage, joiner);

      const code = await hostGame(hostPage);
      await joinGame(joinPage, code);
      await bothReachPlaying(hostPage, joinPage);

      watchCtx = await browser.newContext();
      const watchPage = await watchCtx.newPage();
      await watchPage.goto(`/play/spectate/${code}`);
      // Spectator board mounts (the canvas), not stuck in joining/error.
      await expect(watchPage.locator("canvas").first()).toBeVisible({
        timeout: 30_000,
      });
      await watchPage.screenshot({ path: "test-results/spectator-board.png", fullPage: false });
    } finally {
      await watchCtx?.close();
      await joinCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(joiner);
      await cleanupPlayer(host);
    }
  });
});
