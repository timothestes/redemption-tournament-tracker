import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedPlayer, cleanupPlayer, adminAvailable } from "../spectatorSeed";
import { login, hostGame, joinGame, bothReachPlaying } from "../spectator/playHelpers";

// Two-browser coverage of Phase Stops (opponent-turn priority stops), spec
// docs/superpowers/specs/2026-08-15-phase-stops-design.md §10 + the Rev 3
// gate-between-phases correction. Harness is e2e/play/pregameStarPhase.spec.ts
// verbatim: seeded players, one browser context each, host/join, then the
// pregame ceremony auto-completes because the seeded deck has no star cards
// and no Lost Souls.
//
// REV 3 MODEL (what every assertion below is written against): a stop is a
// GATE on the boundary INTO a phase, not a pause on the phase itself. Arming
// happens on the between-phase gate markers (data-testid="phase-gate-{phase}"),
// the turn HALTS BEFORE the gated phase (so the phase pill is still on the
// PREVIOUS phase while held, and a battle gate's hold has NO open band), and
// RELEASE — PASS, toggle-off, or timeout — auto-advances the turn INTO the
// gated phase with no further clicks from the active player.
//
// The four scenarios:
//   1. Battle gate end-to-end — arm → advance halts in PREPARATION with the
//      band shut → active is frozen → PASS auto-enters battle and opens the
//      band → end turn.
//   2. E3  — a draw gate set on the opponent's turn fires at the NEXT flip
//      (flip-then-hold: the hold sits at the top of draw AFTER the auto-draw,
//      so this one flow is unchanged from rev 2).
//   3. E6  — the holder toggling the held gate off releases the hold, and the
//      release AUTO-ADVANCES into the gated phase.
//   4. R4/R5 — the discard gate fires out of end_battle without writing the
//      phase (E17: the band stays open and its conclude buttons go dead), and
//      a turn player's band-opening drag during an active hold is refused with
//      an error toast.
//
// Three deliberate deviations from the brief's wording, all forced by the
// client and all asserted in their honest form (see the per-test comments):
//   - Scenario 1's "active player clicks End Turn → error toast": every UI
//     path into a hold-guarded reducer is DISABLED for the active player
//     (TurnIndicator End Turn, GameToolbar End Turn, all five phase buttons,
//     both arrows), so the guarded reducer is never called and its
//     toastReducerError catch (useGameState.ts) never fires. Asserted as:
//     the controls are disabled, and clicking through them changes nothing.
//   - Scenario 4's "attacker drags into the band DURING PREPARATION": that is
//     unreachable from the client, so rev 3's R5 silent refusal cannot be
//     driven end-to-end. The band is phase-driven (isBattleBandActive —
//     MultiplayerCanvas.tsx: status==='playing' && (currentPhase==='battle' ||
//     battleState!=='')) and findZoneAtPosition only returns the 'battle' zone
//     when the band is on screen, so during preparation no drop — canvas drag,
//     group drag, or modal drag; all five enterBattle call sites — can even
//     reach enter_battle. R5's own precondition (battleState==='' AND
//     currentPhase index < battle) therefore never coincides with a droppable
//     band except when the phase IS battle and a resolved battle has cleared
//     battleState — and R5 deliberately excludes currentPhase==='battle'
//     (no retro-fire, §5.6). What IS reachable, and what scenario 4 drives, is
//     the other half of the same guard: assertTurnNotHeld inside enter_battle,
//     which refuses the turn player's band-opening drag during ANY active hold
//     and surfaces it as an error toast.
//   - E17's "band conclude buttons are disabled while held" moved out of
//     scenario 1: a battle gate's hold now has no open band at all. Its new
//     home is scenario 4, where a DISCARD gate holds the turn with the phase
//     still on battle and the band still open.
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL and a
// SpacetimeDB dev module carrying the rev 3 Phase Stops reducers/tables.

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
const AMBER = "rgb(251, 191, 36)"; // #fbbf24 — the held phase's button label
const PHASE_ACTIVE = "rgb(232, 213, 163)"; // #e8d5a3 — the phase the turn is in
const PHASE_IDLE_MY_TURN = "rgba(232, 213, 163, 0.45)";

