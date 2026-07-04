-- 063_forge_delete_set.sql
-- Cascade-delete a set: every card in it (via forge_delete_card, which handles
-- version-pointer FKs and its own per-card audit row), then grants/elders
-- (forge_set_elders/forge_set_grants already FK to forge_sets ON DELETE CASCADE —
-- these deletes are belt-and-braces, kept explicit anyway), then the set row
-- itself. Set-elder or superadmin only. Mirrors forge_delete_card's audit
-- convention (cf. 052) with a set_deleted row before the set is removed.
-- UI confirms destructively before calling. SCHEMA + FUNCTION ONLY — no data.

create or replace function public.forge_delete_set(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not (public.is_forge_superadmin() or public.is_forge_set_elder(p_set_id)) then
    raise exception 'not authorized to delete this set';
  end if;

  perform 1 from public.forge_sets where id = p_set_id for update;
  if not found then
    raise exception 'set not found';
  end if;

  for r in select id from public.forge_cards where set_id = p_set_id loop
    perform public.forge_delete_card(r.id);
  end loop;

  delete from public.forge_set_grants where set_id = p_set_id;
  delete from public.forge_set_elders where set_id = p_set_id;

  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'set_deleted', p_set_id::text);

  delete from public.forge_sets where id = p_set_id;
end;
$$;

revoke execute on function public.forge_delete_set(uuid) from public, anon;
grant execute on function public.forge_delete_set(uuid) to authenticated;
