import { Response } from 'express';
import { validationResult } from 'express-validator';
import { Types, PipelineStage } from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Photo } from '../models/Photo';
import { Like, getMatchedUserIds } from '../models/Like';
import { Pass } from '../models/Pass';
import { ProfileView } from '../models/ProfileView';
import { getBlockedUserIds, isBlockedEitherWay } from '../models/Block';
import { toCard } from '../services/card.service';
import { canSeeInsights, hasPlus, likeAllowance } from '../services/plus.service';
import { uploadImage, uploadMultipleImages } from '../services/cloudinary.service';
import { calculateDistance } from '../utils/helpers';
import { notifyLiked, notifyNewMatch, notifyViewed } from '../services/push.service';
import { acceptMessageRequest, messageRequestView } from '../services/messageRequest.service';
import {
  CompleteProfileRequest,
  ProfileUpdateData,
  CompleteProfileResponseDto,
  UserDto,
} from '../types';

// Location update throttle settings
const LOCATION_UPDATE_DISTANCE_THRESHOLD = 0.5; // 500 meters in km
const LOCATION_UPDATE_TIME_THRESHOLD = 5 * 60 * 1000; // 5 minutes in ms

const isLocationIndexError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: number; codeName?: string };
  return maybeError.code === 16755 || maybeError.codeName === 'Location16755';
};

const clearInvalidLocationForUser = async (userId: string | Types.ObjectId) => {
  const normalizedUserId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

  await Profile.collection.updateOne(
    {
      userId: normalizedUserId,
      location: { $exists: true },
      $or: [
        { 'location.type': { $exists: false } },
        { 'location.type': { $ne: 'Point' } },
        { 'location.coordinates.0': { $exists: false } },
        { 'location.coordinates.1': { $exists: false } },
        { 'location.coordinates.2': { $exists: true } },
      ],
    },
    {
      $unset: {
        location: '',
      },
    }
  );
};

