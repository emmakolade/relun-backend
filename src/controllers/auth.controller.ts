import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { generateTokenPair } from '../utils/jwt.utils';
import {
  generateOTP,
  getOTPExpiry,
  sendOTPEmail,
  sendOTPSMS,
  verifyOTP as verifyOTPUtil,
} from '../utils/otp.utils';
import { AuthRequest } from '../middleware/auth.middleware';
import { User, IUser } from '../models/User';
import { Profile } from '../models/Profile';
import { RefreshToken } from '../models/RefreshToken';
import { Photo } from '../models/Photo';
import { PushToken } from '../models/PushToken';
import { CoinTransaction } from '../models/CoinTransaction';
import { DatePost } from '../models/DatePost';
import { deleteImage } from '../services/cloudinary.service';
import { SIGNUP_BONUS_COINS, SIGNUP_BONUS_REF } from '../config/coins';
import {
  RequestOTPRequest,
  RequestOTPResponse,
  VerifyOTPRequest,
  LoginRequest,
  LoginResponse,
} from '../types';

export const requestOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, phone }: RequestOTPRequest = req.body;

    if (!email && !phone) {
      res.status(400).json({ error: 'Email or phone is required' });
      return;
    }

    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    const queryConditions = [];
    if (email) queryConditions.push({ email });
    if (phone) queryConditions.push({ phone });

    let user: IUser | null = await User.findOne({
      $or: queryConditions,
    });

    if (user) {
      user.otpCode = otp;
      user.otpExpiry = otpExpiry;
      await user.save();
    } else {
      user = await User.create({
        email,
        phone,
        otpCode: otp,
        otpExpiry,
        coins: SIGNUP_BONUS_COINS,
      });

      await Profile.create({ userId: user._id });

      if (SIGNUP_BONUS_COINS > 0) {
        await CoinTransaction.create({
          userId: user._id,
          amount: SIGNUP_BONUS_COINS,
          balanceAfter: SIGNUP_BONUS_COINS,
          reason: 'bonus',
          refId: SIGNUP_BONUS_REF,
          // The app shows a welcome sheet for it once the user reaches the main screen.
          announced: false,
        });
      }
    }

    if (email) {
      await sendOTPEmail(email, otp);
    } else if (phone) {
      await sendOTPSMS(phone, otp);
    }

    const response: RequestOTPResponse = {
      message: 'OTP sent successfully',
      isNewUser: !user.fullName, // If no fullName, they need to complete profile
    };

    res.json(response);
  } catch (error) {
    console.error('Request OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, phone }: LoginRequest = req.body;

    if (!email && !phone) {
      res.status(400).json({ error: 'Email or phone is required' });
      return;
    }

    const queryConditions = [];
    if (email) queryConditions.push({ email });
    if (phone) queryConditions.push({ phone });

    const user = await User.findOne({
      $or: queryConditions,
    });

    if (!user) {
      res.status(404).json({ error: "This user doesn't exist" });
      return;
    }

    if (email && !user.isEmailVerified) {
      res.status(403).json({ error: 'Email not verified. Please verify.' });
      return;
    }

    if (phone && !user.isPhoneVerified) {
      res.status(403).json({ error: 'Phone not verified. Please verify.' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    user.lastActive = new Date();
    await user.save();

    const tokens = generateTokenPair({
      userId: user._id.toString(),
      email: user.email || undefined,
      phone: user.phone || undefined,
    });

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    await RefreshToken.create({
      token: tokens.refreshToken,
      userId: user._id,
      expiresAt: expiryDate,
    });

    const profile = await Profile.findOne({ userId: user._id }).select(
      'bio city segment isComplete completenessScore'
    );

    const needsProfileCompletion =
      !user.fullName || !user.dateOfBirth || !user.gender || !profile?.segment;
    const needsEmail = !user.email;
    const needsPhone = !user.phone;

    const response: LoginResponse = {
      ...tokens,
      user: {
        ...user.toObject(),
        id: user._id.toString(),
        profile: profile?.toObject(),
      },
      needsProfileCompletion,
      needsEmail,
      needsPhone,
    };

    res.json(response);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

export const verifyOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, phone, otp }: VerifyOTPRequest = req.body;

    if (!email && !phone) {
      res.status(400).json({ error: 'Email or phone is required' });
      return;
    }

    const queryConditions = [];
    if (email) queryConditions.push({ email });
    if (phone) queryConditions.push({ phone });

    const user = await User.findOne({
      $or: queryConditions,
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!user.otpCode || !user.otpExpiry) {
      res.status(400).json({ error: 'No OTP requested. Please request OTP first.' });
      return;
    }

    const isValidOTP = verifyOTPUtil(user.otpCode, otp, user.otpExpiry);

    if (!isValidOTP) {
      res.status(401).json({ error: 'Invalid or expired OTP' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    if (email) {
      user.isEmailVerified = true;
    }
    if (phone) {
      user.isPhoneVerified = true;
    }

    user.otpCode = undefined;
    user.otpExpiry = undefined;

    user.lastActive = new Date();
    await user.save();

    const tokens = generateTokenPair({
      userId: user._id.toString(),
      email: user.email || undefined,
      phone: user.phone || undefined,
    });

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    await RefreshToken.create({
      token: tokens.refreshToken,
      userId: user._id,
      expiresAt: expiryDate,
    });

    const profile = await Profile.findOne({ userId: user._id }).select(
      'bio city segment isComplete completenessScore'
    );

    const needsProfileCompletion =
      !user.fullName || !user.dateOfBirth || !user.gender || !profile?.segment;
    const needsEmail = !user.email;
    const needsPhone = !user.phone;
    // Lets the apps resume onboarding at the photo step.
    const photoCount = await Photo.countDocuments({ userId: user._id });

    const response: LoginResponse & { photoCount: number } = {
      ...tokens,
      user: {
        ...user.toObject(),
        id: user._id.toString(),
        profile: profile?.toObject(),
      },
      needsProfileCompletion,
      needsEmail,
      needsPhone,
      photoCount,
    };

    res.json(response);
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'OTP verification failed' });
  }
};

export const getCurrentUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!.id).select('-passwordHash -twoFactorSecret');

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const profile = await Profile.findOne({ userId: user._id }).select(
      'bio city segment isComplete completenessScore'
    );

    res.json({
      ...user.toObject(),
      id: user._id.toString(),
      profile,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    await RefreshToken.deleteMany({ userId });

    await User.findByIdAndUpdate(userId, { lastActive: new Date() });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token is required' });
      return;
    }

    const storedToken = await RefreshToken.findOne({ token: refreshToken }).populate('userId');

    if (!storedToken || storedToken.expiresAt < new Date()) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    const user = await User.findById(storedToken.userId);

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const tokens = generateTokenPair({
      userId: user._id.toString(),
      email: user.email || undefined,
      phone: user.phone || undefined,
    });

    // Delete old refresh token and create new one
    await RefreshToken.deleteOne({ token: refreshToken });

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    await RefreshToken.create({
      token: tokens.refreshToken,
      userId: user._id,
      expiresAt: expiryDate,
    });

    res.json(tokens);
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
};

/**
 * DELETE /api/auth/account
 *
 * Deactivates the account and frees the email and phone so they can sign up
 * again. Photos are removed from Cloudinary and the profile disappears
 * everywhere. Everything else, messages on both sides included, is erased 30
 * days later by jobs/purgeDeletedAccounts.
 */
export const deleteAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const photos = await Photo.find({ userId }).select('publicId').lean();

    await Promise.all(
      photos
        .filter((photo) => photo.publicId)
        .map((photo) =>
          deleteImage(photo.publicId!).catch((error) =>
            console.error('Delete account photo error:', error)
          )
        )
    );

    await Promise.all([
      Photo.deleteMany({ userId }),
      RefreshToken.deleteMany({ userId }),
      PushToken.deleteMany({ userId }),
      DatePost.updateMany({ userId, status: 'active' }, { status: 'cancelled' }),
      Profile.updateOne({ userId }, { isVisible: false }),
      User.updateOne(
        { _id: userId },
        {
          $set: { isActive: false, deletedAt: new Date(), fullName: 'Deleted user' },
          $unset: { email: '', phone: '', otpCode: '', otpExpiry: '' },
        }
      ),
    ]);

    res.json({ deleted: true });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
};
