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
// Two real players through the full pregame ceremony + spectator interactions —
// the dev-server first-compile and ceremony auto-timers make these slow.
test.setTimeout(240_000);

// The reserve-gate assertion clicks the Konva board at coordinates tuned for the
// fixed 1280x720 chromium-desktop viewport (see test-results/spectator-board.png).
// On the mobile/WebKit project the layout differs and those clicks would miss, so
// restrict this whole suite to chromium-desktop.
// chromium-desktop is Chromium @ 1280x720; chromium-mobile is WebKit @ 390px,
// where the layout differs and the tuned clicks would miss.
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "playing-board specs use desktop-viewport Konva coordinates",
);

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
  // deck_select — ready up if offered (button may read "Loading cards…" first,
  // and readiness can auto-resolve before we get here).
  for (const p of [host, joiner]) {
    try {
      await p.getByRole("button", { name: /ready up/i }).click({ timeout: 20_000 });
    } catch { /* already past deck_select */ }
  }
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

  test("spectator chat input is disabled", async ({ browser }) => {
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
      await expect(watchPage.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

      // The chat panel (RightPanel) is open by default on the 'all' tab; the
      // spectator client passes chatDisabled, so the message input renders the
      // "Spectators can't chat" placeholder and is disabled. ChatPanel renders an
      // input per tab, so scope to the visible one.
      const chatInput = watchPage
        .getByPlaceholder(/spectators can'?t chat/i)
        .filter({ visible: true });
      await expect(chatInput).toBeVisible({ timeout: 15_000 });
      await expect(chatInput).toBeDisabled();
    } finally {
      await watchCtx?.close();
      await joinCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(joiner);
      await cleanupPlayer(host);
    }
  });

  test("spectator reserve is hidden until shared, then read-only", async ({ browser }) => {
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
      await expect(watchPage.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

      // Konva renders the board to a single <canvas>, so the reserve pile has no
      // DOM node — we click its screen position. These coords are the host
      // (seat0 / bottom sidebar) RESERVE cell at the fixed chromium-desktop
      // viewport (1280x720); see test-results/spectator-board.png. mouse.click
      // dispatches real events that Konva's hit-detection picks up.
      const RESERVE = { x: 950, y: 500 };
      const reserveModal = watchPage.getByText(/^Reserve \(\d+\)$/);
      const readOnlyHint = watchPage.getByText(/Drag to a zone/i);

      // 1) Host is NOT sharing → clicking the reserve opens nothing.
      await watchPage.mouse.click(RESERVE.x, RESERVE.y);
      await watchPage.waitForTimeout(1000);
      await expect(reserveModal).toHaveCount(0);

      // 2) Host shares their hand with spectators (Spectators tab → checkbox).
      await hostPage.getByRole("button", { name: /^Spectators$/ }).click();
      await hostPage.getByText("Share my hand with spectators").click();
      await watchPage.waitForTimeout(1500); // let the share flag propagate

      // 3) Now the spectator can open the reserve — and it is read-only
      //    (the action hint that only renders for non-readOnly is absent).
      await expect(async () => {
        await watchPage.mouse.click(RESERVE.x, RESERVE.y);
        await expect(reserveModal).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      await expect(readOnlyHint).toHaveCount(0);
      // Close it again.
      await watchPage.keyboard.press("Escape");
    } finally {
      await watchCtx?.close();
      await joinCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(joiner);
      await cleanupPlayer(host);
    }
  });
});
