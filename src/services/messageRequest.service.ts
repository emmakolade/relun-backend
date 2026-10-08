import { Like } from '../models/Like';
import { Message, getConversationId } from '../models/Message';
import { MessageRequest, MessageRequestStatus } from '../models/MessageRequest';
import { MESSAGE_REQUEST_LIMIT } from '../config/coins';
import { notifyNewMatch } from './push.service';

/** A message request as one side of it sees it. */
export type MessageRequestView = {
  status: MessageRequestStatus;
  /** True for the person who paid to send it. */
  outgoing: boolean;
  /** Messages the sender can still send before a reply; 0 for the receiver. */
  remaining: number;
};

const isDuplicateKey = (error: unknown) => (error as { code?: number }).code === 11000;

// A like made for the user by a request, so it doesn't use up their daily likes.
// Unique indexes make this safe to race: whoever loses just finds the row there.
export const ensureLike = (userId: string, targetUserId: string) =>
  Like.updateOne(
    { userId, targetUserId },
    { $setOnInsert: { userId, targetUserId, source: 'request' } },
    { upsert: true }
  ).catch((error) => {
    if (!isDuplicateKey(error)) throw error;
  });

/**
 * The receiver replied or liked back: the pair becomes a match, which opens
 * the chat, and the sender hears about it. Returns false if nothing was pending.
 */
export const acceptMessageRequest = async (params: {
  senderId: string;
  receiverId: string;
}): Promise<boolean> => {
  const { senderId, receiverId } = params;
  const conversationId = getConversationId(senderId, receiverId);

  const request = await MessageRequest.findOneAndUpdate(
    { conversationId, senderId, status: 'pending' },
    { $set: { status: 'accepted', respondedAt: new Date() } },
    { new: true }
  );
  if (!request) return false;

  await Promise.all([
    ensureLike(receiverId, senderId),
    // The sender may have unliked while waiting.
    ensureLike(senderId, receiverId),
  ]);

  void notifyNewMatch({ recipientId: senderId, matchedUserId: receiverId });
  return true;
};

/** Requests in these conversations, keyed by conversation id, from the viewer's side. */
export const messageRequestViews = async (
  viewerId: string,
  conversationIds: string[]
): Promise<Map<string, MessageRequestView>> => {
  const views = new Map<string, MessageRequestView>();
  if (conversationIds.length === 0) return views;

  const requests = await MessageRequest.find({
    conversationId: { $in: conversationIds },
    status: { $ne: 'accepted' },
  }).lean();

  await Promise.all(
    requests.map(async (request) => {
      const outgoing = request.senderId.toString() === viewerId;
      let remaining = 0;
      if (outgoing && request.status === 'pending') {
        const sent = await Message.countDocuments({
          conversationId: request.conversationId,
          senderId: viewerId,
        });
        remaining = Math.max(0, MESSAGE_REQUEST_LIMIT - sent);
      }
      views.set(request.conversationId, { status: request.status, outgoing, remaining });
    })
  );

  return views;
};

export const messageRequestView = async (
  viewerId: string,
  otherId: string
): Promise<MessageRequestView | null> => {
  const conversationId = getConversationId(viewerId, otherId);
  return (await messageRequestViews(viewerId, [conversationId])).get(conversationId) ?? null;
};