// Complete profile for first-time users
export const completeProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const {
      fullName,
      dateOfBirth,
      gender,
      bio,
      segment,
      email,
      phone,
      latitude,
      longitude,
    }: CompleteProfileRequest = req.body;

    const user = await User.findById(req.user!.id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (fullName) user.fullName = fullName;
    if (dateOfBirth) user.dateOfBirth = new Date(dateOfBirth);
    if (gender) user.gender = gender;

    // If user signed up with phone, they must provide email (and vice versa)
    if (email && !user.email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        res.status(400).json({ error: 'Email already in use' });
        return;
      }
      user.email = email;
    }

    if (phone && !user.phone) {
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) {
        res.status(400).json({ error: 'Phone already in use' });
        return;
      }
      user.phone = phone;
    }

    await user.save();

    const profileUpdateData: ProfileUpdateData = {
      fullName,
      dateOfBirth,
      gender,
      bio,
      segment,
      email,
      phone,
      latitude,
      longitude,
    };

    if (latitude !== undefined && longitude !== undefined) {
      profileUpdateData.latitude = latitude;
      profileUpdateData.longitude = longitude;
      profileUpdateData.location = {
        type: 'Point',
        coordinates: [longitude, latitude],
      };
    }

    await clearInvalidLocationForUser(user._id);

    let profile;
    try {
      profile = await Profile.findOneAndUpdate(
        { userId: user._id },
        { $set: profileUpdateData },
        { new: true, upsert: true }
      );
    } catch (error) {
      if (!isLocationIndexError(error)) {
        throw error;
      }

      await Profile.collection.updateOne({ userId: user._id }, { $unset: { location: '' } });

      profile = await Profile.findOneAndUpdate(
        { userId: user._id },
        { $set: profileUpdateData },
        { new: true, upsert: true }
      );
    }

    // Calculate completeness
    const requiredFields = ['segment'];
    const userRequiredFields = ['fullName', 'dateOfBirth', 'gender', 'email', 'phone'];

    const filledProfileFields = requiredFields.filter((field) => profile.get(field));
    const filledUserFields = userRequiredFields.filter((field) => user.get(field));

    const totalFields = requiredFields.length + userRequiredFields.length;
    const filledFields = filledProfileFields.length + filledUserFields.length;

    const completenessScore = Math.round((filledFields / totalFields) * 100);
    const isComplete = completenessScore >= 80;

    profile.completenessScore = completenessScore;
    profile.isComplete = isComplete;
    await profile.save();

    const userDto: UserDto = {
      id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
    };

    const response: CompleteProfileResponseDto = {
      user: userDto,
      profile: profile.toObject() as unknown as Record<string, unknown>,
      isComplete,
    };

    res.json(response);
  } catch (error) {
    console.error('Complete profile error:', error);
    res.status(500).json({ error: 'Failed to complete profile' });
  }
};

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const profile = await Profile.findOne({ userId: req.user!.id });

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    const user = await User.findById(req.user!.id).select(
      'fullName dateOfBirth gender email phone'
    );

    const photos = await Photo.find({ userId: req.user!.id }).sort({ order: 1 });

    res.json({
      user,
      profile: profile.toObject(),
      photos,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const updateData: ProfileUpdateData = { ...req.body };

    if (typeof req.body.fullName === 'string') {
      const trimmedFullName = req.body.fullName.trim();

      if (trimmedFullName.length > 0) {
        await User.findByIdAndUpdate(req.user!.id, { fullName: trimmedFullName });
      }
    }

    // fullName belongs to User model, not Profile model
    delete updateData.fullName;

    // Handle location conversion from latitude/longitude to GeoJSON
    if (updateData.latitude !== undefined && updateData.longitude !== undefined) {
      updateData.location = {
        type: 'Point',
        coordinates: [updateData.longitude, updateData.latitude], // [longitude, latitude]
      };
    }

    await clearInvalidLocationForUser(req.user!.id);

    let profile;
    try {
      profile = await Profile.findOneAndUpdate(
        { userId: req.user!.id },
        { $set: updateData },
        { new: true, upsert: true }
      );
    } catch (error) {
      if (!isLocationIndexError(error)) {
        throw error;
      }

      await Profile.collection.updateOne(
        { userId: new Types.ObjectId(req.user!.id) },
        { $unset: { location: '' } }
      );

      profile = await Profile.findOneAndUpdate(
        { userId: req.user!.id },
        { $set: updateData },
        { new: true, upsert: true }
      );
    }

    // Calculate completeness
    const requiredFields = ['bio', 'city', 'segment', 'lookingFor', 'interests'];
    const filledFields = requiredFields.filter((field) => profile.get(field));
    const completenessScore = Math.round((filledFields.length / requiredFields.length) * 100);
    const isComplete = completenessScore >= 90;

    profile.completenessScore = completenessScore;
    profile.isComplete = isComplete;
    await profile.save();

    res.json(profile);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

export const uploadPhoto = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Handle both single and multiple file uploads
    const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);

    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const photoCount = await Photo.countDocuments({ userId: req.user!.id });

    // Check if total photos would exceed limit
    if (photoCount + files.length > 6) {
      res.status(400).json({
        error: `Maximum 6 photos allowed. You have ${photoCount} photos, attempting to upload ${files.length} more.`,
      });
      return;
    }

    // Upload to Cloudinary - use different methods for single vs multiple
    let uploadResults;
    if (files.length === 1) {
      // Single file upload
      const result = await uploadImage(files[0].buffer, `relun/users/${req.user!.id}`);
      uploadResults = [result];
    } else {
      // Multiple files upload
      const buffers = files.map((file) => file.buffer);
      uploadResults = await uploadMultipleImages(buffers, `relun/users/${req.user!.id}`);
    }

    // Save all to database
    const uploadedPhotos = [];
    for (let i = 0; i < uploadResults.length; i++) {
      const result = uploadResults[i];
      const photo = await Photo.create({
        userId: req.user!.id,
        url: result.secureUrl,
        publicId: result.publicId,
        order: photoCount + i,
      });
      uploadedPhotos.push(photo);
    }

    // Upload all files to Cloudinary
    // const uploadedPhotos = [];

    // for (let i = 0; i < files.length; i++) {
    //   const file = files[i];

    //   // Upload to Cloudinary
    //   const uploadResult = await uploadImage(file.buffer, `relun/users/${req.user!.id}`);

    //   // Save to database
    //   const photo = await Photo.create({
    //     userId: req.user!.id,
    //     url: uploadResult.secureUrl,
    //     publicId: uploadResult.publicId,
    //     order: photoCount + i,
    //   });

    //   uploadedPhotos.push(photo);
    // }

    // Return single photo object if only one was uploaded, otherwise return array
    res.status(201).json(files.length === 1 ? uploadedPhotos[0] : uploadedPhotos);
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
};

