/**
 * Authentication: scrypt password hashing, opaque session tokens, and the
 * `requireAuth` middleware. Tokens are stored hashed-at-rest only by value in
 * the sessions table with a hard expiry.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, now } from './db';

export interface AuthedRequest extends Request {
  user?: { id: string; username: string; role: string };
  sessionToken?: string;
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function createSession(userId: string, userAgent?: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)`
  ).run(token, userId, now(), Date.now() + SESSION_TTL_MS, userAgent ?? null);
  return token;
}

export function destroySession(token: string) {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function userForToken(token: string) {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token) as any;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  return { id: row.id, username: row.username, role: row.role };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const user = userForToken(token);
  if (!user) return res.status(401).json({ error: 'Session expired — please sign in again' });
  req.user = user;
  req.sessionToken = token;
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,18}$/;

export function validatePassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}
