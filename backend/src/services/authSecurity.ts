import crypto from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import type { PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import type { AuthContext, AuthPermissions, UserRole } from '../types/auth';
import { env } from '../config/env';

// Chosen auth model: secure server-side session cookies.
// This fits the app's dynamic org-manager permissions better than long-lived JWTs because
// revocation and role/contact changes take effect immediately on the next request.

export const SESSION_COOKIE_NAME = 'fp_session';
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;
const PASSWORD_HASH_ROUNDS = 12;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const toNumericArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .sort((left, right) => left - right);
};

const mergeUniqueIds = (...collections: number[][]): number[] => Array.from(new Set(collections.flat())).sort((a, b) => a - b);

const buildPermissions = (params: { isAdmin: boolean; managedOrganizationIds: number[]; accessibleOrganizationIds: number[] }): AuthPermissions => {
  const canManageScopedResources = params.isAdmin || params.managedOrganizationIds.length > 0;
  const canViewScopedResources = params.isAdmin || params.accessibleOrganizationIds.length > 0;

  return {
    canManageOrganizations: canManageScopedResources,
    canManageMembers: canManageScopedResources,
    canManagePools: canManageScopedResources,
    canManageNotifications: canManageScopedResources,
    canManageMarketing: params.isAdmin,
    canManageUsers: canManageScopedResources,
    canApproveOrgAccess: canManageScopedResources,
    canRunSimulation: params.isAdmin,
    canViewMetrics: canViewScopedResources
  };
};

const deriveRole = (params: { isAdmin: boolean; managedOrganizationIds: number[]; isPlayer: boolean }): UserRole => {
  if (params.isAdmin || params.managedOrganizationIds.length > 0) {
    return 'organizer';
  }

  return params.isPlayer ? 'player' : 'participant';
};

export const validatePasswordStrength = (password: string): string | null => {
  if (password.length < 12) {
    return 'Password must be at least 12 characters long.';
  }

  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter.';
  }

  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter.';
  }

  if (!/\d/.test(password)) {
    return 'Password must include at least one number.';
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include at least one special character.';
  }

  return null;
};

export const hashPassword = async (password: string): Promise<string> => bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
export const verifyPassword = async (password: string, passwordHash: string): Promise<boolean> => bcrypt.compare(password, passwordHash);

export const hashOpaqueToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
export const generateOpaqueToken = (size = 32): string => crypto.randomBytes(size).toString('hex');

export const getSessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.APP_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL_MS
});

export const setSessionCookie = (res: Response, rawToken: string): void => {
  res.cookie(SESSION_COOKIE_NAME, rawToken, getSessionCookieOptions());
};

export const clearSessionCookie = (res: Response): void => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    ...getSessionCookieOptions(),
    maxAge: undefined,
    expires: new Date(0)
  });
};

