import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';
import {
  getProfile,
  updateProfile,
  uploadPhoto,
  replacePhoto,
  deletePhoto,
  getUserProfile,
  getNearbyUsers,
  completeProfile,
  likeUser,
  unlikeUser,
  getLikeStatus,
  getReceivedLikes,
  getMatches,
  passUser,
  getProfileViews,
} from '../controllers/profile.controller';
import { SHOW_ME_VALUES } from '../models/Profile';

const router = Router();

// Get user profile
router.get('/', authenticate, getProfile);

// Update profile
router.put(
  '/',
  authenticate,
  [
    body('fullName').optional().isString().trim().isLength({ min: 1, max: 100 }),
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

// Upload photo (supports single or multiple files, max 3 total)
router.post('/photos', authenticate, upload.array('photos', 3), uploadPhoto);

// Replace an existing photo
router.patch('/photos/:photoId', authenticate, upload.single('photo'), replacePhoto);
// router.post('/photos', authenticate, upload.fields([
//   { name: 'photo', maxCount: 1 },
//   { name: 'photos', maxCount: 6 }
// ]), uploadPhoto);

// Delete photo
router.delete('/photos/:photoId', authenticate, deletePhoto);

// Get nearby users for discovery/feed
router.get(
  '/discover',
  authenticate,
  [
    query('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    query('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage('Limit must be between 1 and 50'),
  ],
  getNearbyUsers
);

// Like/unlike a user
router.post(
  '/likes/:targetUserId',
  authenticate,
  [param('targetUserId').isMongoId().withMessage('Invalid target user ID')],
  likeUser
);

router.delete(
  '/likes/:targetUserId',
  authenticate,
  [param('targetUserId').isMongoId().withMessage('Invalid target user ID')],
  unlikeUser
);

router.get(
  '/likes/:targetUserId/status',
  authenticate,
  [param('targetUserId').isMongoId().withMessage('Invalid target user ID')],
  getLikeStatus
);

router.get('/likes/received', authenticate, getReceivedLikes);

// Not interested, so Discover stops showing them.
router.post(
  '/passes/:targetUserId',
  authenticate,
  [param('targetUserId').isMongoId().withMessage('Invalid target user ID')],
  passUser
);

// Who viewed my profile (gated on insights).
router.get('/views', authenticate, getProfileViews);

// Mutual matches. Must stay above '/:userId' or that route swallows it.
router.get('/matches', authenticate, getMatches);

// Get another user's profile
router.get('/:userId', authenticate, getUserProfile);

// Complete profile (for new users)
router.post(
  '/complete-profile',
  authenticate,
  [
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('dateOfBirth').isISO8601().withMessage('Valid date of birth is required'),
    body('gender').isIn(['male', 'female']).withMessage('Invalid gender'),
    body('segment').isIn(['relationship', 'fun']).withMessage('Invalid segment'),
    body('showMe').optional().isIn([...SHOW_ME_VALUES]).withMessage('Invalid showMe'),
    body('bio').optional().isString().isLength({ max: 500 }),
    body('email').optional().isEmail(),
    body('phone').optional().isMobilePhone('any'),
    body('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    body('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  ],
  completeProfile
);

export default router;
