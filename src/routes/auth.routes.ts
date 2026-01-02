import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import {
  requestOTP,
  verifyOTP,
  login,
  logout,
  getCurrentUser,
  refreshToken,
} from '../controllers/auth.controller';
import { completeProfile } from '../controllers/profile.controller';

const router = Router();

// Request OTP (Continue with Email/Phone)
router.post(
  '/request-otp',
  [
    body('email').optional().isEmail().withMessage('Invalid email'),
    body('phone').optional().isMobilePhone('any').withMessage('Invalid phone'),
  ],
  requestOTP
);

// Verify OTP
router.post(
  '/verify-otp',
  [
    body('email').optional().isEmail(),
    body('phone').optional(),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  verifyOTP
);

// // Login (after OTP verification)
router.post('/login', [body('email').optional().isEmail(), body('phone').optional()], login);

// Complete profile (for new users)
router.post(
  '/complete-profile',
  authenticate,
  [
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('dateOfBirth').isISO8601().withMessage('Valid date of birth is required'),
    body('gender').isIn(['male', 'female', 'non_binary', 'other']).withMessage('Invalid gender'),
    body('segment').isIn(['relationship', 'fun']).withMessage('Invalid segment'),
    body('bio').optional().isString().isLength({ max: 500 }),
    body('email').optional().isEmail(),
    body('phone').optional().isMobilePhone('any'),
    body('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    body('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  ],
  completeProfile
);

// Logout
router.post('/logout', authenticate, logout);

// Get current user
router.get('/me', authenticate, getCurrentUser);

// Refresh token
router.post('/refresh', refreshToken);

export default router;
