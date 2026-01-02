import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';
import {
  getProfile,
  updateProfile,
  uploadPhoto,
  deletePhoto,
  getUserProfile,
} from '../controllers/profile.controller';

const router = Router();

// Get user profile
router.get('/', authenticate, getProfile);

// Update profile
router.put(
  '/',
  authenticate,
  [
    body('bio').optional().isString().isLength({ max: 500 }),
    body('city').optional().isString(),
    body('segment').optional().isIn(['relationship', 'fun']),
    body('lookingFor').optional().isArray(),
    body('interests').optional().isArray(),
    body('location.latitude').optional().isFloat({ min: -90, max: 90 }),
    body('location.longitude').optional().isFloat({ min: -180, max: 180 }),
  ],
  updateProfile
);

// Upload photo (supports single or multiple files, max 6 total)
router.post('/photos', authenticate, upload.array('photos', 6), uploadPhoto);
// router.post('/photos', authenticate, upload.fields([
//   { name: 'photo', maxCount: 1 },
//   { name: 'photos', maxCount: 6 }
// ]), uploadPhoto);

// Delete photo
router.delete('/photos/:photoId', authenticate, deletePhoto);

// Get another user's profile
router.get('/:userId', authenticate, getUserProfile);

export default router;
