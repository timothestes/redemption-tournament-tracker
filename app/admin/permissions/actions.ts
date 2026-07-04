"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";

export type AdminRow = {
  user_id: string;
  username: string | null;
  email: string | null;
  permissions: string[];
  created_at: string;
};

export type UserHit = {
  user_id: string;
  username: string | null;
  email: string | null;
  is_admin: boolean;
};

export async function listAdmins(): Promise<AdminRow[]> {
  const ctx = await requireSuperuser();
  if (!ctx) return [];
  const { data } = await ctx.supabase.rpc("super_list_admins");
  return (data as AdminRow[] | null) ?? [];
}

export async function searchUsers(query: string): Promise<UserHit[]> {
  const ctx = await requireSuperuser();
  if (!ctx) return [];
  const { data } = await ctx.supabase.rpc("super_search_users", { p_query: query });
  return (data as UserHit[] | null) ?? [];
}

export async function setAdminPermissions(
  userId: string,
  permissions: string[]
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireSuperuser();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("super_set_admin_permissions", {
    p_user_id: userId,
    p_permissions: permissions,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/permissions");
  return { ok: true };
}

export async function removeAdmin(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireSuperuser();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("super_remove_admin", { p_user_id: userId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/permissions");
  return { ok: true };
}
