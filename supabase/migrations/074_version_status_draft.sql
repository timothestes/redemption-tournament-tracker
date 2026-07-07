-- 074: add 'draft' to version_status. MUST be alone in this migration:
-- ALTER TYPE ... ADD VALUE runs inside Supabase's per-migration transaction
-- and the new value is unusable until that transaction commits (075 uses it).
-- No RLS change needed: the playtester branch of card_versions_select (057) is
-- a whitelist ('published','approved'), so 'draft' rows are invisible to
-- granted playtesters by construction; elder/owner/super branches are
-- status-agnostic and see them immediately.
alter type public.version_status add value if not exists 'draft';
