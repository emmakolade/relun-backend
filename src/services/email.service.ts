import nodemailer from 'nodemailer';

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename?: string;
    content?: string | Buffer;
    path?: string;
    contentType?: string;
    encoding?: string;
  }>;
}

export const sendEmail = async (options: EmailOptions) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: {
        name: 'Relun App',
        address: process.env.EMAIL_FROM || process.env.SMTP_USER || '',
      },
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments || [],
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Email sent successfully to ${options.to}====>>>>`, info.messageId);
    return info;
  } catch (error) {
    console.error('[EMAIL] Error sending email====>>>>', error);
    throw new Error('Failed to send email');
  }
};

