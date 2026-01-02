import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Match } from '../models/Match';
import { Message } from '../models/Message';
import { Profile } from '../models/Profile';
import { Photo } from '../models/Photo';

export const getMatches = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user!.id;

    const matches = await Match.find({
      $or: [{ user1Id: userId }, { user2Id: userId }],
    })
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('user1Id', 'fullName dateOfBirth gender lastActive')
      .populate('user2Id', 'fullName dateOfBirth gender lastActive');

    const total = await Match.countDocuments({
      $or: [{ user1Id: userId }, { user2Id: userId }],
    });

    // Get last message for each match
    const matchesWithLastMessage = await Promise.all(
      matches.map(async (match) => {
        const lastMessage = await Message.findOne({ matchId: match._id })
          .sort({ createdAt: -1 })
          .limit(1);

        const otherUserId = match.user1Id._id.toString() === userId ? match.user2Id._id : match.user1Id._id;
        const profile = await Profile.findOne({ userId: otherUserId });
        const photos = await Photo.find({ userId: otherUserId }).sort({ order: 1 }).limit(1);

        return {
          ...match.toObject(),
          lastMessage,
          profile,
          photo: photos[0] || null,
        };
      })
    );

    res.json({
      matches: matchesWithLastMessage,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get matches error:', error);
    res.status(500).json({ error: 'Failed to get matches' });
  }
};

export const getMatchById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { matchId } = req.params;
    const userId = req.user!.id;

    const match = await Match.findOne({
      _id: matchId,
      $or: [{ user1Id: userId }, { user2Id: userId }],
    })
      .populate('user1Id', 'fullName dateOfBirth gender lastActive')
      .populate('user2Id', 'fullName dateOfBirth gender lastActive');

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const otherUserId = match.user1Id._id.toString() === userId ? match.user2Id._id : match.user1Id._id;
    const profile = await Profile.findOne({ userId: otherUserId });
    const photos = await Photo.find({ userId: otherUserId }).sort({ order: 1 });

    res.json({
      ...match.toObject(),
      profile,
      photos,
    });
  } catch (error) {
    console.error('Get match error:', error);
    res.status(500).json({ error: 'Failed to get match' });
  }
};

export const unmatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { matchId } = req.params;
    const userId = req.user!.id;

    const match = await Match.findOne({
      _id: matchId,
      $or: [{ user1Id: userId }, { user2Id: userId }],
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    await Match.deleteOne({ _id: matchId });
    await Message.deleteMany({ matchId });

    res.json({ message: 'Unmatched successfully' });
  } catch (error) {
    console.error('Unmatch error:', error);
    res.status(500).json({ error: 'Failed to unmatch' });
  }
};

export const blockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { matchId } = req.params;
    const userId = req.user!.id;

    const match = await Match.findOne({
      _id: matchId,
      $or: [{ user1Id: userId }, { user2Id: userId }],
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    // Add block logic to user model if needed
    match.user1Id.toString() === userId ? match.user2Id : match.user1Id;

    // For now, just delete the match
    await Match.deleteOne({ _id: matchId });
    await Message.deleteMany({ matchId });

    res.json({ message: 'User blocked successfully' });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
};
