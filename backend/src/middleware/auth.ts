import { NextFunction, Request, Response } from 'express';
import { AuthContext, UserRole } from '../types/auth';
import { verifyToken } from '../config/jwt';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const parseRole = (value: string | undefined): UserRole => {
  if (value === 'organizer' || value === 'participant' || value === 'player') {
    return value;
  }

  return 'participant';
};

export const mockAuth = (req: Request, _res: Response, next: NextFunction): void => {
  // Try JWT token first
  const authHeader = req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      req.auth = {
        userId: String(payload.userId),
        role: payload.role
      };
      return next();
    }
  }

  // Fall back to mock auth for development
  req.auth = {
    userId: req.header('x-user-id') ?? 'dev-user',
    role: parseRole(req.header('x-user-role') ?? undefined)
  };

  next();
};

export const requireRole =
  (...allowedRoles: UserRole[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.role;

    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
