-- Forge: private sets.
-- A private set (forge_sets.is_private = true) is visible/editable only to
-- superadmins and its explicit forge_set_elders designer roster. It withholds
-- the "any global elder" shortcut that is_forge_set_elder normally grants (see
-- the uncommitted prod migration forge_elders_access_all_sets, DB version
-- 20260705221747, which THIS migration supersedes). Public sets (is_private =
-- false, the default) keep the all-elders-see-all behavior. Because every
-- set/card read policy, write/lifecycle RPC, realtime topic authz, and the
-- review layer funnel through is_forge_set_elder, this single redefinition
-- hides a private set everywhere at once. Non-members/anon remain false.
--
-- ROLLBACK: to restore all-elders-see-all, redefine is_forge_set_elder to
--   select public.is_forge_elder_or_super()
--       or exists(select 1 from public.forge_set_elders e
--                 where e.set_id = p_set_id and e.user_id = auth.uid());

-- 1. Privacy flag. Default false → every existing set stays public (no change).
alter table public.forge_sets
  add column if not exists is_private boolean not null default false;

-- 2. Choke point: withhold the global-elder shortcut for private sets.
create or replace function public.is_forge_set_elder(p_set_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_forge_superadmin()
      or exists(
        select 1 from public.forge_set_elders e
        where e.set_id = p_set_id and e.user_id = auth.uid()
      )
      or (
        public.is_forge_elder_or_super()
        and not exists(
          select 1 from public.forge_sets s
          where s.id = p_set_id and s.is_private
        )
      );
$$;
revoke execute on function public.is_forge_set_elder(uuid) from public, anon;
grant  execute on function public.is_forge_set_elder(uuid) to authenticated;

-- 3. Create-set accepts privacy. Drop the 1-arg form so the 2-arg (with a
--    default) resolves for both existing single-arg callers and new ones.
drop function if exists public.forge_create_set(text);
create or replace function public.forge_create_set(p_name text, p_is_private boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_base text; v_slug text; v_n int := 1;
begin
  if not public.is_forge_elder_or_super() then
    raise exception 'only elders may create sets';
  end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'set name required'; end if;
  v_base := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then v_base := 'set'; end if;
  v_slug := v_base;
  while exists(select 1 from public.forge_sets where slug = v_slug) loop
    v_n := v_n + 1; v_slug := v_base || '-' || v_n;
  end loop;
  insert into public.forge_sets (name, slug, created_by, is_private)
  values (btrim(p_name), v_slug, auth.uid(), coalesce(p_is_private, false))
  returning id into v_id;
  insert into public.forge_set_elders (set_id, user_id) values (v_id, auth.uid());
  return v_id;
end; $$;
revoke execute on function public.forge_create_set(text, boolean) from public, anon;
grant  execute on function public.forge_create_set(text, boolean) to authenticated;

-- 4. Toggle privacy. Gated STRICTER than is_forge_set_elder: superadmin or an
--    EXPLICIT roster designer only — so a global elder (who passes
--    is_forge_set_elder for any public set) can't privatize a shared set out
--    from under its collaborators.
create or replace function public.forge_set_privacy(p_set_id uuid, p_is_private boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_forge_superadmin() or exists(
    select 1 from public.forge_set_elders e
    where e.set_id = p_set_id and e.user_id = auth.uid()
  )) then
    raise exception 'not a designer on this set';
  end if;
  update public.forge_sets
     set is_private = coalesce(p_is_private, false), updated_at = now()
   where id = p_set_id;
end; $$;
revoke execute on function public.forge_set_privacy(uuid, boolean) from public, anon;
grant  execute on function public.forge_set_privacy(uuid, boolean) to authenticated;
