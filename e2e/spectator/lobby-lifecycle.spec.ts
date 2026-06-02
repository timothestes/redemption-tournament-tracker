import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  seedPlayer,
  cleanupPlayer,
  adminAvailable,
} from "../spectatorSeed";
import { login, hostGame, joinGame, bothReachPlaying } from "./playHelpers";

// Lifecycle coverage for the "Open Games" lobby list as a spectator/viewer sees
// it. The lobby only advertises games that have at least one CONNECTED player
// (LobbyList filters on `tables.Player.where(isConnected = true)`), so a game
// whose players have all dropped must leave the list within a few seconds — the
// server flips `isConnected` to false on websocket close, well before the much
// slower status -> 'finished' reaper would have hidden it. These tests pin that
// behavior and guard against the "LIVE zombie" regression (an abandoned playing
// game lingering as a watchable row forever).
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL and a healthy
// SpacetimeDB dev module, same as the rest of the spectator suite.

test.describe.configure({ mode: "serial" });

const requireSeed = () => {
  if (!adminAvailable) {
    throw new Error(
      "Lobby lifecycle E2E requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.",
    );
  }
};

/**
 * The lobby row for a given host, scoped by the host's (unique) username so a
 * row from another concurrent game can't satisfy the assertion. The row
 * container is `<div class="... bg-card ...">` (see LobbyList.tsx).
 */
function lobbyRow(viewer: Page, username: string) {
  return viewer.locator("div.bg-card", { hasText: username });
}

test.describe("lobby game lifecycle", () => {
  test("a game with a connected host is listed in the lobby", async ({ browser }) => {
    requireSeed();
    const host = await seedPlayer("host");
    const viewer = await seedPlayer("viewer");
    let hostCtx: BrowserContext | null = null;
    let viewerCtx: BrowserContext | null = null;
    try {
      hostCtx = await browser.newContext();
      const hostPage = await hostCtx.newPage();
      await login(hostPage, host);
      await hostGame(hostPage); // host stays in the waiting room, connected

      viewerCtx = await browser.newContext();
      const viewerPage = await viewerCtx.newPage();
      await login(viewerPage, viewer);
      await viewerPage.goto("/play");

      // Control: while the host is connected, the viewer sees the row.
      await expect(lobbyRow(viewerPage, host.username)).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await viewerCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(viewer);
      await cleanupPlayer(host);
    }
  });

  test("an abandoned waiting game disappears from the lobby", async ({ browser }) => {
    test.setTimeout(90_000);
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

      viewerCtx = await browser.newContext();
      const viewerPage = await viewerCtx.newPage();
      await login(viewerPage, viewer);
      await viewerPage.goto("/play");

      const row = lobbyRow(viewerPage, host.username);
      await expect(row).toBeVisible({ timeout: 20_000 });

      // Host abandons: closing the context drops the only player connection.
      // The server flips isConnected -> false within a few seconds (separate
      // from the 30s waiting-game grace timeout), so the row leaves the lobby's
      // connected-players filter quickly — no need to wait for status=finished.
      await hostCtx.close();
      hostCtx = null;

      await expect(row).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await viewerCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(viewer);
      await cleanupPlayer(host);
    }
  });

  test("an abandoned playing game disappears from the lobby (no LIVE zombie)", async ({
    browser,
  }) => {
    // Driving two players through create -> join -> pregame ceremony -> playing
    // is the slow part (dev-server compile + ceremony auto-timers); the
    // post-abandon disappearance itself is fast.
    test.setTimeout(240_000);
    requireSeed();
    const host = await seedPlayer("host");
    const joiner = await seedPlayer("join");
    const viewer = await seedPlayer("viewer");
    let hostCtx: BrowserContext | null = null;
    let joinCtx: BrowserContext | null = null;
    let viewerCtx: BrowserContext | null = null;
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

      viewerCtx = await browser.newContext();
      const viewerPage = await viewerCtx.newPage();
      await login(viewerPage, viewer);
      await viewerPage.goto("/play");

      // A playing game shows as a LIVE row with a Watch button.
      const row = lobbyRow(viewerPage, host.username);
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row.getByText(/live/i)).toBeVisible();

      // Both players abandon. The game's status stays 'playing' (the reaper that
      // would flip it to 'finished' only runs much later / under stricter
      // conditions), but with zero connected players it must still leave the
      // lobby — this is the zombie regression guard.
      await joinCtx.close();
      joinCtx = null;
      await hostCtx.close();
      hostCtx = null;

      await expect(row).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await viewerCtx?.close();
      await joinCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(viewer);
      await cleanupPlayer(joiner);
      await cleanupPlayer(host);
    }
  });

  test("a playing game with one player still connected stays listed", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    requireSeed();
    const host = await seedPlayer("host");
    const joiner = await seedPlayer("join");
    const viewer = await seedPlayer("viewer");
    let hostCtx: BrowserContext | null = null;
    let joinCtx: BrowserContext | null = null;
    let viewerCtx: BrowserContext | null = null;
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

      viewerCtx = await browser.newContext();
      const viewerPage = await viewerCtx.newPage();
      await login(viewerPage, viewer);
      await viewerPage.goto("/play");

      const row = lobbyRow(viewerPage, host.username);
      await expect(row).toBeVisible({ timeout: 20_000 });

      // Only the joiner drops; the host is still connected. The rule is
      // ">=1 connected player", not "all connected", so the row must remain.
      await joinCtx.close();
      joinCtx = null;

      // Wait past the disconnect-detection window (a few seconds) so a wrongly
      // aggressive "all connected" filter would have already hidden the row,
      // then assert it is still there.
      await viewerPage.waitForTimeout(15_000);
      await expect(row).toBeVisible();
    } finally {
      await viewerCtx?.close();
      await joinCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(viewer);
      await cleanupPlayer(joiner);
      await cleanupPlayer(host);
    }
  });
});
