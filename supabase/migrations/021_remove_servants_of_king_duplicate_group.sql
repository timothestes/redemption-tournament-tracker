-- Remove incorrect duplicate groups for cards that share a base name
-- but are genuinely different cards (different abilities).

-- "Servants by the River" (PoC) vs "Servants by the River [T2C]"
-- Different abilities: "Protect Lost Souls..." vs "Negate an evil card..."
DELETE FROM duplicate_card_group_members WHERE group_id = 1764;
DELETE FROM duplicate_card_groups WHERE id = 1764;

-- "Servants of the King [Sky]" vs "[River]"
-- Different stats (3/3 vs 2/7), abilities, and references (Daniel 7:10 vs 7:14)
DELETE FROM duplicate_card_group_members WHERE group_id = 1765;
DELETE FROM duplicate_card_groups WHERE id = 1765;
