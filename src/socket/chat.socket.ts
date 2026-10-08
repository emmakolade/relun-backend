import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/jwt.utils';
import {
  Message,
  getConversationId,
  MAX_MESSAGE_LENGTH,
  MESSAGE_TYPES,
  MessageType,
} from '../models/Message';
import { getMatchedUserIds } from '../models/Like';
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
import { notifyNewMessage } from '../services/push.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

const isValidObjectId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);

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
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = verifyToken(token);
      socket.userId = decoded.userId;
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

    // Update user's online status
    User.findByIdAndUpdate(userId, { lastActive: new Date() }).catch(console.error);

    // Join user's room
    socket.join(`user:${userId}`);

    if (addConnection(userId)) {
      void broadcastPresence(io, userId, true);
    }

    // Join conversation room
    socket.on('join_conversation', async (recipientId: string) => {
      try {
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
        // presence_changed on the user's own room.
        const presenceEvent: SocketPresenceEvent = {
          userId: recipientId,
          isOnline: isUserOnline(recipientId),
        };
        socket.emit('presence_changed', presenceEvent);

        console.log(`User ${userId} joined conversation ${conversationId}`);
      } catch (error) {
        console.error('Join conversation error:', error);
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    // Leave conversation room
    socket.on('leave_conversation', (recipientId: string) => {
      if (!isValidObjectId(recipientId)) return;
      const conversationId = getConversationId(userId, recipientId);
      socket.leave(`conversation:${conversationId}`);
      console.log(`User ${userId} left conversation ${conversationId}`);
    });

    // Send message
    socket.on('send_message', async (data: SocketSendMessageData) => {
      try {
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
            clientId: data?.clientId,
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

        const newMessageEvent: SocketNewMessageEvent = {
          conversationId,
          message: message.toJSON() as any,
          clientId: typeof data?.clientId === 'string' ? data.clientId.slice(0, 64) : undefined,
        };

        // Emit to conversation room
        io.to(`conversation:${conversationId}`).emit('new_message', newMessageEvent);

        // Emit to receiver's room for notification
        io.to(`user:${recipientId}`).emit('message_notification', newMessageEvent);

        // Only push when they have no live connection: someone with the app
        // open already got the event above, and a push would just duplicate it.
        if (!isUserOnline(recipientId)) {
          void notifyNewMessage({ recipientId, senderId: userId, content });
        }
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', (data: SocketTypingData) => {
      const { recipientId, isTyping } = data ?? {};
      if (!isValidObjectId(recipientId)) return;

      // No match check: only members of the room receive this, and join_conversation
      // already gates membership.
      const conversationId = getConversationId(userId, recipientId);
      const typingEvent: SocketUserTypingEvent = { userId, isTyping: !!isTyping };
      socket.to(`conversation:${conversationId}`).emit('user_typing', typingEvent);
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

        // Notify sender
        const readEvent: SocketMessagesReadEvent = { conversationId, readBy: userId };
        socket.to(`conversation:${conversationId}`).emit('messages_read', readEvent);
      } catch (error) {
        console.error('Mark read error:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('User disconnected:', userId);
      User.findByIdAndUpdate(userId, { lastActive: new Date() }).catch(console.error);

      if (removeConnection(userId)) {
        void broadcastPresence(io, userId, false);
      }
    });
  });
};
