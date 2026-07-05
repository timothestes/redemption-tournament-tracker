-- The DesignCard model replaced `flavorText` with a `scripture` verse-text field
-- (flavor text isn't part of Redemption; scripture is) and dropped the unused
-- `strengthModifier` / `toughnessModifier` fields. Update the field-anchored
-- suggestion allowlist to mirror the DesignCard keys in app/forge/lib/designCard.ts.
create or replace function public._forge_is_card_field(p_field text)
returns boolean language sql immutable security definer set search_path = '' as $$
  select p_field = any (array[
    'name','cardType','alignment','brigades','strength','toughness',
    'class','icons','identifiers',
    'specialAbility','reference','legality','rarity','scripture','artistCredit','cardFrame'
  ]);
$$;
