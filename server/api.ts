/** REST API — auth, profiles, leaderboards, social, store, tournaments, admin. */
import express, { type Request, type Response, type NextFunction } from 'express';
import {
  AuthedRequest,
  createSession,
  destroySession,
  requireAdmin,
  requireAuth,
  userForToken,
  verifyPassword,
  validatePassword,
  EMAIL_RE,
  USERNAME_RE,
} from './auth';
import {
  blockUser,
  blockedIds,
  buyItem,
  changePassword,
  claimChallenge,
  claimDaily,
  createUser,
  friendsOf,
  getMatchHistory,
  getProfile,
  getUserByEmail,
  getUserById,
  getUserByUsername,
  leaderboard,
  markNotificationsRead,
  notificationsFor,
  pendingRequests,
  publicUser,
  recentOpponents,
  removeFriend,
  reportUser,
  respondFriendRequest,
  searchPlayers,
  sendFriendRequest,
  STORE_ITEMS,
  touchUser,
  unblockUser,
  updateProfileFields,
  updateSettings,
} from './store';
import {
  createTournament,
  getTournament,
  joinTournament,
  listTournaments,
  startTournament,
  tournamentLeaderboard,
} from './tournaments';
import { db, now } from './db';
import { leaderboard as t_leaderboard } from './store';

