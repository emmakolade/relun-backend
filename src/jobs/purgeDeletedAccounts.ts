import { Types } from 'mongoose';
import { Block } from '../models/Block';
import { DatePost, DateRequest } from '../models/DatePost';
import { Like } from '../models/Like';
import { Message } from '../models/Message';
import { MessageRequest } from '../models/MessageRequest';
import { Notification } from '../models/Notification';
import { Pass } from '../models/Pass';
import { Photo } from '../models/Photo';
import { Plus } from '../models/Plus';
import { Profile } from '../models/Profile';
import { ProfileView } from '../models/ProfileView';
import { PushToken } from '../models/PushToken';
import { RefreshToken } from '../models/RefreshToken';
import { User } from '../models/User';
import { deleteImage } from '../services/cloudinary.service';

/**
 * Permanently erases accounts deleted more than 30 days ago, as the privacy
 * policy promises. DELETE /api/auth/account hides the profile and removes
 * photos at once; this removes everything else, including the person's
 * messages on both sides of every chat.
 *
 * Kept on purpose: CoinTransaction and PlusPayment (financial records the law
 * requires us to keep) and Report (so abuse reports survive a deleted account).
 */

export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 50;

const purgeUser = async (userId: Types.ObjectId) => {
  // Photos are normally gone already; catch any that were missed.
  const photos = await Photo.find({ userId }).select('publicId').lean();
  await Promise.all(
    photos
      .filter((photo) => photo.publicId)
      .map((photo) => deleteImage(photo.publicId!).catch((error) => console.error('Purge photo error:', error)))
  );

  const posts = await DatePost.find({ userId }).select('_id').lean();
  const postIds = posts.map((post) => post._id);

  await Promise.all([
    Profile.deleteOne({ userId }),
    Photo.deleteMany({ userId }),
    Message.deleteMany({ $or: [{ senderId: userId }, { receiverId: userId }] }),
    MessageRequest.deleteMany({ $or: [{ senderId: userId }, { receiverId: userId }] }),
    Like.deleteMany({ $or: [{ userId }, { targetUserId: userId }] }),
    Pass.deleteMany({ $or: [{ userId }, { targetUserId: userId }] }),
    ProfileView.deleteMany({ $or: [{ viewerId: userId }, { viewedId: userId }] }),
    Block.deleteMany({ $or: [{ blockerId: userId }, { blockedId: userId }] }),
    Notification.deleteMany({ $or: [{ userId }, { actorId: userId }] }),
    DateRequest.deleteMany({ $or: [{ requesterId: userId }, { ownerId: userId }, { dateId: { $in: postIds } }] }),
    DatePost.deleteMany({ userId }),
    Plus.deleteOne({ userId }),
    PushToken.deleteMany({ userId }),
    RefreshToken.deleteMany({ userId }),
  ]);

  // Last, so a failure part-way leaves the user to be picked up on the next run.
  await User.deleteOne({ _id: userId });
};

/** One pass over every account past the retention window. Returns how many were erased. */
export const purgeDeletedAccounts = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
  let purged = 0;

  for (;;) {
    const users = await User.find({ isActive: false, deletedAt: { $lte: cutoff } })
      .select('_id')
      .limit(BATCH)
      .lean();
    if (users.length === 0) break;

    for (const user of users) {
      try {
        await purgeUser(user._id as Types.ObjectId);
        purged += 1;
      } catch (error) {
        console.error(`Purge account ${user._id} error:`, error);
        // Stop this run rather than looping on an account that keeps failing.
        return purged;
      }
    }
  }

  return purged;
};

/** Runs the purge shortly after start-up and then once a day. */
export const schedulePurgeDeletedAccounts = () => {
  const run = () =>
    purgeDeletedAccounts()
      .then((count) => count > 0 && console.log(`Purged ${count} deleted account(s)`))
      .catch((error) => console.error('Purge deleted accounts error:', error));

  setTimeout(run, 60 * 1000).unref();
  setInterval(run, DAY_MS).unref();
};
