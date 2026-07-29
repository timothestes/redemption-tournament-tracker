import { describe, it, expect, vi, beforeEach } from "vitest";

// Both specifiers below must resolve to the exact modules the implementation
// imports, or the mock silently doesn't apply and these tests hit the network.
vi.mock("@/lib/pricing/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("../../../utils/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { createClient } from "../../../utils/supabase/server";
import { loadDeckTournamentContext } from "../deckTournamentContext";
import { loadPublicDeckAction } from "../actions";

/**
 * Admin-client stub covering the three shapes loadDeckTournamentContext uses:
 *   .from().select().eq().maybeSingle()            — the link and the two rows
 *   .from().select("id", {count}).eq()             — the field-size count
 * `calls` records table hits so the publish gate is asserted directly rather
 * than inferred from a null return.
 */
function fakeAdmin(opts: {
  link?: any;
  tournament?: any;
  participant?: any;
  participantCount?: number;
  calls?: { tournaments: number; participants: number };
}) {
  const calls = opts.calls ?? { tournaments: 0, participants: 0 };
  return {
    from: (table: string) => ({
      select: (_cols?: string, options?: any) => ({
        eq: () => {
          if (table === "participants" && options?.head) {
            calls.participants++;
            return Promise.resolve({ count: opts.participantCount ?? 0, error: null });
          }
          return {
            maybeSingle: async () => {
              if (table === "tournament_decklists") {
                return { data: opts.link ?? null, error: null };
              }
              if (table === "tournaments") {
                calls.tournaments++;
                return { data: opts.tournament ?? null, error: null };
              }
              if (table === "participants") {
                calls.participants++;
                return { data: opts.participant ?? null, error: null };
              }
              return { data: null, error: null };
            },
          };
        },
      }),
    }),
  } as any;
}

const PUBLISHED = {
  link: { tournament_id: "t1", participant_id: "p1" },
  tournament: {
    id: "t1",
    name: "Nationals 2026",
    category: "Nationals",
    deck_format: "Type 1",
    ended_at: "2026-07-04T00:00:00Z",
    results_published: true,
    decklists_published: true,
  },
  participant: { place: 1, name: "Kevin H", match_points: 18, differential: 31 },
  participantCount: 48,
};

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(createClient).mockReset();
});

describe("loadDeckTournamentContext", () => {
  it("returns null and never touches tournaments/participants for an unassociated deck", async () => {
    const calls = { tournaments: 0, participants: 0 };
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({ link: null, calls }));

    expect(await loadDeckTournamentContext("deck-with-no-tournament")).toBeNull();
    expect(calls).toEqual({ tournaments: 0, participants: 0 });
  });

  it("returns null when the host has not published decklists, without reading participants", async () => {
    const calls = { tournaments: 0, participants: 0 };
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        ...PUBLISHED,
        tournament: { ...PUBLISHED.tournament, decklists_published: false },
        calls,
      })
    );

    expect(await loadDeckTournamentContext("d1")).toBeNull();
    expect(calls.participants).toBe(0);
  });

  it("returns the event, the player, the finish and the field size when published", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin(PUBLISHED));

    expect(await loadDeckTournamentContext("d1")).toEqual({
      tournament_id: "t1",
      tournament_name: "Nationals 2026",
      category: "Nationals",
      // Normalized through lib/formats, exactly like the results page, so a
      // legacy "Type 1" row reads the same on both screens.
      deck_format: "Limited",
      ended_at: "2026-07-04T00:00:00Z",
      results_published: true,
      placement: 1,
      player_name: "Kevin H",
      match_points: 18,
      differential: 31,
      participant_count: 48,
    });
  });

  it("reports results_published:false so the page can skip a link to a page that 404s", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        ...PUBLISHED,
        tournament: { ...PUBLISHED.tournament, results_published: false },
      })
    );

    const ctx = await loadDeckTournamentContext("d1");
    expect(ctx?.results_published).toBe(false);
    expect(ctx?.tournament_name).toBe("Nationals 2026");
    // Standings the host chose NOT to publish must not ride along on a
    // published decklist. Placement survives — it's already baked into the
    // published copy's name — but the record exists nowhere else.
    expect(ctx?.match_points).toBeNull();
    expect(ctx?.differential).toBeNull();
    expect(ctx?.placement).toBe(1);
  });

  it("degrades to null instead of throwing when the admin client is unavailable", async () => {
    vi.mocked(getSupabaseAdmin).mockImplementation(() => {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    });

    expect(await loadDeckTournamentContext("d1")).toBeNull();
  });
});

/** RLS-client stub for the deck load itself. */
function fakeUserClient(deck: any) {
  return {
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async (name: string) =>
      name === "get_deck_total_prices"
        ? { data: [{ total_price: "12.50" }], error: null }
        : { data: [{ budget_price: "8.00" }], error: null },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            table === "decks"
              ? { data: deck, error: null }
              : { data: { username: "redemptionccg" }, error: null },
          order: () => ({ range: async () => ({ data: [], error: null }) }),
          // deck_tags is awaited straight off .eq()
          then: (resolve: any) => resolve({ data: [], error: null }),
        }),
      }),
      update: () => ({ eq: () => ({ then: (resolve: any) => resolve({ error: null }) }) }),
    }),
  } as any;
}

describe("loadPublicDeckAction tournament block", () => {
  it("attaches tournament:null for an ordinary community deck", async () => {
    vi.mocked(createClient).mockResolvedValue(
      fakeUserClient({ id: "d1", user_id: "u1", is_public: true, name: "Crimson Rush" })
    );
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin({ link: null }));

    const result = await loadPublicDeckAction("d1");

    expect(result.success).toBe(true);
    expect(result.deck!.tournament).toBeNull();
    // Everything an ordinary deck page renders is still there.
    expect(result.deck!.name).toBe("Crimson Rush");
    expect(result.deck!.username).toBe("redemptionccg");
    expect(result.deck!.total_price).toBe(12.5);
  });

  it("attaches the tournament context for a published copy", async () => {
    vi.mocked(createClient).mockResolvedValue(
      fakeUserClient({
        id: "d1",
        user_id: "service",
        is_public: true,
        name: "Kevin H - 1st Place - Nationals 2026",
      })
    );
    vi.mocked(getSupabaseAdmin).mockReturnValue(fakeAdmin(PUBLISHED));

    const result = await loadPublicDeckAction("d1");

    expect(result.success).toBe(true);
    expect(result.deck!.tournament).toMatchObject({
      tournament_id: "t1",
      tournament_name: "Nationals 2026",
      placement: 1,
      player_name: "Kevin H",
      participant_count: 48,
    });
  });
});
