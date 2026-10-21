import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { verifyToken } from '../utils/jwt.utils';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    phone?: string;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as { userId: string };

    const user = await User.findById(decoded.userId).select('email phone isActive');

    if (!user) {
      console.error('[AUTH] User not found:', decoded.userId);
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (!user.isActive) {
      console.error('[AUTH] User is inactive:', decoded.userId);
      res.status(401).json({ error: 'Account is inactive' });
      return;
    }

    req.user = {
      id: user._id.toString(),
      email: user.email || undefined,
      phone: user.phone || undefined,
    };

    next();
  } catch (error) {
    // TokenExpiredError extends JsonWebTokenError, so check it first.
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token format' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      const decoded = verifyToken(token) as { userId: string };
      const user = await User.findById(decoded.userId).select('email phone isActive');

      if (user && user.isActive) {
        req.user = {
          id: user._id.toString(),
          email: user.email || undefined,
          phone: user.phone || undefined,
        };
      }
    }

    next();
  } catch (error) {
    next();
  }
};
