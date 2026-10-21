import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin, getStats } from '../controllers/admin.controller';

const router = Router();

router.get('/stats', authenticate, requireAdmin, getStats);

export default router;
