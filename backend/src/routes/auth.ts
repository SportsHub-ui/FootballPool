import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';
import { requireAuth, requirePermission } from '../middleware/auth';
import { deliverEmail } from '../services/notifications';
import {
  canManageOrganization,
  clearSessionCookie,
  consumePasswordResetToken,
  createUserSession,
  findRequestableOrganizations,
  findUserByEmail,
  issuePasswordResetToken,
  loadAuthenticatedUser,
  parseCookieHeader,
  setUserPassword,
  revokeUserSession,
  setSessionCookie,
  SESSION_COOKIE_NAME,
  toAuthContext,
  validatePasswordStrength,
  verifyPassword
} from '../services/authSecurity';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email()
});

const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20).optional(),
    email: z.string().trim().email().optional(),
    password: z.string().min(12),
    confirmPassword: z.string().min(12)
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword']
  })
  .refine((value) => Boolean(value.token || value.email), {
    message: 'A reset token or email address is required.',
    path: ['token']
  });

const requestAccessSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  organizationId: z.number().int().positive(),
  requestNote: z.string().trim().max(500).optional().or(z.literal(''))
});

const accessRequestStatusSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNote: z.string().trim().max(500).optional().or(z.literal(''))
});

export const authRouter = Router();

const includeResetTokenInResponse = process.env.NODE_ENV === 'test' || process.env.APP_ENV !== 'production';

const nextUserId = async (client: PoolClient): Promise<number> => {
  await client.query('LOCK TABLE football_pool.users IN EXCLUSIVE MODE');
  const result = await client.query<{ next_id: number }>(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM football_pool.users`);
  return Number(result.rows[0]?.next_id ?? 1);
};

const buildUserResponse = (auth: ReturnType<typeof toAuthContext>) => ({
  id: Number(auth.userId),
  userId: auth.userId,
  role: auth.role,
  email: auth.email ?? null,
  firstName: auth.firstName ?? null,
  lastName: auth.lastName ?? null,
  isAdmin: auth.isAdmin,
  managedOrganizationIds: auth.managedOrganizationIds,
  accessibleOrganizationIds: auth.accessibleOrganizationIds,
  permissions: auth.permissions
});

const canBypassResetTokenForEmail = (email: string | undefined, user: { password_hash: string | null; active_flg: boolean | null } | null): boolean => {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  return Boolean(
    normalizedEmail &&
    env.PASSWORD_SETUP_BYPASS_EMAILS.includes(normalizedEmail) &&
    user &&
    user.active_flg &&
    !user.password_hash
  );
};

const logPasswordReset = async (email: string, token: string, reason: 'forgot-password' | 'request-access'): Promise<void> => {
  const subject = reason === 'request-access' ? 'FootballPool access request received' : 'FootballPool password reset';
  const messageText = [
    `A ${reason === 'request-access' ? 'new account setup' : 'password reset'} token has been generated for your FootballPool account.`,
    '',
    'Use the Set / Reset Password flow in the app and enter this token when prompted:',
    token,
    '',
    'If you did not request this, you can ignore this email.'
  ].join('\n');

  try {
    await deliverEmail({
      recipientEmail: email,
      subject,
      messageText,
      messageHtml: undefined
    });
  } catch (error) {
    console.warn(`[auth:${reason}] failed to deliver password email to ${email}`, error);
  }

  console.info(`[auth:${reason}] password setup token for ${email}: ${token}`);
};

authRouter.get('/organizations', async (_req, res) => {
  try {
    const organizations = await findRequestableOrganizations(db);
    res.json({ organizations });
  } catch (error) {
    console.error('Organization list error:', error);
    res.status(500).json({ error: 'Failed to load organizations' });
  }
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  try {
    const client = await db.connect();
    try {
      const bootstrapResult = await client.query<{ user_count: string }>(
        `SELECT COUNT(*)::text AS user_count FROM football_pool.users`
      );
      const userCount = Number(bootstrapResult.rows[0]?.user_count ?? 0);

      if (userCount === 0) {
        return res.status(409).json({
          error: 'No users exist yet. Create the first organizer account on the Users page, then set a secure password for that account.'
        });
      }

      const user = await findUserByEmail(client, parsed.data.email);
      if (!user || !user.active_flg) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      if (!user.password_hash) {
        return res.status(403).json({
          error: 'Your account exists, but a password has not been set yet. Use the Set / Reset Password flow to finish setup.'
        });
      }

      const passwordMatches = await verifyPassword(parsed.data.password, user.password_hash);
      if (!passwordMatches) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      await client.query('BEGIN');
      const { rawToken, expiresAt } = await createUserSession(client, Number(user.id), {
        ipAddress: req.ip,
        userAgent: req.header('user-agent') ?? null
      });
      await client.query(`UPDATE football_pool.users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
      await client.query('COMMIT');

      const loadedUser = await loadAuthenticatedUser(client, Number(user.id));
      if (!loadedUser) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Unable to load your account permissions.' });
      }

      const auth = toAuthContext(loadedUser);
      setSessionCookie(res, rawToken);

      res.json({
        message: 'Login successful',
        token: 'session-authenticated',
        session: { expiresAt },
        user: buildUserResponse(auth)
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

authRouter.post('/logout', async (req, res) => {
  const rawToken = parseCookieHeader(req.header('cookie'))[SESSION_COOKIE_NAME];

  try {
    if (rawToken) {
      await revokeUserSession(db, rawToken);
    }
  } catch (error) {
    console.error('Logout error:', error);
  }

  clearSessionCookie(res);
  res.json({ message: 'Signed out' });
});

authRouter.post('/forgot-password', async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  try {
    const client = await db.connect();
    try {
      const user = await findUserByEmail(client, parsed.data.email);

      if (!user || !user.active_flg) {
        res.json({ message: 'If that email exists in the system, password reset instructions have been generated.' });
        return;
      }

      const { rawToken, expiresAt } = await issuePasswordResetToken(client, Number(user.id));
      await logPasswordReset(String(user.email ?? parsed.data.email), rawToken, 'forgot-password');

      res.json({
        message: 'If that email exists in the system, password reset instructions have been generated.',
        ...(includeResetTokenInResponse ? { resetToken: rawToken, expiresAt } : {})
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to start the password reset flow.' });
  }
});

authRouter.post('/reset-password', async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const passwordError = validatePasswordStrength(parsed.data.password);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      let userId: number | null = null;

      if (parsed.data.token) {
        userId = await consumePasswordResetToken(client, parsed.data.token, parsed.data.password);

        if (userId == null) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: 'The password reset token is invalid or has expired.' });
          return;
        }
      } else {
        const user = await findUserByEmail(client, parsed.data.email ?? '');
        const canBypassToken = canBypassResetTokenForEmail(parsed.data.email, user);

        if (!canBypassToken || !user) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: 'A password reset token is required to set or change this password.' });
          return;
        }

        userId = Number(user.id);
        await setUserPassword(client, userId, parsed.data.password);
      }

      const { rawToken, expiresAt } = await createUserSession(client, userId, {
        ipAddress: req.ip,
        userAgent: req.header('user-agent') ?? null
      });

      await client.query(`UPDATE football_pool.users SET last_login_at = NOW() WHERE id = $1`, [userId]);
      await client.query('COMMIT');

      const loadedUser = await loadAuthenticatedUser(client, userId);
      if (!loadedUser) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Unable to load your account permissions.' });
      }

      const auth = toAuthContext(loadedUser);
      setSessionCookie(res, rawToken);

      res.json({
        message: 'Your password has been set successfully.',
        token: 'session-authenticated',
        session: { expiresAt },
        user: buildUserResponse(auth)
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to set the password.' });
  }
});

