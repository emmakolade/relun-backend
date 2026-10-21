import { Request, Response } from 'express';
import { Waitlist, WAITLIST_PLATFORMS, WaitlistPlatform } from '../models/Waitlist';
import { sendEmail } from '../services/email.service';
import { waitlistEmail } from '../services/emailTemplates';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// The endpoint is public and sends an email, so cap sign-ups per IP to keep it
// from being used to spam other people's inboxes.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, { count: number; resetAt: number }>();

const limited = (ip: string): boolean => {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 10_000) {
      for (const [key, value] of hits) if (value.resetAt < now) hits.delete(key);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
};

// POST /api/waitlist { email, platform?, source? }
export const joinWaitlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const platform = WAITLIST_PLATFORMS.includes(req.body?.platform)
      ? (req.body.platform as WaitlistPlatform)
      : undefined;
    const source = typeof req.body?.source === 'string' ? req.body.source.slice(0, 100) : undefined;

    if (!EMAIL_RE.test(email) || email.length > 254) {
      res.status(400).json({ error: 'Enter a valid email address' });
      return;
    }
    // req.ip honours the app's 'trust proxy' setting. Reading X-Forwarded-For
    // directly would let anyone dodge the limit by sending a fake header.
    const ip = req.ip || 'unknown';
    if (limited(ip)) {
      res.status(429).json({ error: 'Too many sign-ups. Try again later.' });
      return;
    }

    const result = await Waitlist.updateOne(
      { email },
      { $setOnInsert: { email, source }, ...(platform ? { $set: { platform } } : {}) },
      { upsert: true }
    );

    // Only the first sign-up gets the email; repeating it just updates the platform.
    if (result.upsertedCount > 0) {
      const mail = waitlistEmail({ recipient: email, platform });
      sendEmail({ to: email, ...mail }).catch((error) => console.error('Waitlist email error:', error));
    }

    res.status(201).json({ joined: true });
  } catch (error) {
    console.error('Join waitlist error:', error);
    res.status(500).json({ error: 'Failed to join the waitlist' });
  }
};
