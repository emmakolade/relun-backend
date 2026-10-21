import { calculateAge } from '../utils/helpers';
import { isUserOnline } from '../socket/presence';

type AnyDoc = { toObject?: () => Record<string, unknown> } & Record<string, unknown>;

const plain = (doc: unknown): Record<string, any> | null => {
  if (!doc) return null;
  const value = doc as AnyDoc;
  return typeof value.toObject === 'function' ? value.toObject() : { ...value };
};

/**
 * The {user, profile, photos} envelope every person-listing endpoint returns,
 * plus derived fields the apps would otherwise each compute: age, isOnline.
 * Respects the person's privacy toggles, so a hidden age or distance never
 * leaves the server.
 */
export const toCard = (entry: { user: unknown; profile: unknown; photos?: unknown[] }) => {
  const user = plain(entry.user);
  const profile = plain(entry.profile);

  if (!user) return null;

  // Defensive: callers select only public fields, but never let these out.
  ['email', 'phone', 'otpCode', 'otpExpiry', 'coins', 'insightsUntil', 'deletedAt', 'password'].forEach(
    (field) => delete user[field]
  );

  const userId = String(user._id);
  const showAge = profile?.showAge !== false;
  const showDistance = profile?.showDistance !== false;

  if (profile) {
    delete profile.location;
    delete profile.latitude;
    delete profile.longitude;
    delete profile.locationUpdatedAt;
    // The person's own preferences, not part of what others see.
    delete profile.notificationsEnabled;
    delete profile.maxDistanceKm;
    delete profile.ageMin;
    delete profile.ageMax;
    if (!showDistance) delete profile.distance;
  }

  const age = showAge && user.dateOfBirth ? calculateAge(user.dateOfBirth) : null;
  if (!showAge) delete user.dateOfBirth;

  return {
    user: { ...user, age, isOnline: isUserOnline(userId) },
    profile,
    photos: (entry.photos ?? []).map((photo) => plain(photo)),
  };
};
