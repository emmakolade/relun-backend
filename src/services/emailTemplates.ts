import path from 'path';

/**
 * Relun's email layout. Built from tables with inline styles, because email
 * clients (Gmail, Outlook, Apple Mail) ignore most modern CSS. The logo is a
 * PNG sent as an inline attachment: many clients block SVG and remote images.
 */

// assets/ sits next to src/ and dist/, so this works from either.
const LOGO_PATH = path.join(__dirname, '../../assets/email/relun-logo.png');
const LOGO_CID = 'relun-logo';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'Courier New', monospace";

const C = {
  page: '#F6F3F1',
  card: '#FFFFFF',
  ink: '#1A1A1A',
  body: '#4A4A4A',
  muted: '#8A8A8A',
  rose: '#E0245E',
  orange: '#FF9F1C',
  tint: '#FFF1F4',
  tintBorder: '#FFD6E0',
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export type RenderedEmail = {
  html: string;
  attachments: { filename: string; path: string; cid: string }[];
};

/**
 * Wraps [content] (already-escaped HTML) in the Relun layout: logo, a white
 * card with the brand gradient on top, and a muted footer.
 */
export const renderEmail = (params: {
  /** Inbox preview text, shown next to the subject. */
  preheader: string;
  title: string;
  content: string;
  /** Who it was sent to, for the footer. */
  recipient?: string;
}): RenderedEmail => {
  const { preheader, title, content, recipient } = params;
  const sentTo = recipient ? `This email was sent to ${escapeHtml(recipient)}.<br>` : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
<style>
  @media (max-width: 600px) {
    .card { border-radius: 0 !important; }
    .pad { padding: 32px 24px 28px !important; }
    .code { font-size: 30px !important; letter-spacing: 8px !important; padding-left: 8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}${'&#8199;&#65279;&#847; '.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
  <tr>
    <td align="center" style="padding:36px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td align="center" style="padding:0 0 24px;">
            <img src="cid:${LOGO_CID}" width="140" height="44" alt="Relun" style="display:block;border:0;outline:none;width:140px;height:auto;">
          </td>
        </tr>
        <tr>
          <td class="card" style="background:${C.card};border-radius:24px;overflow:hidden;box-shadow:0 10px 40px rgba(70,30,20,0.08);">
            <div style="height:6px;line-height:6px;font-size:0;background-color:${C.rose};background-image:linear-gradient(90deg,${C.rose},${C.orange});">&nbsp;</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="pad" style="padding:40px 40px 36px;font-family:${FONT};">
${content}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 24px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">
            ${sentTo}Relun · Find your match, your way
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { html, attachments: [{ filename: 'relun-logo.png', path: LOGO_PATH, cid: LOGO_CID }] };
};

/** Confirms a sign-up to hear when the Android and iPhone apps launch. */
export const waitlistEmail = (params: { recipient: string; platform?: 'android' | 'ios' }) => {
  const which = params.platform === 'android' ? 'the Android app' : params.platform === 'ios' ? 'the iPhone app' : 'the Relun app';
  const content = `
                  <h1 style="margin:0 0 12px;font-size:24px;line-height:32px;font-weight:700;color:${C.ink};">You're on the list</h1>
                  <p style="margin:0 0 20px;font-size:16px;line-height:24px;color:${C.body};">
                    Thanks for your interest in Relun. We'll email you once when ${which} is ready to download.
                  </p>
                  <p style="margin:0 0 28px;font-size:16px;line-height:24px;color:${C.body};">
                    You don't have to wait: Relun already works in your phone's browser, and you can add it to your home screen.
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="border-radius:999px;background:${C.rose};">
                        <a href="https://relun.chat/app/" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Open Relun on the web</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:28px 0 0;font-size:14px;line-height:22px;color:${C.muted};">
                    Didn't sign up? You can ignore this email, or reply and we'll remove you.
                  </p>`;

  return {
    subject: "You're on the Relun waitlist",
    text:
      `Thanks for your interest in Relun. We'll email you once when ${which} is ready to download.\n\n` +
      `You don't have to wait: open https://relun.chat/app/ in your phone's browser.\n\n` +
      `Didn't sign up? Ignore this email, or reply and we'll remove you.`,
    ...renderEmail({
      preheader: `We'll email you when ${which} is ready.`,
      title: "You're on the Relun waitlist",
      content,
      recipient: params.recipient,
    }),
  };
};

/** The sign-in code email. */
export const otpEmail = (params: { code: string; minutes: number; recipient: string }) => {
  const code = escapeHtml(params.code);
  const content = `
                  <h1 style="margin:0 0 12px;font-size:24px;line-height:32px;font-weight:700;color:${C.ink};">Your sign-in code</h1>
                  <p style="margin:0 0 28px;font-size:16px;line-height:24px;color:${C.body};">
                    Enter this code in Relun to continue. It expires in ${params.minutes} minutes.
                  </p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" style="background:${C.tint};border:1px solid ${C.tintBorder};border-radius:16px;padding:24px 12px;">
                        <span class="code" style="font-family:${MONO};font-size:36px;line-height:44px;font-weight:700;letter-spacing:12px;padding-left:12px;color:${C.ink};">${code}</span>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:28px 0 0;font-size:14px;line-height:22px;color:${C.body};">
                    Never share this code. Relun will never ask you for it.
                  </p>
                  <p style="margin:12px 0 0;font-size:14px;line-height:22px;color:${C.muted};">
                    Didn’t try to sign in? You can ignore this email. No one can get into your account without the code.
                  </p>`;

  return {
    subject: `${params.code} is your Relun code`,
    text:
      `Your Relun sign-in code is ${params.code}. It expires in ${params.minutes} minutes.\n\n` +
      `Never share this code. If you didn't try to sign in, you can ignore this email.`,
    ...renderEmail({
      preheader: `Your sign-in code is ${params.code}. It expires in ${params.minutes} minutes.`,
      title: 'Your Relun sign-in code',
      content,
      recipient: params.recipient,
    }),
  };
};
