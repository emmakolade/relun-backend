import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import {
  getPlusStatus,
  initializePlusPaystack,
  verifyPlusPaystack,
  confirmPlayPlus,
  cancelPlus,
} from '../controllers/plus.controller';

const router = Router();

router.get('/', authenticate, getPlusStatus);

// Web: Paystack. renew=true subscribes to the plan; false buys a one-time pass.
router.post(
  '/paystack/initialize',
  authenticate,
  [body('plan').isIn(['weekly', 'monthly']), body('renew').isBoolean()],
  initializePlusPaystack
);
router.post(
  '/paystack/verify',
  authenticate,
  [body('reference').isString().isLength({ min: 6, max: 200 })],
  verifyPlusPaystack
);

// Android: called after Google Play reports the subscription, before acknowledging it.
router.post(
  '/play',
  authenticate,
  [
    body('purchaseToken').isString().isLength({ min: 10, max: 4096 }),
    body('basePlanId').optional().isString(),
  ],
  confirmPlayPlus
);

router.post('/cancel', authenticate, cancelPlus);

export default router;
