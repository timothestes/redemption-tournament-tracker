import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { CARDS, type CardData } from "@/lib/cards/lookup";
import { FORMATS } from "@/lib/formats";
import { matchesBanListEntry } from "@/utils/deckcheck/rules";
import { generateJoinCode } from "@/lib/tournament/joinCodes";
import { deleteTestUser } from "./deleteUser";

// This spec exercises migration 084 (tournament_deck_submissions,
// participants.user_id, tournaments.require_decklists) end-to-end. It is
// self-contained: seeds its own host/player accounts, tournament, and a real
// legal deck, and cleans everything up in afterAll. See
// .claude/skills/verify/SKILL.md for the account/session conventions this
// mirrors.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const adminAvailable = !!URL && !!SERVICE;
const admin = adminAvailable
  ? createClient(URL, SERVICE, { auth: { persistSession: false } })
  : null;

// ─── Build a real, Limited-legal 50-card main deck straight off the live ───
// ─── card database — no hardcoded card names, so a future                ───
// ─── `make update-cards` regen can't silently go stale.                  ───
//
// Filler needs more than 3 copies per card to reach the 43 non-Lost-Soul
// slots without an unreasonable number of distinct printings, so this leans
// on two real properties of checkDeck's Type 1 rules (utils/deckcheck/rules.ts):
//   - checkVanillaLimit only caps types whose lowercased string is exactly
//     "hero" / "evil character" / "enhancement" — real "Hero Token" / "Evil
//     Character Token" printings fall outside that set and are uncapped.
//   - non-special-ability cards outside Hero/Evil Character/Enhancement have
//     no quantity rule at all in the Type 1 rule set.
// Both are genuine behavior of the app's own validator (is_legal reflects
// exactly what tournament_qr_join will record), not a workaround of it —
// verified directly against validateT1Rules in code review for this task.
interface DeckCardSeed {
  name: string;
  set: string;
  imgFile: string | null;
  quantity: number;
}

