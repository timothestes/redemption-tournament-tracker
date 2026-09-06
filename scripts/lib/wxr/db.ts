import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthorMapEntry, ImportRow } from "./assemble";

export const ARCHIVE_EMAIL = "landofredemption@landofredemption.com";
export const ARCHIVE_USERNAME = "Land of Redemption";

export function serviceClient(env: NodeJS.ProcessEnv): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function listAllUsers(sb: SupabaseClient): Promise<{ id: string; email: string }[]> {
  const out: { id: string; email: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email) out.push({ id: u.id, email: u.email.toLowerCase() });
    if (data.users.length < 1000) return out;
  }
}

export async function ensureArchiveUser(sb: SupabaseClient, users: { id: string; email: string }[]): Promise<string> {
  let id = users.find((u) => u.email === ARCHIVE_EMAIL)?.id;
  if (!id) {
    const { data, error } = await sb.auth.admin.createUser({ email: ARCHIVE_EMAIL, email_confirm: true, user_metadata: { wxr_archive: true } });
    if (error || !data.user) throw new Error(`createUser(${ARCHIVE_EMAIL}): ${error?.message}`);
    id = data.user.id;
    users.push({ id, email: ARCHIVE_EMAIL });
  }
  const { error } = await sb.from("profiles").update({ username: ARCHIVE_USERNAME }).eq("id", id).is("username", null);
  if (error) throw new Error(`profiles.username: ${error.message}`);
  return id;
}

export function resolveAuthors(map: AuthorMapEntry[], users: { id: string; email: string }[], archiveId: string): Map<string, string> {
  const byEmail = new Map(users.map((u) => [u.email, u.id]));
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const a of map) {
    if (!a.email) { out.set(a.login, archiveId); continue; }
    const id = byEmail.get(a.email);
    if (id) out.set(a.login, id); else missing.push(a.email);
  }
  if (missing.length) throw new Error(`no tracker account for mapped author email(s): ${missing.join(", ")}`);
  return out;
}

export async function existingSourceUrls(sb: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("posts").select("source_url").not("source_url", "is", null).range(from, from + 999);
    if (error) throw new Error(`posts.source_url: ${error.message}`);
    for (const r of data) if (r.source_url) out.add(r.source_url);
    if (data.length < 1000) return out;
  }
}

/** insert: fails on an existing source_url (unique). update: everything but slug/status. */
export async function writePost(sb: SupabaseClient, row: ImportRow, mode: "insert" | "update"): Promise<{ id: string } | { error: string }> {
  if (!row.author_id) return { error: "author_id unresolved" };
  if (mode === "insert") {
    const { data, error } = await sb.from("posts").insert(row).select("id").single();
    return error ? { error: error.message } : { id: data.id };
  }
  const { slug: _s, status: _st, ...patch } = row;
  const { data, error } = await sb.from("posts").update(patch).eq("source_url", row.source_url).select("id").single();
  return error ? { error: error.message } : { id: data.id };
}
