import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/jwt.utils';
import {
  Message,
  getConversationId,
  MAX_MESSAGE_LENGTH,
  MESSAGE_TYPES,
  MessageType,
} from '../models/Message';
import { getMatchedUserIds, isMatched } from '../models/Like';
import { canViewConversation, resolveSendAccess, CHAT_ACCESS_ERRORS } from '../services/access.service';
import { User } from '../models/User';
import {
  SocketSendMessageData,
  SocketTypingData,
  SocketMarkReadData,
  SocketNewMessageEvent,
  SocketUserTypingEvent,
  SocketMessagesReadEvent,
  SocketPresenceEvent,
} from '../types';
import { addConnection, removeConnection, isUserOnline } from './presence';
import { touchActivity } from '../services/activity.service';
import { notifyNewMessage, notifyFirstMessageEmail } from '../services/push.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

const isValidObjectId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);

const safeClientId = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.slice(0, 64) : undefined;

// Per-socket flood control: at most `max` events in a sliding `windowMs`.
const createRateLimiter = (max: number, windowMs: number) => {
  const hits: number[] = [];
  return (): boolean => {
    const now = Date.now();
    while (hits.length > 0 && now - hits[0] > windowMs) hits.shift();
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
};

// setTimeout overflows above ~24.8 days.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// Presence is only shared with people the user has matched with, so it is
// pushed into each match's personal room rather than broadcast to everyone.
const broadcastPresence = async (io: Server, userId: string, isOnline: boolean) => {
  try {
    const matchedUserIds = await getMatchedUserIds(userId);
    const event: SocketPresenceEvent = { userId, isOnline };

    matchedUserIds.forEach((matchedUserId) => {
      io.to(`user:${matchedUserId}`).emit('presence_changed', event);
    });
  } catch (error) {
    console.error('Broadcast presence error:', error);
  }
};

export const initializeSocketIO = (io: Server) => {
  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const raw =
        socket.handshake.auth?.token ||
        socket.handshake.headers.authorization?.replace('Bearer ', '');
      const token = typeof raw === 'string' ? raw : '';

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = verifyToken(token) as { userId?: unknown; exp?: number };
      if (!isValidObjectId(decoded.userId)) {
        return next(new Error('Invalid token'));
      }

      // Same checks as the REST authenticate middleware: deleted or
      // deactivated accounts can't open a socket with an old token.
      const user = await User.findById(decoded.userId).select('isActive').lean();
      if (!user || !user.isActive) {
        return next(new Error('Invalid token'));
      }

      socket.userId = decoded.userId;
      (socket.data as { tokenExp?: number }).tokenExp = decoded.exp;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.userId;

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    console.log('[User connected]====>>', userId);

    // A socket outliving its token would keep the session alive forever.
    const tokenExp = (socket.data as { tokenExp?: number }).tokenExp;
    const expiryTimer =
      typeof tokenExp === 'number'
        ? setTimeout(
            () => socket.disconnect(true),
            Math.min(Math.max(tokenExp * 1000 - Date.now(), 0), MAX_TIMEOUT_MS)
          )
        : null;

    const allowSend = createRateLimiter(20, 10_000);
    const allowTyping = createRateLimiter(30, 10_000);
    const allowJoin = createRateLimiter(30, 10_000);

    // Update user's online status
    touchActivity(userId);

    // Join user's room
    socket.join(`user:${userId}`);

    if (addConnection(userId)) {
      void broadcastPresence(io, userId, true);
    }

    // Join conversation room
    socket.on('join_conversation', async (recipientId: string) => {
      try {
        if (!allowJoin()) return;
        if (!isValidObjectId(recipientId)) {
          socket.emit('error', { message: 'Invalid recipient' });
          return;
        }

        // Gate the room itself, not just sends: room members receive typing
        // and read-receipt events for the conversation.
        if (!(await canViewConversation(userId, recipientId))) {
          socket.emit('error', { message: 'You can only chat with your matches' });
          return;
        }

        const conversationId = getConversationId(userId, recipientId);
        socket.join(`conversation:${conversationId}`);

        // Seed the opener with the current state; later changes arrive as
        // presence_changed on the user's own room. Presence is for matches
        // only, so a message request doesn't reveal whether they're online.
        if (await isMatched(userId, recipientId)) {
          const presenceEvent: SocketPresenceEvent = {
            userId: recipientId,
            isOnline: isUserOnline(recipientId),
          };
          socket.emit('presence_changed', presenceEvent);
        }

        console.log(`User ${userId} joined conversation ${conversationId}`);
      } catch (error) {
        console.error('Join conversation error:', error);
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    // Leave conversation room
    socket.on('leave_conversation', (recipientId: string) => {
      try {
        if (!isValidObjectId(recipientId)) return;
        const conversationId = getConversationId(userId, recipientId);
        socket.leave(`conversation:${conversationId}`);
        console.log(`User ${userId} left conversation ${conversationId}`);
      } catch (error) {
        console.error('Leave conversation error:', error);
      }
    });

    // Send message
    socket.on('send_message', async (data: SocketSendMessageData) => {
      try {
        if (!allowSend()) {
          socket.emit('error', {
            message: 'You are sending messages too fast',
            code: 'RATE_LIMITED',
            clientId: safeClientId(data?.clientId),
          });
          return;
        }

        const { recipientId, messageType = 'text' } = data ?? {};
        const content = typeof data?.content === 'string' ? data.content.trim() : '';

        if (!isValidObjectId(recipientId)) {
          socket.emit('error', { message: 'Invalid recipient' });
          return;
        }

        if (!content) {
          socket.emit('error', { message: 'Message content is required' });
          return;
        }

        if (content.length > MAX_MESSAGE_LENGTH) {
          socket.emit('error', {
            message: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
          });
          return;
        }

        if (!MESSAGE_TYPES.includes(messageType as MessageType)) {
          socket.emit('error', { message: 'Invalid message type' });
          return;
        }

        // A match or message request implies both users exist; blocks, unpaid
        // chats and spent requests are refused. Replying to a request accepts it.
        const access = await resolveSendAccess(userId, recipientId);
        if (access !== 'ok' && access !== 'reply') {
          socket.emit('error', {
            message: CHAT_ACCESS_ERRORS[access],
            code: access.toUpperCase(),
            clientId: safeClientId(data?.clientId),
          });
          return;
        }

        const conversationId = getConversationId(userId, recipientId);

        const message = await Message.create({
          conversationId,
          senderId: userId,
          receiverId: recipientId,
          content,
          messageType,
        });
        const firstMessage = (await Message.countDocuments({ conversationId, receiverId: recipientId })) === 1;

        const newMessageEvent: SocketNewMessageEvent = {
          conversationId,
          message: message.toJSON() as any,
          clientId: safeClientId(data?.clientId),
        };

        // Emit to conversation room
        io.to(`conversation:${conversationId}`).emit('new_message', newMessageEvent);

        // Emit to receiver's room for notification
        io.to(`user:${recipientId}`).emit('message_notification', newMessageEvent);

        // Only push when they have no live connection: someone with the app
        // open already got the event above, and a push would just duplicate it.
        if (!isUserOnline(recipientId)) {
          void notifyNewMessage({ recipientId, senderId: userId, content, firstMessage });
        } else if (firstMessage) {
          void notifyFirstMessageEmail({ recipientId, senderId: userId });
        }
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', (data: SocketTypingData) => {
      try {
        if (!allowTyping()) return;
        const { recipientId, isTyping } = data ?? {};
        if (!isValidObjectId(recipientId)) return;

        // No match check per keystroke: the sender must have joined the room,
        // and join_conversation gates membership.
        const conversationId = getConversationId(userId, recipientId);
        const room = `conversation:${conversationId}`;
        if (!socket.rooms.has(room)) return;
        const typingEvent: SocketUserTypingEvent = { userId, isTyping: !!isTyping };
        socket.to(room).emit('user_typing', typingEvent);
      } catch (error) {
        console.error('Typing error:', error);
      }
    });

    // Mark messages as read
    socket.on('mark_read', async (data: SocketMarkReadData) => {
      try {
        const { recipientId } = data ?? {};
        if (!isValidObjectId(recipientId)) return;

        const conversationId = getConversationId(userId, recipientId);

        // Scoped to messages addressed to this user, so it can only ever
        // mark their own messages read.
        await Message.updateMany(
          { conversationId, receiverId: userId, isRead: false },
          { $set: { isRead: true, readAt: new Date() } }
        );

        // Notify sender, but only through a room this socket was let into.
        const room = `conversation:${conversationId}`;
        if (!socket.rooms.has(room)) return;
        const readEvent: SocketMessagesReadEvent = { conversationId, readBy: userId };
        socket.to(room).emit('messages_read', readEvent);
      } catch (error) {
        console.error('Mark read error:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      console.log('User disconnected:', userId);
      User.findByIdAndUpdate(userId, { lastActive: new Date() }).catch(console.error);

      if (removeConnection(userId)) {
        void broadcastPresence(io, userId, false);
      }
    });
  });
};