// PhaseGate bar states (rev 3). GATE_FAINT covers both the resting and the
// hovered discoverability outline — Playwright leaves the mouse parked on
// whatever it last clicked, so a gate asserted right after its own click may
// still be in the hover variant.
const GATE_HELD = "rgb(251, 191, 36)"; // #fbbf24 + stopHoldPulse
const GATE_ARMED = "rgb(196, 149, 90)"; // #c4955a — set but unfired
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
 * A between-phase gate marker (rev 3): the hit target that sits immediately
 * BEFORE `phase`'s button and toggles the viewer's stop on that phase. The
 * draw gate is the leftmost element in the row.
 */
function phaseGate(page: Page, phase: Phase) {
  return page.locator(`[data-testid="phase-gate-${phase}"]`);
}

/** The slim visual bar inside a gate. Absent entirely when the gate has
 *  nothing to show and nothing to toggle. */
function gateBar(page: Page, phase: Phase) {
  return phaseGate(page, phase).locator('span[aria-hidden="true"]');
}

/** A gate's bar color, or GATE_NONE when no bar renders. */
async function gateColor(page: Page, phase: Phase): Promise<string> {
  const bar = gateBar(page, phase);
  if ((await bar.count()) === 0) return GATE_NONE;
  return bar.evaluate((el) => getComputedStyle(el).backgroundColor);
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
  // Rev 3 copy (C4): the caption names the GATE, not a phase the turn is in.
  await expect(heldBtn(active)).toHaveAttribute(
    "title",
    new RegExp(`stopped before ${PHASE_LABELS[phase]}`),
  );

  // The gate before the phase pulses amber, and the phase button behind it
  // takes the amber label — on BOTH clients. The stopper's view is not private.
  for (const p of [holder, active]) {
    await expect.poll(() => gateColor(p, phase), { timeout: 20_000 }).toBe(GATE_HELD);
    await expect(phaseBtn(p, phase)).toHaveCSS("color", AMBER);
  }
}

/** No hold anywhere: PASS gone on the holder, End Turn live on the active seat. */
async function expectHoldCleared(holder: Page, active: Page) {
  await expect(passBtn(holder)).toHaveCount(0, { timeout: 25_000 });
  await expect(heldBtn(active)).toHaveCount(0, { timeout: 25_000 });
  await expect(endTurnBtn(active)).toBeEnabled({ timeout: 25_000 });
}

/** Arm the viewer's gate before `phase` and confirm both the toast copy and
 *  the bar going solid gold. Only legal on the opponent's turn. */
