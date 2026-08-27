import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { seedPlayer, cleanupPlayer, adminAvailable, type SeededPlayer } from "../spectatorSeed";
import { login, hostGame, joinGame, bothReachPlaying } from "../spectator/playHelpers";

// Two-browser regression coverage for The Foretelling Angel's top-deck reveal
// (#325/#327) and the drag-away staleness fix: the my-deck top GameCardNode
// must be KEYED by row id. Unkeyed, dragging the revealed top card away left
// React updating the drag-displaced Konva node in place for the NEXT top card,
// so the pile showed only the shadow CardBackShape until a hard refresh.
//
// The test drives the real interaction: reach `playing`, flip the host's
// top_deck_revealed flag via `spacetime sql` (the toggle reducer needs the
// Angel in play; the flag is what the render reads), find the deck cell by
// watching which card-back position turns into the expected top card's face,
// drag that card off the deck, and assert the NEXT top card's face appears in
// the same cell — the exact assertion that fails on the unkeyed node.
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL and the
// SpacetimeDB dev module. Konva has no DOM, so faces are asserted by scanning
// window.Konva stages for Image nodes and matching their src (see
// reference_multiplayer_konva_e2e_driving).

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

test.skip(!adminAvailable, "requires SUPABASE_SERVICE_ROLE_KEY env");
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "drives the desktop-viewport Konva board",
);

const STDB_SERVER = "https://maincloud.spacetimedb.com";
const STDB_MODULE = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME ?? "redemption-multiplayer-dev";
const SPACETIME_BIN = `${homedir()}/.local/bin/spacetime`;

/** Run a SQL statement against the dev module and return parsed rows. */
function stdbSql(query: string): string[][] {
  const out = execFileSync(
    SPACETIME_BIN,
    ["sql", STDB_MODULE, query, "--server", STDB_SERVER, "--no-config"],
    { encoding: "utf8" },
  );
  const lines = out.split("\n");
  const sep = lines.findIndex((l) => /^-+(\+-+)*\s*$/.test(l.trim()));
  if (sep === -1) return [];
  return lines
    .slice(sep + 1)
    .filter((l) => l.trim().length > 0)
    .map((l) => l.split("|").map((c) => c.trim().replace(/^"|"$/g, "")));
}

/** Lowercase alphanumeric-only fingerprint — survives URL encoding and
 *  extension/query differences between card_img_file and the CDN src. */
