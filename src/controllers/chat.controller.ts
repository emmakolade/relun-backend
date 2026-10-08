import { Response } from 'express';
import mongoose from 'mongoose';
import { validationResult } from 'express-validator';
import { AuthRequest } from '../middleware/auth.middleware';
import { Message, getConversationId } from '../models/Message';
import { getBlockedUserIds, isBlockedEitherWay } from '../models/Block';
import { isMatched, Like } from '../models/Like';
import { MessageRequest } from '../models/MessageRequest';
import { Profile } from '../models/Profile';
import { canViewConversation, resolveSendAccess, CHAT_ACCESS_ERRORS } from '../services/access.service';
import { hasPlus, requestAllowance } from '../services/plus.service';
import {
  ensureLike,
  messageRequestView,
  messageRequestViews,
} from '../services/messageRequest.service';
import { spendCoins, creditCoins, InsufficientCoinsError } from '../services/wallet.service';
import { notifyMessageRequest, notifyNewMatch, notifyNewMessage } from '../services/push.service';
import { isUserOnline } from '../socket/presence';
import { getIO } from '../socket/io';
import { COIN_COSTS } from '../config/coins';
import { User } from '../models/User';
import { GetMessagesResponse, SendMessageRequest, UnreadCountResponse } from '../types';

const isValidObjectId = (id: string): boolean => mongoose.Types.ObjectId.isValid(id);

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user!.id;

    if (!isValidObjectId(recipientId)) {
      res.status(400).json({ error: 'Invalid recipient id' });
      return;
    }

    if (!(await canViewConversation(userId, recipientId))) {
      res.status(403).json({ error: 'You can only chat with your matches' });
      return;
    }

    // Generate conversation ID from the two user IDs
    const conversationId = getConversationId(userId, recipientId);

    const [messages, total] = await Promise.all([
      Message.find({ conversationId })
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit)),
      Message.countDocuments({ conversationId }),
    ]);

    // Mark messages as read
    await Message.updateMany(
      { conversationId, receiverId: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    const response: GetMessagesResponse = {
      messages: messages.reverse() as any, // Reverse to show oldest first
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
      request: await messageRequestView(userId, recipientId),
    };

    res.json(response);
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

    const { recipientId } = req.params;
    const { content, messageType = 'text' }: SendMessageRequest = req.body;
    const userId = req.user!.id;

    if (!isValidObjectId(recipientId)) {
      res.status(400).json({ error: 'Invalid recipient id' });
      return;
    }

    // A match or message request implies both users exist; blocks, unpaid
    // chats and spent requests are refused. Replying to a request accepts it.
    const access = await resolveSendAccess(userId, recipientId);
    if (access !== 'ok' && access !== 'reply') {
      res.status(403).json({ error: CHAT_ACCESS_ERRORS[access], code: access.toUpperCase() });
      return;
    }

    // Generate conversation ID from the two user IDs
    const conversationId = getConversationId(userId, recipientId);

    const message = await Message.create({
      conversationId,
      senderId: userId,
      receiverId: recipientId,
      content,
      messageType,
    });

    res.status(201).json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

export const deleteMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId, messageId } = req.params;
    const userId = req.user!.id;

    if (!isValidObjectId(recipientId) || !isValidObjectId(messageId)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }

    const conversationId = getConversationId(userId, recipientId);

    // Scoped to senderId, so a user can only delete their own messages.
    const result = await Message.deleteOne({
      _id: messageId,
      conversationId,
      senderId: userId,
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

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

    const response: UnreadCountResponse = { unreadCount };
    res.json(response);
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
};

export const getConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    // Aggregation pipelines are not cast by Mongoose, so the id must be an
    // ObjectId here or every $match and $eq below silently matches nothing.
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Get all unique conversations for this user
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [{ senderId: userObjectId }, { receiverId: userObjectId }],
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: '$conversationId',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$receiverId', userObjectId] }, { $eq: ['$isRead', false] }] },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $sort: { 'lastMessage.createdAt': -1 },
      },
    ]);

    // Fetch every participant in one query rather than one per conversation.
    const otherUserIds = conversations.map((conv) =>
      conv.lastMessage.senderId.equals(userObjectId)
        ? conv.lastMessage.receiverId
        : conv.lastMessage.senderId
    );

    const conversationIds = conversations.map((conv) => conv._id as string);
    const [users, blockedIds, requests] = await Promise.all([
      User.find({ _id: { $in: otherUserIds }, isActive: true }).select('fullName'),
      getBlockedUserIds(userId),
      messageRequestViews(userId, conversationIds),
    ]);
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    const blocked = new Set(blockedIds);

    const conversationsWithUsers = conversations
      .map((conv, index) => {
        const request = requests.get(conv._id) ?? null;
        return {
          conversationId: conv._id,
          otherUser: usersById.get(otherUserIds[index].toString()) ?? null,
          lastMessage: conv.lastMessage,
          unreadCount: conv.unreadCount,
          // Set while the pair is talking through a message request, not a match.
          request,
        };
      })
      .filter(
        (conv) =>
          conv.otherUser &&
          !blocked.has(conv.otherUser._id.toString()) &&
          // A declined request disappears for the person who declined it.
          !(conv.request?.status === 'declined' && !conv.request.outgoing)
      );

    res.json({ conversations: conversationsWithUsers });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
};

