import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  registerPushToken,
  deletePushToken,
  listNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
} from '../controllers/notification.controller';

const router = Router();

// Register this device for push notifications
router.post('/token', authenticate, registerPushToken);

// Stop pushing to this device (called on logout)
router.delete('/token', authenticate, deletePushToken);

// The in-app list behind the bell
router.get('/', authenticate, listNotifications);
router.get('/unread-count', authenticate, getUnreadNotificationCount);
router.post('/read', authenticate, markNotificationsRead);

export default router;