export const replacePhoto = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { photoId } = req.params;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const existingPhoto = await Photo.findOne({ _id: photoId, userId: req.user!.id });

    if (!existingPhoto) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }

    const uploadResult = await uploadImage(file.buffer, `relun/users/${req.user!.id}`);

    // if (existingPhoto.publicId) {
    //   await deleteImage(existingPhoto.publicId);
    // }

    existingPhoto.url = uploadResult.secureUrl;
    existingPhoto.publicId = uploadResult.publicId;
    await existingPhoto.save();

    res.json(existingPhoto);
  } catch (error) {
    console.error('Replace photo error:', error);
    res.status(500).json({ error: 'Failed to replace photo' });
  }
};

export const deletePhoto = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { photoId } = req.params;

    const photo = await Photo.findOne({ _id: photoId, userId: req.user!.id });

    if (!photo) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }

    // Delete from Cloudinary if publicId exists
    // if (photo.publicId) {
    //   await deleteImage(photo.publicId);
    // }

    // Delete from database
    await Photo.deleteOne({ _id: photoId });

    // Reorder remaining photos
    const remainingPhotos = await Photo.find({ userId: req.user!.id }).sort({ order: 1 });

    for (let i = 0; i < remainingPhotos.length; i++) {
      remainingPhotos[i].order = i;
      await remainingPhotos[i].save();
    }

    res.json({ message: 'Photo deleted successfully' });
  } catch (error) {
    console.error('Delete photo error:', error);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
};

export const getUserProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const viewerId = req.user!.id;

    if (!Types.ObjectId.isValid(userId)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    // A blocked person simply does not exist from either side.
    if (userId !== viewerId && (await isBlockedEitherWay(viewerId, userId))) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = await User.findOne({ _id: userId, isActive: true }).select(
      'fullName dateOfBirth gender lastActive'
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const [profile, photos, liked, likedMe, viewerProfile, messageRequest] = await Promise.all([
      Profile.findOne({ userId }),
      Photo.find({ userId }).sort({ order: 1 }),
      Like.exists({ userId: viewerId, targetUserId: userId }),
      Like.exists({ userId, targetUserId: viewerId }),
      Profile.findOne({ userId: viewerId }).select('latitude longitude'),
      userId === viewerId ? null : messageRequestView(viewerId, userId),
    ]);

    const isMutual = !!liked && !!likedMe;

    if (userId !== viewerId) {
      // A notification at most once a day per viewer, so browsing back and forth isn't noise.
      ProfileView.findOneAndUpdate(
        { viewerId, viewedId: userId },
        { $set: { lastViewedAt: new Date() } },
        { upsert: true, new: false }
      )
        .lean()
        .then((previous) => {
          if (!previous || Date.now() - previous.lastViewedAt.getTime() > 24 * 60 * 60 * 1000) {
            void notifyViewed({ viewedId: userId, viewerId });
          }
        })
        .catch((error) => console.error('Record profile view error:', error));
    }

    // Distance from the viewer, when both have a location.
    const plainProfile = profile ? (profile.toObject() as Record<string, any>) : null;
    if (
      plainProfile?.latitude &&
      plainProfile?.longitude &&
      viewerProfile?.latitude &&
      viewerProfile?.longitude
    ) {
      const km = calculateDistance(
        viewerProfile.latitude,
        viewerProfile.longitude,
        plainProfile.latitude,
        plainProfile.longitude
      );
      plainProfile.distance = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
    }

    res.json({
      ...toCard({ user, profile: plainProfile, photos }),
      relationship: {
        liked: !!liked,
        isMutual,
        // Whether the viewer can pay to message them without a match.
        acceptsMessageRequests: profile?.allowMessageRequests ?? true,
        messageRequest: isMutual ? null : messageRequest,
      },
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
};

export const likeUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { targetUserId } = req.params;
    const userId = req.user!.id;

    if (userId === targetUserId) {
      res.status(400).json({ error: 'You cannot like yourself' });
      return;
    }

    const targetUser = await User.findOne({ _id: targetUserId, isActive: true });

    if (!targetUser || (await isBlockedEitherWay(userId, targetUserId))) {
      res.status(404).json({ error: 'Target user not found' });
      return;
    }

    const [currentProfile, targetProfile] = await Promise.all([
      Profile.findOne({ userId }).select('segment'),
      Profile.findOne({ userId: targetUserId }).select('segment'),
    ]);

    if (
      currentProfile?.segment &&
      targetProfile?.segment &&
      currentProfile.segment !== targetProfile.segment
    ) {
      res.status(403).json({ error: 'You can only like users in the same segment' });
      return;
    }

    const existingLike = await Like.findOne({ userId, targetUserId });
    const allowance = await likeAllowance(userId, await hasPlus(userId));

    if (!existingLike) {
      // Free users get FREE_DAILY_LIKES a day; Plus has no limit.
      if (allowance.left === 0) {
        res.status(429).json({
          error: 'You’ve used all your likes for today',
          code: 'LIKE_LIMIT',
          resetAt: allowance.resetAt,
        });
        return;
      }
      await Like.create({ userId, targetUserId });
    }

    const reciprocalLikeExists = !!(await Like.exists({
      userId: targetUserId,
      targetUserId: userId,
    }));

    // Liking back someone who sent you a message request accepts it and opens
    // the chat. That also tells them about the match.
    const acceptedRequest =
      reciprocalLikeExists &&
      (await acceptMessageRequest({ senderId: targetUserId, receiverId: userId }));

    // Only when the match is newly formed. The liker sees isMutual in this
    // response; the other side liked earlier and has no idea yet, so push them.
    if (!existingLike && reciprocalLikeExists && !acceptedRequest) {
      void notifyNewMatch({ recipientId: targetUserId, matchedUserId: userId });
    } else if (!existingLike && !reciprocalLikeExists) {
      void notifyLiked({ recipientId: targetUserId, likerId: userId });
    }

    res.status(existingLike ? 200 : 201).json({
      liked: true,
      isMutual: reciprocalLikeExists,
      alreadyLiked: !!existingLike,
      targetUserId,
      // Null for Plus (no limit).
      likesLeft: allowance.left === null ? null : allowance.left - (existingLike ? 0 : 1),
      likesResetAt: allowance.resetAt,
    });
  } catch (error) {
    console.error('Like user error:', error);
    res.status(500).json({ error: 'Failed to like user' });
  }
};

export const unlikeUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { targetUserId } = req.params;
    const userId = req.user!.id;

    await Like.deleteOne({ userId, targetUserId });

    res.json({ liked: false, targetUserId });
  } catch (error) {
    console.error('Unlike user error:', error);
    res.status(500).json({ error: 'Failed to unlike user' });
  }
};

