import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  seedPlayer,
  cleanupPlayer,
  adminAvailable,
  admin,
} from "../spectatorSeed";
import { login, hostGame, joinGame, bothReachPlaying } from "../spectator/playHelpers";

// End-to-end coverage of the REG Pre-Game Phase (steps 2 and 3): star reveals,
// then Lost Soul activation. Both players are seeded with a deck of star cards
// so the star window actually opens instead of auto-skipping.
//
// The two regressions this pins:
//  1. The board stays fully interactive while the rail is mounted. The rail is
//     a DOM overlay over the Konva canvas; a wrapper that forgot
//     pointer-events: none would swallow every board click. The drag below is
//     driven with real mouse events (page.mouse.*), never dispatchEvent — a
//     synthetic event bypasses exactly the layer this is testing.
//  2. move_card_to_top_of_deck succeeds during the phase. It — and ~20 other
//     reducers — is gated on `status === 'playing'`, which is why the phase
//     runs with status 'playing' and gates turn machinery on `pregamePhase`
//     instead. An earlier design kept status at 'pregame' and would have made
//     every one of those reducers throw 'Game is not in playing state'.
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL and a healthy
// SpacetimeDB dev module (NEXT_PUBLIC_SPACETIMEDB_DB_NAME).

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

// Real Konva drags need the fixed 1280x720 chromium-desktop viewport; the
// mobile project's layout differs. Same restriction as e2e/spectator/board.spec.ts.
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "pre-game star phase drives the desktop-viewport Konva board",
);

// A star card whose registry entry encodes its STAR clause, so its ability is
// hand-legal (see the card audit in the plan). Every copy in the deck is the
// same card, which makes the opening hand deterministic: 8 stars, always.
const STAR_CARD = {
  name: "Sign of Jonah",
  set: "PoC",
  img: "188-Sign-of-Jonah",
  qty: 50,
};
const ABILITY_LABEL = "Look at top 3 cards of deck";

/** Replace a seeded deck's contents with an all-star deck. */
async function makeStarDeck(deckId: string) {
  if (!admin) throw new Error("makeStarDeck requires SUPABASE_SERVICE_ROLE_KEY");
  const { error: delErr } = await admin.from("deck_cards").delete().eq("deck_id", deckId);
  if (delErr) throw new Error(`deck_cards delete failed: ${delErr.message}`);
  const { error: insErr } = await admin.from("deck_cards").insert({
    deck_id: deckId,
    card_name: STAR_CARD.name,
    card_set: STAR_CARD.set,
    card_img_file: STAR_CARD.img,
    quantity: STAR_CARD.qty,
    zone: "main",
  });
  if (insErr) throw new Error(`deck_cards insert failed: ${insErr.message}`);
  const { error: updErr } = await admin
    .from("decks")
    .update({ card_count: STAR_CARD.qty })
    .eq("id", deckId);
  if (updErr) throw new Error(`deck card_count update failed: ${updErr.message}`);
}

/** The rail panel — the parent of its heading div, so its chips are in scope. */
function railPanel(page: Page, heading: string) {
  return page.getByText(heading, { exact: true }).locator("xpath=..");
}

/**
 * Whichever of the two player pages currently owns the star window. Only the
 * active seat's rail renders the submit buttons, and which seat goes first is
 * decided by a dice roll we don't control.
 */
async function pageWithStarWindow(pages: Page[]): Promise<Page> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    for (const p of pages) {
      if (await p.getByRole("button", { name: /^No stars$/i }).count()) return p;
    }
    await pages[0].waitForTimeout(500);
  }
  throw new Error("no pre-game star window opened on either page");
}

interface BoardGeometry {
  /** Centre points of my face-up star cards, right-most first. */
  cards: Array<{ x: number; y: number }>;
  /** Screen y of the HAND zone label, i.e. the top of my hand row. */
  handTop: number | null;
  stage: { left: number; top: number; width: number; height: number };
}

/**
 * Read real screen coordinates out of the live Konva stage. Card nodes carry no
 * DOM, so hit-testing goes through the loaded image's src — the seeded deck is
 * a single card name, so every face-up match is one of my hand cards.
 */
async function readBoard(page: Page, imgFragment: string): Promise<BoardGeometry> {
  const geo = await page.evaluate((frag) => {
    const K = (window as any).Konva;
    if (!K || !K.stages || !K.stages.length) return null;
    const stage = [...K.stages].sort((a: any, b: any) => b.width() - a.width())[0];
    const box = stage.container().getBoundingClientRect();
    const cards = (stage.find("Image") as any[])
      .filter((n: any) => {
        const im = n.image();
        return im && typeof im.src === "string" && im.src.includes(frag);
      })
      .map((n: any) => {
        const r = n.getClientRect();
        return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
      })
      // Right-most first: the rail sits over the bottom-LEFT of the canvas and
      // overlaps the left end of the hand row, so the left-most hand cards are
      // genuinely unreachable by a real click.
      .sort((a: any, b: any) => b.x - a.x);
    const handLabel = (stage.find("Text") as any[]).find((t: any) => t.text() === "HAND");
    const handTop = handLabel ? box.top + handLabel.getClientRect().y : null;
    return {
      cards,
      handTop,
      stage: { left: box.left, top: box.top, width: box.width, height: box.height },
    };
  }, imgFragment);
  if (!geo) throw new Error("Konva stage not found on the page");
  return geo as BoardGeometry;
}

