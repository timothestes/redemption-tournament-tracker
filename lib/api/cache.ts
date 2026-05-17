import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-free anon client for the cached public-deck loaders. The standard
 * `utils/supabase/server` createClient reads cookies(), which Next forbids
 * inside unstable_cache. Public-API reads don't need a user session — RLS on
 * `decks` already permits anon SELECT where is_public = true.
 */
function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase anon env vars missing");
  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const PUBLIC_DECKS_LIST_TAG = "public-decks-list" as const;
export const publicDeckTag = (id: string) => `public-deck:${id}` as const;

const SITE_URL = "https://landofredemption.com";
const PAGE_SIZE_ALLOWLIST = new Set([24, 50, 100]);
const SORTS = new Set(["newest", "most_viewed", "name"] as const);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ListSort = "newest" | "most_viewed" | "name";

export type ListParams = {
  page: number;
  page_size: number;
  format: string | null;
  username: string | null;
  sort: ListSort;
};

export type DeckPayload = {
  id: string;
  name: string;
  description: string | null;
  format: string | null;
  paragon: string | null;
  card_count: number;
  is_legal: boolean;
  view_count: number;
  username: string | null;
  created_at: string;
  updated_at: string;
  url: string;
};

export type ListPayload = {
  data: DeckPayload[];
  pagination: { page: number; page_size: number; total: number; has_more: boolean };
};

export type DetailPayload = DeckPayload & {
  cards: { name: string; set: string | null; quantity: number; zone: string }[];
};

export type ParseResult<T> =
  | { ok: true; value: T; message?: never }
  | { ok: false; message: string; value?: never };

export function parseListParams(sp: URLSearchParams): ParseResult<ListParams> {
  const pageRaw = sp.get("page");
  const page = pageRaw === null ? 1 : Number.parseInt(pageRaw, 10);
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    return { ok: false, message: "page must be an integer in [1, 1000]" };
  }

  const pageSizeRaw = sp.get("page_size");
  const page_size = pageSizeRaw === null ? 24 : Number.parseInt(pageSizeRaw, 10);
  if (!Number.isInteger(page_size) || !PAGE_SIZE_ALLOWLIST.has(page_size)) {
    return { ok: false, message: "page_size must be one of 24, 50, 100" };
  }

  const sortRaw = sp.get("sort");
  const sort = (sortRaw ?? "newest") as ListSort;
  if (!SORTS.has(sort)) {
    return { ok: false, message: "sort must be one of newest, most_viewed, name" };
  }

  const format = sp.get("format")?.trim() || null;
  const username = sp.get("username")?.trim() || null;

  return { ok: true, value: { page, page_size, format, username, sort } };
}

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function deckUrl(id: string): string {
  return `${SITE_URL}/decklist/${id}`;
}

type DeckRow = {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  format: string | null;
  paragon: string | null;
  card_count: number | null;
  is_legal: boolean | null;
  view_count: number | null;
  created_at: string;
  updated_at: string;
};

function rowToPayload(row: DeckRow, username: string | null): DeckPayload {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    format: row.format,
    paragon: row.paragon,
    card_count: row.card_count ?? 0,
    is_legal: row.is_legal ?? false,
    view_count: row.view_count ?? 0,
    username,
    created_at: row.created_at,
    updated_at: row.updated_at,
    url: deckUrl(row.id),
  };
}

const DECK_COLUMNS =
  "id, user_id, name, description, format, paragon, card_count, is_legal, view_count, created_at, updated_at";

async function resolveUsernames(
  supabase: ReturnType<typeof anonClient>,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const { data } = await supabase
    .from("profiles")
    .select("id, username")
    .in("id", userIds);
  for (const row of data ?? []) {
    if (row.username) map.set(row.id, row.username);
  }
  return map;
}

async function loadListFresh(params: ListParams): Promise<ListPayload> {
  const supabase = anonClient();

  let userIdFilter: string | null = null;
  if (params.username) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", params.username)
      .maybeSingle();
    if (!profile) {
      return {
        data: [],
        pagination: { page: params.page, page_size: params.page_size, total: 0, has_more: false },
      };
    }
    userIdFilter = profile.id;
  }

  let q = supabase
    .from("decks")
    .select(DECK_COLUMNS, { count: "exact" })
    .eq("is_public", true);

  if (params.format) {
    if (params.format === "Type 1") {
      q = q.or("format.is.null,format.eq.Type 1");
    } else {
      q = q.eq("format", params.format);
    }
  }
  if (userIdFilter) q = q.eq("user_id", userIdFilter);

  switch (params.sort) {
    case "most_viewed":
      q = q.order("view_count", { ascending: false, nullsFirst: false }).order("id", { ascending: true });
      break;
    case "name":
      q = q.order("name", { ascending: true }).order("id", { ascending: true });
      break;
    case "newest":
    default:
      q = q.order("updated_at", { ascending: false }).order("id", { ascending: true });
      break;
  }

  const offset = (params.page - 1) * params.page_size;
  q = q.range(offset, offset + params.page_size - 1);

  const { data, count, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as unknown as DeckRow[];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  const usernames = await resolveUsernames(supabase, userIds);

  return {
    data: rows.map((r) => rowToPayload(r, r.user_id ? usernames.get(r.user_id) ?? null : null)),
    pagination: {
      page: params.page,
      page_size: params.page_size,
      total: count ?? 0,
      has_more: (count ?? 0) > offset + rows.length,
    },
  };
}

async function loadDetailFresh(id: string): Promise<DetailPayload | null> {
  const supabase = anonClient();
  const { data: deck, error } = await supabase
    .from("decks")
    .select(DECK_COLUMNS)
    .eq("is_public", true)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!deck) return null;

  const row = deck as unknown as DeckRow;

  const { data: cards, error: cardsErr } = await supabase
    .from("deck_cards")
    .select("card_name, card_set, quantity, zone")
    .eq("deck_id", id);
  if (cardsErr) throw cardsErr;

  let username: string | null = null;
  if (row.user_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", row.user_id)
      .maybeSingle();
    username = profile?.username ?? null;
  }

  const payload = rowToPayload(row, username);
  return {
    ...payload,
    cards: (cards ?? []).map((c: { card_name: string; card_set: string | null; quantity: number; zone: string }) => ({
      name: c.card_name,
      set: c.card_set ?? null,
      quantity: c.quantity,
      zone: c.zone ?? "main",
    })),
  };
}

export function loadPublicDecksList(params: ListParams): Promise<ListPayload> {
  return unstable_cache(
    () => loadListFresh(params),
    ["public-decks-list", params.page.toString(), params.page_size.toString(), params.format ?? "", params.username ?? "", params.sort],
    { tags: [PUBLIC_DECKS_LIST_TAG], revalidate: 300 },
  )();
}

export function loadPublicDeckDetail(id: string): Promise<DetailPayload | null> {
  return unstable_cache(
    () => loadDetailFresh(id),
    ["public-deck-detail", id],
    { tags: [PUBLIC_DECKS_LIST_TAG, publicDeckTag(id)], revalidate: 3600 },
  )();
}
