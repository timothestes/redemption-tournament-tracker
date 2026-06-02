import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  seedPlayer,
  cleanupPlayer,
  adminAvailable,
  type SeededPlayer,
} from "../spectatorSeed";

// These tests exercise the spectator feature end-to-end against the live
// SpacetimeDB dev module (NEXT_PUBLIC_SPACETIMEDB_DB_NAME=redemption-multiplayer-dev).
// They require:
//   - SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL  (seed users/decks)
//   - a reachable, healthy SpacetimeDB dev module
//
// The "watch a live game" tests keep a real host browser context open for the
// duration so the game stays in `waiting` (the host-abandoned redirect fires
// the moment the creator disconnects).

test.describe.configure({ mode: "serial" });

const requireSeed = () => {
  if (!adminAvailable) {
    throw new Error(
      "Spectator E2E requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.",
    );
  }
};

/** Log a seeded user in through the sign-in UI on the given page. */
async function login(page: Page, user: SeededPlayer) {
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
async function hostGame(page: Page): Promise<string> {
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

test.describe("spectator mode", () => {
  test("anonymous user can open the spectate route (no auth wall)", async ({
    browser,
  }) => {
    const ctx = await browser.newContext(); // no auth cookies
    const page = await ctx.newPage();
    await page.goto("/play/spectate/ZZZZ");
    // Must NOT be redirected to sign-in — spectating is open to anonymous users.
    await expect(page).toHaveURL(/\/play\/spectate\/ZZZZ/);
    // With no such game, the route resolves to its error state.
    await expect(
      page.getByText(/no game found with that code/i),
    ).toBeVisible({ timeout: 20_000 });
    await ctx.close();
  });

  test("spectator can watch a live waiting game", async ({ browser }) => {
    requireSeed();
    const host = await seedPlayer("host");
    let hostCtx: BrowserContext | null = null;
    let watchCtx: BrowserContext | null = null;
    try {
      // Host creates and holds the game.
      hostCtx = await browser.newContext();
      const hostPage = await hostCtx.newPage();
      await login(hostPage, host);
      const code = await hostGame(hostPage);

      // A separate (anonymous) spectator watches it.
      watchCtx = await browser.newContext();
      const watchPage = await watchCtx.newPage();
      await watchPage.goto(`/play/spectate/${code}`);

      await expect(watchPage.getByText("SPECTATING")).toBeVisible({
        timeout: 20_000,
      });
      await expect(watchPage.getByText("GAME CODE")).toBeVisible();
      await expect(watchPage.getByText(code, { exact: true })).toBeVisible();
      // Host's username is shown in the spectated pregame view.
      await expect(watchPage.getByText(host.username)).toBeVisible();

      // The host sees the spectator count rise (debug overlay reflects live state).
      await expect(hostPage.getByText(/spectators:\s*1/)).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await watchCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(host);
    }
  });

  test("a second user's lobby lists the public game with a Watch button", async ({
    browser,
  }) => {
    requireSeed();
    const host = await seedPlayer("host");
    const viewer = await seedPlayer("viewer");
    let hostCtx: BrowserContext | null = null;
    let viewerCtx: BrowserContext | null = null;
    try {
      hostCtx = await browser.newContext();
      const hostPage = await hostCtx.newPage();
      await login(hostPage, host);
      await hostGame(hostPage);

      // A second logged-in user sees the public game in the lobby. The lobby can
      // list several live games, so scope to THIS game's row by the host's
      // (unique) username, then assert its Watch button.
      viewerCtx = await browser.newContext();
      const viewerPage = await viewerCtx.newPage();
      await login(viewerPage, viewer);
      await viewerPage.goto("/play");

      const row = viewerPage.locator("div.bg-card", { hasText: host.username });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row.getByRole("button", { name: /^watch$/i })).toBeVisible();

      // NOTE: the "N watching" count is intentionally NOT asserted here — that
      // indicator only renders for playing/pregame games (LobbyList isPlaying
      // gate), never for a `waiting` game. Covering it requires driving the full
      // two-player pregame ceremony to reach `playing`; see the skipped test below.
    } finally {
      await viewerCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(viewer);
      await cleanupPlayer(host);
    }
  });

  // Full read-only coverage on the in-game canvas (no context menus, no card
  // drag, disabled chat input) plus the lobby "N watching" indicator all require
  // a game in `playing` status, which needs two live players to complete the
  // pregame ceremony (deck select -> roll -> choose first -> reveal). Scaffolded
  // here for a follow-up; left skipped so the suite stays reliable.
  test.skip("spectator sees a read-only board on a playing game", async () => {
    // 1. host context: create game
    // 2. joiner context: join game, both ack through pregame to `playing`
    // 3. spectator context: /play/spectate/[code]
    //    - assert canvas mounts (TurnIndicator visible)
    //    - assert chat input is disabled
    //    - assert right-clicking a card opens no context menu
    //    - assert the lobby row shows "1 watching" (isPlaying gate satisfied)
  });
});
