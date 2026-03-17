import { NextRequest, NextResponse } from 'next/server';
import { syncTournamentListings } from '@/lib/listings/sync';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    console.log('[cron] Starting tournament listings sync...');
    const result = await syncTournamentListings();
    console.log('[cron] Tournament listings sync complete:', result);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] Tournament listings sync failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
