-- 062_forge_missives.sql
-- Forge Missives: elder→member email. Directory RPC (emails live only in auth.users)
-- + sent-missive log. Follows 048/049 definer/no-oracle/revoke patterns.

-- 1) Sent-missive log. Read: elders+. Write: only via forge_log_missive below.
create table if not exists public.forge_missives (
  id              uuid primary key default gen_random_uuid(),
  sender          uuid not null references auth.users(id),
  subject         text not null,
  body_text       text not null,          -- raw composed body, pre-template
  recipient_ids   uuid[] not null,
  recipient_count int not null,
  sent_at         timestamptz not null default now()
);
alter table public.forge_missives enable row level security;
drop policy if exists "forge_missives_select" on public.forge_missives;
create policy "forge_missives_select" on public.forge_missives
  for select to authenticated using (public.is_forge_elder_or_super());
revoke all on public.forge_missives from anon;
grant select on public.forge_missives to authenticated;
-- no insert/update/delete policies: writes land via forge_log_missive only

-- 2) Member directory with emails (auth.users) + set scoping for targeting.
--    NO ORACLE: returns zero rows for non-elders (mirrors forge_list_invites).
--    set_ids = grants ∪ set-elderships, so "everyone on set X" includes that
--    set's elders as well as granted playtesters.
create or replace function public.forge_member_directory()
returns table(user_id uuid, display_name text, role public.playtest_role,
              email text, set_ids uuid[])
language sql security definer stable set search_path = '' as $$
  select m.user_id, m.display_name, m.role, u.email::text,
         coalesce((
           select array_agg(distinct s.set_id) from (
             select g.set_id from public.forge_set_grants g where g.user_id = m.user_id
             union
             select e.set_id from public.forge_set_elders e where e.user_id = m.user_id
           ) s
         ), '{}')
  from public.playtest_members m
  join auth.users u on u.id = m.user_id
  where public.is_forge_elder_or_super()
  order by m.role, m.display_name nulls last;
$$;

-- 3) Log a sent missive (elders+; also stamps forge_audit).
create or replace function public.forge_log_missive(
  p_subject text, p_body_text text, p_recipient_ids uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_forge_elder_or_super() then
    raise exception 'not authorized';
  end if;
  insert into public.forge_missives (sender, subject, body_text, recipient_ids, recipient_count)
  values (auth.uid(), p_subject, p_body_text, coalesce(p_recipient_ids, '{}'),
          coalesce(array_length(p_recipient_ids, 1), 0))
  returning id into v_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'missive_sent', v_id::text);
  return v_id;
end; $$;

-- 4) Lock down execute (Supabase default-grants anon directly; strip it — cf. 048 §3).
revoke execute on function public.forge_member_directory() from public, anon;
revoke execute on function public.forge_log_missive(text, text, uuid[]) from public, anon;
grant execute on function public.forge_member_directory() to authenticated;
grant execute on function public.forge_log_missive(text, text, uuid[]) to authenticated;
