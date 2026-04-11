import { NextFunction, Request, Response } from 'express';
import { db } from '../config/db';
import { env } from '../config/env';
import { verifyToken } from '../config/jwt';
import { authenticateSession, loadAuthenticatedUser, parseCookieHeader, SESSION_COOKIE_NAME, toAuthContext } from '../services/authSecurity';
import type { AuthContext, AuthPermissions, UserRole } from '../types/auth';

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

const buildFallbackPermissions = (role: UserRole): AuthPermissions => {
  const isOrganizer = role === 'organizer';

  return {
    canManageOrganizations: isOrganizer,
    canManageMembers: isOrganizer,
    canManagePools: isOrganizer,
    canManageNotifications: isOrganizer,
    canManageMarketing: isOrganizer,
    canManageUsers: isOrganizer,
    canApproveOrgAccess: isOrganizer,
    canRunSimulation: isOrganizer,
    canViewMetrics: isOrganizer
  };
};

export const buildMockAuthContext = (userId: string, role: UserRole, email?: string | null): AuthContext => ({
  userId,
  role,
  email: email ?? null,
  firstName: null,
  lastName: null,
  isAdmin: role === 'organizer',
  managedOrganizationIds: [],
  accessibleOrganizationIds: [],
  permissions: buildFallbackPermissions(role)
});

export const mockAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const cookies = parseCookieHeader(req.header('cookie'));
    const sessionToken = cookies[SESSION_COOKIE_NAME];

    if (sessionToken) {
      const auth = await authenticateSession(db, sessionToken);
      if (auth) {
        req.auth = auth;
        next();
        return;
      }
    }

    const authHeader = req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);

      if (payload) {
        const loadedUser = await loadAuthenticatedUser(db, Number(payload.userId));
        req.auth = loadedUser
          ? toAuthContext(loadedUser)
          : buildMockAuthContext(String(payload.userId), parseRole(payload.role), payload.email ?? null);
        next();
        return;
      }
    }

    const mockUserId = req.header('x-user-id');
    const mockRole = req.header('x-user-role');

    if ((mockUserId || mockRole) && env.APP_ENV !== 'production') {
      req.auth = buildMockAuthContext(mockUserId ?? 'dev-user', parseRole(mockRole ?? undefined));
    } else {
      req.auth = undefined;
    }

    next();
  } catch (error) {
    console.error('Authentication middleware failed:', error);
    req.auth = undefined;
    next();
  }
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.auth?.userId) {
    res.status(401).json({ error: 'Sign in is required.' });
    return;
  }

  next();
};

export const requireRole =
  (...allowedRoles: UserRole[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth?.role) {
      res.status(401).json({ error: 'Sign in is required.' });
      return;
    }

    if (req.auth.isAdmin || allowedRoles.includes(req.auth.role)) {
      next();
      return;
    }

    res.status(403).json({ error: 'Forbidden' });
  };

export const requirePermission =
  (permission: keyof AuthPermissions) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth?.userId) {
      res.status(401).json({ error: 'Sign in is required.' });
      return;
    }

    if (req.auth.isAdmin || req.auth.permissions?.[permission]) {
      next();
      return;
    }

    res.status(403).json({ error: 'Forbidden' });
  };
