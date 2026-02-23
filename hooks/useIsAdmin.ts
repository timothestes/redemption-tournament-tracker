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
            // Fetch permissions from admin_users table
            const { data: adminData } = await supabase
              .from('admin_users')
              .select('permissions')
              .eq('user_id', user.id)
              .single();
            setPermissions(adminData?.permissions || []);
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