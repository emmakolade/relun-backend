import { Response } from 'express';
import { validationResult } from 'express-validator';
import { AuthRequest } from '../middleware/auth.middleware';
import { Match } from '../models/Match';
import { Message } from '../models/Message';

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { matchId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user!.id;

    // Verify user is part of the match
    const match = await Match.findOne({
      _id: matchId,
      $or: [{ user1Id: userId }, { user2Id: userId }],
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const messages = await Message.find({ matchId })
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('senderId', 'fullName')
      .populate('receiverId', 'fullName');

    const total = await Message.countDocuments({ matchId });

    // Mark messages as read
    await Message.updateMany(
      { matchId, receiverId: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    res.json({
      messages: messages.reverse(), // Reverse to show oldest first
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
};

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { matchId } = req.params;
    const { content, messageType = 'text' } = req.body;
    const userId = req.user!.id;

    // Verify user is part of the match
    const match = await Match.findOne({
      _id: matchId,
      $or: [{ user1Id: userId }, { user2Id: userId }],
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const receiverId = match.user1Id.toString() === userId ? match.user2Id : match.user1Id;

    const message = await Message.create({
      matchId,
      senderId: userId,
      receiverId,
      content,
      messageType,
    });

    // Update match's last message timestamp
    // match.lastMessageAt = new Date();
    await match.save();

    const populatedMessage = await Message.findById(message._id)
      .populate('senderId', 'fullName')
      .populate('receiverId', 'fullName');

    res.status(201).json(populatedMessage);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

export const deleteMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { matchId, messageId } = req.params;
    const userId = req.user!.id;

    const message = await Message.findOne({
      _id: messageId,
      matchId,
      senderId: userId,
    });

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    await Message.deleteOne({ _id: messageId });

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
};

export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const unreadCount = await Message.countDocuments({
      receiverId: userId,
      isRead: false,
    });

    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
};
