-- Remove incorrect duplicate groups for cards that share a base name
-- but are genuinely different cards (different art/abilities).
-- In Redemption, different art = different card identity.

-- Servants by the River (1764): PoC vs [T2C] — different abilities
DELETE FROM duplicate_card_group_members WHERE group_id = 1764;
DELETE FROM duplicate_card_groups WHERE id = 1764;

-- Servants of the King (1765): [Sky] vs [River] — different stats/abilities
DELETE FROM duplicate_card_group_members WHERE group_id = 1765;
DELETE FROM duplicate_card_groups WHERE id = 1765;

-- Cherubim (738): FooF/PoC/Roots/Wa/[Blake]/[Unknown] — all different art
DELETE FROM duplicate_card_group_members WHERE group_id = 738;
DELETE FROM duplicate_card_groups WHERE id = 738;

-- Sabbath Breaker (732): classic + IR dual-brigade variants — all different
DELETE FROM duplicate_card_group_members WHERE group_id = 732;
DELETE FROM duplicate_card_groups WHERE id = 732;

-- Seraph (950): RoA/PoC vs [T2C] — different stats/abilities
DELETE FROM duplicate_card_group_members WHERE group_id = 950;
DELETE FROM duplicate_card_groups WHERE id = 950;

-- Sadducees (1500): 10A vs GoC — different art
DELETE FROM duplicate_card_group_members WHERE group_id = 1500;
DELETE FROM duplicate_card_groups WHERE id = 1500;

-- ─── Dismissed suggestions table ───────────────────────────────
-- Tracks base names that should NOT be suggested as duplicate groups.
-- Cards with different art are different cards in Redemption, but the
-- suggestion algorithm can't detect art differences automatically.

CREATE TABLE IF NOT EXISTS dismissed_duplicate_suggestions (
  id SERIAL PRIMARY KEY,
  base_name TEXT NOT NULL,
  card_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(base_name)
);

ALTER TABLE dismissed_duplicate_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on dismissed_duplicate_suggestions"
  ON dismissed_duplicate_suggestions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = current_user AND rolname = 'registration_admin'
    )
    OR current_setting('role', true) = 'service_role'
    OR auth.role() = 'service_role'
  );

CREATE POLICY "Authenticated read on dismissed_duplicate_suggestions"
  ON dismissed_duplicate_suggestions
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Seed with known different-art cards
INSERT INTO dismissed_duplicate_suggestions (base_name, card_type) VALUES
  ('Cherubim', 'Hero'),
  ('Sabbath Breaker', 'Evil Character'),
  ('Seraph', 'Hero'),
  ('Sadducees', 'Evil Character'),
  ('Pharisees', 'Evil Character'),
  ('Seraphim', 'Hero'),
  ('Servants of the King', 'Hero'),
  ('Servants by the River', 'Hero')
ON CONFLICT (base_name) DO NOTHING;
