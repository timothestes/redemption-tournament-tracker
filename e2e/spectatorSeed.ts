import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const adminAvailable = !!URL && !!SERVICE;

export const admin = adminAvailable
  ? createClient(URL, SERVICE, { auth: { persistSession: false } })
  : null;

// A few real cards (name | set | imgFile) pulled from lib/cards/generated/cardData.ts.
// findCard() enriches these into game card data during loadDeckForGame.
const SAMPLE_CARDS: Array<{ name: string; set: string; img: string }> = [
  { name: "Angel at Shur (Wa)", set: "War", img: "Angel_at_Shur_(Wa)" },
  { name: "Angel at the Tomb (Wa)", set: "War", img: "Angel_at_the_Tomb_(Wa)" },
  { name: "Angel Chariots (Wa)", set: "War", img: "Angel_Chariots_(Wa)" },
  { name: "Angel Departed", set: "AW", img: "Angel_Departed_(AW)" },
  { name: "Angel Food (L)", set: "Main", img: "Angel_Food_(B)" },
];

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
  const username = `spec_${label}_${stamp}`.slice(0, 24);

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
      card_count: SAMPLE_CARDS.length,
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
      quantity: 1,
      zone: "main",
    })),
  );
  if (cErr) throw new Error(`deck_cards insert failed: ${cErr.message}`);

  return { userId, email, password: PASSWORD, username, deckId: deck.id };
}

export async function cleanupPlayer(p: SeededPlayer) {
  if (!admin) return;
  // deck_cards cascade on deck delete in most schemas; delete decks explicitly.
  await admin.from("decks").delete().eq("user_id", p.userId);
  try {
    await admin.auth.admin.deleteUser(p.userId);
  } catch {
    // ignore — leftover e2e users are harmless
  }
}
