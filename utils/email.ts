// Email utility using Resend
// To enable emails, install resend: npm install resend
// Add RESEND_API_KEY to your .env.local file

import { NATIONALS_CONFIG } from "../app/config/nationals";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: EmailOptions) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "noreply@yourdomain.com";

  if (!resendApiKey) {
    console.warn("RESEND_API_KEY not configured. Email not sent.");
    return { success: false, error: "Email service not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Email send failed:", error);
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    console.error("Email send error:", error);
    return { success: false, error: String(error) };
  }
}

export function getRegistrationConfirmationEmail(
  firstName: string,
  lastName: string,
  thursdayEvent: string,
  fridayEvent: string,
  saturdayEvent: string
) {
  const formatEvent = (event: string) => {
    if (!event || event === "none") return "None";
    return event
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6; 
            color: #1f2937; 
            background-color: #f3f4f6;
            margin: 0;
            padding: 0;
          }
          .container { 
            max-width: 600px; 
            margin: 40px auto; 
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header { 
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white; 
            padding: 40px 30px; 
            text-align: center;
          }
          .header h1 { 
            margin: 0 0 10px 0; 
            font-size: 32px; 
            font-weight: 700;
          }
          .header p { 
            margin: 0; 
            font-size: 18px; 
            opacity: 0.95;
          }
          .checkmark {
            display: inline-block;
            width: 60px;
            height: 60px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            margin: 0 0 20px 0;
            position: relative;
          }
          .checkmark:after {
            content: '✓';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 36px;
            color: white;
            font-weight: bold;
          }
          .content { 
            padding: 40px 30px;
          }
          .greeting {
            font-size: 24px;
            font-weight: 600;
            color: #111827;
            margin: 0 0 20px 0;
          }
          .intro-text {
            font-size: 16px;
            color: #4b5563;
            margin: 0 0 30px 0;
          }
          .section-title {
            font-size: 18px;
            font-weight: 600;
            color: #111827;
            margin: 30px 0 15px 0;
          }
          .event-box { 
            background: #f9fafb;
            padding: 16px 20px; 
            margin: 12px 0; 
            border-left: 4px solid #10b981; 
            border-radius: 6px;
          }
          .event-box strong {
            display: block;
            color: #374151;
            font-size: 14px;
            margin-bottom: 4px;
          }
          .event-box span {
            color: #059669;
            font-size: 16px;
            font-weight: 500;
          }
          .info-box {
            background: #ecfdf5;
            border: 1px solid #a7f3d0;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
          }
          .info-box h4 {
            margin: 0 0 12px 0;
            color: #065f46;
            font-size: 16px;
            font-weight: 600;
          }
          .info-box ul {
            margin: 0;
            padding: 0 0 0 20px;
            color: #047857;
          }
          .info-box li {
            margin: 6px 0;
          }
          .contact-box {
            background: #fef3c7;
            border: 1px solid #fde68a;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
          }
          .contact-box p {
            margin: 0 0 12px 0;
            color: #92400e;
            font-weight: 500;
          }
          .contact-box a {
            color: #b45309;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
          }
          .contact-box a:hover {
            text-decoration: underline;
          }
          .footer { 
            text-align: center; 
            padding: 30px; 
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
          }
          .footer p {
            margin: 5px 0;
            color: #6b7280; 
            font-size: 14px;
          }
          .footer a {
            color: #10b981;
            text-decoration: none;
          }
          @media only screen and (max-width: 600px) {
            .container {
              margin: 0;
              border-radius: 0;
            }
            .content {
              padding: 30px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="checkmark"></div>
            <h1>You're Registered!</h1>
            <p>${NATIONALS_CONFIG.displayName} • ${NATIONALS_CONFIG.datesShort}</p>
          </div>
          
          <div class="content">
            <p class="greeting">Hey ${firstName} ${lastName}! 🎉</p>
            <p class="intro-text">
              Your registration for the ${NATIONALS_CONFIG.year} National Redemption Tournament is confirmed! 
              We're excited to see you compete this summer.
            </p>
            
            <h3 class="section-title">📅 Your Event Schedule</h3>
            
            <div class="event-box">
              <strong>Thursday, ${NATIONALS_CONFIG.eventDates.thursday}</strong>
              <span>${formatEvent(thursdayEvent)}</span>
            </div>
            
            <div class="event-box">
              <strong>Friday, ${NATIONALS_CONFIG.eventDates.friday}</strong>
              <span>${formatEvent(fridayEvent)}</span>
            </div>
            
            <div class="event-box">
              <strong>Saturday, ${NATIONALS_CONFIG.eventDates.saturday}</strong>
              <span>${formatEvent(saturdayEvent)}</span>
            </div>
            
            <div class="info-box">
              <h4>📍 What's Next?</h4>
              <ul>
                <li>Venue location and directions will be sent in the coming weeks</li>
                <li>Detailed tournament schedule and rules coming soon</li>
                <li>Hotel recommendations and group rates will be shared</li>
              </ul>
            </div>
            
            <div class="contact-box">
              <p>Questions or need to update your registration?</p>
              <a href="mailto:info@landofredemption.com">info@landofredemption.com</a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              This email confirms your registration. Please keep it for your records.
            </p>
          </div>
          
          <div class="footer">
            <p><strong>Land of Redemption</strong></p>
            <p>${NATIONALS_CONFIG.displayName} Tournament | ${NATIONALS_CONFIG.dates}</p>
            <p style="margin-top: 10px;">
              <a href="https://landofredemption.com">Visit our website</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}
