import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { PushToken, PushProvider, isExpoPushToken, isFcmToken } from '../models/PushToken';
import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { Photo } from '../models/Photo';
import { getBlockedUserIds } from '../models/Block';
import { canSeeInsights } from '../services/plus.service';
import { unreadNotificationCount } from '../services/inbox.service';

// Expo tokens are recognisable by shape; anything else must say it is FCM.
const resolveProvider = (token: unknown, provider: unknown): PushProvider | null => {
  if (isExpoPushToken(token)) return 'expo';
  if (provider === 'fcm' && isFcmToken(token)) return 'fcm';
  return null;
};

export const registerPushToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token, platform, provider } = req.body;
    const userId = req.user!.id;
    const resolvedProvider = resolveProvider(token, provider);

    if (!resolvedProvider) {
      res.status(400).json({ error: 'Invalid push token' });
      return;
    }

    // Upsert on the token so re-registering the same device updates it, and a
    // device that switches accounts moves to the new user instead of keeping
    // both subscriptions alive.
    await PushToken.findOneAndUpdate(
      { token },
      {
        token,
        userId,
        provider: resolvedProvider,
        platform: platform === 'ios' || platform === 'android' ? platform : undefined,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ registered: true });
  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ error: 'Failed to register push token' });
  }
};

export const deletePushToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token } = req.body;
    const userId = req.user!.id;

    if (typeof token !== 'string' || !token) {
      res.status(400).json({ error: 'Invalid push token' });
      return;
    }

    // Scoped to the caller so one user cannot unregister another's device.
    await PushToken.deleteOne({ token, userId });

    res.json({ removed: true });
  } catch (error) {
    console.error('Delete push token error:', error);
    res.status(500).json({ error: 'Failed to remove push token' });
  }
};

// ---------- In-app notifications (the bell) ----------

const firstNameOf = (name?: string | null) => name?.trim().split(' ')[0] || 'Someone';

// GET /api/notifications. Newest first. Likes and views only name the person
// when the user has Likes & Views (a coin pass or Plus).
export const listNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const [items, blockedIds, insights] = await Promise.all([
      Notification.find({ userId }).sort({ createdAt: -1 }).limit(50).lean(),
      getBlockedUserIds(userId),
      canSeeInsights(userId),
    ]);
    const blocked = new Set(blockedIds);
    const visible = items.filter((n) => !n.actorId || !blocked.has(n.actorId.toString()));

    const actorIds = [...new Set(visible.flatMap((n) => (n.actorId ? [n.actorId.toString()] : [])))];
    const [users, photos] = await Promise.all([
      User.find({ _id: { $in: actorIds } }).select('fullName').lean(),
      Photo.find({ userId: { $in: actorIds } }).sort({ order: 1 }).select('userId url').lean(),
    ]);
    const nameById = new Map(users.map((u) => [u._id.toString(), u.fullName]));
    const photoById = new Map<string, string>();
    photos.forEach((p) => {
      const key = p.userId.toString();
      if (!photoById.has(key)) photoById.set(key, p.url);
    });

    const notifications = visible.map((n) => {
      const actorId = n.actorId?.toString();
      // Who liked or viewed is what Likes & Views sells.
      const hidden = (n.type === 'like' || n.type === 'view') && !insights;
      const name = actorId ? firstNameOf(nameById.get(actorId)) : null;
      let { title, body } = n;
      if (!hidden && name && n.type === 'like') {
        title = `${name} likes you`;
        body = 'Like them back to match.';
      } else if (!hidden && name && n.type === 'view') {
        title = `${name} viewed your profile`;
        body = 'Take a look at theirs.';
      }
      return {
        id: n._id.toString(),
        type: n.type,
        title,
        body,
        createdAt: n.createdAt,
        read: !!n.readAt,
        actor: actorId && !hidden ? { id: actorId, name, photoUrl: photoById.get(actorId) ?? null } : null,
        data: hidden ? {} : (n.data ?? {}),
      };
    });

    res.json({ notifications, unreadCount: await unreadNotificationCount(userId) });
  } catch (error) {
    console.error('List notifications error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
};

// GET /api/notifications/unread-count, for the bell badge.
export const getUnreadNotificationCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json({ unreadCount: await unreadNotificationCount(req.user!.id) });
  } catch (error) {
    console.error('Unread notifications error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
};

// POST /api/notifications/read. Opening the list marks everything read.
export const markNotificationsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await Notification.updateMany(
      { userId: req.user!.id, readAt: { $exists: false } },
      { $set: { readAt: new Date() } }
    );
    res.json({ unreadCount: 0 });
  } catch (error) {
    console.error('Mark notifications read error:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
};
