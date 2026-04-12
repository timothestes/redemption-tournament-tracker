import { NextRequest, NextResponse } from 'next/server';
import { syncDiscordRulings } from '@/lib/rulings/discord-sync';
import { sendCronAlert } from '@/lib/cron/alerts';

export const maxDuration = 90;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    console.log('[cron] Syncing Discord rulings...');
    const result = await syncDiscordRulings();
    console.log(`[cron] Rulings sync complete: ${result.fetched} fetched, ${result.newMessages} new`);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] Rulings sync failed:', message);
    await sendCronAlert('Rulings Sync', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
