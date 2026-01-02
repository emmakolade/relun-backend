import { Response } from 'express';
import { validationResult } from 'express-validator';
import { AuthRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Photo } from '../models/Photo';

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const profile = await Profile.findOne({ userId: req.user!.id });

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    const photos = await Photo.find({ userId: req.user!.id }).sort({ order: 1 });

    res.json({
      ...profile.toObject(),
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

    const updateData: any = { ...req.body };

    if (updateData.location && updateData.location.latitude && updateData.location.longitude) {
      updateData.location = {
        type: 'Point',
        coordinates: [updateData.location.longitude, updateData.location.latitude],
      };
    }

    const profile = await Profile.findOneAndUpdate(
      { userId: req.user!.id },
      { $set: updateData },
      { new: true, upsert: true }
    );

    // Calculate completeness
    const requiredFields = ['bio', 'city', 'segment', 'lookingFor', 'interests'];
    const filledFields = requiredFields.filter(field => profile.get(field));
    const completenessScore = Math.round((filledFields.length / requiredFields.length) * 100);
    const isComplete = completenessScore >= 80;

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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { url, order } = req.body;

    const photoCount = await Photo.countDocuments({ userId: req.user!.id });

    if (photoCount >= 6) {
      res.status(400).json({ error: 'Maximum 6 photos allowed' });
      return;
    }

    const photo = await Photo.create({
      userId: req.user!.id,
      url,
      order: order ?? photoCount,
    });

    res.status(201).json(photo);
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
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

    const user = await User.findById(userId).select('fullName dateOfBirth gender lastActive');

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const profile = await Profile.findOne({ userId });
    const photos = await Photo.find({ userId }).sort({ order: 1 });

    res.json({
      user,
      profile,
      photos,
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
};