/** A real mouse drag — trusted events, the only kind Konva hit-tests. */
async function dragBoard(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several intermediate moves: Konva starts a drag only after the pointer
  // actually travels, and the drop target is resolved from the last position.
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / 12,
      from.y + ((to.y - from.y) * i) / 12,
    );
  }
  await page.mouse.up();
}

const requireSeed = () => {
  if (!adminAvailable) {
    throw new Error(
      "Pre-game star phase E2E requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.",
    );
  }
};

test.describe("REG pre-game star phase", () => {
  test("stars resolve, the board stays live, and turn 1 begins", async ({ browser }) => {
    requireSeed();
    const host = await seedPlayer("star-h");
    const joiner = await seedPlayer("star-j");
    await makeStarDeck(host.deckId);
    await makeStarDeck(joiner.deckId);

    let hostCtx: BrowserContext | null = null;
    let joinCtx: BrowserContext | null = null;
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

      // --- 1. The pre-game header and the star rail -------------------------
      const active = await pageWithStarWindow([hostPage, joinPage]);
      const idle = active === hostPage ? joinPage : hostPage;

      // TurnIndicator swaps the five turn phases for the pre-game treatment.
      // Exact match: the rail's own heading reads "Pre-Game Phase · Stars".
      await expect(active.getByText("Pre-Game Phase", { exact: true })).toBeVisible();
      await expect(active.getByText("Lost Souls", { exact: true }).first()).toBeVisible();
      await expect(active.getByRole("button", { name: /^No stars$/i })).toBeVisible();
      await active.screenshot({ path: "test-results/pregame-star-rail.png" });

      // --- 2. GameToolbar is mounted ---------------------------------------
      await expect(active.locator('button[title="Draw (D)"]')).toBeVisible();

      // --- 3. The board is interactive under the rail -----------------------
      const rail = railPanel(active, "Pre-Game Phase · Stars");
      const chipsBefore = await rail.locator("span").count();
      expect(chipsBefore).toBeGreaterThan(1);

      const geo = await readBoard(active, STAR_CARD.img);
      expect(geo.cards.length, "no face-up star cards found on the board").toBeGreaterThan(0);
      const handCard = geo.cards[0];
      // Drop into my territory: the open band above the hand row and below the
      // battle area, well clear of the rail's bottom-left panel.
      const drop = {
        x: geo.stage.left + geo.stage.width * 0.35,
        y: (geo.handTop ?? handCard.y) - 180,
      };
      await dragBoard(active, handCard, drop);

      // The rail's chips are derived from star cards in MY hand, so one fewer
      // chip proves the server accepted a real board drag out of the hand.
      await expect
        .poll(async () => rail.locator("span").count(), { timeout: 20_000 })
        .toBe(chipsBefore - 1);

      // --- 4. Reveal one star, its ability is hand-legal --------------------
      await rail.locator("span").first().click();
      const revealBtn = active.getByRole("button", { name: /^Reveal 1 star$/i });
      await expect(revealBtn).toBeVisible();
      await revealBtn.click();

      const abilityBtn = active.getByRole("button", { name: ABILITY_LABEL });
      await expect(abilityBtn).toBeVisible({ timeout: 20_000 });
      await expect(abilityBtn).toBeEnabled();
      await expect(active.getByRole("button", { name: /Resolved/i })).toBeVisible();

      // The opponent sees the reveal without owning the window.
      await expect(idle.getByText(/Waiting for .* to reveal stars/i)).toBeVisible({
        timeout: 20_000,
      });

      // --- 5. A topdeck succeeds during the phase ---------------------------
      await abilityBtn.click();
      const peeked = active.locator("[data-card-id]");
      await expect(peeked.first()).toBeVisible({ timeout: 20_000 });
      await peeked.first().click({ button: "right" });
      // Two controls read "Top of Deck": the modal footer's put-the-rest-back
      // button (a no-op for a top peek — the cards are already on top) and the
      // per-card context menu, which always calls the reducer. The context menu
      // renders after the modal body, so it is the last match.
      await active.getByRole("button", { name: /^Top of Deck$/ }).last().click();
      // move_card_to_top_of_deck logs MOVE_TO_TOP_OF_DECK; the game log is the
      // only proof the reducer ran rather than throwing.
      await expect(active.getByText(/to top of their deck/i).first()).toBeVisible({
        timeout: 20_000,
      });
      await active.screenshot({ path: "test-results/pregame-star-topdeck.png" });
      await active.keyboard.press("Escape");

      // --- 6. Finish both windows and reach turn 1 --------------------------
      await active.getByRole("button", { name: /Resolved/i }).click();

      const second = await pageWithStarWindow([hostPage, joinPage]);
      await second.getByRole("button", { name: /^No stars$/i }).click();

      // Neither player has a Lost Soul, so the soul step auto-skips on the
      // server and the pre-game completes outright.
      for (const p of [hostPage, joinPage]) {
        await expect(p.getByText("Pre-Game Phase", { exact: true })).toHaveCount(0, {
          timeout: 45_000,
        });
        await expect(p.getByText("Preparation", { exact: true }).first()).toBeVisible({
          timeout: 20_000,
        });
        await expect(p.locator('button[title="Draw (D)"]')).toBeVisible();
      }
    } finally {
      await joinCtx?.close();
      await hostCtx?.close();
      await cleanupPlayer(joiner);
      await cleanupPlayer(host);
    }
  });
});
