import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { createSwipe, getSwipes, getPotentialMatches } from '../controllers/swipe.controller';

const router = Router();

// Create a swipe
router.post(
  '/',
  authenticate,
  [
    body('targetUserId').notEmpty().withMessage('Target user ID is required'),
    body('swipeType').isIn(['like', 'dislike', 'superlike']).withMessage('Invalid swipe type'),
  ],
  createSwipe
);

// Get swipe history
router.get('/', authenticate, getSwipes);

// Get potential matches (users not swiped on yet)
router.get('/potential', authenticate, getPotentialMatches);

export default router;
