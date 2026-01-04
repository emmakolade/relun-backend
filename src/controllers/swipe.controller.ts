import { Response } from 'express';
import { validationResult } from 'express-validator';
import { AuthRequest } from '../middleware/auth.middleware';
import { Swipe } from '../models/Swipe';
import { Match } from '../models/Match';
import { User } from '../models/User';
import { Profile } from '../models/Profile';

export const createSwipe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { targetUserId, swipeType } = req.body;
    const userId = req.user!.id;

    // Check if already swiped
    const existingSwipe = await Swipe.findOne({
      userId,
      targetUserId,
    });

    if (existingSwipe) {
      res.status(400).json({ error: 'Already swiped on this user' });
      return;
    }

    // Create swipe
    const swipe = await Swipe.create({
      userId,
      targetUserId,
      swipeType,
    });

    // Check for match if it's a like or superlike
    if (swipeType === 'like' || swipeType === 'superlike') {
      const reciprocalSwipe = await Swipe.findOne({
        userId: targetUserId,
        targetUserId: userId,
        swipeType: { $in: ['like', 'superlike'] },
      });

      if (reciprocalSwipe) {
        // Create match
        const match = await Match.create({
          user1Id: userId < targetUserId ? userId : targetUserId,
          user2Id: userId < targetUserId ? targetUserId : userId,
        });

        res.status(201).json({
          swipe,
          match,
          isMatch: true,
        });
        return;
      }
    }

    res.status(201).json({
      swipe,
      isMatch: false,
    });
  } catch (error) {
    console.error('Create swipe error:', error);
    res.status(500).json({ error: 'Failed to create swipe' });
  }
};

export const getSwipes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, swipeType } = req.query;

    const query: any = { userId: req.user!.id };

    if (swipeType && ['like', 'dislike', 'superlike'].includes(swipeType as string)) {
      query.swipeType = swipeType;
    }

    const swipes = await Swipe.find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('targetUserId', 'fullName dateOfBirth gender');

    const total = await Swipe.countDocuments(query);

    res.json({
      swipes,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get swipes error:', error);
    res.status(500).json({ error: 'Failed to get swipes' });
  }
};

export const getPotentialMatches = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { limit = 10 } = req.query;
    const userId = req.user!.id;

    // Get all user IDs that have been swiped on
    const swipedUserIds = await Swipe.find({ userId }).distinct('targetUserId');

    // Get current user's profile to filter by preferences
    const currentProfile = await Profile.findOne({ userId });

    const query: any = {
      _id: { $ne: userId, $nin: swipedUserIds },
      isActive: true,
    };

    // Add location-based filtering if available
    // Support both old format (latitude/longitude) and new format (location GeoJSON)
    const hasLocation =
      currentProfile?.location?.coordinates ||
      (currentProfile?.latitude && currentProfile?.longitude);

    if (hasLocation) {
      let userLocation;

      // Use GeoJSON location if available, otherwise convert lat/lng
      if (currentProfile.location?.coordinates) {
        userLocation = currentProfile.location;
      } else if (currentProfile.latitude && currentProfile.longitude) {
        userLocation = {
          type: 'Point',
          coordinates: [currentProfile.longitude, currentProfile.latitude], // [lng, lat]
        };
      }

      // Find profile documents within the distance and restrict to those userIds
      const nearbyProfileUserIds = await Profile.find({
        location: {
          $near: {
            $geometry: userLocation,
            $maxDistance: 500000, // 50km
          },
        },
      }).distinct('userId');

      // If no nearby profiles, return empty result early
      if (!nearbyProfileUserIds || nearbyProfileUserIds.length === 0) {
        res.json({ users: [] });
        return;
      }

      // Filter out the current user and already swiped users from nearby profiles
      const filteredNearbyIds = nearbyProfileUserIds.filter(
        (id) =>
          id.toString() !== userId &&
          !swipedUserIds.some((swipedId) => swipedId.toString() === id.toString())
      );

      if (filteredNearbyIds.length === 0) {
        res.json({ users: [] });
        return;
      }

      // Only include nearby users who haven't been swiped on
      query._id = { $in: filteredNearbyIds };
    }

    const potentialMatches = await User.find(query)
      .limit(Number(limit))
      .select('fullName dateOfBirth gender lastActive');

    // Get profiles and photos for each user
    const usersWithProfiles = await Promise.all(
      potentialMatches.map(async (user) => {
        const profile = await Profile.findOne({ userId: user._id });
        return {
          user,
          profile,
        };
      })
    );

    res.json({
      users: usersWithProfiles,
    });
  } catch (error) {
    console.error('Get potential matches error:', error);
    res.status(500).json({ error: 'Failed to get potential matches' });
  }
};
