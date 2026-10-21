import { readFile } from 'fs/promises';
import path from 'path';
import nodemailer from 'nodemailer';

type Attachment = {
  filename?: string;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  encoding?: string;
  /** Content-ID, for inline images referenced as src="cid:...". */
  cid?: string;
};

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Attachment[];
}

const FROM_NAME = 'Relun';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

const toBase64 = async (a: Attachment): Promise<string> => {
  if (a.path) return (await readFile(a.path)).toString('base64');
  if (Buffer.isBuffer(a.content)) return a.content.toString('base64');
  if (typeof a.content === 'string') {
    return a.encoding === 'base64' ? a.content : Buffer.from(a.content).toString('base64');
  }
  return '';
};

const mimeOf = (a: Attachment): string =>
  a.contentType ||
  MIME_BY_EXT[path.extname(a.filename || a.path || '').toLowerCase()] ||
  'application/octet-stream';

// ZeptoMail HTTP API: https://www.zoho.com/zeptomail/help/api/email-sending.html
const sendViaZeptoMail = async (options: EmailOptions, token: string) => {
  const attachments = options.attachments || [];
  const encoded = await Promise.all(
    attachments.map(async (a) => ({ a, content: await toBase64(a), mime_type: mimeOf(a) })),
  );

  const body = {
    from: { address: process.env.EMAIL_FROM || 'noreply@relun.chat', name: FROM_NAME },
    to: [options.to].flat().map((address) => ({ email_address: { address } })),
    subject: options.subject,
    htmlbody: options.html,
    ...(options.text && { textbody: options.text }),
    ...(encoded.some((e) => e.a.cid) && {
      inline_images: encoded
        .filter((e) => e.a.cid)
        .map((e) => ({ cid: e.a.cid, content: e.content, mime_type: e.mime_type })),
    }),
    ...(encoded.some((e) => !e.a.cid) && {
      attachments: encoded
        .filter((e) => !e.a.cid)
        .map((e) => ({ name: e.a.filename || 'attachment', content: e.content, mime_type: e.mime_type })),
    }),
  };

  const res = await fetch(process.env.ZEPTOMAIL_API_URL || 'https://cpaas.zoho.com/v1.1/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // The dashboard token may be copied with or without its scheme prefix.
      Authorization: token.startsWith('Zoho-enczapikey') ? token : `Zoho-enczapikey ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`ZeptoMail ${res.status}: ${JSON.stringify(data?.error || data)}`);
  }
  return { messageId: data?.request_id };
};

const sendViaSmtp = async (options: EmailOptions) => {
  const port = parseInt(process.env.SMTP_PORT || '587');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter.sendMail({
    from: {
      name: FROM_NAME,
      address: process.env.EMAIL_FROM || process.env.SMTP_USER || '',
    },
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: options.attachments || [],
  });
};

export const sendEmail = async (options: EmailOptions) => {
  try {
    const zeptoToken = process.env.ZEPTOMAIL_TOKEN;
    const info = zeptoToken ? await sendViaZeptoMail(options, zeptoToken) : await sendViaSmtp(options);
    console.log(`[EMAIL] Email sent successfully to ${options.to}====>>>>`, info.messageId);
    return info;
  } catch (error) {
    console.error('[EMAIL] Error sending email====>>>>', error);
    throw new Error('Failed to send email');
  }
};