async function armGate(page: Page, phase: Phase) {
  await expect(phaseGate(page, phase)).toBeEnabled();
  await expect(phaseGate(page, phase)).toHaveAttribute(
    "title",
    new RegExp(`^Stop before ${PHASE_LABELS[phase]} on `),
  );
  await phaseGate(page, phase).click();
  await expect(
    page.getByText(new RegExp(`Stop set: before ${PHASE_LABELS[phase]}`)),
  ).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => gateColor(page, phase), { timeout: 10_000 }).toBe(GATE_ARMED);
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
  test("a battle gate halts the turn IN preparation, and PASS enters battle", async ({
    browser,
  }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "ps1");
    const { active, idle } = game;
    try {
      // --- 1. The non-active player arms the gate before Battle -------------
      // Gate markers are the ONLY stop control in rev 3 — the phase buttons
      // went back to being plain own-turn jumps.
      await armGate(idle, "battle");
      await moveMouseAway(idle);
      await expect.poll(() => gateColor(idle, "battle")).toBe(GATE_ARMED);
      // The gate is private to the stopper until it fires: the active player's
      // own gates render nothing at all (no stop, no hold, nothing to toggle).
      await expect.poll(() => gateColor(active, "battle")).toBe(GATE_NONE);

      // --- 2. The active player jumps draw → battle and is HALTED IN PREP ---
      // R1: the turn legitimately crosses draw → upkeep → preparation (g-1),
      // then stops dead at the gate. It does NOT enter battle.
      await phaseBtn(active, "battle").click();
      await expectHoldEngaged(idle, active, "battle");

      // The pill is still on Preparation — this is the whole rev 3 correction.
      await moveMouseAway(active);
      await expect(phaseBtn(active, "preparation")).toHaveCSS("color", PHASE_ACTIVE);
      await expect(phaseBtn(idle, "preparation")).toHaveCSS("color", PHASE_ACTIVE);
      // And because battle was never entered, the band never opened: no
      // phantom Field of Battle behind the hold.
      expect(await bandOpen(active)).toBe(false);
      expect(await bandOpen(idle)).toBe(false);
      await active.screenshot({ path: "test-results/phase-stops-hold-active.png" });
      await idle.screenshot({ path: "test-results/phase-stops-hold-holder.png" });

      // --- 3. The active player cannot move the turn on ---------------------
      // The brief asks for the "The turn is held" SenderError toast here. It is
      // unreachable through these controls: the client disables every path into
      // the guarded reducers rather than letting them throw, so the
      // toastReducerError catch never gets a rejection to toast. (Scenario 4
      // drives the one path that IS reachable — a band-open drag.) The
      // equivalent assertion is that the controls are dead and nothing budges.
      await expect(heldBtn(active)).toBeDisabled();
      await expect(toolbarEndTurnBtn(active)).toBeDisabled();
      for (const phase of ["draw", "upkeep", "preparation", "battle", "discard"] as Phase[]) {
        await expect(phaseBtn(active, phase)).toBeDisabled();
      }
      await heldBtn(active).click({ force: true }).catch(() => {});
      await phaseBtn(active, "discard").click({ force: true }).catch(() => {});
      await active.waitForTimeout(1_500);
      // Still held, still parked in preparation, still no band.
      await moveMouseAway(active);
      await expect(heldBtn(active)).toBeVisible();
      await expect(phaseBtn(active, "preparation")).toHaveCSS("color", PHASE_ACTIVE);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", AMBER);
      expect(await bandOpen(active)).toBe(false);
      await expect(passBtn(idle)).toBeVisible();

      // --- 4. PASS crosses the gate: the turn ENTERS battle by itself -------
      // R3 — no further clicks from the active player, and passing a battle
      // GATE is what opens the band.
      await passBtn(idle).click();
      await expectHoldCleared(idle, active);
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect.poll(() => bandOpen(active), { timeout: 25_000 }).toBe(true);
      await expect.poll(() => bandOpen(idle), { timeout: 25_000 }).toBe(true);
      // The gate itself is spent for this turn but the stop survives: gold again.
      await moveMouseAway(idle);
      await expect.poll(() => gateColor(idle, "battle"), { timeout: 10_000 }).toBe(GATE_ARMED);

      // The freshly opened band is a live drop target.
      await dragHandCardIntoBand(active);
      await expect.poll(() => cardsInBand(idle), { timeout: 25_000 }).toBeGreaterThan(0);

      // --- 5. End Turn now succeeds ----------------------------------------
      await endTurnBtn(active).click();
      await waitForTurn(idle);
      await expect(endTurnBtn(active)).toHaveCount(0, { timeout: 25_000 });
    } finally {
      await game.dispose();
    }
  });

  test("E3: a draw gate fires at the next turn flip, with the stopper holding", async ({
    browser,
  }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "ps3");
    const { active: first, idle: second } = game;
    try {
      // Gates can only be armed on the opponent's turn, so `second` arms the
      // draw gate now — it cannot fire on `first`'s turn (a draw gate is never
      // in end_turn's upkeep..discard scan range).
      await armGate(second, "draw");

      // First flip: `second` takes the turn, nothing holds (the new non-active
      // seat is `first`, who has no stops).
      await endTurnBtn(first).click();
      await waitForTurn(second);
      await expect(passBtn(second)).toHaveCount(0);
      await expect(heldBtn(second)).toHaveCount(0);

      // Second flip: `second` ends their OWN turn, and their own draw gate
      // engages against `first`'s fresh draw — E3, the counter-intuitive one.
      // R2 keeps this flip-then-hold: holding BEFORE the flip would invert the
      // holder seat, so the hold sits at the top of draw after the auto-draw
      // and the pill is legitimately already on Draw.
      await endTurnBtn(second).click();
      await expectHoldEngaged(second, first, "draw");
      await second.screenshot({ path: "test-results/phase-stops-e3-flip.png" });

      // And it releases normally — a no-op transition, since the turn is
      // already in the released phase (R3's currentPhase === releasedPhase guard).
      await passBtn(second).click();
      await expectHoldCleared(second, first);
      await moveMouseAway(first);
      await expect(phaseBtn(first, "draw")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      // The stop itself survives the release — armed for next time, bar gold.
      await moveMouseAway(second);
      await expect.poll(() => gateColor(second, "draw"), { timeout: 10_000 }).toBe(GATE_ARMED);
    } finally {
      await game.dispose();
    }
  });

  test("E6: toggling the held gate off releases it AND enters the gated phase", async ({
    browser,
  }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "ps6");
    const { active, idle } = game;
    try {
      await armGate(idle, "battle");

      await phaseBtn(active, "battle").click();
      await expectHoldEngaged(idle, active, "battle");
      await moveMouseAway(active);
      await expect(phaseBtn(active, "preparation")).toHaveCSS("color", PHASE_ACTIVE);
      expect(await bandOpen(active)).toBe(false);

      // "Never mind" — tapping the held gate again both clears the stop and
      // releases the hold sitting on it (spec §6.1). In rev 3 the toggle-off
      // release goes through the SAME releaseHold path as PASS, so it also
      // advances the turn through the gate.
      await phaseGate(idle, "battle").click();
      await expect(idle.getByText(/Stop removed: before Battle/)).toBeVisible({ timeout: 5_000 });
      await expectHoldCleared(idle, active);

      // Auto-advance: nobody clicked a phase button, but the turn is in battle
      // and the band is open.
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect.poll(() => bandOpen(active), { timeout: 25_000 }).toBe(true);

      // The stop is gone: faint discoverability outline for the stopper,
      // nothing at all for the active player.
      await moveMouseAway(idle);
      await expect.poll(() => gateColor(idle, "battle"), { timeout: 10_000 }).toMatch(GATE_FAINT);
      await expect.poll(() => gateColor(active, "battle")).toBe(GATE_NONE);

      // The active player can move on immediately, and nothing re-fires.
      await phaseBtn(active, "discard").click();
      await moveMouseAway(active);
      await expect(phaseBtn(active, "discard")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_IDLE_MY_TURN);
      await expect(heldBtn(active)).toHaveCount(0);
    } finally {
      await game.dispose();
    }
  });

  test("a discard gate holds with the band open (E17), and a held band-open drag is refused", async ({
    browser,
  }) => {
    requireSeed();
    const game = await twoPlayerGame(browser, "p16");
    const { active, idle } = game;
    try {
      // ===================================================================
      // PART 1 — R4 + E17. A discard gate halts the turn WITHOUT writing the
      // phase, so the pill stays on Battle and the band stays open; the
      // band's conclude buttons go dead for the duration.
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
      // R1 with g-1 === oldIdx: no phase write at all, just the hold. The pill
      // never leaves Battle, so the band never closes.
      await phaseBtn(active, "discard").click();
      await expectHoldEngaged(idle, active, "discard");
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE);
      await expect.poll(() => bandOpen(active), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => cardsInBand(active), { timeout: 10_000 }).toBeGreaterThan(0);

      // --- 4. E17: the band's conclude buttons are dead while held ----------
      const winBattleBtn = active.getByRole("button", { name: /Win Battle/ });
      const endBattleBtn = active.getByRole("button", { name: /End Battle/ });
      await expect(winBattleBtn).toBeVisible();
      await expect(winBattleBtn).toBeDisabled();
      await expect(endBattleBtn).toBeDisabled();

      // Force-clicking the disabled buttons must not dispatch — no reducer
      // call, so no SenderError, so no unhandled-rejection pageerror (this was
      // the original E17 bug: before isTurnHeld gated these buttons,
      // force-clicking them dispatched a rejected reducer call that surfaced
      // as an unhandled-rejection pageerror).
      const battlePageErrors: string[] = [];
      active.on("pageerror", (e) => battlePageErrors.push(String(e)));
      await winBattleBtn.click({ force: true }).catch(() => {});
      await endBattleBtn.click({ force: true }).catch(() => {});
      await active.waitForTimeout(500);
      expect(battlePageErrors).toEqual([]);
      await expect.poll(() => cardsInBand(active), { timeout: 5_000 }).toBeGreaterThan(0);
      await expect(heldBtn(active)).toBeVisible();
      await active.screenshot({ path: "test-results/phase-stops-discard-gate-held.png" });

      // --- 5. PASS crosses the gate into discard, closing the band ----------
      await passBtn(idle).click();
      await expectHoldCleared(idle, active);
      await moveMouseAway(active);
      await expect(phaseBtn(active, "discard")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect.poll(() => bandOpen(active), { timeout: 25_000 }).toBe(false);

      // ===================================================================
      // PART 2 — the reachable half of R5. Two flips reset firedPhases (the
      // stop itself persists), then the same discard gate is re-armed by the
      // server for a NEW turn. This time the band is open but EMPTY
      // (battleState === '' after an unopposed Win Battle), which is the one
      // client-reachable state where a turn-player drag routes through
      // enter_battle with the band closed server-side — and assertTurnNotHeld
      // refuses it with a toast.
      // ===================================================================
      await endTurnBtn(active).click();
      await waitForTurn(idle);
      await expect(passBtn(idle)).toHaveCount(0);
      await endTurnBtn(idle).click();
      await waitForTurn(active);
      await expect(passBtn(idle)).toHaveCount(0);

      // --- 6. Battle phase, attack, and win it: band open, battleState '' ---
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

      // --- 7. The discard gate fires again on the fresh turn ---------------
      // firedPhases resets at the flip, so the still-armed stop is live again.
      await expect.poll(() => gateColor(idle, "discard"), { timeout: 10_000 }).toBe(GATE_ARMED);
      await phaseBtn(active, "discard").click();
      await expectHoldEngaged(idle, active, "discard");
      await moveMouseAway(active);
      await expect(phaseBtn(active, "battle")).toHaveCSS("color", PHASE_ACTIVE);

      // --- 8. A band-opening drag during the hold is REFUSED ----------------
      // battleState === '' so the drop routes through enter_battle, whose
      // assertTurnNotHeld throws; useGameState's enterBattle .catch surfaces it
      // as an error toast and the card never leaves the hand.
      const toast = active.getByText(/The turn is held/);
      await dragHandCardIntoBand(active);
      await expect(toast).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => cardsInBand(idle), { timeout: 10_000 }).toBe(0);
      await expect.poll(() => cardsInBand(active), { timeout: 10_000 }).toBe(0);
      await expect(heldBtn(active)).toBeVisible();
      await active.screenshot({ path: "test-results/phase-stops-held-band-open.png" });

      // --- 9. Release enters discard and closes the band --------------------
      await passBtn(idle).click();
      await expectHoldCleared(idle, active);
      await moveMouseAway(active);
      await expect(phaseBtn(active, "discard")).toHaveCSS("color", PHASE_ACTIVE, {
        timeout: 25_000,
      });
      await expect.poll(() => bandOpen(active), { timeout: 25_000 }).toBe(false);
    } finally {
      await game.dispose();
    }
  });
});
