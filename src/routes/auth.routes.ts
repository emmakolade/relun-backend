import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { rateLimit, contactKey } from '../middleware/rateLimit.middleware';
import {
  requestOTP,
  verifyOTP,
  logout,
  getCurrentUser,
  refreshToken,
  deleteAccount,
} from '../controllers/auth.controller';

const router = Router();

const MINUTE = 60 * 1000;

// Email or phone, as plain strings (objects would turn into Mongo query operators).
const contactValidators = [
  body('email')
    .optional()
    .isString()
    .trim()
    .toLowerCase()
    .isEmail()
    .withMessage('Invalid email'),
  body('phone')
    .optional()
    .isString()
    .trim()
    .isMobilePhone('any')
    .withMessage('Invalid phone'),
];

// Request OTP (Continue with Email/Phone)
router.post(
  '/request-otp',
  rateLimit({ windowMs: 15 * MINUTE, max: 10 }),
  rateLimit({ windowMs: 60 * MINUTE, max: 5, key: contactKey }),
  contactValidators,
  requestOTP
);

// Verify OTP
router.post(
  '/verify-otp',
  rateLimit({ windowMs: 15 * MINUTE, max: 30 }),
  rateLimit({ windowMs: 15 * MINUTE, max: 10, key: contactKey }),
  [
    ...contactValidators,
    body('otp')
      .isString()
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('OTP must be 6 digits'),
  ],
  verifyOTP
);

// Logout
router.post('/logout', authenticate, logout);

// Get current user
router.get('/me', authenticate, getCurrentUser);

// Refresh token
router.post(
  '/refresh',
  rateLimit({ windowMs: 15 * MINUTE, max: 60 }),
  [body('refreshToken').isString().withMessage('Refresh token is required')],
  refreshToken
);

router.delete('/account', authenticate, deleteAccount);

export default router;