export const parseCookieHeader = (cookieHeader?: string | null): Record<string, string> => {
  const entries = String(cookieHeader ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const cookies: Record<string, string> = {};
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
};

export interface AuthenticatedUserRecord {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  isAdmin: boolean;
  role: UserRole;
  isPlayer: boolean;
  managedOrganizationIds: number[];
  accessibleOrganizationIds: number[];
  permissions: AuthPermissions;
}

export const loadAuthenticatedUser = async (
  client: Pick<PoolClient, 'query'>,
  userId: number
): Promise<AuthenticatedUserRecord | null> => {
  const result = await client.query<{
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    admin_flg: boolean | null;
    is_player_flg: boolean | null;
    managed_organization_ids: unknown;
    approved_organization_ids: unknown;
  }>(
    `SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        COALESCE(u.admin_flg, FALSE) AS admin_flg,
        COALESCE(u.is_player_flg, FALSE) AS is_player_flg,
        COALESCE(manager_orgs.managed_organization_ids, ARRAY[]::int[]) AS managed_organization_ids,
        COALESCE(approved_orgs.approved_organization_ids, ARRAY[]::int[]) AS approved_organization_ids
     FROM football_pool.users u
     LEFT JOIN LATERAL (
       SELECT ARRAY_AGG(DISTINCT o.id ORDER BY o.id) AS managed_organization_ids
       FROM football_pool.organization o
       WHERE o.primary_contact_id = u.id
          OR o.secondary_contact_id = u.id
     ) manager_orgs ON TRUE
     LEFT JOIN LATERAL (
       SELECT ARRAY_AGG(DISTINCT r.organization_id ORDER BY r.organization_id) AS approved_organization_ids
       FROM football_pool.organization_access_request r
       WHERE r.user_id = u.id
         AND r.status = 'approved'
     ) approved_orgs ON TRUE
     WHERE u.id = $1
       AND COALESCE(u.active_flg, TRUE) = TRUE
     LIMIT 1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const managedOrganizationIds = toNumericArray(row.managed_organization_ids);
  const accessibleOrganizationIds = mergeUniqueIds(managedOrganizationIds, toNumericArray(row.approved_organization_ids));
  const isAdmin = Boolean(row.admin_flg);
  const isPlayer = Boolean(row.is_player_flg);

  return {
    id: Number(row.id),
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    email: row.email ?? null,
    isAdmin,
    role: deriveRole({ isAdmin, managedOrganizationIds, isPlayer }),
    isPlayer,
    managedOrganizationIds,
    accessibleOrganizationIds,
    permissions: buildPermissions({ isAdmin, managedOrganizationIds, accessibleOrganizationIds })
  };
};

export const toAuthContext = (user: AuthenticatedUserRecord): AuthContext => ({
  userId: String(user.id),
  role: user.role,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  isAdmin: user.isAdmin,
  managedOrganizationIds: user.managedOrganizationIds,
  accessibleOrganizationIds: user.accessibleOrganizationIds,
  permissions: user.permissions
});

export const createUserSession = async (
  client: Pick<PoolClient, 'query'>,
  userId: number,
  details?: { ipAddress?: string | null; userAgent?: string | null }
): Promise<{ rawToken: string; expiresAt: Date }> => {
  const sessionId = crypto.randomUUID().replace(/-/g, '');
  const rawToken = `${sessionId}.${generateOpaqueToken(32)}`;
  const tokenHash = hashOpaqueToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await client.query(
    `INSERT INTO football_pool.user_session (
       session_id,
       user_id,
       session_token_hash,
       expires_at,
       created_at,
       last_seen_at,
       ip_address,
       user_agent
     )
     VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6)`,
    [sessionId, userId, tokenHash, expiresAt, details?.ipAddress ?? null, details?.userAgent ?? null]
  );

  return { rawToken, expiresAt };
};

export const revokeUserSession = async (client: Pick<PoolClient, 'query'>, rawToken: string): Promise<void> => {
  await client.query(
    `UPDATE football_pool.user_session
     SET revoked_at = NOW()
     WHERE session_token_hash = $1
       AND revoked_at IS NULL`,
    [hashOpaqueToken(rawToken)]
  );
};

export const authenticateSession = async (
  client: Pick<PoolClient, 'query'>,
  rawToken: string
): Promise<AuthContext | null> => {
  const sessionResult = await client.query<{ user_id: number }>(
    `SELECT user_id
     FROM football_pool.user_session
     WHERE session_token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [hashOpaqueToken(rawToken)]
  );

  const session = sessionResult.rows[0];
  if (!session) {
    return null;
  }

  await client.query(
    `UPDATE football_pool.user_session
     SET last_seen_at = NOW()
     WHERE session_token_hash = $1`,
    [hashOpaqueToken(rawToken)]
  );

  const user = await loadAuthenticatedUser(client, Number(session.user_id));
  return user ? toAuthContext(user) : null;
};

