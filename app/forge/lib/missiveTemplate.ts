// UI name: "Announcements" (renamed 2026-07-04). DB objects keep the missive name (migration 062 is live).
//
// Forge missive email template.
// Pure, synchronous HTML builders for the "Forge Missives" feature: elders emailing
// playtesters. Emails ship as raw HTML via Resend, so every style that carries the
// design is inline, tables use role="presentation", and solid-color fallbacks back
// gradients for Outlook. No shared code with utils/email.ts — this is fully forge-branded.

/** Escapes the five HTML-significant characters. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Turns a raw plain-text body into email-safe HTML.
 * Escapes the whole body first, substitutes {name} with the (escaped) recipient name
 * ({name} survives escaping since it has no special chars), then converts
 * blank-line-separated blocks into <p> and single newlines into <br>.
 */
export function missiveBodyHtml(body: string, recipientName: string): string {
  const escaped = escapeHtml(body).replace(/\{name\}/g, escapeHtml(recipientName));
  return escaped
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p style="margin:0 0 16px 0;">${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Wraps a missive body (output of missiveBodyHtml) in the full forge-branded email
 * document: ember strip, header wordmark + kicker, body, signature, confidentiality
 * block, and footer. senderName/senderEmail are escaped where injected.
 */
export function wrapForgeMissive(opts: {
  bodyHtml: string;
  senderName: string;
  senderEmail: string;
}): string {
  const { bodyHtml } = opts;
  const senderName = escapeHtml(opts.senderName);
  const senderEmail = escapeHtml(opts.senderEmail);

  const display = "Impact, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
  const bodyFont = "Arimo, Arial, 'Helvetica Neue', Helvetica, sans-serif";

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;background-color:#05080c;font-family:${bodyFont};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#05080c;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#10151d;border:1px solid #232c38;border-radius:12px;overflow:hidden;">
            <!-- Quench strip -->
            <tr>
              <td height="6" style="height:6px;font-size:0;line-height:0;background-color:#1d4ed8;background-image:linear-gradient(90deg,#0b1a33,#1d4ed8,#7dd3fc,#1d4ed8,#0b1a33);">&nbsp;</td>
            </tr>
            <!-- Header: wordmark + kicker -->
            <tr>
              <td align="center" style="padding:28px 30px 22px;border-bottom:1px solid #232c38;">
                <div style="font-family:${display};font-size:26px;color:#f8fafc;letter-spacing:4px;text-transform:uppercase;">THE FORGE</div>
                <div style="font-family:${display};font-size:12px;color:#7dd3fc;letter-spacing:3px;text-transform:uppercase;margin-top:8px;">AN ANNOUNCEMENT FROM THE ELDERS</div>
              </td>
            </tr>
            <!-- Body + signature -->
            <tr>
              <td style="padding:32px 30px;color:#e2e8f0;font-size:17px;line-height:1.75;font-family:${bodyFont};">
                ${bodyHtml}
                <div style="margin-top:28px;padding-top:18px;border-top:1px solid #232c38;">
                  <div style="color:#94a3b8;font-size:13px;">Sent from the Forge by</div>
                  <div style="margin-top:4px;"><strong style="color:#ffffff;">${senderName}</strong> <span style="color:#b0bcca;"> — Redemption Elder</span></div>
                  <div style="margin-top:4px;color:#b0bcca;font-size:14px;">${senderEmail}</div>
                </div>
              </td>
            </tr>
            <!-- Confidentiality block -->
            <tr>
              <td style="padding:0 30px 28px;">
                <div style="background:#0b1420;border:1px solid #1e3a5f;border-left:4px solid #38bdf8;border-radius:6px;padding:16px 18px;font-size:14px;line-height:1.65;color:#dbe4ee;font-family:${bodyFont};">
                  Everything in this announcement — card designs, names, mechanics, set details, images, and timelines — is confidential playtest material. Do not share, screenshot, forward, or discuss it outside of playtesting.
                </div>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td align="center" style="padding:20px 30px 26px;border-top:1px solid #232c38;text-align:center;color:#94a3b8;font-size:13px;line-height:1.6;font-family:${bodyFont};">
                <div>
                  <strong style="color:#e2e8f0;">Need to respond?</strong> DM <strong style="color:#e2e8f0;">${senderName}</strong> on Discord
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
