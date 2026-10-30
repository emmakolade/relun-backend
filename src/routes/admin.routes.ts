import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import {
  requireAdmin,
  getStats,
  getAdminSettings,
  updateAdminSettings,
} from '../controllers/admin.controller';

const router = Router();

router.get('/stats', authenticate, requireAdmin, getStats);

router.get('/settings', authenticate, requireAdmin, getAdminSettings);
router.patch(
  '/settings',
  authenticate,
  requireAdmin,
  [body('discoverEveryone').optional().isBoolean({ strict: true })],
  updateAdminSettings
);

export default router;