export const issuePasswordResetToken = async (
  client: Pick<PoolClient, 'query'>,
  userId: number
): Promise<{ rawToken: string; expiresAt: Date }> => {
  const rawToken = generateOpaqueToken(24);
  const tokenHash = hashOpaqueToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await client.query(
    `UPDATE football_pool.users
     SET password_reset_token_hash = $2,
         password_reset_expires_at = $3,
         password_reset_requested_at = NOW()
     WHERE id = $1`,
    [userId, tokenHash, expiresAt]
  );

  return { rawToken, expiresAt };
};

export const findUserByEmail = async (
  client: Pick<PoolClient, 'query'>,
  email: string
): Promise<{
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  password_hash: string | null;
  admin_flg: boolean | null;
  active_flg: boolean | null;
} | null> => {
  const result = await client.query<{
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    password_hash: string | null;
    admin_flg: boolean | null;
    active_flg: boolean | null;
  }>(
    `SELECT id, first_name, last_name, email, password_hash, admin_flg, active_flg
     FROM football_pool.users
     WHERE LOWER(COALESCE(email, '')) = $1
     LIMIT 1`,
    [normalizeEmail(email)]
  );

  return result.rows[0] ?? null;
};

export const setUserPassword = async (
  client: Pick<PoolClient, 'query'>,
  userId: number,
  password: string
): Promise<void> => {
  const passwordHash = await hashPassword(password);

  await client.query(
    `UPDATE football_pool.users
     SET password_hash = $2,
         password_set_at = NOW(),
         password_reset_token_hash = NULL,
         password_reset_expires_at = NULL,
         password_reset_requested_at = NULL
     WHERE id = $1`,
    [userId, passwordHash]
  );
};

export const consumePasswordResetToken = async (
  client: Pick<PoolClient, 'query'>,
  resetToken: string,
  newPassword: string
): Promise<number | null> => {
  const tokenHash = hashOpaqueToken(resetToken);
  const result = await client.query<{ id: number }>(
    `SELECT id
     FROM football_pool.users
     WHERE password_reset_token_hash = $1
       AND password_reset_expires_at IS NOT NULL
       AND password_reset_expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  const userId = result.rows[0]?.id != null ? Number(result.rows[0].id) : null;
  if (userId == null) {
    return null;
  }

  await setUserPassword(client, userId, newPassword);
  return userId;
};

export const canManageOrganization = (auth: AuthContext | undefined, organizationId: number | null | undefined): boolean => {
  if (!auth || organizationId == null) {
    return false;
  }

  return auth.isAdmin || auth.managedOrganizationIds.includes(Number(organizationId));
};

export const canAccessOrganization = (auth: AuthContext | undefined, organizationId: number | null | undefined): boolean => {
  if (!auth || organizationId == null) {
    return false;
  }

  return auth.isAdmin || auth.accessibleOrganizationIds.includes(Number(organizationId));
};

export const loadPoolOrganizationId = async (
  client: Pick<PoolClient, 'query'>,
  poolId: number
): Promise<number | null> => {
  const result = await client.query<{ team_id: number | null }>(
    `SELECT team_id
     FROM football_pool.pool
     WHERE id = $1
     LIMIT 1`,
    [poolId]
  );

  return result.rows[0]?.team_id != null ? Number(result.rows[0].team_id) : null;
};

export const canManagePool = async (
  client: Pick<PoolClient, 'query'>,
  auth: AuthContext | undefined,
  poolId: number
): Promise<boolean> => {
  if (!auth) {
    return false;
  }

  if (auth.isAdmin) {
    return true;
  }

  const organizationId = await loadPoolOrganizationId(client, poolId);
  return canManageOrganization(auth, organizationId);
};

export const findRequestableOrganizations = async (
  client: Pick<PoolClient, 'query'>
): Promise<Array<{ id: number; team_name: string | null }>> => {
  const result = await client.query<{ id: number; team_name: string | null }>(
    `SELECT id, team_name
     FROM football_pool.organization
     ORDER BY team_name NULLS LAST, id`
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    team_name: row.team_name ?? null
  }));
};
