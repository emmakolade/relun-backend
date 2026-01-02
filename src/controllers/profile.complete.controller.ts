import { Response } from 'express';
import { validationResult } from 'express-validator';
import { AuthRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Profile } from '../models/Profile';

// Complete profile for first-time users
export const completeProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { fullName, dateOfBirth, gender, bio, segment, email, phone } = req.body;

    const user = await User.findById(req.user!.id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Update user info
    if (fullName) user.fullName = fullName;
    if (dateOfBirth) user.dateOfBirth = new Date(dateOfBirth);
    if (gender) user.gender = gender;

    // If user signed up with phone, they must provide email (and vice versa)
    if (email && !user.email) {
      // Check if email is already taken
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        res.status(400).json({ error: 'Email already in use' });
        return;
      }
      user.email = email;
    }

    if (phone && !user.phone) {
      // Check if phone is already taken
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) {
        res.status(400).json({ error: 'Phone already in use' });
        return;
      }
      user.phone = phone;
    }

    await user.save();

    // Update profile
    const profile = await Profile.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          bio,
          segment,
        },
      },
      { new: true, upsert: true }
    );

    // Calculate completeness
    const requiredFields = ['bio', 'segment'];
    const userRequiredFields = ['fullName', 'dateOfBirth', 'gender', 'email', 'phone'];
    
    const filledProfileFields = requiredFields.filter(field => profile.get(field));
    const filledUserFields = userRequiredFields.filter(field => user.get(field));
    
    const totalFields = requiredFields.length + userRequiredFields.length;
    const filledFields = filledProfileFields.length + filledUserFields.length;
    
    const completenessScore = Math.round((filledFields / totalFields) * 100);
    const isComplete = completenessScore >= 80;

    profile.completenessScore = completenessScore;
    profile.isComplete = isComplete;
    await profile.save();

    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
      },
      profile,
      isComplete,
    });
  } catch (error) {
    console.error('Complete profile error:', error);
    res.status(500).json({ error: 'Failed to complete profile' });
  }
};