// ---------------------------------------------------------------------------
// Abuse protection: simple in-memory sliding window per IP + route bucket
// ---------------------------------------------------------------------------
const buckets = new Map<string, number[]>();
export function rateLimit(bucket: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${bucket}:${req.ip}`;
    const t = Date.now();
    const arr = (buckets.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) {
      return res.status(429).json({ error: 'Too many requests — slow down' });
    }
    arr.push(t);
    buckets.set(key, arr);
    next();
  };
}

const wrap = (fn: (req: AuthedRequest, res: Response) => any) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req as AuthedRequest, res);
  } catch (err: any) {
    console.error('[api]', err);
    if (!res.headersSent) res.status(500).json({ error: err?.message ?? 'Server error' });
  }
};

export function buildApi(sockets: {
  isOnline: (id: string) => boolean;
  emitToUser: (id: string, ev: string, payload: any) => void;
}) {
  const api = express.Router();

  // ---------------------------------------------------------------- health
  api.get('/health', (_req, res) => res.json({ ok: true, at: now(), uptime: process.uptime() }));

  // ------------------------------------------------------------------ auth
  api.post(
    '/auth/register',
    rateLimit('register', 10, 60_000),
    wrap(async (req, res) => {
      const { email, password, username, country, avatar } = req.body ?? {};
      if (!EMAIL_RE.test(String(email ?? ''))) return res.status(400).json({ error: 'Enter a valid email address' });
      const pwErr = validatePassword(password);
      if (pwErr) return res.status(400).json({ error: pwErr });
      if (!USERNAME_RE.test(String(username ?? '')))
        return res.status(400).json({ error: 'Username: 3–18 letters, numbers, _ . -' });
      if (getUserByEmail(email)) return res.status(409).json({ error: 'That email is already registered' });
      if (getUserByUsername(username)) return res.status(409).json({ error: 'That username is taken' });
      const user = createUser({ email, username, password, country, avatar });
      const token = createSession(user.id, req.headers['user-agent']);
      // dev mode: verification link is returned directly so it can be tested
      const verifyToken = getUserById(user.id).verification_token;
      res.status(201).json({
        token,
        user: publicUser(user),
        verification: {
          required: process.env.REQUIRE_EMAIL_VERIFICATION === '1',
          link: `/verify?token=${verifyToken}`,
          devToken: process.env.NODE_ENV === 'production' ? undefined : verifyToken,
        },
      });
    })
  );

  api.post(
    '/auth/login',
    rateLimit('login', 20, 60_000),
    wrap(async (req, res) => {
      const { email, password } = req.body ?? {};
      const user = getUserByEmail(String(email ?? ''));
      if (!user || !verifyPassword(String(password ?? ''), user.password_hash))
        return res.status(401).json({ error: 'Incorrect email or password' });
      if (user.banned) return res.status(403).json({ error: `Account suspended: ${user.ban_reason ?? 'policy violation'}` });
      touchUser(user.id);
      const token = createSession(user.id, req.headers['user-agent']);
      res.json({ token, user: publicUser(user) });
    })
  );

  api.post('/auth/logout', requireAuth, wrap(async (req, res) => {
    if (req.sessionToken) destroySession(req.sessionToken);
    res.json({ ok: true });
  }));

  api.get('/auth/me', (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const u = token ? userForToken(token) : null;
    if (!u) return res.status(401).json({ error: 'Not signed in' });
    res.json({ user: publicUser(getUserById(u.id)) });
  });

  api.get('/auth/verify', wrap(async (req, res) => {
    const token = String(req.query.token ?? '');
    const user = db.prepare(`SELECT * FROM users WHERE verification_token=?`).get(token) as any;
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification link' });
    db.prepare(`UPDATE users SET email_verified=1, verification_token=NULL WHERE id=?`).run(user.id);
    res.json({ ok: true, username: user.username });
  }));

  api.post('/auth/resend-verification', requireAuth, wrap(async (req, res) => {
    const user = getUserById(req.user!.id);
    if (user.email_verified) return res.json({ ok: true, already: true });
    res.json({ ok: true, devToken: process.env.NODE_ENV === 'production' ? undefined : user.verification_token });
  }));

  api.post('/auth/forgot-password', rateLimit('forgot', 8, 60_000), wrap(async (req, res) => {
    const user = getUserByEmail(String(req.body?.email ?? ''));
    if (!user) return res.json({ ok: true }); // don't leak account existence
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    db.prepare(`UPDATE users SET reset_token=?, reset_expires=? WHERE id=?`).run(token, Date.now() + 3600_000, user.id);
    res.json({
      ok: true,
      message: 'If that email exists, a reset link has been sent.',
      devToken: process.env.NODE_ENV === 'production' ? undefined : token,
    });
  }));

  api.post('/auth/reset-password', wrap(async (req, res) => {
    const { token, password } = req.body ?? {};
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const user = db.prepare(`SELECT * FROM users WHERE reset_token=?`).get(String(token ?? '')) as any;
    if (!user || user.reset_expires < Date.now()) return res.status(400).json({ error: 'Reset link is invalid or expired' });
    const { hashPassword } = await import('./auth');
    db.prepare(`UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL WHERE id=?`).run(
      hashPassword(password),
      user.id
    );
    db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(user.id);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- profile
  api.get('/profile/me', requireAuth, wrap(async (req, res) => {
    res.json(getProfile(req.user!.id));
  }));

  api.get('/profile/:username', wrap(async (req, res) => {
    const u = getUserByUsername(String(req.params.username));
    if (!u) return res.status(404).json({ error: 'Player not found' });
    const p: any = getProfile(u.id);
    // never leak private account fields; competitive history is public
    delete p.settings;
    delete p.challenges; // daily challenges are private
    res.json(p);
  }));

  api.get('/players/search', requireAuth, wrap(async (req, res) => {
    res.json(searchPlayers(String(req.query.q ?? ''), req.user!.id));
  }));

  api.patch('/profile', requireAuth, wrap(async (req, res) => {
    updateProfileFields(req.user!.id, req.body ?? {});
    res.json(getProfile(req.user!.id));
  }));

  api.put('/settings', requireAuth, wrap(async (req, res) => {
    res.json({ settings: updateSettings(req.user!.id, req.body ?? {}) });
  }));

  api.post('/account/password', requireAuth, wrap(async (req, res) => {
    const { current, next } = req.body ?? {};
    const pwErr = validatePassword(next);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const r = changePassword(req.user!.id, current, next);
    res.status(r.ok ? 200 : 400).json(r);
  }));

  // ------------------------------------------------------------- leaderboard
  api.get('/leaderboard', wrap(async (req, res) => {
    const scope = String(req.query.scope ?? 'global') as any;
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const me = token ? userForToken(token) : null;
    const country = String(req.query.country ?? (me ? getUserById(me.id)?.country : 'BD'));
    res.json(leaderboard(scope, me?.id, country));
  }));

  api.get('/leaderboard/tournaments', wrap(async (_req, res) => {
    res.json(tournamentLeaderboard());
  }));

  api.get('/matches/history', requireAuth, wrap(async (req, res) => {
    res.json(getMatchHistory(req.user!.id, 50));
  }));

  // ----------------------------------------------------------------- social
  api.get('/friends', requireAuth, wrap(async (req, res) => {
    const list = friendsOf(req.user!.id).map((f) => ({ ...f, online: sockets.isOnline(f.id) }));
    res.json({ friends: list, requests: pendingRequests(req.user!.id), recent: recentOpponents(req.user!.id) });
  }));

  api.post('/friends/request', requireAuth, rateLimit('friend', 20, 60_000), wrap(async (req, res) => {
    const r = sendFriendRequest(req.user!.id, String(req.body?.username ?? ''));
    res.status(r.ok ? 200 : 400).json(r);
  }));

  api.post('/friends/respond', requireAuth, wrap(async (req, res) => {
    const r = respondFriendRequest(req.user!.id, Number(req.body?.requestId), !!req.body?.accept);
    res.status(r.ok ? 200 : 400).json(r);
  }));

  api.delete('/friends/:id', requireAuth, wrap(async (req, res) => {
    res.json(removeFriend(req.user!.id, String(req.params.id)));
  }));

  api.post('/users/:id/block', requireAuth, wrap(async (req, res) => {
    res.json(blockUser(req.user!.id, String(req.params.id)));
  }));
  api.post('/users/:id/unblock', requireAuth, wrap(async (req, res) => {
    res.json(unblockUser(req.user!.id, String(req.params.id)));
  }));
  api.get('/users/blocked', requireAuth, wrap(async (req, res) => {
    res.json(blockedIds(req.user!.id));
  }));

  api.post('/users/:id/report', requireAuth, rateLimit('report', 10, 60_000), wrap(async (req, res) => {
    const reasons = ['cheating', 'abuse', 'collusion', 'inappropriate_name', 'other'];
    if (!reasons.includes(req.body?.reason)) return res.status(400).json({ error: 'Invalid reason' });
    res.json(reportUser(req.user!.id, String(req.params.id), req.body.reason, String(req.body?.details ?? ''), req.body?.matchId));
  }));

  api.get('/notifications', requireAuth, wrap(async (req, res) => {
    res.json(notificationsFor(req.user!.id));
  }));
  api.post('/notifications/read', requireAuth, wrap(async (req, res) => {
    res.json(markNotificationsRead(req.user!.id));
  }));

  // ------------------------------------------------------------ rewards
  api.post('/rewards/daily', requireAuth, wrap(async (req, res) => {
    const r = claimDaily(req.user!.id);
    res.status(r.ok ? 200 : 400).json(r);
  }));

  api.post('/rewards/challenge', requireAuth, wrap(async (req, res) => {
    const r = claimChallenge(req.user!.id, String(req.body?.id ?? ''));
    res.status(r.ok ? 200 : 400).json(r);
  }));

  // --------------------------------------------------------------- store
  api.get('/store', requireAuth, wrap(async (req, res) => {
    const me = getUserById(req.user!.id);
    const p = db.prepare(`SELECT * FROM player_profiles WHERE user_id=?`).get(req.user!.id) as any;
    res.json({
      items: STORE_ITEMS,
      coins: p.coins,
      equipped: {
        table_skin: p.table_skin,
        ball_skin: p.ball_skin,
        uniform: p.uniform,
        frame: p.frame,
        celebration: p.celebration,
      },
      owned: (await import('./store')).ownedItems(req.user!.id),
    });
  }));

  api.post('/store/buy', requireAuth, rateLimit('store', 30, 60_000), wrap(async (req, res) => {
    const r = buyItem(req.user!.id, String(req.body?.itemId ?? ''));
    res.status(r.ok ? 200 : 400).json(r);
  }));

  api.post('/store/equip', requireAuth, wrap(async (req, res) => {
    const { equipItem } = await import('./store');
    const r = equipItem(req.user!.id, String(req.body?.itemId ?? ''));
    res.status(r.ok ? 200 : 400).json(r);
  }));

  // --------------------------------------------------------- tournaments
  api.get('/tournaments', wrap(async (_req, res) => res.json(listTournaments())));
  api.get('/tournaments/:id', wrap(async (req, res) => {
    const t = getTournament(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    res.json(t);
  }));
  api.post('/tournaments', requireAuth, rateLimit('tourney', 10, 60_000), wrap(async (req, res) => {
    const r = createTournament(req.user!.id, String(req.body?.name ?? ''), req.body?.format, Number(req.body?.maxTeams ?? 8));
    res.status(r.ok ? 201 : 400).json(r);
  }));
  api.post('/tournaments/:id/join', requireAuth, wrap(async (req, res) => {
    const r = joinTournament(req.user!.id, String(req.params.id), String(req.body?.teamName ?? ''));
    res.status(r.ok ? 200 : 400).json(r);
  }));
  api.post('/tournaments/:id/start', requireAuth, wrap(async (req, res) => {
    const r = startTournament(req.user!.id, String(req.params.id));
    res.status(r.ok ? 200 : 400).json(r);
  }));

  // ----------------------------------------------------------------- admin
  api.get('/admin/overview', requireAuth, requireAdmin, wrap(async (_req, res) => {
    res.json({
      users: (db.prepare(`SELECT COUNT(*) c FROM users`).get() as any).c,
      matches: (db.prepare(`SELECT COUNT(*) c FROM matches`).get() as any).c,
      liveMatches: (db.prepare(`SELECT COUNT(*) c FROM matches WHERE status='waiting'`).get() as any).c,
      bannedUsers: (db.prepare(`SELECT COUNT(*) c FROM users WHERE banned=1`).get() as any).c,
      reports: db.prepare(`SELECT r.*, u.username AS target FROM reports r JOIN users u ON u.id=r.target_id WHERE status='open'`).all(),
      suspicious: db.prepare(`SELECT * FROM audit_log WHERE action LIKE 'anticheat%' ORDER BY id DESC LIMIT 20`).all(),
      audit: db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 40`).all(),
      economy: db.prepare(`SELECT SUM(coins) coins FROM player_profiles`).get(),
    });
  }));

  api.get('/admin/users', requireAuth, requireAdmin, wrap(async (_req, res) => {
    const rows = db.prepare(`
      SELECT u.id, u.email, u.username, u.avatar, u.country, u.role, u.banned, u.ban_reason, u.created_at,
             pr.rating, pr.highest_rating, pp.level, pp.coins, pp.xp
      FROM users u
      LEFT JOIN player_ratings pr ON pr.user_id = u.id
      LEFT JOIN player_profiles pp ON pp.user_id = u.id
      ORDER BY u.created_at DESC
    `).all() as any[];

    const users = rows.map((r) => {
      const rating = r.rating ?? START_RATING;
      const isAdmin =
        r.role === 'admin' ||
        r.email?.toLowerCase() === 'rashedcse18@gmail.com' ||
        r.email?.toLowerCase() === 'admin@arena.dev';
      return {
        id: r.id,
        email: r.email,
        username: r.username,
        avatar: r.avatar,
        country: r.country,
        rating,
        tier: tierFor(rating).tier,
        level: r.level ?? 1,
        xp: r.xp ?? 0,
        coins: r.coins ?? 0,
        role: isAdmin ? 'admin' : 'player',
        banned: !!r.banned,
        banReason: r.ban_reason,
        createdAt: r.created_at,
      };
    });

    res.json({ users });
  }));

  api.post('/admin/ban', requireAuth, requireAdmin, wrap(async (req, res) => {
    const { userId, ban, reason } = req.body ?? {};
    db.prepare(`UPDATE users SET banned=?, ban_reason=? WHERE id=?`).run(ban ? 1 : 0, reason ?? null, userId);
    db.prepare(`INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`).run(
      req.user!.id,
      ban ? 'admin.ban' : 'admin.unban',
      userId,
      JSON.stringify({ reason }),
      now()
    );
    if (ban) db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(userId);
    res.json({ ok: true });
  }));

  api.post('/admin/user/role', requireAuth, requireAdmin, wrap(async (req, res) => {
    const { userId, role } = req.body ?? {};
    if (!['admin', 'player'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    db.prepare(`UPDATE users SET role=? WHERE id=?`).run(role, userId);
    db.prepare(`INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`).run(
      req.user!.id,
      'admin.set_role',
      userId,
      JSON.stringify({ role }),
      now()
    );
    res.json({ ok: true });
  }));

  api.post('/admin/user/adjust', requireAuth, requireAdmin, wrap(async (req, res) => {
    const { userId, deltaCoins, deltaRating } = req.body ?? {};
    if (typeof deltaCoins === 'number' && deltaCoins !== 0) {
      db.prepare(`UPDATE player_profiles SET coins = MAX(0, coins + ?) WHERE user_id = ?`).run(deltaCoins, userId);
    }
    if (typeof deltaRating === 'number' && deltaRating !== 0) {
      db.prepare(`UPDATE player_ratings SET rating = MAX(100, rating + ?) WHERE user_id = ?`).run(deltaRating, userId);
    }
    db.prepare(`INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`).run(
      req.user!.id,
      'admin.adjust_user',
      userId,
      JSON.stringify({ deltaCoins, deltaRating }),
      now()
    );
    res.json({ ok: true });
  }));

  api.post('/admin/user/delete', requireAuth, requireAdmin, wrap(async (req, res) => {
    const { userId } = req.body ?? {};
    if (!userId || userId === req.user!.id) return res.status(400).json({ error: 'Cannot delete current account' });
    db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(userId);
    db.prepare(`DELETE FROM player_profiles WHERE user_id=?`).run(userId);
    db.prepare(`DELETE FROM player_ratings WHERE user_id=?`).run(userId);
    db.prepare(`DELETE FROM users WHERE id=?`).run(userId);
    db.prepare(`INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`).run(
      req.user!.id,
      'admin.delete_user',
      userId,
      JSON.stringify({}),
      now()
    );
    res.json({ ok: true });
  }));

  api.post('/admin/reports/:id/resolve', requireAuth, requireAdmin, wrap(async (req, res) => {
    db.prepare(`UPDATE reports SET status=? WHERE id=?`).run(req.body?.status === 'dismiss' ? 'dismissed' : 'resolved', String(req.params.id));
    res.json({ ok: true });
  }));

  return api;
}

export { t_leaderboard };
