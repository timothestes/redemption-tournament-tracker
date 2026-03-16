import { createClient } from "./supabase/server";

export async function isRegistrationAdmin(): Promise<boolean> {
  const supabase = await createClient();
  
  // Get the current user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return false;
  }

  // Check if user is in the admin_users table
  const { data, error } = await supabase
    .rpc('check_admin_role');

  if (error) {
    console.error('Error checking admin role:', error);
    return false;
  }

  return data || false;
}

export async function requireRegistrationAdmin() {
  const isAdmin = await isRegistrationAdmin();

  if (!isAdmin) {
    throw new Error("Unauthorized: Registration admin access required");
  }
}

export async function hasPermission(permission: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) return false;

  const { data: isAdminData } = await supabase.rpc('check_admin_role');
  if (!isAdminData) return false;

  const { data: perms } = await supabase.rpc('get_my_admin_permissions');
  return Array.isArray(perms) && perms.includes(permission);
}

export async function requirePermission(permission: string) {
  const has = await hasPermission(permission);
  if (!has) {
    throw new Error(`Unauthorized: ${permission} permission required`);
  }
}