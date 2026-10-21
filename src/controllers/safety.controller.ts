import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import { Block } from '../models/Block';
import { Report, REPORT_REASONS } from '../models/Report';
import { User } from '../models/User';
import { Photo } from '../models/Photo';

const validId = (id: string) => mongoose.Types.ObjectId.isValid(id);

// POST /api/safety/blocks/:userId
export const blockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const blockerId = req.user!.id;
    const { userId } = req.params;

    if (!validId(userId) || userId === blockerId) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    await Block.updateOne(
      { blockerId, blockedId: userId },
      { $setOnInsert: { blockerId, blockedId: userId } },
      { upsert: true }
    );

    res.status(201).json({ blocked: true, userId });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
};

// DELETE /api/safety/blocks/:userId
export const unblockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!validId(req.params.userId)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    await Block.deleteOne({ blockerId: req.user!.id, blockedId: req.params.userId });
    res.json({ blocked: false, userId: req.params.userId });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
};

// GET /api/safety/blocks
export const listBlocks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const blocks = await Block.find({ blockerId: req.user!.id }).sort({ createdAt: -1 }).lean();
    const ids = blocks.map((block) => block.blockedId);

    const [users, photos] = await Promise.all([
      User.find({ _id: { $in: ids } })
        .select('fullName')
        .lean(),
      Photo.find({ userId: { $in: ids }, order: 0 })
        .select('userId url')
        .lean(),
    ]);

    const userById = new Map(users.map((user) => [user._id.toString(), user]));
    const photoById = new Map(photos.map((photo) => [photo.userId.toString(), photo.url]));

    res.json({
      blocks: blocks.map((block) => {
        const id = block.blockedId.toString();
        return {
          userId: id,
          fullName: userById.get(id)?.fullName ?? 'Relun user',
          photoUrl: photoById.get(id) ?? null,
          blockedAt: block.createdAt,
        };
      }),
    });
  } catch (error) {
    console.error('List blocks error:', error);
    res.status(500).json({ error: 'Failed to load blocked users' });
  }
};

// POST /api/safety/reports/:userId { reason, details? }
export const reportUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reporterId = req.user!.id;
    const { userId } = req.params;
    const { reason = 'other', details } = req.body ?? {};

    if (!validId(userId) || userId === reporterId) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    if (!REPORT_REASONS.includes(reason)) {
      res.status(400).json({ error: 'Invalid reason' });
      return;
    }

    // One open report per pair is enough; repeats would only pile up junk for moderators.
    if (await Report.exists({ reporterId, reportedId: userId, status: 'open' })) {
      res.status(201).json({ reported: true });
      return;
    }

    await Report.create({
      reporterId,
      reportedId: userId,
      reason,
      details: typeof details === 'string' ? details.slice(0, 1000) : undefined,
    });

    res.status(201).json({ reported: true });
  } catch (error) {
    console.error('Report user error:', error);
    res.status(500).json({ error: 'Failed to send report' });
  }
};
