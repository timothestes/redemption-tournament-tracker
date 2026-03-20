-- Add source column to distinguish ORDIR-synced vs manually-created groups
ALTER TABLE duplicate_card_groups
  ADD COLUMN source text NOT NULL DEFAULT 'ordir';

-- Add card_type column for filtering (hero, evil_character, enhancement, etc.)
ALTER TABLE duplicate_card_groups
  ADD COLUMN card_type text;

-- Add index for filtering by source
CREATE INDEX idx_duplicate_card_groups_source ON duplicate_card_groups(source);

-- Add manage_cards permission to admins who have manage_rulings
UPDATE admin_users
SET permissions = array_append(permissions, 'manage_cards')
WHERE 'manage_rulings' = ANY(permissions)
  AND NOT ('manage_cards' = ANY(permissions));
