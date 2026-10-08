import { Notification, NotificationType } from '../models/Notification';
import { getIO } from '../socket/io';

export const unreadNotificationCount = (userId: string) =>
  Notification.countDocuments({ userId, readAt: { $exists: false } });

/**
 * Adds a notification to the user's in-app list and tells an open app to
 * update its bell badge. Never throws: a missed notification shouldn't fail
 * the request that caused it.
 */
export const addNotification = async (params: {
  userId: string;
  type: NotificationType;
  actorId?: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> => {
  try {
    await Notification.create(params);
    const unreadCount = await unreadNotificationCount(params.userId);
    getIO()?.to(`user:${params.userId}`).emit('notification', { unreadCount });
  } catch (error) {
    console.error('Add notification error:', error);
  }
};
