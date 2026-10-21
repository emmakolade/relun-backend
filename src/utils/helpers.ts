import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

export const calculateAge = (dateOfBirth: Date): number => {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
};

export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Radius of the Earth in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
};

const toRad = (value: number): number => {
  return (value * Math.PI) / 180;
};

// Grid the other person's position is snapped to before measuring, about 1.1 km.
const LOCATION_GRID_DEGREES = 0.01;
const snap = (degrees: number) =>
  Math.round(degrees / LOCATION_GRID_DEGREES) * LOCATION_GRID_DEGREES;

/**
 * Distance shown to a viewer, in whole km (at least 1). The other person's
 * position is snapped to a grid first, so a viewer who spoofs their own
 * location from several points can't triangulate anyone closer than ~1 km.
 */
export const displayDistanceKm = (
  viewerLat: number,
  viewerLon: number,
  lat: number,
  lon: number
): number => Math.max(1, Math.round(calculateDistance(viewerLat, viewerLon, snap(lat), snap(lon))));
