import os from 'os';
import { Response, NextFunction } from 'express';
import { PipelineStage } from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Like } from '../models/Like';
import { Message } from '../models/Message';
import { DatePost, DateRequest } from '../models/DatePost';
import { Plus, PlusPayment } from '../models/Plus';
import { CoinTransaction } from '../models/CoinTransaction';
import { Report } from '../models/Report';
import { ActiveDay } from '../models/ActiveDay';
import { getIO } from '../socket/io';
import { onlineCount } from '../socket/presence';
import {
  STATS_TIMEZONE,
  lagosDay,
  lagosDayStart,
  lagosMonthStart,
} from '../services/activity.service';

const TREND_DAYS = 14;

// Admins are listed by user id in ADMIN_USER_IDS (comma-separated).
const adminIds = () =>
  new Set(
    (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );

/** After authenticate. Anyone who isn't an admin gets a 404, as if the route didn't exist. */
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user || !adminIds().has(req.user.id)) {
    res.status(404).json({ error: 'Route not found' });
    return;
  }
  next();
};

/** Users with a socket in at least one conversation room. */
const usersInChats = (): number => {
  const io = getIO();
  if (!io) return 0;
  const users = new Set<string>();
  for (const [room, socketIds] of io.of('/').adapter.rooms) {
    if (!room.startsWith('conversation:')) continue;
    for (const socketId of socketIds) {
      const userId = (io.of('/').sockets.get(socketId) as { userId?: string } | undefined)?.userId;
      if (userId) users.add(userId);
    }
  }
  return users.size;
};

/** { 'YYYY-MM-DD': count } of documents per Lagos day of `field`, since `since`. */
const countByDay = async (
  model: { aggregate: (pipeline: PipelineStage[]) => Promise<{ _id: string; count: number }[]> },
  field: string,
  since: Date,
  match: Record<string, unknown> = {}
): Promise<Record<string, number>> => {
  const rows = await model.aggregate([
    { $match: { ...match, [field]: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: STATS_TIMEZONE } },
        count: { $sum: 1 },
      },
    },
  ]);
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
};

/** Matches per Lagos day: a match happens when the second of two mutual likes is made. */
const matchesByDay = async (since: Date): Promise<Record<string, number>> => {
  const rows = await Like.aggregate<{ _id: string; count: number }>([
    { $match: { createdAt: { $gte: since } } },
    {
      $lookup: {
        from: 'likes',
        let: { userId: '$userId', targetUserId: '$targetUserId', createdAt: '$createdAt' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$userId', '$$targetUserId'] },
                  { $eq: ['$targetUserId', '$$userId'] },
                  { $lte: ['$createdAt', '$$createdAt'] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'likeBack',
      },
    },
    { $match: { 'likeBack.0': { $exists: true } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: STATS_TIMEZONE } },
        count: { $sum: 1 },
      },
    },
  ]);
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
};

