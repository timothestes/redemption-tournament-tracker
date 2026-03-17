import { NextRequest, NextResponse } from 'next/server';
import { syncTournamentListings, SyncResult } from '@/lib/listings/sync';
import { sendEmail } from '@/utils/email';

const ALERT_EMAIL = 'landofredemption@gmail.com';

function shouldAlert(result: SyncResult): string | null {
  // Total failure — nothing parsed
  if (result.parsed === 0) {
    return 'Tournament sync parsed 0 listings — the Cactus page may have changed structure.';
  }

  // Validation failures
  if (result.invalid > 0) {
    return `Tournament sync had ${result.invalid} invalid listing(s):\n${result.errors.join('\n')}`;
  }

  // DB write errors
  if (result.errors.length > 0) {
    return `Tournament sync completed with errors:\n${result.errors.join('\n')}`;
  }

  return null;
}

function buildAlertEmail(reason: string, result: SyncResult): string {
  return `
    <h2 style="margin:0 0 16px 0; color:#f87171;">Tournament Sync Alert</h2>
    <p style="margin:0 0 16px 0;">${reason.replace(/\n/g, '<br>')}</p>
    <table style="width:100%; border-collapse:collapse; font-size:14px;">
      <tr><td style="padding:4px 8px; color:#a1a1aa;">Parsed</td><td style="padding:4px 8px;">${result.parsed}</td></tr>
      <tr><td style="padding:4px 8px; color:#a1a1aa;">Valid</td><td style="padding:4px 8px;">${result.valid}</td></tr>
      <tr><td style="padding:4px 8px; color:#a1a1aa;">Invalid</td><td style="padding:4px 8px;">${result.invalid}</td></tr>
      <tr><td style="padding:4px 8px; color:#a1a1aa;">Inserted</td><td style="padding:4px 8px;">${result.inserted}</td></tr>
      <tr><td style="padding:4px 8px; color:#a1a1aa;">Updated</td><td style="padding:4px 8px;">${result.updated}</td></tr>
      <tr><td style="padding:4px 8px; color:#a1a1aa;">Removed</td><td style="padding:4px 8px;">${result.marked_removed}</td></tr>
    </table>
    <p style="margin:16px 0 0 0; font-size:12px; color:#71717a;">
      Check <a href="https://vercel.com" style="color:#a1a1aa;">Vercel logs</a> for full details.
    </p>
  `;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    console.log('[cron] Starting tournament listings sync...');
    const result = await syncTournamentListings();
    console.log('[cron] Tournament listings sync complete:', result);

    // Check if we should alert
    const alertReason = shouldAlert(result);
    if (alertReason) {
      console.warn('[cron] Sending alert email:', alertReason);
      await sendEmail({
        to: ALERT_EMAIL,
        subject: `[RedemptionCCG] Tournament sync alert`,
        html: buildAlertEmail(alertReason, result),
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] Tournament listings sync failed:', message);

    // Alert on total failure
    await sendEmail({
      to: ALERT_EMAIL,
      subject: `[RedemptionCCG] Tournament sync FAILED`,
      html: `
        <h2 style="margin:0 0 16px 0; color:#f87171;">Tournament Sync Failed</h2>
        <p style="margin:0; font-family:monospace; font-size:13px; color:#fca5a5;">${message}</p>
      `,
    }).catch(() => {}); // Don't let email failure mask the original error

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
