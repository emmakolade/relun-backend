import { PushToken } from '../models/PushToken';
import { User } from '../models/User';
import { Message } from '../models/Message';
import { Profile } from '../models/Profile';
import { getFirebaseMessaging } from './firebase.service';
import { addNotification } from './inbox.service';
import { sendEmail } from './email.service';
import { socialEmail } from './emailTemplates';
import { NotificationDelivery } from '../models/NotificationDelivery';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Expo accepts at most 100 messages per request.
const EXPO_BATCH_SIZE = 100;
// FCM multicast accepts at most 500 tokens per call.
const FCM_BATCH_SIZE = 500;
const PREVIEW_LENGTH = 120;

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
};

const emailSocialEvent = async (params: {
  userId: string;
  subject: string;
  heading: string;
  body: string;
  eventKey?: string;
} ): Promise<void> => {
  let reservedKey = false;
  try {
    const [user, profile] = await Promise.all([
      User.findById(params.userId).select('email isEmailVerified fullName isActive').lean(),
      Profile.findOne({ userId: params.userId }).select('emailNotificationsEnabled').lean(),
    ]);
    if (!user?.isActive || !user.email || !user.isEmailVerified || profile?.emailNotificationsEnabled === false) return;
    if (params.eventKey) {
      try {
        await NotificationDelivery.create({ key: params.eventKey, userId: params.userId });
        reservedKey = true;
      } catch (error) {
        if ((error as { code?: number }).code === 11000) return;
        throw error;
      }
    }
    const name = user.fullName?.trim().split(' ')[0] || 'there';
    const email = socialEmail({ subject: params.subject, heading: params.heading, body: params.body, name, recipient: user.email });
    await sendEmail({ to: user.email, ...email });
  } catch (error) {
    if (reservedKey && params.eventKey) {
      await NotificationDelivery.deleteOne({ key: params.eventKey }).catch(() => {});
    }
    console.error('Social notification email error:', error);
  }
};

type ExpoTicket = {
  status?: 'ok' | 'error';
  details?: { error?: string };
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }

  return batches;
};

const deliver = async (tokens: string[], payload: PushPayload): Promise<void> => {
  const messages = tokens.map((to) => ({
    to,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data,
    badge: payload.badge,
  }));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Only needed if the Expo project has push security enabled.
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    console.error('Expo push rejected the request:', response.status);
    return;
  }

  const result = (await response.json()) as { data?: ExpoTicket[] };
  const tickets = result.data || [];

  // Tickets come back aligned with the messages we sent. Uninstalled apps
  // report DeviceNotRegistered; drop those or they accumulate forever.
  const deadTokens = tickets
    .map((ticket, index) =>
      ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
        ? tokens[index]
        : null
    )
    .filter((token): token is string => !!token);

  if (deadTokens.length > 0) {
    await PushToken.deleteMany({ token: { $in: deadTokens } });
  }
};

// FCM data values must be strings.
const stringifyData = (data?: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(data ?? {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])
  );

const deliverFcm = async (tokens: string[], payload: PushPayload): Promise<void> => {
  const messaging = getFirebaseMessaging();

  if (!messaging) {
    console.warn('[push] FCM tokens registered but Firebase is not configured');
    return;
  }

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: stringifyData(payload.data),
    android: {
      priority: 'high',
      notification: {
        channelId: 'messages',
        sound: 'default',
        notificationCount: payload.badge,
      },
    },
    // Browsers: the web app's service worker shows it (see relun-web/public/sw.js).
    webpush: { headers: { Urgency: 'high' } },
  });

  // Same idea as Expo's DeviceNotRegistered: drop tokens of uninstalled apps.
  const deadTokens = response.responses
    .map((result, index) => {
      const code = result.error?.code;
      return code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
        ? tokens[index]
        : null;
    })
    .filter((token): token is string => !!token);

  if (deadTokens.length > 0) {
    await PushToken.deleteMany({ token: { $in: deadTokens } });
  }
};

/**
 * Fire-and-forget. A push that fails is not worth retrying: the message is
 * already in MongoDB and the user sees it on next open, and a stale
 * notification has close to zero value. This never throws, so callers can
 * `void` it without risking the request they are serving.
 */
