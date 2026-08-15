import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedPlayer, cleanupPlayer, adminAvailable } from "../spectatorSeed";
import { login, hostGame, joinGame, bothReachPlaying } from "../spectator/playHelpers";

// Two-browser coverage of Phase Stops (opponent-turn priority stops), spec
// docs/superpowers/specs/2026-08-15-phase-stops-design.md §10. Harness is
// e2e/play/pregameStarPhase.spec.ts verbatim: seeded players, one browser
// context each, host/join, then the pregame ceremony auto-completes because
// the seeded deck has no star cards and no Lost Souls.
//
// The four scenarios:
//   1. Battle stop end-to-end — set → hold → active is frozen (E17: the
//      battle band's ⚑ Win Battle / ↩ End Battle are disabled too) → PASS →
//      end turn.
//   2. E3  — a draw stop set on the opponent's turn fires at the NEXT flip.
//   3. E6  — the holder toggling the held phase off releases the hold.
//   4. E16 — the enter_battle band-open rule fires an unfired battle stop.
//
// Two deliberate deviations from the brief's wording, both forced by the
// client and both asserted in their honest form (see the per-test comments):
//   - Scenario 1's "active player clicks End Turn → error toast": every UI
//     path into a hold-guarded reducer is DISABLED for the active player
//     (TurnIndicator End Turn, GameToolbar End Turn, all five phase buttons,
//     both arrows), so the guarded reducer is never called and its
//     toastReducerError catch (useGameState.ts) never fires. Asserted as:
//     the controls are disabled, and clicking through them changes nothing.
//   - Scenario 4's "drags an attacker into the band during preparation": the
//     band is phase-driven since the battle-zone redesign (isBattleBandActive
//     — MultiplayerCanvas.tsx), so it is neither rendered nor a drop target
//     during preparation. The only client-reachable state that still routes a
//     drop through enter_battle (battleState === '' with the band on screen)
//     is `currentPhase === 'battle'` after an unopposed ⚑ Win Battle, so the
//     test drives that. It exercises exactly the §5.7 branch E16 is about.
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL and a
// SpacetimeDB dev module carrying the Phase Stops reducers/tables.

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

// Real Konva drags need the fixed 1280x720 chromium-desktop viewport; the
// mobile project's layout differs. Same restriction as e2e/spectator/board.spec.ts.
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "phase stops drive the desktop-viewport phase bar and Konva board",
);

type Phase = "draw" | "upkeep" | "preparation" | "battle" | "discard";

const PHASE_LABELS: Record<Phase, string> = {
  draw: "Draw",
  upkeep: "Upkeep",
  preparation: "Preparation",
  battle: "Battle",
  discard: "Discard",
};

// TurnIndicator's inline colors, as Chromium reports them computed.
const AMBER = "rgb(251, 191, 36)"; // #fbbf24 — held phase + its pulsing dot
const STOP_GOLD = "rgb(196, 149, 90)"; // #c4955a — a set-but-unfired stop dot
const PHASE_ACTIVE = "rgb(232, 213, 163)"; // #e8d5a3 — the phase the turn is in
const PHASE_IDLE_MY_TURN = "rgba(232, 213, 163, 0.45)";

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------

/**
 * The five phase buttons share one row inside TurnIndicator. They must be
 * scoped through that row, not matched globally: GameToolbar renders its own
 * buttons captioned "Draw" and "End Turn", so a bare text match is ambiguous
 * for exactly the two phases these tests care most about. "Preparation" is
 * unique in the DOM, so it anchors the row; `..` is Playwright's XPath parent.
 */
function phaseRow(page: Page) {
  return page
    .locator("button")
    .filter({ hasText: /^Preparation$/ })
    .first()
    .locator("..");
}

function phaseBtn(page: Page, phase: Phase) {
  return phaseRow(page)
    .locator("button")
    .filter({ hasText: new RegExp(`^${PHASE_LABELS[phase]}$`) })
    .first();
}

/** The stop marker dot — the only aria-hidden span inside a phase button. */
function stopDot(page: Page, phase: Phase) {
  return phaseBtn(page, phase).locator('span[aria-hidden="true"]');
}

/** Holder-only: the amber "Pass · Ns" button in the End Turn slot. */
function passBtn(page: Page) {
  return page.locator('button[title^="Your stop"]');
}

/** Active-player-only, and only while held: "Held · Ns" in the End Turn slot. */
function heldBtn(page: Page) {
  return page.locator('button[title^="Held"]');
}

