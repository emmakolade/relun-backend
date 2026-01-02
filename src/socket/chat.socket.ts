import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/jwt.utils';
import { Match } from '../models/Match';
import { Message } from '../models/Message';
import { User } from '../models/User';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

export const initializeSocketIO = (io: Server) => {
  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

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
    console.log('User connected:', socket.userId);

    // Update user's online status
    if (socket.userId) {
      User.findByIdAndUpdate(socket.userId, { lastActive: new Date() }).catch(console.error);
    }

    // Join user's room
    socket.join(`user:${socket.userId}`);

    // Join match room
    socket.on('join_match', async (matchId: string) => {
      try {
        const match = await Match.findOne({
          _id: matchId,
          $or: [
            { user1Id: socket.userId },
            { user2Id: socket.userId },
          ],
        });

        if (match) {
          socket.join(`match:${matchId}`);
          console.log(`User ${socket.userId} joined match ${matchId}`);
        }
      } catch (error) {
        console.error('Join match error:', error);
      }
    });

    // Leave match room
    socket.on('leave_match', (matchId: string) => {
      socket.leave(`match:${matchId}`);
      console.log(`User ${socket.userId} left match ${matchId}`);
    });

    // Send message
    socket.on('send_message', async (data: {
      matchId: string;
      content: string;
      messageType?: string;
    }) => {
      try {
        const { matchId, content, messageType = 'text' } = data;

        // Verify user is part of the match
        const match = await Match.findOne({
          _id: matchId,
          $or: [
            { user1Id: socket.userId },
            { user2Id: socket.userId },
          ],
        });

        if (!match) {
          socket.emit('error', { message: 'Match not found' });
          return;
        }

        const receiverId = match.user1Id.toString() === socket.userId
          ? match.user2Id
          : match.user1Id;

        // Create message
        const message = await Message.create({
          matchId,
          senderId: socket.userId,
          receiverId,
          content,
          messageType,
        });

        // Update match's last message timestamp
        match.lastMessageAt = new Date();
        await match.save();

        const populatedMessage = await Message.findById(message._id)
          .populate('senderId', 'fullName')
          .populate('receiverId', 'fullName');

        // Emit to match room
        io.to(`match:${matchId}`).emit('new_message', populatedMessage);

        // Emit to receiver's room for notification
        io.to(`user:${receiverId}`).emit('message_notification', {
          matchId,
          message: populatedMessage,
        });
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', async (data: { matchId: string; isTyping: boolean }) => {
      try {
        const { matchId, isTyping } = data;

        // Verify user is part of the match
        const match = await Match.findOne({
          _id: matchId,
          $or: [
            { user1Id: socket.userId },
            { user2Id: socket.userId },
          ],
        });

        if (match) {
          socket.to(`match:${matchId}`).emit('user_typing', {
            userId: socket.userId,
            isTyping,
          });
        }
      } catch (error) {
        console.error('Typing error:', error);
      }
    });

    // Mark messages as read
    socket.on('mark_read', async (data: { matchId: string }) => {
      try {
        const { matchId } = data;

        await Message.updateMany(
          { matchId, receiverId: socket.userId, isRead: false },
          { $set: { isRead: true, readAt: new Date() } }
        );

        // Notify sender
        socket.to(`match:${matchId}`).emit('messages_read', {
          matchId,
          readBy: socket.userId,
        });
      } catch (error) {
        console.error('Mark read error:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log('User disconnected:', socket.userId);
      
      // Update last active
      if (socket.userId) {
        await User.findByIdAndUpdate(socket.userId, { lastActive: new Date() }).catch(console.error);
      }
    });
  });
};
