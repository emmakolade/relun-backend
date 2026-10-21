import { User } from '../models/User';
import { ActiveDay } from '../models/ActiveDay';

// Days roll over on Lagos time (UTC+1, no daylight saving), like the free allowances.
export const STATS_TIMEZONE = 'Africa/Lagos';
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// lastActive is written at most this often per user.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** YYYY-MM-DD of the Lagos day containing `date`. */
export const lagosDay = (date: Date = new Date()): string =>
  new Date(date.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);

/** Start of the Lagos day `daysAgo` days before the one containing `date`. */
export const lagosDayStart = (daysAgo = 0, date: Date = new Date()): Date => {
  const shifted = new Date(date.getTime() + LAGOS_OFFSET_MS);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(midnight - LAGOS_OFFSET_MS - daysAgo * DAY_MS);
};

/** Start of the Lagos month containing `date`. */
export const lagosMonthStart = (date: Date = new Date()): Date => {
  const shifted = new Date(date.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - LAGOS_OFFSET_MS);
};

/**
 * Records that the user is using the app: bumps lastActive and marks today as
 * an active day. Throttled by the lastActive the caller already loaded, so a
 * busy session costs one write every few minutes. Never throws.
 */
export const touchActivity = (userId: string, lastActive?: Date | null): void => {
  const now = new Date();
  if (lastActive && now.getTime() - lastActive.getTime() < TOUCH_INTERVAL_MS) return;

  User.updateOne({ _id: userId }, { lastActive: now }).catch((error) =>
    console.error('Touch lastActive error:', error)
  );
  ActiveDay.updateOne(
    { day: lagosDay(now), userId },
    { $setOnInsert: { day: lagosDay(now), userId } },
    { upsert: true }
  ).catch((error) => {
    // Two requests racing to insert the same day is harmless.
    if ((error as { code?: number }).code !== 11000) console.error('Record active day error:', error);
  });
};