/** TurnIndicator's End Turn, live only on the active seat with no hold. */
function endTurnBtn(page: Page) {
  return page.locator('button[title="End your turn"]');
}

/** GameToolbar's separate End Turn (label text, not the same button). */
function toolbarEndTurnBtn(page: Page) {
  return page.locator('button[title="End Turn"]');
}

// ---------------------------------------------------------------------------
// Konva board reading (same technique as pregameStarPhase.spec.ts: card nodes
// carry no DOM, so everything is hit-tested through the live stage)
// ---------------------------------------------------------------------------

interface StageRead {
  /** Every loaded card image, centre point in screen px. */
  cards: Array<{ x: number; y: number }>;
  /** Screen rect of the Field of Battle band, or null when it is closed. */
  band: { x: number; y: number; width: number; height: number } | null;
  /** Screen y of MY hand row's label (the lower of the two HAND labels). */
  handTop: number | null;
}

async function readStage(page: Page): Promise<StageRead> {
  const geo = await page.evaluate(() => {
    const K = (window as any).Konva;
    if (!K || !K.stages || !K.stages.length) return null;
    const stage = [...K.stages].sort((a: any, b: any) => b.width() - a.width())[0];
    const box = stage.container().getBoundingClientRect();

    const cards = (stage.find("Image") as any[])
      .filter((n: any) => {
        const im = n.image();
        return im && typeof im.src === "string" && im.src.length > 0;
      })
      .map((n: any) => {
        const r = n.getClientRect();
        return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
      });

    // The band background is the Rect drawn at BAND_BG_OPACITY over #1a0d0d.
    const bandNode = (stage.find("Rect") as any[]).find(
      (r: any) => Math.abs(r.opacity() - 0.75) < 0.01 && r.fill() === "#1a0d0d",
    );
    let band: { x: number; y: number; width: number; height: number } | null = null;
    if (bandNode) {
      const r = bandNode.getClientRect();
      band = { x: box.left + r.x, y: box.top + r.y, width: r.width, height: r.height };
    }

    // Both seats render a HAND label; mine is the lower one on screen.
    const handYs = (stage.find("Text") as any[])
      .filter((t: any) => t.text() === "HAND")
      .map((t: any) => box.top + t.getClientRect().y)
      .sort((a: number, b: number) => b - a);

    return { cards, band, handTop: handYs.length ? handYs[0] : null };
  });
  if (!geo) throw new Error("Konva stage not found on the page");
  return geo as StageRead;
}

/** Right-most card in my hand — the fan overlaps left-to-right, so only the
 *  right-most card exposes a full face to a real mouse press. */
async function myRightmostHandCard(page: Page): Promise<{ x: number; y: number }> {
  const geo = await readStage(page);
  if (geo.handTop == null) throw new Error("no HAND label on the board");
  const inHand = geo.cards
    .filter((c) => c.y > geo.handTop!)
    .sort((a, b) => b.x - a.x);
  if (!inHand.length) throw new Error("no cards found in my hand");
  return inHand[0];
}

/** How many card images currently sit inside the Field of Battle band. */
async function cardsInBand(page: Page): Promise<number> {
  const geo = await readStage(page);
  if (!geo.band) return 0;
  const b = geo.band;
  return geo.cards.filter(
    (c) => c.x >= b.x && c.x <= b.x + b.width && c.y >= b.y && c.y <= b.y + b.height,
  ).length;
}

/** A real mouse drag — trusted events, the only kind Konva hit-tests. */
async function dragBoard(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / 12,
      from.y + ((to.y - from.y) * i) / 12,
    );
  }
  await page.mouse.up();
}

/** Drag my right-most hand card into the band's own half of the field. */
async function dragHandCardIntoBand(page: Page) {
  const geo = await readStage(page);
  if (!geo.band) throw new Error("the Field of Battle band is not open");
  const card = await myRightmostHandCard(page);
  await dragBoard(page, card, {
    // Right half is my side of the dashed centreline (battle-zone spec §3).
    x: geo.band.x + geo.band.width * 0.72,
    y: geo.band.y + geo.band.height / 2,
  });
}

// ---------------------------------------------------------------------------
// Flow helpers
// ---------------------------------------------------------------------------

/**
 * Both players are past the REG pre-game and on turn 1: the five-phase row is
 * back (it is replaced by the Stars/Lost Souls chips during the pre-game) and
 * exactly one seat holds the turn. Returns { active, idle } — the dice roll
 * decides which, so no test may assume host goes first.
 */