export const getLikeStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { targetUserId } = req.params;
    const userId = req.user!.id;

    const liked = !!(await Like.exists({ userId, targetUserId }));
    const isMutual =
      liked &&
      !!(await Like.exists({
        userId: targetUserId,
        targetUserId: userId,
      }));

    res.json({ liked, isMutual, targetUserId });
  } catch (error) {
    console.error('Get like status error:', error);
    res.status(500).json({ error: 'Failed to get like status' });
  }
};

export const getReceivedLikes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { limit = 100 } = req.query;
    const safeLimit = Math.max(1, Math.min(Number(limit), 200));

    // People already liked back are matches and live in Messages instead.
    const [insights, blockedIds, liked] = await Promise.all([
      canSeeInsights(userId),
      getBlockedUserIds(userId),
      Like.find({ userId }).select('targetUserId').lean(),
    ]);

    const hidden = [...blockedIds, ...liked.map((like) => like.targetUserId.toString())].map(
      (id) => new Types.ObjectId(id)
    );
    const filter = { targetUserId: new Types.ObjectId(userId), userId: { $nin: hidden } };
    const count = await Like.countDocuments(filter);

    // Without insights (a coin pass or Plus) the app only learns how many, never who.
    if (!insights) {
      res.json({ locked: true, count, likes: [] });
      return;
    }

    const likes = await Like.find(filter).sort({ createdAt: -1 }).limit(safeLimit).lean();

    const likesWithUsers = await Promise.all(
      likes.map(async (like) => {
        const [likerUser, likerProfile, likerPhotos] = await Promise.all([
          User.findOne({ _id: like.userId, isActive: true }).select(
            'fullName dateOfBirth gender lastActive'
          ),
          Profile.findOne({ userId: like.userId }).select('bio segment showAge showDistance'),
          Photo.find({ userId: like.userId }).sort({ order: 1 }),
        ]);

        const card = toCard({ user: likerUser, profile: likerProfile, photos: likerPhotos });
        return card ? { ...card, likedAt: like.createdAt } : null;
      })
    );

    res.json({ locked: false, count, likes: likesWithUsers.filter(Boolean) });
  } catch (error) {
    console.error('Get received likes error:', error);
    res.status(500).json({ error: 'Failed to get received likes' });
  }
};

