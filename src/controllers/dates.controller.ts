import { Response } from 'express';
import { validationResult } from 'express-validator';
import mongoose, { Types } from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import { DatePost, DateRequest, DATE_POST_GRACE_MS } from '../models/DatePost';
import { Profile } from '../models/Profile';
import { User } from '../models/User';
import { Photo } from '../models/Photo';
import { Like } from '../models/Like';
import { getBlockedUserIds, isBlockedEitherWay } from '../models/Block';
import { toCard } from '../services/card.service';
import { notifyDateRequest, notifyDateAccepted } from '../services/push.service';
import { dateAllowance, hasPlus } from '../services/plus.service';
import { spendCoins, creditCoins, InsufficientCoinsError } from '../services/wallet.service';
import { COIN_COSTS } from '../config/coins';

const GRACE_MS = DATE_POST_GRACE_MS;

const validId = (id: string) => mongoose.Types.ObjectId.isValid(id);

/** Person cards for a set of user ids, keyed by id. Three queries in total. */
const loadCards = async (ids: Types.ObjectId[]) => {
  const [users, profiles, photos] = await Promise.all([
    User.find({ _id: { $in: ids }, isActive: true }).select(
      'fullName dateOfBirth gender lastActive'
    ),
    Profile.find({ userId: { $in: ids } }).select('userId bio segment showAge showDistance'),
    Photo.find({ userId: { $in: ids } }).sort({ order: 1 }),
  ]);

  const profileById = new Map(profiles.map((p) => [p.userId.toString(), p]));
  const photosById = new Map<string, typeof photos>();
  photos.forEach((photo) => {
    const key = photo.userId.toString();
    photosById.set(key, [...(photosById.get(key) ?? []), photo]);
  });

  return new Map(
    users.map((user) => {
      const key = String(user._id);
      return [
        key,
        toCard({ user, profile: profileById.get(key) ?? null, photos: photosById.get(key) ?? [] }),
      ];
    })
  );
};

const serializePost = (post: Record<string, any>) => ({
  id: String(post._id),
  activity: post.activity,
  place: post.place,
  scheduledFor: post.scheduledFor,
  description: post.description ?? null,
  createdAt: post.createdAt,
});

// GET /api/dates
export const browseDates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const [profile, blockedIds] = await Promise.all([
      Profile.findOne({ userId }).select('segment').lean(),
      getBlockedUserIds(userId),
    ]);

    const posts = await DatePost.find({
      segment: profile?.segment ?? 'relationship',
      status: 'active',
      scheduledFor: { $gte: new Date(Date.now() - GRACE_MS) },
      userId: { $nin: [userId, ...blockedIds].map((id) => new Types.ObjectId(id)) },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const [cards, myRequests] = await Promise.all([
      loadCards(posts.map((post) => post.userId)),
      DateRequest.find({ requesterId: userId, dateId: { $in: posts.map((p) => p._id) } }).lean(),
    ]);

    const statusByDate = new Map(myRequests.map((r) => [r.dateId.toString(), r.status]));

    const dates = posts
      .map((post) => ({
        ...serializePost(post),
        owner: cards.get(post.userId.toString()) ?? null,
        myRequestStatus: statusByDate.get(post._id.toString()) ?? null,
      }))
      .filter((date) => date.owner !== null);

    res.json({ dates });
  } catch (error) {
    console.error('Browse dates error:', error);
    res.status(500).json({ error: 'Failed to load dates' });
  }
};

// GET /api/dates/mine
export const myDates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const posts = await DatePost.find({ userId, status: 'active' })
      .sort({ scheduledFor: 1 })
      .lean();
    const requests = await DateRequest.find({ dateId: { $in: posts.map((p) => p._id) } })
      .sort({ createdAt: 1 })
      .lean();

    const cards = await loadCards(requests.map((r) => r.requesterId));

    const dates = posts.map((post) => ({
      ...serializePost(post),
      requests: requests
        .filter((r) => r.dateId.toString() === post._id.toString())
        .map((r) => ({
          id: String(r._id),
          status: r.status,
          createdAt: r.createdAt,
          requester: cards.get(r.requesterId.toString()) ?? null,
        }))
        .filter((r) => r.requester !== null),
    }));

    res.json({ dates });
  } catch (error) {
    console.error('My dates error:', error);
    res.status(500).json({ error: 'Failed to load your dates' });
  }
};

