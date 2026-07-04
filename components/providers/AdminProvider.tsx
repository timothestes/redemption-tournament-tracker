"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { getUserSafe } from "../../utils/supabase/getUserSafe";

interface AdminState {
  isAdmin: boolean;
  isSuperuser: boolean;
  permissions: string[];
  loading: boolean;
}

const AdminContext = createContext<AdminState | null>(null);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AdminState>({
    isAdmin: false,
    isSuperuser: false,
    permissions: [],
    loading: true,
  });
  const supabase = useRef(createClient()).current;

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const user = await getUserSafe(supabase);

        if (!user) {
          setState({ isAdmin: false, isSuperuser: false, permissions: [], loading: false });
          return;
        }

        const { data: isAdminData, error: adminError } = await supabase.rpc("check_admin_role");

        if (adminError || !isAdminData) {
          setState({ isAdmin: false, isSuperuser: false, permissions: [], loading: false });
          return;
        }

        const { data: permsData, error: permsError } = await supabase.rpc("get_my_admin_permissions");
        // An RPC error (e.g. migration not yet applied in this env) leaves
        // superData undefined → treated as false. Fail-closed.
        const { data: superData } = await supabase.rpc("is_superuser");

        setState({
          isAdmin: true,
          isSuperuser: superData === true,
          permissions: permsError ? [] : (permsData || []),
          loading: false,
        });
      } catch {
        setState({ isAdmin: false, isSuperuser: false, permissions: [], loading: false });
      }
    };

    checkAdminStatus();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      checkAdminStatus();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  return <AdminContext.Provider value={state}>{children}</AdminContext.Provider>;
}

export function useAdminContext(): AdminState {
  const ctx = useContext(AdminContext);
  if (!ctx) {
    // Rendered outside AdminProvider — treat as non-admin but not loading so
    // UI doesn't hang. This shouldn't happen in normal app flow.
    return { isAdmin: false, isSuperuser: false, permissions: [], loading: false };
  }
  return ctx;
}
