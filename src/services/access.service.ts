import { isMatched } from '../models/Like';
import { isBlockedEitherWay } from '../models/Block';
import { Message, getConversationId } from '../models/Message';
import { MessageRequest } from '../models/MessageRequest';
import { MESSAGE_REQUEST_LIMIT } from '../config/coins';
import { acceptMessageRequest } from './messageRequest.service';

/**
 * 'reply' means the user is answering a message request sent to them: sending
 * is allowed, and accepts the request first (see resolveSendAccess).
 */
export type ChatAccess = 'ok' | 'reply' | 'not_matched' | 'blocked' | 'request_limit' | 'request_declined';

/** Can these two users see each other's conversation at all? */
export const canViewConversation = async (userId: string, otherId: string): Promise<boolean> => {
  if (await isBlockedEitherWay(userId, otherId)) return false;
  if (await isMatched(userId, otherId)) return true;

  const request = await MessageRequest.findOne({
    conversationId: getConversationId(userId, otherId),
  }).lean();
  if (!request) return false;
  // A declined request disappears for the person who declined it.
  return !(request.status === 'declined' && request.receiverId.toString() === userId);
};

/**
 * Sending needs a match and no block (chats with matches are free), or a
 * pending message request: its sender may write up to MESSAGE_REQUEST_LIMIT
 * messages, and its receiver may reply.
 */
export const getChatAccess = async (userId: string, otherId: string): Promise<ChatAccess> => {
  if (await isBlockedEitherWay(userId, otherId)) return 'blocked';
  if (await isMatched(userId, otherId)) return 'ok';

  const conversationId = getConversationId(userId, otherId);
  const request = await MessageRequest.findOne({ conversationId }).lean();
  // Accepted but no longer matched means one of them unmatched since.
  if (!request || request.status === 'accepted') return 'not_matched';

  const isSender = request.senderId.toString() === userId;
  if (request.status === 'declined') return isSender ? 'request_declined' : 'not_matched';
  if (!isSender) return 'reply';

  const sent = await Message.countDocuments({ conversationId, senderId: userId });
  return sent < MESSAGE_REQUEST_LIMIT ? 'ok' : 'request_limit';
};

/** getChatAccess for an actual send: a reply to a request accepts it first. */
export const resolveSendAccess = async (userId: string, otherId: string): Promise<ChatAccess> => {
  const access = await getChatAccess(userId, otherId);
  if (access !== 'reply') return access;
  await acceptMessageRequest({ senderId: otherId, receiverId: userId });
  return 'ok';
};

export const CHAT_ACCESS_ERRORS: Record<Exclude<ChatAccess, 'ok' | 'reply'>, string> = {
  not_matched: 'You can only chat with your matches',
  blocked: 'This conversation is no longer available',
  request_limit: `You can send up to ${MESSAGE_REQUEST_LIMIT} messages until they reply`,
  request_declined: 'They declined your message request',
};
