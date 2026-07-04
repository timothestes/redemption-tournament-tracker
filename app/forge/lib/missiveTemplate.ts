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
  <body style="margin:0;padding:0;background-color:#0c0a09;font-family:${bodyFont};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0c0a09;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#1b1613;border:1px solid #33261e;border-radius:12px;overflow:hidden;">
            <!-- Ember strip -->
            <tr>
              <td height="6" style="height:6px;font-size:0;line-height:0;background-color:#9a3412;background-image:linear-gradient(90deg,#431407,#9a3412,#f59e0b,#9a3412,#431407);">&nbsp;</td>
            </tr>
            <!-- Header: wordmark + kicker -->
            <tr>
              <td align="center" style="padding:28px 30px 22px;border-bottom:1px solid #33261e;">
                <div style="font-family:${display};font-size:26px;color:#fafaf9;letter-spacing:4px;text-transform:uppercase;">THE FORGE</div>
                <div style="font-family:${display};font-size:12px;color:#fbbf24;letter-spacing:3px;text-transform:uppercase;margin-top:8px;">AN ANNOUNCEMENT FROM THE ELDERS</div>
              </td>
            </tr>
            <!-- Body + signature -->
            <tr>
              <td style="padding:32px 30px;color:#f5f5f4;font-size:17px;line-height:1.75;font-family:${bodyFont};">
                ${bodyHtml}
                <div style="margin-top:28px;padding-top:18px;border-top:1px solid #33261e;">
                  <div style="color:#a8a29e;font-size:13px;">Sent from the Forge by</div>
                  <div style="margin-top:4px;"><strong style="color:#ffffff;">${senderName}</strong> <span style="color:#c9c3bc;"> — Elder of the Forge</span></div>
                  <div style="margin-top:4px;color:#c9c3bc;font-size:14px;">${senderEmail}</div>
                </div>
              </td>
            </tr>
            <!-- Confidentiality block -->
            <tr>
              <td style="padding:0 30px 28px;">
                <div style="background:#201409;border:1px solid #7c2d12;border-left:4px solid #ea580c;border-radius:6px;padding:16px 18px;font-size:14px;line-height:1.65;color:#e9e4de;font-family:${bodyFont};">
                  <span style="color:#fbbf24;font-weight:bold;">Keep it in the Forge.</span> Everything in this announcement — card designs, names, mechanics, set details, images, and timelines — is confidential playtest material. Do not share, screenshot, forward, or discuss it outside the Forge. You are reading this because the elders trust you with unfinished work; that trust is what makes the Forge possible. Guard it.
                </div>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td align="center" style="padding:20px 30px 26px;border-top:1px solid #33261e;text-align:center;color:#a8a29e;font-size:13px;line-height:1.6;font-family:${bodyFont};">
                <div>
                  <strong style="color:#e7e5e4;">Need to respond?</strong> DM <strong style="color:#e7e5e4;">${senderName}</strong> on Discord — that's where the Forge talks. Replies to this email reach ${senderName} as a backstop, but Discord is faster.
                </div>
                <div style="margin-top:12px;font-style:italic;color:#857c72;letter-spacing:1px;">Forged in fire. Kept in shadow.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
