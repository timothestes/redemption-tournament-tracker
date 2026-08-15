import { createClient } from "@supabase/supabase-js";
import { deleteTestUser } from "./deleteUser";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const adminAvailable = !!URL && !!SERVICE;

export const admin = adminAvailable
  ? createClient(URL, SERVICE, { auth: { persistSession: false } })
  : null;

// A few real cards (name | set | imgFile) pulled from lib/cards/generated/cardData.ts.
// findCard() enriches these into game card data during loadDeckForGame. Each is
// seeded at a quantity that totals ~50 cards so the opening-hand draw (8 cards)
// works when a game reaches the `playing` state.
//
// NOTE: none of these cards has a (Star)/STAR: ability and none is a Lost Soul,
// so the REG Pre-Game Phase auto-skips both sub-steps and the game reaches turn 1
// without extra clicks. If you add a star card or a Lost Soul here, the pregame
// will pause for input and bothReachPlaying() will hang.
const SAMPLE_CARDS: Array<{ name: string; set: string; img: string; qty: number }> = [
  { name: "Angel at Shur (Wa)", set: "War", img: "Angel_at_Shur_(Wa)", qty: 10 },
  { name: "Angel at the Tomb (Wa)", set: "War", img: "Angel_at_the_Tomb_(Wa)", qty: 10 },
  { name: "Angel Chariots (Wa)", set: "War", img: "Angel_Chariots_(Wa)", qty: 10 },
  { name: "Angel Departed", set: "AW", img: "Angel_Departed_(AW)", qty: 10 },
  { name: "Angel Food (L)", set: "Main", img: "Angel_Food_(B)", qty: 10 },
];
const DECK_CARD_COUNT = SAMPLE_CARDS.reduce((n, c) => n + c.qty, 0);

export interface SeededPlayer {
  userId: string;
  email: string;
  password: string;
  username: string;
  deckId: string;
}

const PASSWORD = "Testpass12345";

/**
 * Create a confirmed user with a username profile and a small playable deck.
 * The deck only needs a handful of real cards — create_game stores the deck as
 * pendingDeckData and the reducers don't validate deck size, so this is enough
 * to drive the create/join/pregame flow.
 */
export async function seedPlayer(label: string): Promise<SeededPlayer> {
  if (!admin) throw new Error("seedPlayer requires SUPABASE_SERVICE_ROLE_KEY");

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `spec-${label}-${stamp}@e2e.test`;
  // profiles.username is UNIQUE and capped at 24 chars, so the uniquifier has
  // to survive the cap — `spec_${label}_${stamp}`.slice(0, 24) truncated from
  // the RIGHT, cutting the random suffix off entirely and leaving only coarse
  // timestamp precision. Playwright parallelises across files (6 workers), and
  // board.spec and lobby-lifecycle both seed the label "host", so two runs
  // could land on the same name and fail with a profiles_username_key
  // violation. Build it right-to-left instead: the random part is never lost,
  // and only the human-readable label gets squeezed.
  const suffix = Math.random().toString(36).slice(2, 8); // 6 chars, always kept
  const username = `s_${label}`.slice(0, 24 - suffix.length - 1) + `_${suffix}`;

  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (uErr || !created?.user) throw new Error(`createUser failed: ${uErr?.message}`);
  const userId = created.user.id;

  // A profiles row may be auto-created by a trigger; upsert the username either way.
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: userId, username }, { onConflict: "id" });
  if (pErr) throw new Error(`profile upsert failed: ${pErr.message}`);

  const { data: deck, error: dErr } = await admin
    .from("decks")
    .insert({
      user_id: userId,
      name: `Spec Deck ${label} ${stamp}`,
      format: "Type 1",
      card_count: DECK_CARD_COUNT,
      is_public: false,
    })
    .select("id")
    .single();
  if (dErr || !deck) throw new Error(`deck insert failed: ${dErr?.message}`);

  const { error: cErr } = await admin.from("deck_cards").insert(
    SAMPLE_CARDS.map((c) => ({
      deck_id: deck.id,
      card_name: c.name,
      card_set: c.set,
      card_img_file: c.img,
      quantity: c.qty,
      zone: "main",
    })),
  );
  if (cErr) throw new Error(`deck_cards insert failed: ${cErr.message}`);

  return { userId, email, password: PASSWORD, username, deckId: deck.id };
}

export async function cleanupPlayer(p: SeededPlayer) {
  if (!admin) return;
  // The old comment here said "leftover e2e users are harmless". They are not:
  // their profiles rows keep the usernames a later run needs, which is exactly
  // how this file's own lobby-lifecycle spec started failing on
  // profiles_username_key. deleteTestUser removes the blocking rows first.
  await deleteTestUser(admin, p.userId);
}
