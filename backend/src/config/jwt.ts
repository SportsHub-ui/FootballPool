import jwt from 'jsonwebtoken';
import { env } from './env';

export interface JWTPayload {
  userId: number;
  role: 'organizer' | 'participant' | 'player';
  email: string;
}

const SECRET = env.JWT_SECRET || 'dev-secret-key-change-in-production';

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload | null;
    return decoded;
  } catch (error) {
    return null;
  }
}
