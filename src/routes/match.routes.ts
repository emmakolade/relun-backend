import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getMatches,
  getMatchById,
  unmatch,
  blockUser,
} from '../controllers/match.controller';

const router = Router();

// Get all matches for current user
router.get('/', authenticate, getMatches);

// Get match by ID
router.get('/:matchId', authenticate, getMatchById);

// Unmatch
router.delete('/:matchId', authenticate, unmatch);

// Block user
router.post('/:matchId/block', authenticate, blockUser);

export default router;
