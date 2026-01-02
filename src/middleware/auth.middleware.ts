import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';

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
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error('[AUTH] JWT_SECRET not configured');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const decoded = jwt.verify(token, secret) as { userId: string };
    console.log('[AUTH] Decoded token:', { userId: decoded.userId });

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
    console.error('[AUTH] Token verification error:', error);
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token format' });
    } else if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const secret = process.env.JWT_SECRET;

      if (secret) {
        const decoded = jwt.verify(token, secret) as { userId: string };
        const user = await User.findById(decoded.userId).select('email phone isActive');

        if (user && user.isActive) {
          req.user = {
            id: user._id.toString(),
            email: user.email || undefined,
            phone: user.phone || undefined,
          };
        }
      }
    }

    next();
  } catch (error) {
    next();
  }
};