function norm(s: string): string {
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface KonvaImg {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Screen-space centers of every visible Konva Image node on the page. */
async function konvaImages(page: Page): Promise<KonvaImg[]> {
  return page.evaluate(() => {
    const K = (window as any).Konva;
    if (!K?.stages?.length) return [];
    const out: any[] = [];
    for (const stage of K.stages) {
      const box = stage.container().getBoundingClientRect();
      for (const node of stage.find("Image")) {
        if (!node.isVisible()) continue;
        const el = typeof node.image === "function" ? node.image() : null;
        const src = el && el.src ? String(el.src) : "";
        if (!src) continue;
        const r = node.getClientRect();
        out.push({
          src,
          x: box.x + r.x + r.width / 2,
          y: box.y + r.y + r.height / 2,
          w: r.width,
          h: r.height,
        });
      }
    }
    return out;
  });
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 40) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/** The host's deck rows, zone_index ascending — [imgFile, id][] with row 0 on top. */
function hostDeckTop(gameId: string, playerId: string): { id: string; img: string } | null {
  const rows = stdbSql(
    `SELECT id, zone_index, card_img_file FROM card_instance WHERE game_id = ${gameId} AND owner_id = ${playerId} AND zone = 'deck'`,
  );
  if (rows.length === 0) return null;
  rows.sort((a, b) => Number(a[1]) - Number(b[1]));
  return { id: rows[0][0], img: rows[0][2] };
}

test("revealed top deck card survives being dragged away (next card renders face up)", async ({
  browser,
}) => {
  let host: SeededPlayer | undefined;
  let joiner: SeededPlayer | undefined;
  let hostCtx: BrowserContext | undefined;
  let joinCtx: BrowserContext | undefined;

  try {
    host = await seedPlayer("tdrhost");
    joiner = await seedPlayer("tdrjoin");

    hostCtx = await browser.newContext();
    joinCtx = await browser.newContext();
    const hostPage = await hostCtx.newPage();
    const joinPage = await joinCtx.newPage();
    await login(hostPage, host);
    await login(joinPage, joiner);

    const code = await hostGame(hostPage);
    await joinGame(joinPage, code);
    await bothReachPlaying(hostPage, joinPage);

    // ---- Resolve game + host player + top-of-deck from the module ----
    const gameRows = stdbSql(`SELECT id FROM game WHERE code = '${code}' AND status = 'playing'`);
    expect(gameRows.length).toBe(1);
    const gameId = gameRows[0][0];
    const playerRows = stdbSql(`SELECT id FROM player WHERE game_id = ${gameId} AND seat = 0`);
    expect(playerRows.length).toBe(1);
    const hostPlayerId = playerRows[0][0];

    const firstTop = hostDeckTop(gameId, hostPlayerId);
    expect(firstTop).not.toBeNull();

    // ---- Snapshot the card-back positions, then flip the reveal flag ----
    // The deck cell is discovered, not hardcoded: it's the card-back position
    // that turns into the expected top card's face once the flag is on.
    await expect(hostPage.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
    await hostPage.waitForTimeout(2_000); // let piles + image preloads settle
    const before = await konvaImages(hostPage);
    const backPositions = before.filter((i) => norm(i.src).includes("cardback"));
    expect(backPositions.length).toBeGreaterThan(0);

    stdbSql(`UPDATE player SET top_deck_revealed = true WHERE id = ${hostPlayerId}`);

    let deckCell: KonvaImg | undefined;
    await expect(async () => {
      const imgs = await konvaImages(hostPage);
      deckCell = imgs.find(
        (i) =>
          norm(i.src).includes(norm(firstTop!.img)) &&
          backPositions.some((b) => near(i, b)),
      );
      expect(deckCell).toBeTruthy();
    }).toPass({ timeout: 20_000 });

    // ---- Drag the revealed top card off the deck ----
    // Drop targets are relative to the discovered cell; SQL confirms the row
    // actually left the deck (an invalid drop snaps back silently).
    const dropCandidates = [
      { x: deckCell!.x - 400, y: deckCell!.y },
      { x: deckCell!.x - 550, y: deckCell!.y - 100 },
      { x: deckCell!.x - 300, y: deckCell!.y - 160 },
    ];
    let moved = false;
    for (const target of dropCandidates) {
      await hostPage.mouse.move(deckCell!.x, deckCell!.y);
      await hostPage.mouse.down();
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        await hostPage.mouse.move(
          deckCell!.x + ((target.x - deckCell!.x) * s) / steps,
          deckCell!.y + ((target.y - deckCell!.y) * s) / steps,
        );
        await hostPage.waitForTimeout(30);
      }
      await hostPage.mouse.up();
      await hostPage.waitForTimeout(1_500); // reducer round-trip
      const topNow = hostDeckTop(gameId, hostPlayerId);
      if (topNow && topNow.id !== firstTop!.id) {
        moved = true;
        break;
      }
    }
    expect(moved, "top card should have left the deck via drag").toBe(true);

    // ---- THE regression assertion ----
    // The NEXT top card's face must appear in the same deck cell. With the
    // unkeyed node this never happens — the cell shows only the shadow
    // card back until a full remount.
    const secondTop = hostDeckTop(gameId, hostPlayerId);
    expect(secondTop).not.toBeNull();
    expect(secondTop!.id).not.toBe(firstTop!.id);

    await expect(async () => {
      const imgs = await konvaImages(hostPage);
      const faceInCell = imgs.find(
        (i) => norm(i.src).includes(norm(secondTop!.img)) && near(i, deckCell!),
      );
      expect(faceInCell).toBeTruthy();
    }).toPass({ timeout: 15_000 });
  } finally {
    await joinCtx?.close();
    await hostCtx?.close();
    if (joiner) await cleanupPlayer(joiner);
    if (host) await cleanupPlayer(host);
  }
});
