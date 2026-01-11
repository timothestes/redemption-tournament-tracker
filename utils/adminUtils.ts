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