export const sendPushToUser = async (userId: string, payload: PushPayload): Promise<void> => {
  try {
    const profile = await Profile.findOne({ userId }).select('notificationsEnabled').lean();

    if (profile?.notificationsEnabled === false) {
      return;
    }

    const tokens = await PushToken.find({ userId }).select('token provider').lean();

    if (tokens.length === 0) {
      return;
    }

    const expoTokens = tokens.filter((entry) => entry.provider !== 'fcm').map((e) => e.token);
    const fcmTokens = tokens.filter((entry) => entry.provider === 'fcm').map((e) => e.token);

    for (const batch of chunk(expoTokens, EXPO_BATCH_SIZE)) {
      await deliver(batch, payload);
    }

    for (const batch of chunk(fcmTokens, FCM_BATCH_SIZE)) {
      await deliverFcm(batch, payload);
    }
  } catch (error) {
    console.error('Send push error:', error);
  }
};

const preview = (content: string): string =>
  content.length > PREVIEW_LENGTH ? `${content.slice(0, PREVIEW_LENGTH - 1)}…` : content;

export const notifyNewMessage = async (params: {
  recipientId: string;
  senderId: string;
  content: string;
  firstMessage?: boolean;
}): Promise<void> => {
  try {
    const [sender, unreadCount] = await Promise.all([
      User.findById(params.senderId).select('fullName').lean(),
      Message.countDocuments({ receiverId: params.recipientId, isRead: false }),
    ]);

    await sendPushToUser(params.recipientId, {
      title: sender?.fullName || 'New message',
      body: preview(params.content),
      badge: unreadCount,
      // The app reads this to open the right conversation on tap.
      data: { type: 'message', userId: params.senderId },
    });
    if (params.firstMessage) void notifyFirstMessageEmail({ recipientId: params.recipientId, senderId: params.senderId });
  } catch (error) {
    console.error('Notify new message error:', error);
  }
};

export const notifyMessageRequest = async (params: {
  recipientId: string;
  senderId: string;
  content: string;
}): Promise<void> => {
  try {
    const sender = await User.findById(params.senderId).select('fullName').lean();
    const name = sender?.fullName?.split(' ')[0] || 'Someone';

    await addNotification({
      userId: params.recipientId,
      type: 'message_request',
      actorId: params.senderId,
      title: 'New message request',
      body: `${name} sent you a message. Reply to match, or decline.`,
      data: { userId: params.senderId },
    });
    void emailSocialEvent({ userId: params.recipientId, subject: 'You have a new message request on Relun', heading: 'A new message request', body: `${name} sent you a message request. Open Relun to review it.` });
    await sendPushToUser(params.recipientId, {
      title: 'New message request',
      body: `${name}: ${preview(params.content)}`,
      // Opens the conversation, where they can reply or decline.
      data: { type: 'message_request', userId: params.senderId },
    });
  } catch (error) {
    console.error('Notify message request error:', error);
  }
};

export const notifyNewMatch = async (params: {
  recipientId: string;
  matchedUserId: string;
}): Promise<void> => {
  try {
    const matchedUser = await User.findById(params.matchedUserId).select('fullName').lean();

    await addNotification({
      userId: params.recipientId,
      type: 'match',
      actorId: params.matchedUserId,
      title: "It's a match!",
      body: `You and ${matchedUser?.fullName?.split(' ')[0] || 'someone'} liked each other. Say hello!`,
      data: { userId: params.matchedUserId },
    });
    void emailSocialEvent({ userId: params.recipientId, subject: "It's a match on Relun", heading: "It's a match!", body: `You and ${matchedUser?.fullName?.split(' ')[0] || 'someone'} liked each other. Open Relun and say hello.` });
    await sendPushToUser(params.recipientId, {
      title: "It's a match!",
      body: `You and ${matchedUser?.fullName || 'someone'} liked each other.`,
      data: { type: 'match', userId: params.matchedUserId },
    });
  } catch (error) {
    console.error('Notify new match error:', error);
  }
};

