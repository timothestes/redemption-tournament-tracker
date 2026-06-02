import { test, expect, type BrowserContext } from "@playwright/test";
import {
  seedPlayer,
  cleanupPlayer,
  adminAvailable,
} from "../spectatorSeed";
import { login, hostGame } from "./playHelpers";

// These tests exercise the spectator feature end-to-end against the live
// SpacetimeDB dev module (NEXT_PUBLIC_SPACETIMEDB_DB_NAME=redemption-multiplayer-dev).
// They require:
//   - SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL  (seed users/decks)
//   - a reachable, healthy SpacetimeDB dev module
//
// The "watch a live game" tests keep a real host browser context open for the
// duration so the game stays in `waiting`. (When the host context closes, the
// server only finishes the abandoned game after a ~30s disconnect grace window,
// which the host-abandoned test budgets for.)

test.describe.configure({ mode: "serial" });

const requireSeed = () => {
  if (!adminAvailable) {
    throw new Error(
      "Spectator E2E requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.",
    );
  }
};

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

  test("spectator is redirected to /play when the host abandons the lobby", async ({
    browser,
  }) => {
    // The server only finishes the abandoned waiting game after the host's
    // 30s disconnect grace window expires (clientDisconnected schedules a
    // DisconnectTimeout; closing the context may not fire a clean leave_game).
    // So the redirect can take ~30s+ — budget the whole test generously.
    test.setTimeout(120_000);
    requireSeed();
    const host = await seedPlayer("host");
    let hostCtx: BrowserContext | null = null;
    let watchCtx: BrowserContext | null = null;
    try {
      hostCtx = await browser.newContext();
      const hostPage = await hostCtx.newPage();
      await login(hostPage, host);
      const code = await hostGame(hostPage);

      watchCtx = await browser.newContext();
      const watchPage = await watchCtx.newPage();
      await watchPage.goto(`/play/spectate/${code}`);
      await expect(watchPage.getByText("SPECTATING")).toBeVisible({
        timeout: 20_000,
      });

      // Closing the host context drops the only player connection. The server
      // immediately flips a `waiting` game to `finished`, and the spectator
      // client reacts by toasting "Host left the lobby" and redirecting to /play.
      await hostCtx.close();
      hostCtx = null;

      await expect(watchPage).toHaveURL(/\/play(\?|$)/, { timeout: 45_000 });
    } finally {
      await watchCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(host);
    }
  });

  test("host's spectator count tracks multiple spectators joining and leaving", async ({
    browser,
  }) => {
    // Two spectator contexts plus the join/leave propagation exceed the default.
    test.setTimeout(90_000);
    requireSeed();
    const host = await seedPlayer("host");
    let hostCtx: BrowserContext | null = null;
    let watchCtxA: BrowserContext | null = null;
    let watchCtxB: BrowserContext | null = null;
    try {
      hostCtx = await browser.newContext();
      const hostPage = await hostCtx.newPage();
      await login(hostPage, host);
      const code = await hostGame(hostPage);

      // Two independent (anonymous) spectators watch the same game.
      watchCtxA = await browser.newContext();
      const watchPageA = await watchCtxA.newPage();
      await watchPageA.goto(`/play/spectate/${code}`);
      await expect(watchPageA.getByText("SPECTATING")).toBeVisible({
        timeout: 20_000,
      });

      watchCtxB = await browser.newContext();
      const watchPageB = await watchCtxB.newPage();
      await watchPageB.goto(`/play/spectate/${code}`);
      await expect(watchPageB.getByText("SPECTATING")).toBeVisible({
        timeout: 20_000,
      });

      // Host's waiting-room debug line reflects both spectators.
      await expect(hostPage.getByText(/spectators:\s*2/)).toBeVisible({
        timeout: 20_000,
      });

      // One spectator leaves — the count decrements back to 1.
      await watchCtxB.close();
      watchCtxB = null;
      await expect(hostPage.getByText(/spectators:\s*1/)).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await watchCtxA?.close();
      await watchCtxB?.close();
      await hostCtx?.close();
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