authRouter.post('/request-access', async (req, res) => {
  const parsed = requestAccessSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  try {
    const client = await db.connect();
    try {
      const organizationResult = await client.query<{ id: number; team_name: string | null }>(
        `SELECT id, team_name FROM football_pool.organization WHERE id = $1 LIMIT 1`,
        [parsed.data.organizationId]
      );

      if ((organizationResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: 'The requested organization was not found.' });
        return;
      }

      await client.query('BEGIN');
      let user = await findUserByEmail(client, parsed.data.email);

      if (!user) {
        const userId = await nextUserId(client);
        const insertResult = await client.query<{
          id: number;
          email: string | null;
          first_name: string | null;
          last_name: string | null;
          password_hash: string | null;
          admin_flg: boolean | null;
          active_flg: boolean | null;
        }>(
          `INSERT INTO football_pool.users (
             id,
             first_name,
             last_name,
             email,
             phone,
             created_at,
             is_player_flg,
             notification_level,
             notify_on_square_lead_flg,
             active_flg
           )
           VALUES ($1, $2, $3, $4, $5, NOW(), FALSE, 'none', FALSE, TRUE)
           RETURNING id, email, first_name, last_name, password_hash, admin_flg, active_flg`,
          [userId, parsed.data.firstName, parsed.data.lastName, parsed.data.email, parsed.data.phone || null]
        );
        user = insertResult.rows[0] ?? null;
      }

      if (!user) {
        throw new Error('Unable to create or load the user account.');
      }

      const existingRequestResult = await client.query<{ id: number; status: string }>(
        `SELECT id, status
         FROM football_pool.organization_access_request
         WHERE organization_id = $1 AND user_id = $2
         LIMIT 1`,
        [parsed.data.organizationId, user.id]
      );

      const existingRequest = existingRequestResult.rows[0];
      if (existingRequest?.status === 'approved') {
        await client.query('COMMIT');
        res.json({ message: 'Access has already been approved for that organization.' });
        return;
      }

      if (existingRequest?.status === 'pending') {
        await client.query('COMMIT');
        res.json({ message: 'Your access request is already pending review.' });
        return;
      }

      await client.query(
        `INSERT INTO football_pool.organization_access_request (
           organization_id,
           user_id,
           status,
           request_note,
           requested_at
         )
         VALUES ($1, $2, 'pending', $3, NOW())
         ON CONFLICT (organization_id, user_id)
         DO UPDATE SET
           status = 'pending',
           request_note = EXCLUDED.request_note,
           requested_at = NOW(),
           reviewed_at = NULL,
           reviewed_by = NULL,
           review_note = NULL`,
        [parsed.data.organizationId, user.id, parsed.data.requestNote || null]
      );

      const { rawToken, expiresAt } = await issuePasswordResetToken(client, Number(user.id));
      await client.query('COMMIT');

      await logPasswordReset(String(user.email ?? parsed.data.email), rawToken, 'request-access');
      res.status(201).json({
        message: 'Your access request has been submitted for review. Use the password setup link to finish creating your credentials.',
        ...(includeResetTokenInResponse ? { resetToken: rawToken, expiresAt } : {})
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Request access error:', error);
    res.status(500).json({ error: 'Failed to submit the access request.' });
  }
});

authRouter.get('/access-requests', requirePermission('canApproveOrgAccess'), async (req, res) => {
  try {
    const auth = req.auth;
    const managedIds = auth?.managedOrganizationIds ?? [];

    const result = await db.query(
      `SELECT r.id,
              r.organization_id,
              o.team_name AS organization_name,
              r.user_id,
              u.first_name,
              u.last_name,
              u.email,
              u.phone,
              r.status,
              r.request_note,
              r.review_note,
              r.requested_at,
              r.reviewed_at,
              reviewer.first_name AS reviewer_first_name,
              reviewer.last_name AS reviewer_last_name
       FROM football_pool.organization_access_request r
       JOIN football_pool.organization o ON o.id = r.organization_id
       JOIN football_pool.users u ON u.id = r.user_id
       LEFT JOIN football_pool.users reviewer ON reviewer.id = r.reviewed_by
       WHERE ($1::boolean = TRUE OR r.organization_id = ANY($2::int[]))
       ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.requested_at DESC`,
      [Boolean(auth?.isAdmin), managedIds]
    );

    res.json({ requests: result.rows });
  } catch (error) {
    console.error('Access request list error:', error);
    res.status(500).json({ error: 'Failed to load organization access requests.' });
  }
});

authRouter.patch('/access-requests/:requestId', requirePermission('canApproveOrgAccess'), async (req, res) => {
  const parsedParams = z.object({ requestId: z.coerce.number().int().positive() }).safeParse(req.params);
  const parsedBody = accessRequestStatusSchema.safeParse(req.body);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues });
    return;
  }

  try {
    const requestLookup = await db.query<{ organization_id: number }>(
      `SELECT organization_id
       FROM football_pool.organization_access_request
       WHERE id = $1
       LIMIT 1`,
      [parsedParams.data.requestId]
    );

    const organizationId = requestLookup.rows[0]?.organization_id != null ? Number(requestLookup.rows[0].organization_id) : null;
    if (organizationId == null) {
      res.status(404).json({ error: 'Access request not found.' });
      return;
    }

    if (!canManageOrganization(req.auth, organizationId)) {
      res.status(403).json({ error: 'You can only review requests for organizations you manage.' });
      return;
    }

    const numericReviewerId = Number(req.auth?.userId ?? NaN);
    let reviewedBy: number | null = null;

    if (Number.isFinite(numericReviewerId) && numericReviewerId > 0) {
      const reviewerLookup = await db.query<{ id: number }>(
        `SELECT id FROM football_pool.users WHERE id = $1 LIMIT 1`,
        [numericReviewerId]
      );
      reviewedBy = (reviewerLookup.rowCount ?? 0) > 0 ? numericReviewerId : null;
    }

    const result = await db.query(
      `UPDATE football_pool.organization_access_request
       SET status = $2,
           review_note = $3,
           reviewed_at = NOW(),
           reviewed_by = $4
       WHERE id = $1
       RETURNING id, organization_id, user_id, status, reviewed_at`,
      [parsedParams.data.requestId, parsedBody.data.status, parsedBody.data.reviewNote || null, reviewedBy]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Access request not found.' });
      return;
    }

    res.json({ message: `Access request ${parsedBody.data.status}.`, request: result.rows[0] });
  } catch (error) {
    console.error('Access request review error:', error);
    res.status(500).json({ error: 'Failed to review the access request.' });
  }
});

// GET /api/auth/verify - Verify current session cookie
authRouter.get('/verify', requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    user: buildUserResponse(req.auth!)
  });
});
