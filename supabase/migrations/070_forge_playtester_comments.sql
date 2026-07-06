-- 070_forge_playtester_comments.sql
-- Let GRANTED playtesters leave plain card-level comments (+ replies) on cards they
-- can already view, WITHOUT any proposal ability. Adds a broader comment guard
-- _forge_can_comment_card (owner/super/set-elder, PLUS granted playtester on a shared
-- playtesting/approved card), widens the card_comments SELECT policy so playtesters
-- see card-level comments only (proposal_id IS NULL), and updates forge_add_comment to
-- accept playtester comments while blocking field/suggestion/proposal attachments for
-- non-elders. _forge_can_read_card, card_proposals, and forge_create_proposal are
-- UNTOUCHED (proposals stay elder-only).
-- Builds on 053 (review layer) and 057 (granted-playtester reveal).

-- 1) Broader comment guard: elder read-guard branches OR granted playtester on a
--    shared card (mirrors the forge_cards granted-read branch from 057).
create or replace function public._forge_can_comment_card(p_card_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id))
           or (c.set_id is not null
               and c.status in ('playtesting','approved')
               and public.is_forge_set_granted(c.set_id)))
  );
$$;

-- 2) card_comments SELECT: elders see everything; granted playtesters see card-level
--    (proposal_id IS NULL) comments only. Proposal-anchored comments stay hidden.
drop policy if exists "card_comments_select" on public.card_comments;
create policy "card_comments_select" on public.card_comments
  for select to authenticated
  using (
    public._forge_can_read_card(card_comments.card_id)
    or (card_comments.proposal_id is null
        and public._forge_can_comment_card(card_comments.card_id))
  );

-- 3) forge_add_comment: widen the top guard to _forge_can_comment_card, but restrict
--    non-elders (granted playtesters) to plain card-level comments/replies.
create or replace function public.forge_add_comment(
  p_card_id uuid, p_proposal_id uuid, p_parent_id uuid,
  p_field text, p_suggested_value jsonb, p_body text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_is_elder boolean; v_parent public.card_comments%rowtype;
begin
  if not public._forge_can_comment_card(p_card_id) then
    raise exception 'not authorized to comment on this card';
  end if;
  if btrim(coalesce(p_body,'')) = '' then raise exception 'a comment body is required'; end if;
  if octet_length(p_body) > 8000 then raise exception 'comment too long'; end if;
  if p_suggested_value is not null and octet_length(p_suggested_value::text) > 8000 then
    raise exception 'suggested value too large';
  end if;
  if p_field is not null and not public._forge_is_card_field(p_field) then
    raise exception 'unknown card field';
  end if;

  -- Elders satisfy the strict read-guard; granted playtesters do not.
  v_is_elder := public._forge_can_read_card(p_card_id);
  if not v_is_elder then
    if p_proposal_id is not null or p_field is not null or p_suggested_value is not null then
      raise exception 'playtesters can only leave plain comments';
    end if;
    if p_parent_id is not null then
      select * into v_parent from public.card_comments where id = p_parent_id;
      if not found or v_parent.card_id <> p_card_id or v_parent.proposal_id is not null then
        raise exception 'invalid parent comment';
      end if;
    end if;
  end if;

  insert into public.card_comments
    (card_id, proposal_id, parent_comment_id, field, suggested_value, body, created_by)
  values
    (p_card_id, p_proposal_id, p_parent_id, p_field, p_suggested_value, btrim(p_body), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- 4) Lock down EXECUTE (mirror 053). create-or-replace preserves ACLs; restate for clarity.
revoke execute on function public._forge_can_comment_card(uuid) from public, anon;
grant  execute on function public._forge_can_comment_card(uuid) to authenticated;
revoke execute on function public.forge_add_comment(uuid, uuid, uuid, text, jsonb, text) from public, anon;
grant  execute on function public.forge_add_comment(uuid, uuid, uuid, text, jsonb, text) to authenticated;