function pickMainDeck(): DeckCardSeed[] {
  const isRotationLegal = (c: CardData) => c.legality === "Rotation";
  const noAbility = (c: CardData) => !c.specialAbility || c.specialAbility.trim() === "";
  const isBanned = (c: CardData) =>
    FORMATS.Limited.banList.some((entry) => matchesBanListEntry(c, entry));
  const isSingleBrigade = (c: CardData) => {
    const b = c.brigade.trim().toLowerCase();
    if (!b || b === "colorless" || b === "multi") return false;
    return !b.includes("/") && !b.includes(",");
  };
  // Strip a trailing "(Set)" / "[Variant]" annotation so two different
  // printings of the same character (e.g. "Subjugating Egyptians [K]" vs.
  // "Subjugating Egyptians (1st Print - K)") are never both picked — the
  // same-card grouping in checkDeck could merge them and trip the 3-copy cap.
  const baseName = (name: string) =>
    name.replace(/\s*\[[^\]]+\]\s*$/, "").replace(/\s*\([^)]+\)\s*$/, "").trim().toLowerCase();

  const lostSoul = CARDS.find(
    (c) =>
      c.type.toLowerCase().includes("lost soul") &&
      isRotationLegal(c) &&
      noAbility(c) &&
      c.reference !== "Proverbs 22:14" && // the one Limited-banned LS reference
      !isBanned(c)
  );
  if (!lostSoul) throw new Error("qr-join e2e: no eligible Lost Soul in the card database");

  const seenBase = new Set<string>();
  const vanilla = CARDS.filter((c) => {
    const t = c.type.trim().toLowerCase();
    if (t !== "hero" && t !== "evil character") return false;
    if (!isRotationLegal(c) || !noAbility(c) || !isSingleBrigade(c) || isBanned(c)) return false;
    const base = baseName(c.name);
    if (seenBase.has(base)) return false;
    seenBase.add(base);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const tokens = CARDS.filter((c) => {
    const t = c.type.trim().toLowerCase();
    if (t !== "hero token" && t !== "evil character token") return false;
    return isRotationLegal(c) && noAbility(c) && !isBanned(c);
  }).sort((a, b) => a.name.localeCompare(b.name));

  const main: DeckCardSeed[] = [
    { name: lostSoul.name, set: lostSoul.set, imgFile: lostSoul.imgFile || null, quantity: 7 },
  ];
  let remaining = 43; // 50-card main deck (Limited minimum) minus the 7 Lost Souls
  for (const c of [...vanilla, ...tokens]) {
    if (remaining <= 0) break;
    const cap = vanilla.includes(c) ? 3 : 5; // vanilla capped at 3; tokens uncapped, 5 is just a tidy batch size
    const qty = Math.min(cap, remaining);
    main.push({ name: c.name, set: c.set, imgFile: c.imgFile || null, quantity: qty });
    remaining -= qty;
  }
  if (remaining > 0) {
    throw new Error(
      `qr-join e2e: card database doesn't have enough eligible filler cards (${remaining} short of 43) — the seed deck builder needs updating`
    );
  }
  return main;
}

// ─── Seed: host + player accounts, a require_decklists Limited tournament, ───
// ─── and a legal deck for the player.                                     ───
//
// `Seeded` fields are populated INCREMENTALLY, in-place, as each row/user is
// created — never assigned only at the end. If any step throws partway
// through (e.g. pickMainDeck() finding the card database changed shape),
// whatever was already created is still recorded on this same object, so
// `cleanup()` (which runs in afterAll regardless of whether beforeAll threw)
// can still find and delete it instead of orphaning rows in prod.
interface Seeded {
  tournamentId?: string;
  code?: string;
  hostId?: string;
  hostEmail?: string;
  hostPassword?: string;
  playerId?: string;
  playerEmail?: string;
  playerPassword?: string;
  deckId?: string;
  deckName?: string;
}

async function seed(state: Seeded): Promise<void> {
  if (!admin) throw new Error("qr-join e2e seed requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const password = "Testpass12345";

  const hostEmail = `qr-join-host-${stamp}@e2e.test`;
  const { data: hostUser, error: hostErr } = await admin.auth.admin.createUser({
    email: hostEmail,
    password,
    email_confirm: true,
  });
  if (hostErr || !hostUser?.user) throw new Error(`Failed to create host: ${hostErr?.message}`);
  state.hostId = hostUser.user.id;
  state.hostEmail = hostEmail;
  state.hostPassword = password;

  const playerEmail = `qr-join-player-${stamp}@e2e.test`;
  const { data: playerUser, error: playerErr } = await admin.auth.admin.createUser({
    email: playerEmail,
    password,
    email_confirm: true,
  });
  if (playerErr || !playerUser?.user) throw new Error(`Failed to create player: ${playerErr?.message}`);
  state.playerId = playerUser.user.id;
  state.playerEmail = playerEmail;
  state.playerPassword = password;

  // Retry on join-code collision, mirroring the production regenerateJoinCode path.
  let tournamentId: string | null = null;
  let code = "";
  for (let attempt = 0; attempt < 5 && !tournamentId; attempt++) {
    code = generateJoinCode();
    const { data: tournament, error: tErr } = await admin
      .from("tournaments")
      .insert({
        name: `QR Join E2E ${stamp}`,
        host_id: hostUser.user.id,
        code,
        has_started: false,
        require_decklists: true,
        deck_format: "Limited",
      })
      .select("id")
      .single();
    if (tErr) {
      if (tErr.code === "23505") continue; // code collision — try another
      throw new Error(`Failed to create tournament: ${tErr.message}`);
    }
    tournamentId = tournament!.id;
  }
  if (!tournamentId) throw new Error("qr-join e2e: could not allocate a unique join code");
  state.tournamentId = tournamentId;
  state.code = code;

  const deckName = `QR Join E2E Deck ${stamp}`;
  const { data: deck, error: deckErr } = await admin
    .from("decks")
    .insert({ user_id: playerUser.user.id, name: deckName, format: "Limited", visibility: "private" })
    .select("id")
    .single();
  if (deckErr || !deck) throw new Error(`Failed to create deck: ${deckErr?.message}`);
  state.deckId = deck.id;
  state.deckName = deckName;

  // Everything above this point creates rows that MUST be tracked before we
  // touch anything that can throw for reasons unrelated to Supabase (a card
  // database shape change) — pickMainDeck() runs only now, after state.deckId
  // is already recorded, so a throw here still leaves a cleanable (empty) deck.
  const mainDeck = pickMainDeck();
  const { error: cardsErr } = await admin.from("deck_cards").insert(
    mainDeck.map((c) => ({
      deck_id: deck.id,
      card_name: c.name,
      card_set: c.set,
      card_img_file: c.imgFile,
      quantity: c.quantity,
      zone: "main",
    }))
  );
  if (cardsErr) throw new Error(`Failed to insert deck cards: ${cardsErr.message}`);
}

// Best-effort over whatever `state` has recorded so far: every delete is
// guarded on its ID being present, and no single failed/skipped delete stops
// the rest from being attempted. Any delete that comes back with an `.error`
// is logged via console.warn so a real cleanup gap is visible on the first
// live run rather than silently swallowed.
async function cleanup(state: Seeded) {
  if (!admin) return;

  // Tournament delete cascades participants, matches, rounds,
  // tournament_decklists, tournament_deck_submissions, tournament_join_blocks.
  if (state.tournamentId) {
    const { error } = await admin.from("tournaments").delete().eq("id", state.tournamentId);
    if (error) console.warn(`qr-join e2e cleanup: failed to delete tournament ${state.tournamentId}:`, error.message);
  }

  // decks.user_id -> auth.users has no ON DELETE action, so the deck (and its
  // cascaded deck_cards) must go before the owning user.
  if (state.deckId) {
    const { error } = await admin.from("decks").delete().eq("id", state.deckId);
    if (error) console.warn(`qr-join e2e cleanup: failed to delete deck ${state.deckId}:`, error.message);
  }

  for (const [label, userId] of [
    ["host", state.hostId],
    ["player", state.playerId],
  ] as const) {
    if (!userId) continue;
    // Was a bare deleteUser, which always 500s on the profiles FK — this spec
    // logged "Database error deleting user" on every single run and leaked both
    // accounts each time.
    const ok = await deleteTestUser(admin, userId);
    if (!ok) console.warn(`qr-join e2e cleanup: ${label} user ${userId} survived`);
  }
}

// ─── Drive the flow ───

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

/**
 * Sign in and wait for the session to actually be established.
 *
 * signInAction is a server-action redirect, so the click resolves long before
 * the browser has left /sign-in. Navigating during that window lands on a page
 * rendered without the session — which then bounces straight back to /sign-in.
 * Callers that need a *specific* destination (the redirectTo flow below) wait
 * on that URL instead; this is for callers that just need to be logged in.
 *
 * Mirrors the pattern the forge specs already use.
 */
async function signInAndSettle(page: Page, email: string, password: string) {
  await signIn(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), {
    timeout: 30_000,
  });
  await page.waitForLoadState("load");
}

test.describe("QR join + decklist submission", () => {
  test.skip(!adminAvailable, "requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL");

  // Created up front (not assigned from seed()'s return value) so afterAll
  // can always find it — even if beforeAll throws partway through seeding,
  // Playwright still runs afterAll, and this object already carries whatever
  // IDs were recorded before the throw.
  const seeded: Seeded = {};

  test.beforeAll(async () => {
    await seed(seeded);
  });

  test.afterAll(async () => {
    await cleanup(seeded);
  });

  test("player joins via code, submits a legal decklist, and the host sees it", async ({ browser }) => {
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();

    // 1. Visit /join/<code> signed out — join info loads, sign-in is offered.
    await playerPage.goto(`/join/${seeded.code}`);
    const signInLink = playerPage.getByRole("link", { name: /sign in to join/i });
    await expect(signInLink).toBeVisible();
    await expect(signInLink).toHaveAttribute(
      "href",
      `/sign-in?redirectTo=${encodeURIComponent(`/join/${seeded.code}`)}`
    );

    // 2. Follow it — the redirectTo is honored back to /join/<code> after sign-in.
    await signInLink.click();
    await playerPage.waitForURL(new RegExp(`/sign-in\\?redirectTo=${encodeURIComponent(`/join/${seeded.code}`)}`));
    await signIn(playerPage, seeded.playerEmail, seeded.playerPassword);
    await playerPage.waitForURL(new RegExp(`/join/${seeded.code}$`));

    // 3. Join form: display name + the seeded legal deck from "My decks".
    await playerPage.getByLabel(/display name/i).fill("E2E Player");
    await playerPage.getByText(seeded.deckName, { exact: true }).click();
    await expect(playerPage.getByText(seeded.deckName, { exact: true })).toBeVisible();
    await playerPage.getByRole("button", { name: /^join$/i }).click();

    // 4. Registered state — deck accepted as legal.
    await expect(playerPage.getByText("Registered as")).toBeVisible();
    await expect(playerPage.getByText("E2E Player", { exact: true })).toBeVisible();
    await expect(playerPage.getByText(seeded.deckName, { exact: true })).toBeVisible();
    await expect(playerPage.getByText("Legal", { exact: true })).toBeVisible();

    await playerContext.close();

    // 5. DB assertions: participant linked to the account, submission recorded and legal.
    const { data: participant, error: pErr } = await admin!
      .from("participants")
      .select("id, user_id, name")
      .eq("tournament_id", seeded.tournamentId)
      .single();
    expect(pErr).toBeNull();
    expect(participant!.user_id).toBe(seeded.playerId);
    expect(participant!.name).toBe("E2E Player");

    const { data: submission, error: sErr } = await admin!
      .from("tournament_deck_submissions")
      .select("is_legal, deck_snapshot, source")
      .eq("participant_id", participant!.id)
      .single();
    expect(sErr).toBeNull();
    expect(submission!.is_legal).toBe(true);
    expect(submission!.source).toBe("player");
    expect(Array.isArray(submission!.deck_snapshot?.cards)).toBe(true);
    expect(submission!.deck_snapshot.cards.length).toBeGreaterThan(0);

    // 6. Host view: the decklist summary shows the submission.
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await hostPage.goto("/sign-in");
    // NOT waitForURL(/.*/) — that regex matches the CURRENT url, so it resolved
    // instantly against /sign-in and the goto below raced the pending sign-in
    // redirect. The host arrived unauthenticated and was bounced back to
    // /sign-in, where "1 of 1" naturally doesn't exist.
    await signInAndSettle(hostPage, seeded.hostEmail, seeded.hostPassword);

    await hostPage.goto(`/tracker/tournaments/${seeded.tournamentId}`);
    // The summary renders after the participants + decklists fetches resolve,
    // which on a cold dev-server route compile is well past the 5s default.
    await expect(hostPage.getByText("1 of 1")).toBeVisible({ timeout: 30_000 });
    await expect(hostPage.getByText(/participants have decklists/i)).toBeVisible();

    // ParticipantTable renders a desktop table AND a mobile card list, both
    // always in the DOM and toggled by CSS — so an unfiltered getByTitle matches
    // two elements and trips strict mode before it ever checks visibility.
    // Assert on whichever layout this viewport is actually showing.
    const submissionButton = hostPage
      .getByTitle(`${seeded.deckName} — view submission`)
      .filter({ visible: true });
    await expect(submissionButton).toBeVisible();

    // It opens the submission, which is the point of the link.
    await submissionButton.click();
    await expect(hostPage.getByRole("dialog")).toBeVisible();

    await hostContext.close();
  });
});
