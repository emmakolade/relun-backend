import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import {
  getMessages,
  sendMessage,
  deleteMessage,
  getUnreadCount,
} from '../controllers/chat.controller';

const router = Router();

// Get unread message count
router.get('/unread/count', authenticate, getUnreadCount);

// Get messages for a match
router.get('/:matchId', authenticate, getMessages);

// Send a message
router.post(
  '/:matchId',
  authenticate,
  [
    body('content').notEmpty().withMessage('Message content is required'),
    body('messageType')
      .optional()
      .isIn(['text', 'image', 'video', 'audio'])
      .withMessage('Invalid message type'),
  ],
  sendMessage
);

// Delete a message
router.delete('/:matchId/:messageId', authenticate, deleteMessage);

export default router;
