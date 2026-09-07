import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedPlayer, cleanupPlayer, adminAvailable } from "../spectatorSeed";
import { login, hostGame, joinGame, bothReachPlaying } from "../spectator/playHelpers";

// Two-browser coverage of Phase Stops (opponent-turn priority stops), spec
// docs/superpowers/specs/2026-08-15-phase-stops-design.md §10 + the Rev 4
// one-shot-gate / priority-prompt correction. Harness is
// e2e/play/pregameStarPhase.spec.ts verbatim: seeded players, one browser
// context each, host/join, then the pregame ceremony auto-completes because
// the seeded deck has no star cards and no Lost Souls.
//
// REV 4 MODEL (what every assertion below is written against):
//   - Gates sit on the boundaries before Upkeep/Preparation/Battle/Discard
//     plus 'end' (before the turn flip). There is NO gate before Draw.
//   - A stop is ONE-SHOT: tripping consumes it (the stopper's gate marker
//     goes back to the faint outline while the hold pulses amber); it must be
//     re-toggled to fire again.
//   - A tripped gate shows the ACTIVE player the same center-board prompt as
//     the Priority button — "X requests action priority before you move to
//     P" / "...before you end your turn" — with Grant/Deny. There is no PASS
//     button and no Held caption; the stopper has no release affordance.
//   - Grant and Deny BOTH only lift the hold — the turn stays exactly where
//     it halted, and the active player redoes their move themselves (the
//     spent gate lets it through). They differ only in the logged courtesy.
//     The 60s backstop release behaves the same way.
//
// The four scenarios:
//   1. Battle gate via a phase click — arm → jump halts in PREPARATION with
//      the band shut → active controls are dead → Deny lifts the hold with
//      the turn still in preparation → re-clicking Battle enters it.
//   2. End gate — no draw gate exists; End Turn crosses to Discard (battle
//      band suppressed on the crossing) and halts before the flip; Deny
//      stays on Discard; pressing End Turn again completes the flip.
//   3. Grant path + one-shot — a preparation gate halts in Upkeep; Grant
//      lifts the hold without advancing; the active player re-clicks
//      Preparation and nothing re-fires (the stop was consumed).
//   4. Discard gate at the battle boundary (E17: band open, conclude buttons
//      dead; Deny leaves the turn on Battle with the band intact) + a
//      re-armed gate proving re-toggle re-fires + a band-opening drag during
//      a hold refused with the "has priority" toast.
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL and a
// SpacetimeDB dev module carrying the rev 4 Phase Stops reducers/tables.

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

// Real Konva drags need the fixed 1280x720 chromium-desktop viewport; the
// mobile project's layout differs. Same restriction as e2e/spectator/board.spec.ts.
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "phase stops drive the desktop-viewport phase bar and Konva board",
);

type Phase = "draw" | "upkeep" | "preparation" | "battle" | "discard";
type Gate = "upkeep" | "preparation" | "battle" | "discard" | "end";

const PHASE_LABELS: Record<Phase | "end", string> = {
  draw: "Draw",
  upkeep: "Upkeep",
  preparation: "Preparation",
  battle: "Battle",
  discard: "Discard",
  end: "End of Turn",
};

// TurnIndicator's inline colors, as Chromium reports them computed.
const AMBER = "rgb(251, 191, 36)"; // #fbbf24 — the held gate's phase-button label
const PHASE_ACTIVE = "rgb(232, 213, 163)"; // #e8d5a3 — the phase the turn is in
const PHASE_IDLE_MY_TURN = "rgba(232, 213, 163, 0.45)";

// PhaseGate bar states. GATE_FAINT covers both the resting and the hovered
// discoverability outline — Playwright leaves the mouse parked on whatever it
// last clicked, so a gate asserted right after its own click may still be in
// the hover variant.
const GATE_HELD = "rgb(251, 191, 36)"; // #fbbf24 + stopHoldPulse
const GATE_ARMED = "rgb(196, 149, 90)"; // #c4955a — set, not yet tripped
const GATE_FAINT = /^rgba\(196, 149, 90, 0\.(28|55)\)$/;
const GATE_NONE = "none"; // no bar element at all (nothing to see, nothing to toggle)

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

/**
 * A between-phase gate marker: the hit target on the boundary BEFORE `gate`'s
 * phase ('end' sits after the Discard button). Toggles the viewer's one-shot
 * stop on that boundary.
 */
function phaseGate(page: Page, gate: Gate | "draw") {
  return page.locator(`[data-testid="phase-gate-${gate}"]`);
}

