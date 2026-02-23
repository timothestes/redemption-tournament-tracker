import { useState, useEffect } from "react";
import { createClient } from "../utils/supabase/client";

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const supabase = createClient();

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        // Get current user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
          setIsAdmin(false);
          setPermissions([]);
          setLoading(false);
          return;
        }

        // Check admin status using table-based function
        const { data, error } = await supabase.rpc('check_admin_role');

        if (error) {
          setIsAdmin(false);
          setPermissions([]);
        } else {
          setIsAdmin(data || false);
          if (data) {
            // Use SECURITY DEFINER RPC to bypass RLS on admin_users table
            const { data: permsData } = await supabase.rpc('get_my_admin_permissions');
            setPermissions(permsData || []);
          } else {
            setPermissions([]);
          }
        }
      } catch (error) {
        setIsAdmin(false);
        setPermissions([]);
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkAdminStatus();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  return { isAdmin, permissions, loading };
}