// Users this user has matched with (both sides liked each other).
export const getMatches = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const [allMatchedIds, blockedIds] = await Promise.all([
      getMatchedUserIds(userId),
      getBlockedUserIds(userId),
    ]);
    const blocked = new Set(blockedIds);
    const matchedUserIds = allMatchedIds.filter((id) => !blocked.has(id));

    if (matchedUserIds.length === 0) {
      res.json({ matches: [] });
      return;
    }

    // Three queries total no matter how many matches, rather than three each.
    const [users, profiles, photos] = await Promise.all([
      User.find({ _id: { $in: matchedUserIds }, isActive: true }).select(
        'fullName dateOfBirth gender lastActive'
      ),
      Profile.find({ userId: { $in: matchedUserIds } }).select(
        'userId bio segment showAge showDistance'
      ),
      Photo.find({ userId: { $in: matchedUserIds } }).sort({ order: 1 }),
    ]);

    const profileByUserId = new Map(
      profiles.map((profile) => [profile.userId.toString(), profile])
    );

    const photosByUserId = new Map<string, typeof photos>();
    photos.forEach((photo) => {
      const key = photo.userId.toString();
      const existing = photosByUserId.get(key);

      if (existing) {
        existing.push(photo);
      } else {
        photosByUserId.set(key, [photo]);
      }
    });

    const matches = users.map((user) => {
      const key = (user._id as Types.ObjectId).toString();

      return toCard({
        user,
        profile: profileByUserId.get(key) || null,
        photos: photosByUserId.get(key) || [],
      });
    });

    res.json({ matches });
  } catch (error) {
    console.error('Get matches error:', error);
    res.status(500).json({ error: 'Failed to get matches' });
  }
};

