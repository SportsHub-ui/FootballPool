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

  // Fall back to header-based mock auth for development when headers are present.
  const mockUserId = req.header('x-user-id');
  const mockRole = req.header('x-user-role');

  if (mockUserId || mockRole) {
    req.auth = {
      userId: mockUserId ?? 'dev-user',
      role: parseRole(mockRole ?? undefined)
    };
  } else {
    req.auth = undefined;
  }

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