/** The slim visual bar inside a gate. Absent entirely when the gate has
 *  nothing to show and nothing to toggle. */
function gateBar(page: Page, gate: Gate) {
  return phaseGate(page, gate).locator('span[aria-hidden="true"]');
}

/** A gate's bar color, or GATE_NONE when no bar renders. */
async function gateColor(page: Page, gate: Gate): Promise<string> {
  const bar = gateBar(page, gate);
  if ((await bar.count()) === 0) return GATE_NONE;
  return bar.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** The center-board priority prompt a tripped gate shows the ACTIVE player. */
function holdPrompt(page: Page) {
  return page.getByText(/requests action priority before you/);
}

function grantBtn(page: Page) {
  return page.getByRole("button", { name: /^Grant$/ });
}

function denyBtn(page: Page) {
  return page.getByRole("button", { name: /^Deny$/ });
}

/** TurnIndicator's End Turn, live only on the active seat with no hold. */
function endTurnBtn(page: Page) {
  return page.locator('button[title="End your turn"]');
}

/** The same slot while a hold is engaged: disabled, retitled. */
function heldEndTurnBtn(page: Page) {
  return page.locator('button[title="Answer the priority request first"]');
}

/** GameToolbar's separate End Turn (label text, not the same button). */
function toolbarEndTurnBtn(page: Page) {
  return page.locator('button[title="End Turn"]');
}

/** Park the mouse off every interactive element — gate bars and phase buttons
 *  both brighten on hover, and Playwright leaves the pointer where it clicked. */
async function moveMouseAway(page: Page) {
  await page.mouse.move(2, 2);
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

/** Is the Field of Battle band on screen? */
async function bandOpen(page: Page): Promise<boolean> {
  return (await readStage(page)).band !== null;
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

/** Drag my right-most hand card into the band's own half of the field.
 *  `xFrac` picks the drop x within the band — the held-drag scenario passes
 *  0.85 so the drop lands clear of the center-board priority prompt. */
async function dragHandCardIntoBand(page: Page, xFrac = 0.72) {
  const geo = await readStage(page);
  if (!geo.band) throw new Error("the Field of Battle band is not open");
  const card = await myRightmostHandCard(page);
  await dragBoard(page, card, {
    // Right half is my side of the dashed centreline (battle-zone spec §3).
    x: geo.band.x + geo.band.width * xFrac,
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
 * backstop auto-denies the prompt, so everything a test wants to see about a
 * hold has to be seen well inside that window.
 */
async function expectHoldEngaged(holder: Page, active: Page, gate: Gate) {
  // The prompt — same component as the Priority button's request — shows to
  // the ACTIVE player only, naming the gated boundary.
  const promptRe =
    gate === "end"
      ? /requests action priority before you end your turn/
      : new RegExp(`requests action priority before you\\s+move to\\s+${PHASE_LABELS[gate]}`);
  await expect(active.getByText(promptRe)).toBeVisible({ timeout: 25_000 });
  await expect(grantBtn(active)).toBeVisible();
  await expect(denyBtn(active)).toBeVisible();
  await expect(holdPrompt(holder)).toHaveCount(0);

  // The active seat's End Turn slot disables behind the prompt.
  await expect(heldEndTurnBtn(active)).toBeDisabled();

  // The tripped gate pulses amber on BOTH clients (the stop itself was
  // consumed at trip — the pulse is the hold, not the arm), and the gated
  // phase's button label goes amber too ('end' has no button).
  for (const p of [holder, active]) {
    await expect.poll(() => gateColor(p, gate), { timeout: 20_000 }).toBe(GATE_HELD);
  }
  if (gate !== "end") {
    for (const p of [holder, active]) {
      await expect(phaseBtn(p, gate)).toHaveCSS("color", AMBER);
    }
  }
}

/** No hold anywhere: prompt gone, End Turn live on the active seat. */
async function expectHoldCleared(active: Page) {
  await expect(holdPrompt(active)).toHaveCount(0, { timeout: 25_000 });
  await expect(endTurnBtn(active)).toBeEnabled({ timeout: 25_000 });
}

/** Arm the viewer's one-shot gate before `gate` and confirm both the toast
 *  copy and the bar going solid gold. Only legal on the opponent's turn. */
async function armGate(page: Page, gate: Gate) {
  await expect(phaseGate(page, gate)).toBeEnabled();
  await expect(phaseGate(page, gate)).toHaveAttribute(
    "title",
    new RegExp(`^Stop before ${PHASE_LABELS[gate]} on `),
  );
  await phaseGate(page, gate).click();
  await expect(
    page.getByText(new RegExp(`Stop set: before ${PHASE_LABELS[gate]}`)),
  ).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => gateColor(page, gate), { timeout: 10_000 }).toBe(GATE_ARMED);
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
  test("a battle gate halts in preparation; after Deny the redone click enters battle", async ({
    browser,
  }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "ps1");
    const { active, idle } = game;
    try {
      // --- 1. The non-active player arms the gate before Battle -------------
      await armGate(idle, "battle");
      await moveMouseAway(idle);
      await expect.poll(() => gateColor(idle, "battle")).toBe(GATE_ARMED);
      // The gate is private to the stopper until it trips: the active player's
      // own gates render nothing at all (no stop, no hold, nothing to toggle).
      await expect.poll(() => gateColor(active, "battle")).toBe(GATE_NONE);

      // --- 2. The active player jumps draw → battle and is HALTED IN PREP ---
      // The turn legitimately crosses draw → upkeep → preparation (the phases
      // before the gate), then stops dead at the boundary with the prompt up.
      await phaseBtn(active, "battle").click();
      await expectHoldEngaged(idle, active, "battle");

      // The pill is still on Preparation, and because battle was never
      // entered, the band never opened.
      await moveMouseAway(active);
      await expect(phaseBtn(active, "preparation")).toHaveCSS("color", PHASE_ACTIVE);
      await expect(phaseBtn(idle, "preparation")).toHaveCSS("color", PHASE_ACTIVE);
      expect(await bandOpen(active)).toBe(false);
      expect(await bandOpen(idle)).toBe(false);
      // One-shot: the stopper's arm was consumed the moment it tripped — the
      // pulse on the gate is the HOLD; the underlying stop is gone.
      await active.screenshot({ path: "test-results/phase-stops-hold-active.png" });
      await idle.screenshot({ path: "test-results/phase-stops-hold-holder.png" });

      // --- 3. The active player cannot move the turn on ---------------------
      // Every path into the guarded reducers is disabled behind the prompt.
      await expect(toolbarEndTurnBtn(active)).toBeDisabled();
      for (const phase of ["draw", "upkeep", "preparation", "battle", "discard"] as Phase[]) {
        await expect(phaseBtn(active, phase)).toBeDisabled();
      }
      await phaseBtn(active, "discard").click({ force: true }).catch(() => {});
      await active.waitForTimeout(1_500);
      await moveMouseAway(active);
      await expect(holdPrompt(active)).toBeVisible();
      await expect(phaseBtn(active, "preparation")).toHaveCSS("color", PHASE_ACTIVE);
      expect(await bandOpen(active)).toBe(false);

      // --- 4. Deny only lifts the hold: the turn STAYS in preparation -------
      await denyBtn(active).click();
      await expectHoldCleared(active);
      await moveMouseAway(active);
      await expect(phaseBtn(active, "preparation")).toHaveCSS("color", PHASE_ACTIVE);
      expect(await bandOpen(active)).toBe(false);
      // One-shot: the stopper's gate is back to the faint outline, NOT gold.
      await moveMouseAway(idle);
      await expect.poll(() => gateColor(idle, "battle"), { timeout: 10_000 }).toMatch(GATE_FAINT);

      // Redoing the move goes through — the spent gate does not re-fire.
      await phaseBtn(active, "battle").click();
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect(holdPrompt(active)).toHaveCount(0);
      await expect.poll(() => bandOpen(active), { timeout: 25_000 }).toBe(true);
      await expect.poll(() => bandOpen(idle), { timeout: 25_000 }).toBe(true);

      // The freshly opened band is a live drop target.
      await dragHandCardIntoBand(active);
      await expect.poll(() => cardsInBand(idle), { timeout: 25_000 }).toBeGreaterThan(0);

      // --- 5. End Turn now succeeds (no re-fire — the stop is spent) --------
      await endTurnBtn(active).click();
      await waitForTurn(idle);
      await expect(endTurnBtn(active)).toHaveCount(0, { timeout: 25_000 });
    } finally {
      await game.dispose();
    }
  });

  test("the end gate halts End Turn before the flip; a second End Turn completes it (and no draw gate exists)", async ({
    browser,
  }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "ps2");
    const { active, idle } = game;
    try {
      // Rev 4 gate geometry: no gate before Draw, and an 'end' gate after
      // Discard — on both clients.
      for (const p of [active, idle]) {
        await expect(phaseGate(p, "draw")).toHaveCount(0);
        await expect(phaseGate(p, "end")).toHaveCount(1);
      }

      await armGate(idle, "end");

      // End Turn from draw: the turn crosses upkeep/preparation/battle/discard
      // (band-open suppressed on the crossing — passing battle en route is not
      // an attack) and halts at the 'end' boundary with the prompt up.
      await endTurnBtn(active).click();
      await expectHoldEngaged(idle, active, "end");
      await moveMouseAway(active);
      await expect(phaseBtn(active, "discard")).toHaveCSS("color", PHASE_ACTIVE);
      expect(await bandOpen(active)).toBe(false);
      expect(await bandOpen(idle)).toBe(false);
      await active.screenshot({ path: "test-results/phase-stops-end-gate.png" });

      // Deny only lifts the hold: the turn stays on Discard, unflipped.
      await denyBtn(active).click();
      await expectHoldCleared(active);
      await moveMouseAway(active);
      await expect(phaseBtn(active, "discard")).toHaveCSS("color", PHASE_ACTIVE);

      // Pressing End Turn again completes the flip — the spent end gate lets
      // it through.
      await endTurnBtn(active).click();
      await waitForTurn(idle);
      await expect(endTurnBtn(active)).toHaveCount(0, { timeout: 25_000 });
      // One-shot, seen from the new turn's perspective: the former stopper is
      // now the active player, so their own consumed gate renders nothing.
      await moveMouseAway(idle);
      await expect.poll(() => gateColor(idle, "end"), { timeout: 10_000 }).toBe(GATE_NONE);
    } finally {
      await game.dispose();
    }
  });

  test("Grant lifts the hold without advancing, and the spent gate does not re-fire", async ({
    browser,
  }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "ps3");
    const { active, idle } = game;
    try {
      await armGate(idle, "preparation");

      // Draw → preparation: the turn crosses into upkeep and halts at the
      // preparation boundary.
      await phaseBtn(active, "preparation").click();
      await expectHoldEngaged(idle, active, "preparation");
      await moveMouseAway(active);
      await expect(phaseBtn(active, "upkeep")).toHaveCSS("color", PHASE_ACTIVE);

      // Grant: the hold lifts but the turn STAYS in upkeep — the stopper has
      // their window on the honor system, and the active player continues
      // whenever both are ready.
      await grantBtn(active).click();
      await expect(active.getByText(/Action priority granted/)).toBeVisible({ timeout: 5_000 });
      await expectHoldCleared(active);
      await moveMouseAway(active);
      await expect(phaseBtn(active, "upkeep")).toHaveCSS("color", PHASE_ACTIVE);
      await expect(phaseBtn(active, "preparation")).toHaveCSS("color", PHASE_IDLE_MY_TURN);

      // One-shot: the stop was consumed at trip, so re-clicking Preparation
      // sails through — no prompt, no hold.
      await phaseBtn(active, "preparation").click();
      await moveMouseAway(active);
      await expect(phaseBtn(active, "preparation")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect(holdPrompt(active)).toHaveCount(0);
      await moveMouseAway(idle);
      await expect.poll(() => gateColor(idle, "preparation"), { timeout: 10_000 }).toMatch(GATE_FAINT);
    } finally {
      await game.dispose();
    }
  });

  test("a discard gate holds at the battle boundary (E17), re-arming re-fires, and a held band-open drag is refused", async ({
    browser,
  }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "p16");
    const { active, idle } = game;
    try {
      // ===================================================================
      // PART 1 — the discard gate fires out of a phase click at the battle
      // boundary WITHOUT writing the phase: the pill stays on Battle, the
      // band stays open, and its conclude buttons go dead (E17).
      // ===================================================================

      // --- 1. Open the battle phase and commit an attacker ------------------
      await phaseBtn(active, "battle").click();
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect.poll(() => bandOpen(active), { timeout: 25_000 }).toBe(true);

      await dragHandCardIntoBand(active);
      await expect.poll(() => cardsInBand(active), { timeout: 25_000 }).toBeGreaterThan(0);

      // --- 2. NOW the opponent arms the gate before Discard -----------------
      await armGate(idle, "discard");

      // --- 3. Advancing to discard halts at the gate ------------------------
      // The gate is the very next boundary: no phase write at all, just the
      // hold. The pill never leaves Battle, so the band never closes.
      await phaseBtn(active, "discard").click();
      await expectHoldEngaged(idle, active, "discard");
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE);
      await expect.poll(() => bandOpen(active), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => cardsInBand(active), { timeout: 10_000 }).toBeGreaterThan(0);

      // --- 4. E17: the band's conclude buttons are dead while held ----------
      // (There is no End Battle button anymore — the attacker walks away by
      // progressing the phase, which is exactly what step 3 above attempted
      // and the gate held. Win Battle is the only attacker band button.)
      const winBattleBtn = active.getByRole("button", { name: /Win Battle/ });
      await expect(winBattleBtn).toBeVisible();
      await expect(winBattleBtn).toBeDisabled();

      // Force-clicking the disabled button must not dispatch — no reducer
      // call, so no SenderError, so no unhandled-rejection pageerror.
      const battlePageErrors: string[] = [];
      active.on("pageerror", (e) => battlePageErrors.push(String(e)));
      await winBattleBtn.click({ force: true }).catch(() => {});
      await active.waitForTimeout(500);
      expect(battlePageErrors).toEqual([]);
      await expect.poll(() => cardsInBand(active), { timeout: 5_000 }).toBeGreaterThan(0);
      await expect(holdPrompt(active)).toBeVisible();
      await active.screenshot({ path: "test-results/phase-stops-discard-gate-held.png" });

      // --- 5. Deny lifts the hold with the turn still on Battle -------------
      // The band (and its attacker) survives; the conclude buttons come back
      // to life; re-clicking Discard then advances for real, auto-returning
      // the band.
      await denyBtn(active).click();
      await expectHoldCleared(active);
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE);
      await expect.poll(() => cardsInBand(active), { timeout: 10_000 }).toBeGreaterThan(0);
      await expect(active.getByRole("button", { name: /Win Battle/ })).toBeEnabled();

      await phaseBtn(active, "discard").click();
      await moveMouseAway(active);
      await expect(phaseBtn(active, "discard")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect(holdPrompt(active)).toHaveCount(0);
      await expect.poll(() => bandOpen(active), { timeout: 25_000 }).toBe(false);

      // ===================================================================
      // PART 2 — re-arming the SAME spent gate re-fires it ("trip once,
      // toggle again"), this time in the band-open battleState=='' window
      // where a turn-player drag routes through enter_battle and
      // assertTurnNotHeld refuses it with the "has priority" toast.
      // ===================================================================

      // --- 6. Back to battle, attack, and win it: band open, battleState '' -
      await phaseBtn(active, "battle").click();
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect.poll(() => bandOpen(active), { timeout: 25_000 }).toBe(true);
      await dragHandCardIntoBand(active);
      await expect.poll(() => cardsInBand(active), { timeout: 25_000 }).toBeGreaterThan(0);

      // No Lost Souls in the seeded decks, so resolve_battle auto-returns
      // immediately: the band empties and battleState clears while the phase
      // bar stays on battle.
      await active.getByRole("button", { name: /Win Battle/ }).click();
      await expect.poll(() => cardsInBand(active), { timeout: 25_000 }).toBe(0);
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE);
      await expect.poll(() => bandOpen(active), { timeout: 10_000 }).toBe(true);

      // --- 7. Re-arm the spent discard gate; it fires again -----------------
      await expect.poll(() => gateColor(idle, "discard"), { timeout: 10_000 }).toMatch(GATE_FAINT);
      await armGate(idle, "discard");
      await phaseBtn(active, "discard").click();
      await expectHoldEngaged(idle, active, "discard");
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE);

      // --- 8. A band-opening drag during the hold is REFUSED ----------------
      // battleState === '' so the drop routes through enter_battle, whose
      // assertTurnNotHeld throws; useGameState's enterBattle .catch surfaces
      // it as an error toast and the card never leaves the hand.
      const toast = active.getByText(/The turn is held/);
      await dragHandCardIntoBand(active, 0.85);
      await expect(toast).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => cardsInBand(idle), { timeout: 10_000 }).toBe(0);
      await expect.poll(() => cardsInBand(active), { timeout: 10_000 }).toBe(0);
      await expect(holdPrompt(active)).toBeVisible();
      await active.screenshot({ path: "test-results/phase-stops-held-band-open.png" });

      // --- 9. Deny lifts the hold; re-clicking Discard closes out the turn --
      await denyBtn(active).click();
      await expectHoldCleared(active);
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE);

      await phaseBtn(active, "discard").click();
      await moveMouseAway(active);
      await expect(phaseBtn(active, "discard")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect(holdPrompt(active)).toHaveCount(0);
      await expect.poll(() => bandOpen(active), { timeout: 25_000 }).toBe(false);
    } finally {
      await game.dispose();
    }
  });
});
