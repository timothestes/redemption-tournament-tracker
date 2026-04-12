import { sendEmail } from '@/utils/email';

const ALERT_EMAIL = 'landofredemption@gmail.com';

/**
 * Send a failure alert email for a cron job.
 * Swallows email errors so they don't mask the original failure.
 */
export async function sendCronAlert(jobName: string, errorMessage: string) {
  await sendEmail({
    to: ALERT_EMAIL,
    subject: `[RedemptionCCG] ${jobName} FAILED`,
    html: `
      <h2 style="margin:0 0 16px 0; color:#f87171;">${jobName} Failed</h2>
      <p style="margin:0; font-family:monospace; font-size:13px; color:#fca5a5;">${errorMessage}</p>
      <p style="margin:16px 0 0 0; font-size:12px; color:#71717a;">
        Check <a href="https://vercel.com" style="color:#a1a1aa;">Vercel logs</a> for full details.
      </p>
    `,
  }).catch(() => {});
}
