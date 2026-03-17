import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * GET /api/rulings?card_name=X              → rulings for a specific card
 * GET /api/rulings?search=X                 → search across all rulings
 * GET /api/rulings?discord=X                → search Discord rulings channel archive
 * GET /api/rulings?discord_context=MSG_ID   → 5 messages before/after a Discord message
 * GET /api/rulings?discord_more=DATE&dir=older|newer → load 5 more messages in a direction
 * GET /api/rulings?recent=1&page=N          → paginated recent rulings (default page 1, 20 per page)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cardName = searchParams.get('card_name');
  const search = searchParams.get('search');
  const discord = searchParams.get('discord');
  const discordContext = searchParams.get('discord_context');
  const discordMore = searchParams.get('discord_more');
  const dir = searchParams.get('dir');
  const recent = searchParams.get('recent');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const perPage = 20;

  const supabase = await createClient();

  if (cardName) {
    const { data, error } = await supabase
      .from('card_rulings')
      .select('id, card_name, question, answer, source, ruling_date')
      .eq('card_name', cardName)
      .order('ruling_date', { ascending: false });

    if (error) {
      return NextResponse.json({ rulings: [], error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rulings: data || [] });
  }

  if (search && search.trim().length >= 2) {
    const { data, error } = await supabase
      .from('card_rulings')
      .select('id, card_name, question, answer, source, ruling_date')
      .or(
        `card_name.ilike.%${search}%,question.ilike.%${search}%,answer.ilike.%${search}%`
      )
      .order('card_name', { ascending: true })
      .limit(50);

    if (error) {
      return NextResponse.json({ rulings: [], error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rulings: data || [] });
  }

  if (discord && discord.trim().length >= 2) {
    const discordPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const discordPerPage = 20;
    const sort = searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
    const from = (discordPage - 1) * discordPerPage;
    const to = from + discordPerPage - 1;

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      supabase
        .from('discord_ruling_messages')
        .select('id, author_name, content, message_date')
        .ilike('content', `%${discord}%`)
        .order('message_date', { ascending: sort === 'oldest' })
        .range(from, to),
      supabase
        .from('discord_ruling_messages')
        .select('*', { count: 'exact', head: true })
        .ilike('content', `%${discord}%`),
    ]);

    if (error || countError) {
      return NextResponse.json({ messages: [], error: (error || countError)?.message }, { status: 500 });
    }

    return NextResponse.json({
      messages: data || [],
      total: count || 0,
      page: discordPage,
      perPage: discordPerPage,
      totalPages: Math.ceil((count || 0) / discordPerPage),
    });
  }

  if (discordContext) {
    // Get the target message first
    const { data: target, error: targetError } = await supabase
      .from('discord_ruling_messages')
      .select('id, author_name, content, message_date')
      .eq('id', discordContext)
      .single();

    if (targetError || !target) {
      return NextResponse.json({ messages: [], error: 'Message not found' }, { status: 404 });
    }

    // Get 5 messages before and 5 after by message_date
    const [{ data: before }, { data: after }] = await Promise.all([
      supabase
        .from('discord_ruling_messages')
        .select('id, author_name, content, message_date')
        .lt('message_date', target.message_date)
        .order('message_date', { ascending: false })
        .limit(5),
      supabase
        .from('discord_ruling_messages')
        .select('id, author_name, content, message_date')
        .gt('message_date', target.message_date)
        .order('message_date', { ascending: true })
        .limit(5),
    ]);

    // Combine: before (reversed to chronological) + target + after
    const context = [
      ...(before || []).reverse(),
      target,
      ...(after || []),
    ];

    return NextResponse.json({ messages: context, targetId: target.id });
  }

  if (discordMore && dir) {
    const isOlder = dir === 'older';
    const { data, error } = await supabase
      .from('discord_ruling_messages')
      .select('id, author_name, content, message_date')
      [isOlder ? 'lt' : 'gt']('message_date', discordMore)
      .order('message_date', { ascending: !isOlder })
      .limit(5);

    if (error) {
      return NextResponse.json({ messages: [], error: error.message }, { status: 500 });
    }

    // Return in chronological order
    const messages = isOlder ? (data || []).reverse() : (data || []);
    return NextResponse.json({ messages });
  }

  if (recent) {
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      supabase
        .from('card_rulings')
        .select('id, card_name, question, answer, source, ruling_date')
        .order('created_at', { ascending: false })
        .range(from, to),
      supabase
        .from('card_rulings')
        .select('*', { count: 'exact', head: true }),
    ]);

    if (error || countError) {
      return NextResponse.json({ rulings: [], error: (error || countError)?.message }, { status: 500 });
    }

    return NextResponse.json({
      rulings: data || [],
      total: count || 0,
      page,
      perPage,
      totalPages: Math.ceil((count || 0) / perPage),
    });
  }

  return NextResponse.json({ rulings: [] });
}