// Get nearby users for discovery/feed.
//
// Shows people in the same segment who are visible, active, inside the
// viewer's distance and age filters, and not already liked, passed, matched or
// blocked in either direction.
export const getNearbyUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { limit = 20, latitude, longitude } = req.query;
    const userId = req.user!.id;
    const safeLimit = Math.max(1, Math.min(Number(limit), 50));

    let currentProfile = await Profile.findOne({ userId });
    const currentSegment = currentProfile?.segment || 'relationship';

    // Auto-update the viewer's location when coordinates are sent (throttled).
    if (latitude && longitude) {
      const lat = parseFloat(latitude as string);
      const lng = parseFloat(longitude as string);
      let shouldUpdateLocation = true;

      if (
        currentProfile?.latitude &&
        currentProfile?.longitude &&
        currentProfile?.locationUpdatedAt
      ) {
        const distanceMoved = calculateDistance(
          currentProfile.latitude,
          currentProfile.longitude,
          lat,
          lng
        );
        const timeSinceLastUpdate =
          Date.now() - new Date(currentProfile.locationUpdatedAt).getTime();

        shouldUpdateLocation =
          distanceMoved > LOCATION_UPDATE_DISTANCE_THRESHOLD ||
          timeSinceLastUpdate > LOCATION_UPDATE_TIME_THRESHOLD;
      }

      if (shouldUpdateLocation) {
        currentProfile = await Profile.findOneAndUpdate(
          { userId },
          {
            $set: {
              latitude: lat,
              longitude: lng,
              locationUpdatedAt: new Date(),
              location: { type: 'Point', coordinates: [lng, lat] },
            },
          },
          { new: true, upsert: true }
        );
      }
    }

    const [liked, passed, blockedIds] = await Promise.all([
      Like.find({ userId }).select('targetUserId').lean(),
      Pass.find({ userId }).select('targetUserId').lean(),
      getBlockedUserIds(userId),
    ]);

    const excluded = [
      userId,
      ...liked.map((like) => like.targetUserId.toString()),
      ...passed.map((pass) => pass.targetUserId.toString()),
      ...blockedIds,
    ].map((id) => new Types.ObjectId(id));

    const profileFilter = {
      userId: { $nin: excluded },
      segment: currentSegment,
      isVisible: true,
    };

    // Age range as a date-of-birth window.
    const ageMin = currentProfile?.ageMin ?? 18;
    const ageMax = currentProfile?.ageMax ?? 99;
    const now = new Date();
    const youngestDob = new Date(now.getFullYear() - ageMin, now.getMonth(), now.getDate());
    const oldestDob = new Date(now.getFullYear() - ageMax - 1, now.getMonth(), now.getDate() + 1);

    const coordinates = currentProfile?.location?.coordinates?.length
      ? [currentProfile.location.coordinates[0], currentProfile.location.coordinates[1]]
      : currentProfile?.latitude && currentProfile?.longitude
        ? [currentProfile.longitude, currentProfile.latitude]
        : null;

    const firstStage: PipelineStage = coordinates
      ? {
          $geoNear: {
            near: { type: 'Point', coordinates } as any,
            distanceField: 'distance',
            maxDistance: (currentProfile?.maxDistanceKm ?? 35) * 1000,
            spherical: true,
            query: profileFilter,
          },
        }
      : { $match: profileFilter };

    const rows = await Profile.aggregate([
      firstStage,
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
          pipeline: [
            {
              $match: {
                isActive: true,
                $or: [
                  { dateOfBirth: { $gte: oldestDob, $lte: youngestDob } },
                  { dateOfBirth: { $exists: false } },
                ],
              },
            },
            { $project: { fullName: 1, dateOfBirth: 1, gender: 1, lastActive: 1 } },
          ],
        },
      },
      { $unwind: '$user' },
      { $limit: safeLimit },
    ]);

    const photos = await Photo.find({ userId: { $in: rows.map((row) => row.userId) } })
      .sort({ order: 1 })
      .lean();

    const users = rows
      .map((row) => {
        const { user, ...profile } = row;
        if (typeof profile.distance === 'number') {
          // One decimal under 10 km so "0.4 km" and "< 1 km away" stay possible.
          const km = profile.distance / 1000;
          profile.distance = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
        }
        return toCard({
          user,
          profile,
          photos: photos.filter((photo) => photo.userId.toString() === row.userId.toString()),
        });
      })
      .filter(Boolean);

    res.json({ users });
  } catch (error) {
    console.error('Get nearby users error:', error);
    res.status(500).json({ error: 'Failed to get nearby users' });
  }
};

// POST /api/profiles/passes/:targetUserId
export const passUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { targetUserId } = req.params;

    if (!Types.ObjectId.isValid(targetUserId) || targetUserId === userId) {
      res.status(400).json({ error: 'Invalid target user ID' });
      return;
    }

    await Pass.updateOne(
      { userId, targetUserId },
      { $setOnInsert: { userId, targetUserId } },
      { upsert: true }
    );

    res.status(201).json({ passed: true, targetUserId });
  } catch (error) {
    console.error('Pass user error:', error);
    res.status(500).json({ error: 'Failed to pass user' });
  }
};

// GET /api/profiles/views. Who viewed me; full list needs active insights.
export const getProfileViews = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const [insights, blockedIds] = await Promise.all([canSeeInsights(userId), getBlockedUserIds(userId)]);

    const filter = {
      viewedId: userId,
      viewerId: { $nin: blockedIds.map((id) => new Types.ObjectId(id)) },
    };
    const count = await ProfileView.countDocuments(filter);

    if (!insights) {
      res.json({ locked: true, count, views: [] });
      return;
    }

    const views = await ProfileView.find(filter).sort({ lastViewedAt: -1 }).limit(100).lean();
    const cards = await Promise.all(
      views.map(async (view) => {
        const [user, profile, photos] = await Promise.all([
          User.findOne({ _id: view.viewerId, isActive: true }).select(
            'fullName dateOfBirth gender lastActive'
          ),
          Profile.findOne({ userId: view.viewerId }).select('bio segment showAge showDistance'),
          Photo.find({ userId: view.viewerId }).sort({ order: 1 }),
        ]);
        const card = toCard({ user, profile, photos });
        return card ? { ...card, viewedAt: view.lastViewedAt } : null;
      })
    );

    res.json({ locked: false, count, views: cards.filter(Boolean) });
  } catch (error) {
    console.error('Get profile views error:', error);
    res.status(500).json({ error: 'Failed to get profile views' });
  }
};