export const notifyDateRequest = async (params: {
  ownerId: string;
  requesterId: string;
  activity: string;
}): Promise<void> => {
  // Callers `void` this, so it must never reject (an unhandled rejection
  // takes the process down).
  try {
    const requester = await User.findById(params.requesterId).select('fullName').lean();
    const body = `${requester?.fullName?.split(' ')[0] || 'Someone'} wants to join "${params.activity}".`;

    await addNotification({
      userId: params.ownerId,
      type: 'date_request',
      actorId: params.requesterId,
      title: 'New date request',
      body,
      data: { userId: params.requesterId },
    });
    void emailSocialEvent({ userId: params.ownerId, subject: 'Someone wants to join your date on Relun', heading: 'New date request', body });
    await sendPushToUser(params.ownerId, {
      title: 'New date request',
      body,
      data: { type: 'date_request', userId: params.requesterId },
    });
  } catch (error) {
    console.error('Notify date request error:', error);
  }
};

export const notifyDateAccepted = async (params: {
  requesterId: string;
  ownerId: string;
  activity: string;
}): Promise<void> => {
  try {
    const owner = await User.findById(params.ownerId).select('fullName').lean();
    const body = `${owner?.fullName?.split(' ')[0] || 'They'} accepted you for "${params.activity}". Say hello!`;

    await addNotification({
      userId: params.requesterId,
      type: 'date_accepted',
      actorId: params.ownerId,
      title: 'Date accepted',
      body,
      data: { userId: params.ownerId },
    });
    void emailSocialEvent({ userId: params.requesterId, subject: 'Your date request was accepted on Relun', heading: 'Date request accepted', body });
    await sendPushToUser(params.requesterId, {
      title: 'Date accepted',
      body,
      data: { type: 'match', userId: params.ownerId },
    });
  } catch (error) {
    console.error('Notify date accepted error:', error);
  }
};

/**
 * A new one-sided like. Who it was stays hidden without Likes & Views (the
 * list endpoint decides), so the push never names them either.
 */
export const notifyLiked = async (params: { recipientId: string; likerId: string }): Promise<void> => {
  try {
    await addNotification({
      userId: params.recipientId,
      type: 'like',
      actorId: params.likerId,
      title: 'Someone likes you',
      body: 'See who it is, and match instantly.',
      data: { userId: params.likerId },
    });
    void emailSocialEvent({ userId: params.recipientId, subject: 'Someone likes you on Relun', heading: 'Someone likes you', body: 'Someone nearby likes your profile. Open Relun to see who it is and decide what to do.' });
    await sendPushToUser(params.recipientId, {
      title: 'Someone likes you 👀',
      body: 'Open Relun to see who it is.',
      data: { type: 'like' },
    });
  } catch (error) {
    console.error('Notify liked error:', error);
  }
};

/** Email only once per sender/recipient conversation, regardless of transport or online status. */
export const notifyFirstMessageEmail = async (params: { recipientId: string; senderId: string }): Promise<void> => {
  try {
    const sender = await User.findById(params.senderId).select('fullName').lean();
    const name = sender?.fullName?.trim().split(' ')[0] || 'Someone';
    await emailSocialEvent({
      userId: params.recipientId,
      subject: 'You have a new message on Relun',
      heading: 'A new message',
      body: `${name} sent you a message. Open Relun to read and reply.`,
      eventKey: `first_message:${params.senderId}:${params.recipientId}`,
    });
  } catch (error) {
    console.error('First message email error:', error);
  }
};

/** A profile view: in the app only, no push. At most one per viewer a day (the caller checks). */
export const notifyViewed = async (params: { viewedId: string; viewerId: string }): Promise<void> =>
  addNotification({
    userId: params.viewedId,
    type: 'view',
    actorId: params.viewerId,
    title: 'Someone viewed your profile',
    body: 'See who’s been looking.',
    data: { userId: params.viewerId },
  });

/** Plus started, or renewed. In the app only; the purchase itself already confirmed it. */
export const notifyPlus = async (params: { userId: string; renewed: boolean; until: Date }): Promise<void> =>
  addNotification({
    userId: params.userId,
    type: 'plus',
    title: params.renewed ? 'Relun Plus renewed' : 'Welcome to Relun Plus',
    body: params.renewed
      ? 'Your Plus is active for another period. Enjoy unlimited likes.'
      : 'Unlimited likes, see who likes you, and free message requests are on.',
  });

/** Coins bought and credited. In the app only. */
export const notifyCoinsAdded = async (params: { userId: string; coins: number }): Promise<void> =>
  addNotification({
    userId: params.userId,
    type: 'coins',
    title: 'Coins added',
    body: `${params.coins.toLocaleString()} coins are in your balance.`,
  });
