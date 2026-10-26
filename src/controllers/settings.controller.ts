import { Response } from 'express';
import { validationResult } from 'express-validator';
import { AuthRequest } from '../middleware/auth.middleware';
import { Profile } from '../models/Profile';
import { User } from '../models/User';

const SETTINGS_FIELDS = [
  'isVisible',
  'showAge',
  'showDistance',
  'notificationsEnabled',
  'allowMessageRequests',
  'maxDistanceKm',
  'ageMin',
  'ageMax',
  'showMe',
] as const;

const pickSettings = (profile: Record<string, any> | null, gender?: string) => ({
  isVisible: profile?.isVisible ?? true,
  showAge: profile?.showAge ?? true,
  showDistance: profile?.showDistance ?? true,
  notificationsEnabled: profile?.notificationsEnabled ?? true,
  allowMessageRequests: profile?.allowMessageRequests ?? true,
  maxDistanceKm: profile?.maxDistanceKm ?? 35,
  ageMin: profile?.ageMin ?? 18,
  ageMax: profile?.ageMax ?? 99,
  segment: profile?.segment ?? 'relationship',
  showMe: profile?.showMe ?? 'opposite',
  // Read-only here; the apps need it to label "Show me" as Men or Women.
  gender: gender ?? null,
});

const userGender = async (userId: string) =>
  (await User.findById(userId).select('gender').lean())?.gender;

// GET /api/settings
export const getSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [profile, gender] = await Promise.all([
      Profile.findOne({ userId: req.user!.id }).lean(),
      userGender(req.user!.id),
    ]);
    res.json({ settings: pickSettings(profile, gender) });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
};

// PATCH /api/settings. Segment is deliberately not settable here: it is permanent.
export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const update: Record<string, unknown> = {};
    SETTINGS_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    const current = await Profile.findOne({ userId: req.user!.id }).select('ageMin ageMax').lean();
    const ageMin = (update.ageMin as number) ?? current?.ageMin ?? 18;
    const ageMax = (update.ageMax as number) ?? current?.ageMax ?? 99;

    if (ageMin > ageMax) {
      res.status(400).json({ error: 'Minimum age must not exceed maximum age' });
      return;
    }

    const profile = await Profile.findOneAndUpdate(
      { userId: req.user!.id },
      { $set: update },
      { new: true, upsert: true }
    ).lean();

    res.json({ settings: pickSettings(profile, await userGender(req.user!.id)) });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};
