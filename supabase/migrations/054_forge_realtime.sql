-- 054_forge_realtime.sql
-- Phase 1b.2: Realtime collaboration layer (Broadcast from Database).
-- Live comments/proposals/cards/sets over PRIVATE, per-topic-authorized channels.
-- No change to the supabase_realtime publication or REPLICA IDENTITY:
-- realtime.broadcast_changes() rides Realtime's own internal messaging.

-- 1. Topic read-authorization helper. Mirrors table RLS exactly:
--    forge:card:{uuid} -> _forge_can_read_card ; forge:set:{uuid} -> set-elder/super.
create or replace function public._forge_can_read_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_topic like 'forge:card:%' then
    begin
      v_id := (split_part(p_topic, ':', 3))::uuid;
    exception when others then
      return false;
    end;
    return public._forge_can_read_card(v_id);
  elsif p_topic like 'forge:set:%' then
    begin
      v_id := (split_part(p_topic, ':', 3))::uuid;
    exception when others then
      return false;
    end;
    return public.is_forge_set_elder(v_id) or public.is_forge_superadmin();
  end if;
  return false;
end;
$$;

revoke all on function public._forge_can_read_topic(text) from public;
revoke all on function public._forge_can_read_topic(text) from anon;
grant execute on function public._forge_can_read_topic(text) to authenticated;

-- 2. realtime.messages RLS — the join/receive gate. select = receive broadcasts +
--    others' presence + JOIN; insert = publish own presence. Both reuse the predicate.
drop policy if exists "forge realtime receive" on realtime.messages;
create policy "forge realtime receive"
  on realtime.messages
  for select
  to authenticated
  using ( public._forge_can_read_topic((select realtime.topic())) );

drop policy if exists "forge realtime presence-send" on realtime.messages;
create policy "forge realtime presence-send"
  on realtime.messages
  for insert
  to authenticated
  with check ( public._forge_can_read_topic((select realtime.topic())) );

-- 3. Broadcast-on-write trigger function. Fans out to the card topic and (when the
--    card is in a set) the set topic, so a card page reacts to its card and a set
--    page reacts to its whole set. NEW/OLD chosen by TG_OP (records can't coalesce).
create or replace function public.forge_broadcast_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_set uuid;
begin
  if TG_OP = 'DELETE' then v_row := OLD; else v_row := NEW; end if;

  if TG_TABLE_NAME = 'forge_sets' then
    perform realtime.broadcast_changes(
      'forge:set:' || v_row.id::text,
      'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);

  elsif TG_TABLE_NAME = 'forge_cards' then
    perform realtime.broadcast_changes(
      'forge:card:' || v_row.id::text,
      'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
    if v_row.set_id is not null then
      perform realtime.broadcast_changes(
        'forge:set:' || v_row.set_id::text,
        'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
    end if;

  else  -- card_proposals, card_comments (both carry card_id)
    perform realtime.broadcast_changes(
      'forge:card:' || v_row.card_id::text,
      'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
    select c.set_id into v_set from public.forge_cards c where c.id = v_row.card_id;
    if v_set is not null then
      perform realtime.broadcast_changes(
        'forge:set:' || v_set::text,
        'change', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
    end if;
  end if;

  return null;  -- AFTER trigger: return value ignored
end;
$$;

revoke all on function public.forge_broadcast_change() from public;
revoke all on function public.forge_broadcast_change() from anon;

drop trigger if exists forge_sets_broadcast on public.forge_sets;
create trigger forge_sets_broadcast
  after insert or update or delete on public.forge_sets
  for each row execute function public.forge_broadcast_change();

drop trigger if exists forge_cards_broadcast on public.forge_cards;
create trigger forge_cards_broadcast
  after insert or update or delete on public.forge_cards
  for each row execute function public.forge_broadcast_change();

drop trigger if exists card_proposals_broadcast on public.card_proposals;
create trigger card_proposals_broadcast
  after insert or update or delete on public.card_proposals
  for each row execute function public.forge_broadcast_change();

drop trigger if exists card_comments_broadcast on public.card_comments;
create trigger card_comments_broadcast
  after insert or update or delete on public.card_comments
  for each row execute function public.forge_broadcast_change();
