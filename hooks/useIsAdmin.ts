import { useState, useEffect, useRef } from "react";
import { createClient } from "../utils/supabase/client";
import { getUserSafe } from "../utils/supabase/getUserSafe";

interface AdminState {
  isAdmin: boolean;
  permissions: string[];
  loading: boolean;
}

export function useIsAdmin() {
  const [state, setState] = useState<AdminState>({
    isAdmin: false,
    permissions: [],
    loading: true,
  });
  const supabase = useRef(createClient()).current;

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const user = await getUserSafe(supabase);

        if (!user) {
          setState({ isAdmin: false, permissions: [], loading: false });
          return;
        }

        const { data: isAdminData, error: adminError } = await supabase.rpc('check_admin_role');

        if (adminError || !isAdminData) {
          setState({ isAdmin: false, permissions: [], loading: false });
          return;
        }

        // Fetch permissions via SECURITY DEFINER RPC to bypass RLS
        const { data: permsData, error: permsError } = await supabase.rpc('get_my_admin_permissions');

        // Batch all updates in a single setState to avoid intermediate renders
        setState({
          isAdmin: true,
          permissions: permsError ? [] : (permsData || []),
          loading: false,
        });
      } catch {
        setState({ isAdmin: false, permissions: [], loading: false });
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

  return {
    isAdmin: state.isAdmin,
    permissions: state.permissions,
    loading: state.loading,
  };
}