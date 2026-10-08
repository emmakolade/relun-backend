import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { getSettings, updateSettings } from '../controllers/settings.controller';

const router = Router();

router.get('/', authenticate, getSettings);

router.patch(
  '/',
  authenticate,
  [
    body('isVisible').optional().isBoolean(),
    body('showAge').optional().isBoolean(),
    body('showDistance').optional().isBoolean(),
    body('notificationsEnabled').optional().isBoolean(),
    body('allowMessageRequests').optional().isBoolean(),
    body('maxDistanceKm').optional().isInt({ min: 1, max: 100 }).toInt(),
    body('ageMin').optional().isInt({ min: 18, max: 99 }).toInt(),
    body('ageMax').optional().isInt({ min: 18, max: 99 }).toInt(),
  ],
  updateSettings
);

export default router;