// Saves a message and pushes it out the way a socket send would.
const deliver = async (params: {
  userId: string;
  recipientId: string;
  conversationId: string;
  content: string;
  request?: boolean;
}) => {
  const { userId, recipientId, conversationId, content } = params;
  const message = await Message.create({
    conversationId,
    senderId: userId,
    receiverId: recipientId,
    content,
    messageType: 'text',
  });

  const event = { conversationId, message: message.toJSON() };
  const io = getIO();
  io?.to(`conversation:${conversationId}`).emit('new_message', event);
  io?.to(`user:${recipientId}`).emit('message_notification', event);

  // A request always pushes: it's the one message they have no reason to expect.
  if (params.request) void notifyMessageRequest({ recipientId, senderId: userId, content });
  else if (!isUserOnline(recipientId)) void notifyNewMessage({ recipientId, senderId: userId, content });

  return message;
};

// POST /api/chat/:recipientId/request
// Messages someone without a match. Uses the free allowance first (weekly, or
// Plus's monthly ones), then COIN_COSTS.messageRequest coins. Coins are not
// refunded if they decline or never reply.
export const sendMessageRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { recipientId } = req.params;
    const content: string = req.body.content;
    const userId = req.user!.id;

    if (!isValidObjectId(recipientId) || recipientId === userId) {
      res.status(400).json({ error: 'Invalid recipient id' });
      return;
    }

    const recipient = await User.findOne({ _id: recipientId, isActive: true }).select('_id').lean();
    if (!recipient || (await isBlockedEitherWay(userId, recipientId))) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const [myProfile, theirProfile] = await Promise.all([
      Profile.findOne({ userId }).select('segment').lean(),
      Profile.findOne({ userId: recipientId }).select('segment allowMessageRequests').lean(),
    ]);

    if (myProfile?.segment && theirProfile?.segment && myProfile.segment !== theirProfile.segment) {
      res.status(403).json({ error: 'You can only message people in the same segment' });
      return;
    }

    if (theirProfile?.allowMessageRequests === false) {
      res.status(403).json({ error: 'They are not accepting message requests', code: 'REQUESTS_OFF' });
      return;
    }

    if (await isMatched(userId, recipientId)) {
      res.status(409).json({ error: 'You are already matched', code: 'ALREADY_MATCHED' });
      return;
    }

    const conversationId = getConversationId(userId, recipientId);
    if (await MessageRequest.exists({ conversationId })) {
      res.status(409).json({ error: 'You have already sent them a message', code: 'REQUEST_EXISTS' });
      return;
    }

    const coinsNow = async () => (await User.findById(userId).select('coins').lean())?.coins ?? 0;

    // They already like this user, so liking back makes a match and the chat
    // opens for free. Nothing is charged and no free request is used.
    const likedBack = !!(await Like.exists({ userId: recipientId, targetUserId: userId }));
    if (likedBack) {
      await ensureLike(userId, recipientId);
      const message = await deliver({ userId, recipientId, conversationId, content });
      void notifyNewMatch({ recipientId, matchedUserId: userId });

      res.status(201).json({ matched: true, request: null, charged: 0, balance: await coinsNow(), message });
      return;
    }

    const allowance = await requestAllowance(userId, await hasPlus(userId));
    const free = allowance.left > 0;
    const charged = free ? 0 : COIN_COSTS.messageRequest;
    const balance = free
      ? await coinsNow()
      : await spendCoins({ userId, amount: charged, reason: 'message_request', refId: recipientId });

    try {
      await MessageRequest.create({
        conversationId,
        senderId: userId,
        receiverId: recipientId,
        paidWith: free ? allowance.paidWith : 'coins',
      });
    } catch (error) {
      // A double tap got here first. Give any coins back.
      if ((error as { code?: number }).code === 11000) {
        if (charged) {
          await creditCoins({ userId, amount: charged, reason: 'refund', refId: recipientId });
        }
        res.status(409).json({ error: 'You have already sent them a message', code: 'REQUEST_EXISTS' });
        return;
      }
      throw error;
    }

    // Like them too: if they like back from Discover, that's a match.
    await ensureLike(userId, recipientId);
    const message = await deliver({ userId, recipientId, conversationId, content, request: true });

    res.status(201).json({
      matched: false,
      request: await messageRequestView(userId, recipientId),
      charged,
      // Which allowance paid for it, if it was free: 'free' (weekly) or 'plus'.
      freeAllowance: free ? allowance.paidWith : null,
      balance,
      message,
    });
  } catch (error) {
    if (error instanceof InsufficientCoinsError) {
      res.status(402).json({
        error: 'Not enough coins',
        code: 'INSUFFICIENT_COINS',
        required: error.required,
        balance: error.balance,
      });
      return;
    }
    console.error('Send message request error:', error);
    res.status(500).json({ error: 'Failed to send message request' });
  }
};

// POST /api/chat/:recipientId/request/decline
// The receiver turns a request down. The sender can't write again, and the
// conversation disappears from the receiver's list.
export const declineMessageRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const userId = req.user!.id;

    if (!isValidObjectId(recipientId)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    const conversationId = getConversationId(userId, recipientId);
    const request = await MessageRequest.findOneAndUpdate(
      { conversationId, receiverId: userId, status: 'pending' },
      { $set: { status: 'declined', respondedAt: new Date() } },
      { new: true }
    );

    if (!request) {
      res.status(404).json({ error: 'No pending message request' });
      return;
    }

    await Message.updateMany(
      { conversationId, receiverId: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    res.json({ declined: true });
  } catch (error) {
    console.error('Decline message request error:', error);
    res.status(500).json({ error: 'Failed to decline message request' });
  }
};