async function bothReachTurnOne(host: Page, joiner: Page): Promise<{ active: Page; idle: Page }> {
  for (const p of [host, joiner]) {
    await expect(phaseBtn(p, "preparation")).toBeVisible({ timeout: 60_000 });
  }
  const active = await activePage([host, joiner]);
  return { active, idle: active === host ? joiner : host };
}

/** Whichever page currently owns the turn. Only valid when no hold is engaged
 *  — the active seat's End Turn retitles itself while held. */
async function activePage(pages: Page[]): Promise<Page> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const p of pages) {
      if (await endTurnBtn(p).count()) return p;
    }
    await pages[0].waitForTimeout(500);
  }
  throw new Error("neither page took the turn");
}

/** Wait for the turn to land on `page` (used after an End Turn flip). */
async function waitForTurn(page: Page) {
  await expect(endTurnBtn(page)).toBeVisible({ timeout: 45_000 });
}

/**
 * Full hold assertion from both sides. Kept fast on purpose: the server's 60s
 * backstop auto-releases the hold, so everything a test wants to see about a
 * hold has to be seen well inside that window.
 */
async function expectHoldEngaged(holder: Page, active: Page, phase: Phase) {
  await expect(passBtn(holder)).toBeVisible({ timeout: 25_000 });
  await expect(passBtn(holder)).toHaveText(/^Pass/);

  await expect(heldBtn(active)).toBeVisible({ timeout: 25_000 });
  await expect(heldBtn(active)).toHaveText(/^Held/);
  await expect(heldBtn(active)).toBeDisabled();

  // The held phase gets the amber treatment (border + label + pulsing dot) on
  // both clients — the stopper's view is not a private one.
  for (const p of [holder, active]) {
    await expect(phaseBtn(p, phase)).toHaveCSS("color", AMBER);
    await expect(stopDot(p, phase)).toHaveCSS("background-color", AMBER);
  }
}

/** No hold anywhere: PASS gone on the holder, End Turn live on the active seat. */
async function expectHoldCleared(holder: Page, active: Page) {
  await expect(passBtn(holder)).toHaveCount(0, { timeout: 25_000 });
  await expect(heldBtn(active)).toHaveCount(0, { timeout: 25_000 });
  await expect(endTurnBtn(active)).toBeEnabled({ timeout: 25_000 });
}

const requireSeed = () => {
  if (!adminAvailable) {
    throw new Error(
      "Phase Stops E2E requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.",
    );
  }
};

