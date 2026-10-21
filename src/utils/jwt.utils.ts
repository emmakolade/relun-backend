import crypto from 'crypto';
import jwt, { SignOptions, Secret } from 'jsonwebtoken';

const ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '7d';
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '30d';
const ALGORITHM = 'HS256';

// Tokens issued before refresh tokens carried a type claim: anything that
// lived longer than this was a refresh token and must not pass as an access token.
const LEGACY_MAX_ACCESS_LIFETIME_SECONDS = 8 * 24 * 60 * 60;

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }
  return secret;
};

export interface TokenPayload {
  userId: string;
  email?: string;
  phone?: string;
}

type DecodedToken = TokenPayload & { type?: 'access' | 'refresh'; iat?: number; exp?: number };

export const generateAccessToken = (payload: TokenPayload): string => {
  const options: SignOptions = {
    algorithm: ALGORITHM,
    expiresIn: ACCESS_TOKEN_EXPIRY as SignOptions['expiresIn'],
  };

  return jwt.sign({ ...payload, type: 'access' }, getJwtSecret() as Secret, options);
};

export const generateRefreshToken = (payload: TokenPayload): string => {
  const options: SignOptions = {
    algorithm: ALGORITHM,
    expiresIn: REFRESH_TOKEN_EXPIRY as SignOptions['expiresIn'],
    // Keeps two refresh tokens issued in the same second distinct.
    jwtid: crypto.randomUUID(),
  };

  return jwt.sign({ ...payload, type: 'refresh' }, getJwtSecret() as Secret, options);
};

const decode = (token: string): DecodedToken =>
  jwt.verify(token, getJwtSecret(), { algorithms: [ALGORITHM] }) as DecodedToken;

/** Verifies an access token. Refresh tokens are rejected. */
export const verifyToken = (token: string): TokenPayload => {
  const decoded = decode(token);
  if (decoded.type === 'refresh') {
    throw new jwt.JsonWebTokenError('Refresh token used as access token');
  }
  if (
    !decoded.type &&
    decoded.iat !== undefined &&
    decoded.exp !== undefined &&
    decoded.exp - decoded.iat > LEGACY_MAX_ACCESS_LIFETIME_SECONDS
  ) {
    throw new jwt.JsonWebTokenError('Refresh token used as access token');
  }
  if (typeof decoded.userId !== 'string') {
    throw new jwt.JsonWebTokenError('Malformed token');
  }
  return decoded;
};

/** Verifies the signature and expiry of a refresh token (legacy ones lack the type claim). */
export const verifyRefreshToken = (token: string): TokenPayload => {
  const decoded = decode(token);
  if (decoded.type === 'access') {
    throw new jwt.JsonWebTokenError('Access token used as refresh token');
  }
  return decoded;
};

export const generateTokenPair = (payload: TokenPayload) => {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
};