const activeByDay = async (since: string): Promise<Record<string, number>> => {
  const rows = await ActiveDay.aggregate<{ _id: string; count: number }>([
    { $match: { day: { $gte: since } } },
    { $group: { _id: '$day', count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
};

/** Plus revenue (in minor units) per currency since `since`, refunds excluded. */
const plusRevenue = async (since: Date) => {
  const rows = await PlusPayment.aggregate<{ _id: string; amount: number; count: number }>([
    { $match: { createdAt: { $gte: since }, refundedAt: { $exists: false } } },
    { $group: { _id: '$currency', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  return {
    payments: rows.reduce((sum, row) => sum + row.count, 0),
    byCurrency: Object.fromEntries(rows.map((row) => [row._id, row.amount])),
  };
};

const coinPurchases = async (since: Date) => {
  const [row] = await CoinTransaction.aggregate<{ count: number; coins: number }>([
    { $match: { reason: 'purchase', createdAt: { $gte: since } } },
    { $group: { _id: null, count: { $sum: 1 }, coins: { $sum: '$amount' } } },
  ]);
  return { purchases: row?.count ?? 0, coins: row?.coins ?? 0 };
};

/**
 * GET /api/admin/stats
 *
 * Live and daily numbers for the admin page. "Today" and the trend use Lagos days.
 */
export const getStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const todayStart = lagosDayStart(0, now);
    const monthStart = lagosMonthStart(now);
    const trendStart = lagosDayStart(TREND_DAYS - 1, now);
    const today = lagosDay(now);
    const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

    const [
      totalUsers,
      completedProfiles,
      active24h,
      active7d,
      active30d,
      likesToday,
      messagesToday,
      datePostsToday,
      dateRequestsToday,
      reportsToday,
      openReports,
      plusActive,
      plusBySource,
      plusToday,
      plusMonth,
      coinsToday,
      coinsMonth,
      signupTrend,
      activeTrend,
      matchTrend,
      messageTrend,
    ] = await Promise.all([
      User.countDocuments({ isActive: true }),
      Profile.countDocuments({ isComplete: true }),
      User.countDocuments({ isActive: true, lastActive: { $gte: hoursAgo(24) } }),
      User.countDocuments({ isActive: true, lastActive: { $gte: hoursAgo(24 * 7) } }),
      User.countDocuments({ isActive: true, lastActive: { $gte: hoursAgo(24 * 30) } }),
      Like.countDocuments({ source: 'like', createdAt: { $gte: todayStart } }),
      Message.countDocuments({ createdAt: { $gte: todayStart } }),
      DatePost.countDocuments({ createdAt: { $gte: todayStart } }),
      DateRequest.countDocuments({ createdAt: { $gte: todayStart } }),
      Report.countDocuments({ createdAt: { $gte: todayStart } }),
      Report.countDocuments({ status: 'open' }),
      Plus.countDocuments({ until: { $gt: now } }),
      Plus.aggregate<{ _id: string; count: number }>([
        { $match: { until: { $gt: now } } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
      plusRevenue(todayStart),
      plusRevenue(monthStart),
      coinPurchases(todayStart),
      coinPurchases(monthStart),
      countByDay(User, 'createdAt', trendStart),
      activeByDay(lagosDay(trendStart)),
      matchesByDay(trendStart),
      countByDay(Message, 'createdAt', trendStart),
    ]);

    const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
      const day = lagosDay(lagosDayStart(TREND_DAYS - 1 - i, now));
      return {
        day,
        signups: signupTrend[day] ?? 0,
        activeUsers: activeTrend[day] ?? 0,
        matches: matchTrend[day] ?? 0,
        messages: messageTrend[day] ?? 0,
      };
    });

    const memory = process.memoryUsage();

    res.json({
      generatedAt: now.toISOString(),
      timezone: STATS_TIMEZONE,
      live: {
        online: onlineCount(),
        inChats: usersInChats(),
      },
      users: {
        total: totalUsers,
        completedProfiles,
        signupsToday: signupTrend[today] ?? 0,
        activeToday: activeTrend[today] ?? 0,
        active24h,
        active7d,
        active30d,
      },
      today: {
        likes: likesToday,
        matches: matchTrend[today] ?? 0,
        messages: messagesToday,
        datePosts: datePostsToday,
        dateRequests: dateRequestsToday,
        reports: reportsToday,
      },
      money: {
        plusActive,
        plusBySource: Object.fromEntries(plusBySource.map((row) => [row._id, row.count])),
        plusToday,
        plusMonth,
        coinsToday,
        coinsMonth,
      },
      safety: { openReports },
      server: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(memory.rss / 1024 / 1024),
        heapMb: Math.round(memory.heapUsed / 1024 / 1024),
        load: os.loadavg().map((value) => Math.round(value * 100) / 100),
        cpus: os.cpus().length,
        node: process.version,
      },
      trend,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
};