// POST /api/dates { activity, place, scheduledFor, description? }
// Free while the poster has a free active slot (1, or 3 with Plus); beyond
// that each post costs COIN_COSTS.datePost coins.
export const createDate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const userId = req.user!.id;
    const { activity, place, scheduledFor, description } = req.body;
    const when = new Date(scheduledFor);

    if (when.getTime() < Date.now() - 5 * 60 * 1000) {
      res.status(400).json({ error: 'Pick a time in the future' });
      return;
    }

    const [profile, allowance] = await Promise.all([
      Profile.findOne({ userId }).select('segment').lean(),
      hasPlus(userId).then((plus) => dateAllowance(userId, plus)),
    ]);

    const charged = allowance.left > 0 ? 0 : COIN_COSTS.datePost;
    const balance = charged
      ? await spendCoins({ userId, amount: charged, reason: 'date_post' })
      : ((await User.findById(userId).select('coins').lean())?.coins ?? 0);

    let post;
    try {
      post = await DatePost.create({
        userId,
        segment: profile?.segment ?? 'relationship',
        activity,
        place,
        scheduledFor: when,
        description: description || undefined,
      });
    } catch (error) {
      if (charged) await creditCoins({ userId, amount: charged, reason: 'refund', refId: 'date_post' });
      throw error;
    }

    res.status(201).json({ date: { ...serializePost(post.toObject()), requests: [] }, charged, balance });
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
    console.error('Create date error:', error);
    res.status(500).json({ error: 'Failed to post date' });
  }
};

// DELETE /api/dates/:dateId
export const deleteDate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await DatePost.updateOne(
      { _id: req.params.dateId, userId: req.user!.id, status: 'active' },
      { status: 'cancelled' }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: 'Date not found' });
      return;
    }

    res.json({ deleted: true });
  } catch (error) {
    console.error('Delete date error:', error);
    res.status(500).json({ error: 'Failed to delete date' });
  }
};

// POST /api/dates/:dateId/requests
export const requestToJoin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { dateId } = req.params;

    if (!validId(dateId)) {
      res.status(400).json({ error: 'Invalid date id' });
      return;
    }

    const post = await DatePost.findOne({ _id: dateId, status: 'active' }).lean();
    if (!post) {
      res.status(404).json({ error: 'This date is no longer available' });
      return;
    }

    const ownerId = post.userId.toString();
    if (ownerId === userId) {
      res.status(400).json({ error: 'You cannot request your own date' });
      return;
    }

    const profile = await Profile.findOne({ userId }).select('segment').lean();
    if ((profile?.segment ?? 'relationship') !== post.segment) {
      res.status(403).json({ error: 'This date is in a different segment' });
      return;
    }

    if (await isBlockedEitherWay(userId, ownerId)) {
      res.status(404).json({ error: 'This date is no longer available' });
      return;
    }

    const existing = await DateRequest.findOne({ dateId, requesterId: userId }).lean();
    if (existing) {
      res.json({ status: existing.status, alreadyRequested: true });
      return;
    }

    await DateRequest.create({ dateId, ownerId, requesterId: userId });
    void notifyDateRequest({ ownerId, requesterId: userId, activity: post.activity });

    res.status(201).json({ status: 'pending', alreadyRequested: false });
  } catch (error) {
    console.error('Request to join error:', error);
    res.status(500).json({ error: 'Failed to send interest' });
  }
};

// PATCH /api/dates/:dateId/requests/:requestId { status: 'accepted' | 'declined' }
export const respondToRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { dateId, requestId } = req.params;
    const { status } = req.body;

    if (status !== 'accepted' && status !== 'declined') {
      res.status(400).json({ error: 'Status must be accepted or declined' });
      return;
    }

    const request = await DateRequest.findOne({ _id: requestId, dateId, ownerId: userId });
    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    request.status = status;
    await request.save();

    const requesterId = request.requesterId.toString();

    if (status === 'accepted') {
      // Accepting makes them a match, which opens the chat, so "Chatting" works at once.
      await Promise.all([
        Like.updateOne(
          { userId, targetUserId: requesterId },
          { $setOnInsert: { userId, targetUserId: requesterId, source: 'date' } },
          { upsert: true }
        ),
        Like.updateOne(
          { userId: requesterId, targetUserId: userId },
          { $setOnInsert: { userId: requesterId, targetUserId: userId, source: 'date' } },
          { upsert: true }
        ),
      ]);

      const post = await DatePost.findById(dateId).select('activity').lean();
      void notifyDateAccepted({
        requesterId,
        ownerId: userId,
        activity: post?.activity ?? 'your date',
      });
    }

    res.json({ id: requestId, status });
  } catch (error) {
    console.error('Respond to request error:', error);
    res.status(500).json({ error: 'Failed to update request' });
  }
};