/** Seed two players, log them in, and drive them to turn 1. */
async function twoPlayerGame(
  browser: import("@playwright/test").Browser,
  label: string,
): Promise<{
  host: Page;
  joiner: Page;
  active: Page;
  idle: Page;
  dispose: () => Promise<void>;
}> {
  const hostUser = await seedPlayer(`${label}h`);
  const joinUser = await seedPlayer(`${label}j`);
  let hostCtx: BrowserContext | null = null;
  let joinCtx: BrowserContext | null = null;
  try {
    hostCtx = await browser.newContext();
    joinCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const joiner = await joinCtx.newPage();
    await login(host, hostUser);
    await login(joiner, joinUser);

    const code = await hostGame(host);
    await joinGame(joiner, code);
    await bothReachPlaying(host, joiner);
    const { active, idle } = await bothReachTurnOne(host, joiner);

    const ctxHost = hostCtx;
    const ctxJoin = joinCtx;
    return {
      host,
      joiner,
      active,
      idle,
      dispose: async () => {
        await ctxJoin.close();
        await ctxHost.close();
        await cleanupPlayer(joinUser);
        await cleanupPlayer(hostUser);
      },
    };
  } catch (e) {
    await joinCtx?.close();
    await hostCtx?.close();
    await cleanupPlayer(joinUser);
    await cleanupPlayer(hostUser);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test.describe("Phase Stops", () => {
  test("battle stop holds the turn until the stopper passes", async ({ browser }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "ps1");
    const { active, idle } = game;
    try {
      // --- 1. The non-active player arms a battle stop --------------------
      // Phase buttons are stop toggles — and only stop toggles — on the
      // opponent's turn (TurnIndicator's canToggleStops).
      await expect(phaseBtn(idle, "battle")).toBeEnabled();
      await phaseBtn(idle, "battle").click();
      await expect(idle.getByText(/Stop set: Battle/)).toBeVisible({ timeout: 5_000 });
      // Marker dot, gold (set) not amber (held) — nothing has fired yet.
      await expect(stopDot(idle, "battle")).toHaveCSS("background-color", STOP_GOLD);
      // The stop is private to the stopper's own row until it fires.
      await expect(stopDot(active, "battle")).toHaveCount(0);

      // --- 2. The active player walks draw → battle on the phase bar -------
      await phaseBtn(active, "battle").click();
      await expectHoldEngaged(idle, active, "battle");
      await active.screenshot({ path: "test-results/phase-stops-hold-active.png" });
      await idle.screenshot({ path: "test-results/phase-stops-hold-holder.png" });

      // --- 2b. E17: the battle band's conclude buttons are dead while held --
      // The band is already open here — applyPhaseTransition stamps
      // battleState:'active' the moment the phase becomes 'battle', which is
      // what just fired the stop. enter_battle is NOT one of the five
      // hold-gated reducers (spec §5.4), so dragging a card in is legal even
      // while held and puts a card in the band without touching the hold —
      // and without it, ⚑ Win Battle never renders (attacker-only + requires
      // a non-empty band).
      await dragHandCardIntoBand(active);
      await expect.poll(() => cardsInBand(active), { timeout: 10_000 }).toBeGreaterThan(0);

      const winBattleBtn = active.getByRole("button", { name: /Win Battle/ });
      const endBattleBtn = active.getByRole("button", { name: /End Battle/ });
      await expect(winBattleBtn).toBeVisible();
      await expect(winBattleBtn).toBeDisabled();
      await expect(endBattleBtn).toBeDisabled();

      // Force-clicking the disabled buttons must not dispatch — no reducer
      // call, so no SenderError, so no unhandled-rejection pageerror (this
      // was the original E17 bug: before isTurnHeld gated these buttons,
      // force-clicking them dispatched a rejected reducer call that
      // surfaced as an unhandled-rejection pageerror).
      const battlePageErrors: string[] = [];
      active.on("pageerror", (e) => battlePageErrors.push(String(e)));
      await winBattleBtn.click({ force: true }).catch(() => {});
      await endBattleBtn.click({ force: true }).catch(() => {});
      await active.waitForTimeout(500);
      expect(battlePageErrors).toEqual([]);
      // Dead clicks: the card is still sitting in the band, the hold is still up.
      await expect.poll(() => cardsInBand(active), { timeout: 5_000 }).toBeGreaterThan(0);
      await expect(heldBtn(active)).toBeVisible();

      // --- 3. The active player cannot move the turn on ---------------------
      // The brief asks for the "The turn is held" SenderError toast here. It is
      // unreachable: the client disables every path into the guarded reducers
      // rather than letting them throw, so the toastReducerError catch these
      // reducers now have (useGameState.ts) never gets a rejection to toast.
      // The equivalent assertion is that the controls are dead and the state
      // does not budge.
      await expect(heldBtn(active)).toBeDisabled();
      await expect(toolbarEndTurnBtn(active)).toBeDisabled();
      for (const phase of ["draw", "upkeep", "preparation", "discard"] as Phase[]) {
        await expect(phaseBtn(active, phase)).toBeDisabled();
      }
      await heldBtn(active).click({ force: true }).catch(() => {});
      await phaseBtn(active, "discard").click({ force: true }).catch(() => {});
      await active.waitForTimeout(1_500);
      // Still held, still on battle — the clicks did nothing.
      await expect(heldBtn(active)).toBeVisible();
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", AMBER);
      await expect(passBtn(idle)).toBeVisible();

      // --- 4. The stopper passes; the turn is live again --------------------
      await passBtn(idle).click();
      await expectHoldCleared(idle, active);
      // Battle is still the current phase (it just isn't held any more).
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE);

      // --- 5. End Turn now succeeds ----------------------------------------
      await endTurnBtn(active).click();
      await waitForTurn(idle);
      await expect(endTurnBtn(active)).toHaveCount(0, { timeout: 25_000 });
    } finally {
      await game.dispose();
    }
  });

  test("E3: a draw stop fires at the next turn flip, with the stopper holding", async ({
    browser,
  }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "ps3");
    const { active: first, idle: second } = game;
    try {
      // Stops can only be armed on the opponent's turn, so `second` arms the
      // draw stop now — it cannot fire on `first`'s turn (a draw stop is never
      // in end_turn's upkeep..discard scan range).
      await phaseBtn(second, "draw").click();
      await expect(second.getByText(/Stop set: Draw/)).toBeVisible({ timeout: 5_000 });
      await expect(stopDot(second, "draw")).toHaveCSS("background-color", STOP_GOLD);

      // First flip: `second` takes the turn, nothing holds (the new non-active
      // seat is `first`, who has no stops).
      await endTurnBtn(first).click();
      await waitForTurn(second);
      await expect(passBtn(second)).toHaveCount(0);
      await expect(heldBtn(second)).toHaveCount(0);

      // Second flip: `second` ends their OWN turn, and their own draw stop
      // engages against `first`'s fresh draw — E3, the counter-intuitive one.
      await endTurnBtn(second).click();
      await expectHoldEngaged(second, first, "draw");
      await second.screenshot({ path: "test-results/phase-stops-e3-flip.png" });

      // And it releases normally.
      await passBtn(second).click();
      await expectHoldCleared(second, first);
      // The stop itself survives the release — it is armed for next time, and
      // its dot goes back to gold.
      await expect(stopDot(second, "draw")).toHaveCSS("background-color", STOP_GOLD);
    } finally {
      await game.dispose();
    }
  });

  test("E6: the holder toggling the held phase off releases the hold", async ({ browser }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "ps6");
    const { active, idle } = game;
    try {
      await phaseBtn(idle, "battle").click();
      await expect(idle.getByText(/Stop set: Battle/)).toBeVisible({ timeout: 5_000 });

      await phaseBtn(active, "battle").click();
      await expectHoldEngaged(idle, active, "battle");

      // "Never mind" — tapping the held phase again both clears the stop and
      // releases the hold it is currently sitting on (spec §6.1).
      await phaseBtn(idle, "battle").click();
      await expect(idle.getByText(/Stop removed: Battle/)).toBeVisible({ timeout: 5_000 });
      await expectHoldCleared(idle, active);
      await expect(stopDot(idle, "battle")).toHaveCount(0);
      await expect(stopDot(active, "battle")).toHaveCount(0);

      // The active player can move on immediately, and nothing re-fires.
      await phaseBtn(active, "discard").click();
      await expect(phaseBtn(active, "discard")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_IDLE_MY_TURN);
      await expect(heldBtn(active)).toHaveCount(0);
    } finally {
      await game.dispose();
    }
  });

  test("E16: opening the band fires an unfired battle stop", async ({ browser }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "p16");
    const { active, idle } = game;
    try {
      // The band is phase-driven, so it cannot be opened from preparation the
      // way E16 describes. The reachable equivalent — same enter_battle branch
      // — is a band re-opened by a drag while the turn is already parked in
      // the battle phase, which is where an unopposed ⚑ Win Battle leaves it.

      // --- 1. Open the battle phase, put a card in the band, win it --------
      await phaseBtn(active, "battle").click();
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect
        .poll(async () => (await readStage(active)).band !== null, { timeout: 25_000 })
        .toBe(true);

      await dragHandCardIntoBand(active);
      await expect.poll(() => cardsInBand(active), { timeout: 25_000 }).toBeGreaterThan(0);

      // No Lost Souls in the seeded decks, so resolve_battle auto-returns
      // immediately: the band empties and battleState clears while the phase
      // bar stays on battle.
      await active.getByRole("button", { name: /Win Battle/ }).click();
      await expect.poll(() => cardsInBand(active), { timeout: 25_000 }).toBe(0);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE);

      // --- 2. NOW the opponent arms a battle stop --------------------------
      // Set mid-phase, so the phase bar never scanned it: it is armed and
      // unfired, which is exactly the state the band-open rule exists for.
      await phaseBtn(idle, "battle").click();
      await expect(idle.getByText(/Stop set: Battle/)).toBeVisible({ timeout: 5_000 });
      await expect(stopDot(idle, "battle")).toHaveCSS("background-color", STOP_GOLD);
      await expect(passBtn(idle)).toHaveCount(0);

      // --- 3. Re-opening the band with an attacker fires it ----------------
      await dragHandCardIntoBand(active);
      await expectHoldEngaged(idle, active, "battle");
      // The attacker is committed — the hold does not roll the drag back.
      await expect.poll(() => cardsInBand(active), { timeout: 25_000 }).toBeGreaterThan(0);
      await expect.poll(() => cardsInBand(idle), { timeout: 25_000 }).toBeGreaterThan(0);
      await active.screenshot({ path: "test-results/phase-stops-band-open.png" });

      await passBtn(idle).click();
      await expectHoldCleared(idle, active);
    } finally {
      await game.dispose();
    }
  });
});
