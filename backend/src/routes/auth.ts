import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { generateToken } from '../config/jwt';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const authRouter = Router();

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
          error: 'No users exist yet. Create the first organizer account on the Users page, then sign in with that email and any non-empty password.'
        });
      }

      // In a real app, passwords would be hashed with bcrypt.
      // For now, any non-empty password is accepted and we only verify the email exists.
      const result = await client.query(
        `SELECT id, first_name, last_name, email FROM football_pool.users WHERE email = $1`,
        [parsed.data.email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'No user was found for that email address.' });
      }

      const user = result.rows[0];

      // Generate JWT token with organizer role (can be customized based on user table in future)
      const token = generateToken({
        userId: user.id,
        role: 'organizer',
        email: user.email
      });

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          role: 'organizer'
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/verify - Verify current token
authRouter.get('/verify', (req, res) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'No authentication' });
  }

  res.json({
    authenticated: true,
    user: {
      userId: req.auth.userId,
      role: req.auth.role
    }
  });
});
