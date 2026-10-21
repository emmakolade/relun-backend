import { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window, in-memory rate limiter. Per process: if the API ever runs on
 * several instances, move the buckets to Redis.
 */
export const rateLimit = (options: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string | undefined;
  message?: string;
}) => {
  const buckets = new Map<string, Bucket>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, options.windowMs).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = options.key ? options.key(req) : req.ip;
    if (!key) {
      next();
      return;
    }

    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > options.max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000).toString());
      res.status(429).json({ error: options.message || 'Too many requests. Please try again later.' });
      return;
    }
    next();
  };
};

/** Rate-limit key for the email or phone in the body, so one inbox/number can't be flooded. */
export const contactKey = (req: Request): string | undefined => {
  const { email, phone } = req.body || {};
  if (typeof email === 'string' && email) return `e:${email.trim().toLowerCase()}`;
  if (typeof phone === 'string' && phone) return `p:${phone.trim()}`;
  return undefined;
};
