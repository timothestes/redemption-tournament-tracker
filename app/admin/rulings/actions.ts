"use server";

import { createClient } from "../../../utils/supabase/server";
import { requirePermission } from "../../../utils/adminUtils";

export interface CardRuling {
  id: string;
  card_name: string;
  question: string;
  answer: string;
  source: string;
  source_url: string | null;
  ruling_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscordMessage {
  id: string;
  discord_message_id: string;
  author_name: string | null;
  content: string;
  message_date: string;
  created_at: string;
}

// ─── Rulings CRUD ───────────────────────────────────────────────

export async function getRulings(search?: string) {
  await requirePermission("manage_rulings");
  const supabase = await createClient();

  let query = supabase
    .from("card_rulings")
    .select("*")
    .order("created_at", { ascending: false });

  if (search && search.trim()) {
    // Use full-text search
    query = query.or(
      `card_name.ilike.%${search}%,question.ilike.%${search}%,answer.ilike.%${search}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching rulings:", error);
    return { rulings: [], error: error.message };
  }

  return { rulings: (data || []) as CardRuling[], error: null };
}

export async function createRuling(ruling: {
  card_name: string;
  question: string;
  answer: string;
  source?: string;
  source_url?: string;
  ruling_date?: string;
}) {
  await requirePermission("manage_rulings");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("card_rulings")
    .insert({
      card_name: ruling.card_name,
      question: ruling.question,
      answer: ruling.answer,
      source: ruling.source || "manual",
      source_url: ruling.source_url || null,
      ruling_date: ruling.ruling_date || null,
      created_by: user?.id || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating ruling:", error);
    return { ruling: null, error: error.message };
  }

  return { ruling: data as CardRuling, error: null };
}

export async function updateRuling(
  id: string,
  updates: {
    card_name?: string;
    question?: string;
    answer?: string;
    source?: string;
    source_url?: string;
    ruling_date?: string;
  }
) {
  await requirePermission("manage_rulings");
  const supabase = await createClient();

  const { error } = await supabase
    .from("card_rulings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("Error updating ruling:", error);
    return { error: error.message };
  }

  return { error: null };
}

export async function deleteRuling(id: string) {
  await requirePermission("manage_rulings");
  const supabase = await createClient();

  const { error } = await supabase.from("card_rulings").delete().eq("id", id);

  if (error) {
    console.error("Error deleting ruling:", error);
    return { error: error.message };
  }

  return { error: null };
}

// ─── Discord Archive Search (public) ────────────────────────────

export async function searchDiscordMessages(search: string, limit = 50) {
  const supabase = await createClient();

  if (!search || search.trim().length < 2) {
    return { messages: [], error: null };
  }

  const { data, error } = await supabase
    .from("discord_ruling_messages")
    .select("id, author_name, content, message_date")
    .ilike("content", `%${search}%`)
    .order("message_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error searching discord messages:", error);
    return { messages: [], error: error.message };
  }

  return { messages: (data || []) as Pick<DiscordMessage, "id" | "author_name" | "content" | "message_date">[], error: null };
}

export async function getDiscordContext(
  messageDate: string,
  direction: "before" | "after",
  limit = 10
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("discord_ruling_messages")
    .select("id, author_name, content, message_date")
    .order("message_date", { ascending: direction === "after" })
    [direction === "before" ? "lt" : "gt"]("message_date", messageDate)
    .limit(limit);

  if (error) {
    console.error("Error fetching discord context:", error);
    return { messages: [], error: error.message };
  }

  // Always return in chronological order
  const messages = (data || []) as Pick<DiscordMessage, "id" | "author_name" | "content" | "message_date">[];
  if (direction === "before") messages.reverse();
  return { messages, error: null };
}

// ─── Search (public, used by rulings page and admin) ────────────

export async function searchRulingsPublic(search: string) {
  const supabase = await createClient();

  if (!search || search.trim().length < 2) {
    return { rulings: [], error: null };
  }

  const { data, error } = await supabase
    .from("card_rulings")
    .select("*")
    .or(
      `card_name.ilike.%${search}%,question.ilike.%${search}%,answer.ilike.%${search}%`
    )
    .order("card_name", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Error searching rulings:", error);
    return { rulings: [], error: error.message };
  }

  return { rulings: (data || []) as CardRuling[], error: null };
}
