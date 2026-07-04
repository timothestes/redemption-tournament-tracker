// Permission catalog for the superuser portal. MIRROR of the SQL allowlist in
// supabase/migrations/062_superuser_admin_portal.sql — update both together.
export const ADMIN_PERMISSIONS = [
  { key: "manage_registrations", label: "Registrations" },
  { key: "manage_tags", label: "Tags" },
  { key: "manage_spoilers", label: "Spoilers" },
  { key: "manage_cards", label: "Cards" },
  { key: "manage_rulings", label: "Rulings" },
  { key: "threshing_floor", label: "Threshing Floor" },
] as const;

export const ADMIN_PERMISSION_KEYS: string[] = ADMIN_PERMISSIONS.map((p) => p.key);
