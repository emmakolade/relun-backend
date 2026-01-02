import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { generateTokenPair } from '../utils/jwt.utils';
import { generateOTP, getOTPExpiry, sendOTPEmail, sendOTPSMS, verifyOTP as verifyOTPUtil } from '../utils/otp.utils';
import { AuthRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { RefreshToken } from '../models/RefreshToken';

// Request OTP - Step 1 of authentication
export const requestOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, phone } = req.body;

    if (!email && !phone) {
      res.status(400).json({ error: 'Email or phone is required' });
      return;
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    // Find or create user
    const queryConditions = [];
    if (email) queryConditions.push({ email });
    if (phone) queryConditions.push({ phone });
    
    let user: any = await User.findOne({
      $or: queryConditions,
    });

    if (user) {
      // Existing user - update OTP
      user.otpCode = otp;
      user.otpExpiry = otpExpiry;
      await user.save();
    } else {
      // New user - create with OTP
      user = await User.create({
        email,
        phone,
        otpCode: otp,
        otpExpiry,
      });

      // Create empty profile for new user
      await Profile.create({ userId: user._id });
    }

    // Send OTP
    if (email) {
      await sendOTPEmail(email, otp);
    } else if (phone) {
      await sendOTPSMS(phone, otp);
    }

    res.json({
      message: 'OTP sent successfully',
      isNewUser: !user.fullName, // If no fullName, they need to complete profile
    });
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

    const { email, phone } = req.body;

    if (!email && !phone) {
      res.status(400).json({ error: 'Email or phone is required' });
      return;
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// Verify OTP - Step 2 of authentication
export const verifyOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, phone, otp } = req.body;

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

    // Verify OTP
    const isValidOTP = verifyOTPUtil(user.otpCode, otp, user.otpExpiry);

    if (!isValidOTP) {
      res.status(401).json({ error: 'Invalid or expired OTP' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    // Mark email/phone as verified
    if (email) {
      user.isEmailVerified = true;
    }
    if (phone) {
      user.isPhoneVerified = true;
    }

    // Clear OTP
    user.otpCode = undefined;
    user.otpExpiry = undefined;
    user.lastActive = new Date();
    await user.save();

    // Generate tokens
    const tokens = generateTokenPair({
      userId: user._id.toString(),
      email: user.email || undefined,
      phone: user.phone || undefined,
    });

    // Store refresh token
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    await RefreshToken.create({
      token: tokens.refreshToken,
      userId: user._id,
      expiresAt: expiryDate,
    });

    // Check if profile is complete
    const profile = await Profile.findOne({ userId: user._id }).select('bio city segment isComplete completenessScore');

    // Check if profile needs completion
    const needsProfileCompletion = !user.fullName || !user.dateOfBirth || !user.gender || !profile?.segment;
    const needsEmail = !user.email;
    const needsPhone = !user.phone;

    res.json({
      ...user.toObject(),
      id: user._id.toString(),
      profile,
      needsProfileCompletion,
      needsEmail,
      needsPhone,
    });
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

    const profile = await Profile.findOne({ userId: user._id }).select('bio city segment isComplete completenessScore');

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

