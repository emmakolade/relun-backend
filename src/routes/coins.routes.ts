import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import {
  getWallet,
  getTransactions,
  confirmPurchase,
  buyInsights,
  initializePaystack,
  verifyPaystack,
  paystackWebhook,
  markBonusSeen,
} from '../controllers/coins.controller';

const router = Router();

router.get('/', authenticate, getWallet);
router.get('/transactions', authenticate, getTransactions);

// Called by the app after Google Play reports a purchase, before consuming it.
router.post(
  '/purchases',
  authenticate,
  [
    body('productId').isString().notEmpty(),
    body('purchaseToken').isString().isLength({ min: 10, max: 4096 }),
    body('platform').optional().isIn(['android', 'ios']),
  ],
  confirmPurchase
);

// Web purchases through Paystack.
router.post(
  '/paystack/initialize',
  authenticate,
  [body('productId').isString().notEmpty()],
  initializePaystack
);
router.post(
  '/paystack/verify',
  authenticate,
  [body('reference').isString().isLength({ min: 6, max: 200 })],
  verifyPaystack
);
router.post('/paystack/webhook', paystackWebhook);

router.post('/bonus/:id/seen', authenticate, markBonusSeen);

router.post('/insights', authenticate, [body('days').optional().isIn([7, 30])], buyInsights);

export default router;
