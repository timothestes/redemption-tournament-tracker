"use client";

import { useEffect } from "react";
import { createClient } from "../../../utils/supabase/client";

// When a user arrives here via a password-reset email, their recovery token
// is in the URL hash (#access_token=...&type=recovery). The server can't read
// hashes, so this client component initialises the Supabase browser client,
// which automatically detects the hash and stores the session in cookies —
// making it available to the resetPasswordAction server action.
export default function RecoverySessionHandler() {
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession();
  }, []);

  return null;
}
