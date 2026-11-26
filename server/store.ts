/**
 * Domain services — users, profiles, match settlement, achievements,
 * leaderboards, social graph, wallet. All SQL is centralised here.
 */
import { db, now, uid } from './db';
import { hashPassword } from './auth';
import {
  START_RATING,
  calculateTeamRating,
  coinsForMatch,
  levelFromXp,
  tierFor,
  xpForMatch,
  DAILY_LOGIN_REWARDS,
  DAILY_CHALLENGES,
} from '../shared/rating';

const today = () => new Date().toISOString().slice(0, 10);
const isoWeek = () => {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
};
const monthKey = () => new Date().toISOString().slice(0, 7);

export const PERIODS = { daily: today, weekly: isoWeek, monthly: monthKey };

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface NewUserInput {
  email: string;
  username: string;
  password: string;
  country?: string;
  avatar?: string;
  role?: string;
}

export function createUser(input: NewUserInput) {
  const id = uid('u_');
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, username, password_hash, avatar, country, role, email_verified, verification_token, created_at, last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      input.email.toLowerCase(),
      input.username,
      hashPassword(input.password),
      input.avatar ?? '⚽',
      (input.country ?? 'BD').toUpperCase().slice(0, 2),
      input.role ??
        (input.email.toLowerCase() === 'rashedcse18@gmail.com' ||
        input.email.toLowerCase() === 'admin@arena.dev'
          ? 'admin'
          : 'player'),
      0,
      uid('v_'),
      now(),
      now()
    );
    db.prepare(`INSERT INTO player_profiles (user_id) VALUES (?)`).run(id);
    db.prepare(`INSERT INTO player_ratings (user_id, rating, highest_rating) VALUES (?,?,?)`).run(
      id,
      START_RATING,
      START_RATING
    );
    db.prepare(
      `INSERT INTO wallet_transactions (user_id, amount, kind, ref, balance_after, created_at) VALUES (?,?,?,?,?,?)`
    ).run(id, 250, 'signup_bonus', null, 250, now());
  });
  tx();
  return getUserById(id);
}

export function getUserById(id: string) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as any;
}
export function getUserByEmail(email: string) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as any;
}
export function getUserByUsername(username: string) {
  return db.prepare(`SELECT * FROM users WHERE lower(username) = lower(?)`).get(username) as any;
}

export function publicUser(row: any) {
  if (!row) return null;
  const r = db.prepare(`SELECT rating FROM player_ratings WHERE user_id = ?`).get(row.id) as any;
  const p = db.prepare(`SELECT xp, level, coins, frame FROM player_profiles WHERE user_id = ?`).get(row.id) as any;
  const rating = r?.rating ?? START_RATING;
  const isAdmin =
    row.role === 'admin' ||
    row.email?.toLowerCase() === 'rashedcse18@gmail.com' ||
    row.email?.toLowerCase() === 'admin@arena.dev';
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    avatar: row.avatar,
    country: row.country,
    rating,
    tier: tierFor(rating).tier,
    level: p?.level ?? 1,
    xp: p?.xp ?? 0,
    coins: p?.coins ?? 0,
    frame: p?.frame ?? 'frame-default',
    role: isAdmin ? ('admin' as const) : ('player' as const),
    banned: !!row.banned,
    banReason: row.ban_reason,
    createdAt: row.created_at,
  };
}

export function touchUser(id: string) {
  db.prepare(`UPDATE users SET last_seen = ? WHERE id = ?`).run(now(), id);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function getProfile(userId: string) {
  const user = getUserById(userId);
  if (!user) return null;
  const r = db.prepare(`SELECT * FROM player_ratings WHERE user_id = ?`).get(userId) as any;
  const p = db.prepare(`SELECT * FROM player_profiles WHERE user_id = ?`).get(userId) as any;
  const stats = {
    matches: r?.matches ?? 0,
    wins: r?.wins ?? 0,
    losses: r?.losses ?? 0,
    draws: r?.draws ?? 0,
    goalsFor: r?.goals_for ?? 0,
    goalsAgainst: r?.goals_against ?? 0,
    winRate: r?.matches ? Math.round(((r.wins / r.matches) * 100 + Number.EPSILON) * 10) / 10 : 0,
    streak: r?.streak ?? 0,
    bestStreak: r?.best_streak ?? 0,
    highestRating: r?.highest_rating ?? START_RATING,
  };
  return {
    user: publicUser(user),
    settings: JSON.parse(user.settings_json || '{}'),
    profile: {
      bio: p?.bio ?? '',
      frame: p?.frame ?? 'frame-default',
      tableSkin: p?.table_skin ?? 'classic-green',
      ballSkin: p?.ball_skin ?? 'classic-ball',
      uniform: p?.uniform ?? 'classic-kit',
      celebration: p?.celebration ?? 'celebration-basic',
      dailyStreak: p?.daily_streak ?? 0,
      lastDailyClaim: p?.last_daily_claim ?? null,
    },
    stats,
    achievements: getAchievements(userId, stats, r),
    matchHistory: getMatchHistory(userId, 20),
    daily: {
      canClaim: (p?.last_daily_claim ?? '') !== today(),
      streak: p?.daily_streak ?? 0,
      rewards: DAILY_LOGIN_REWARDS,
    },
    challenges: getChallenges(userId),
    ratingHistory: db
      .prepare(`SELECT rating_before, delta, rating_after, reason, created_at FROM rating_history WHERE user_id=? ORDER BY id DESC LIMIT 30`)
      .all(userId),
  };
}

export function getMatchHistory(userId: string, limit = 20) {
  const rows = db
    .prepare(
      `SELECT m.*, mp.team, mp.goals, mp.rating_delta FROM matches m
       JOIN match_players mp ON mp.match_id = m.id AND mp.user_id = ?
       WHERE m.status IN ('ended','abandoned')
       ORDER BY m.created_at DESC LIMIT ?`
    )
    .all(userId, limit) as any[];
  return rows.map((m) => {
    const others = db
      .prepare(
        `SELECT mp.team, u.username, u.avatar FROM match_players mp JOIN users u ON u.id = mp.user_id
         WHERE mp.match_id = ? AND mp.user_id != ?`
      )
      .all(m.id, userId) as any[];
    const mine = m.team;
    const opp = mine === 'A' ? 'B' : 'A';
    const myScore = mine === 'A' ? m.team_a_score : m.team_b_score;
    const oppScore = mine === 'A' ? m.team_b_score : m.team_a_score;
    return {
      id: m.id,
      mode: m.mode,
      playedAt: m.ended_at || m.created_at,
      team: mine,
      myScore,
      opponentScore: oppScore,
      outcome: m.winner === null ? 'draw' : m.winner === mine ? 'win' : 'loss',
      ratingDelta: m.rating_delta ?? 0,
      goals: m.goals ?? 0,
      durationSec: m.duration_sec ?? 0,
      partners: others.filter((o) => o.team === mine).map((o) => ({ username: o.username, avatar: o.avatar })),
      opponents: others.filter((o) => o.team === opp).map((o) => ({ username: o.username, avatar: o.avatar })),
    };
  });
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { id: 'first-match', title: 'First Kick', description: 'Play your first match', icon: '👟', target: 1, metric: 'matches', reward: 50 },
  { id: 'first-win', title: 'Taste of Victory', description: 'Win a match', icon: '🏅', target: 1, metric: 'wins', reward: 80 },
  { id: 'matches-10', title: 'Regular', description: 'Play 10 matches', icon: '🎯', target: 10, metric: 'matches', reward: 100 },
  { id: 'wins-10', title: 'Winner', description: 'Win 10 matches', icon: '🏆', target: 10, metric: 'wins', reward: 200 },
  { id: 'goals-50', title: 'Sniper', description: 'Score 50 goals', icon: '🎯', target: 50, metric: 'goalsFor', reward: 250 },
  { id: 'streak-5', title: 'On Fire', description: 'Win 5 matches in a row', icon: '🔥', target: 5, metric: 'bestStreak', reward: 300 },
  { id: 'gold-tier', title: 'Golden Boots', description: 'Reach 1200 rating (Gold)', icon: '🥇', target: 1200, metric: 'rating', reward: 150 },
  { id: 'diamond-tier', title: 'Diamond Hands', description: 'Reach 1600 rating (Diamond)', icon: '💎', target: 1600, metric: 'rating', reward: 400 },
  { id: 'matches-100', title: 'Veteran', description: 'Play 100 matches', icon: '🎖️', target: 100, metric: 'matches', reward: 600 },
] as const;

export function getAchievements(userId: string, stats?: any, ratingRow?: any) {
  const s = stats ?? (db.prepare(`SELECT * FROM player_ratings WHERE user_id=?`).get(userId) as any) ?? {};
  const rows = db.prepare(`SELECT achievement_id, progress, unlocked_at FROM achievements WHERE user_id = ?`).all(userId) as any[];
  const map = new Map(rows.map((r) => [r.achievement_id, r]));
  const metrics: Record<string, number> = {
    matches: s.matches ?? 0,
    wins: s.wins ?? 0,
    goalsFor: s.goals_for ?? s.goalsFor ?? 0,
    bestStreak: s.best_streak ?? s.bestStreak ?? 0,
    rating: ratingRow?.rating ?? START_RATING,
  };
  return ACHIEVEMENTS.map((a) => {
    const row = map.get(a.id);
    const value = Math.min(a.target, metrics[a.metric] ?? 0);
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      icon: a.icon,
      target: a.target,
      progress: row ? Math.max(row.progress, value) : value,
      unlocked: !!(row && row.unlocked_at),
      reward: a.reward,
      unlockedAt: row?.unlocked_at ?? undefined,
    };
  });
}

/** Recomputes achievement progress and pays out newly unlocked rewards. */
export function syncAchievements(userId: string) {
  const s = db.prepare(`SELECT * FROM player_ratings WHERE user_id=?`).get(userId) as any;
  if (!s) return [];
  const metrics: Record<string, number> = {
    matches: s.matches,
    wins: s.wins,
    goalsFor: s.goals_for,
    bestStreak: s.best_streak,
    rating: s.rating,
  };
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    const value = Math.min(a.target, metrics[a.metric] ?? 0);
    const existing = db
      .prepare(`SELECT * FROM achievements WHERE user_id=? AND achievement_id=?`)
      .get(userId, a.id) as any;
    if (!existing) {
      const done = value >= a.target;
      db.prepare(`INSERT INTO achievements (user_id, achievement_id, progress, unlocked_at) VALUES (?,?,?,?)`).run(
        userId,
        a.id,
        value,
        done ? now() : null
      );
      if (done) {
        unlockReward(userId, a.reward, `achievement:${a.id}`, `Achievement unlocked: ${a.title}`);
        unlocked.push(a.title);
      }
    } else if (!existing.unlocked_at && value >= a.target) {
      db.prepare(`UPDATE achievements SET progress=?, unlocked_at=? WHERE user_id=? AND achievement_id=?`).run(
        a.target,
        now(),
        userId,
        a.id
      );
      unlockReward(userId, a.reward, `achievement:${a.id}`, `Achievement unlocked: ${a.title}`);
      unlocked.push(a.title);
    } else if (!existing.unlocked_at) {
      db.prepare(`UPDATE achievements SET progress=? WHERE user_id=? AND achievement_id=?`).run(value, userId, a.id);
    }
  }
  return unlocked;
}

function unlockReward(userId: string, coins: number, ref: string, title: string) {
  addCoins(userId, coins, 'achievement', ref);
  notify(userId, 'achievement', title, `+${coins} coins`);
}

// ---------------------------------------------------------------------------
// Wallet / XP
// ---------------------------------------------------------------------------

export function addCoins(userId: string, amount: number, kind: string, ref?: string) {
  const p = db.prepare(`SELECT coins FROM player_profiles WHERE user_id=?`).get(userId) as any;
  if (!p) return 0;
  const after = Math.max(0, p.coins + amount);
  db.prepare(`UPDATE player_profiles SET coins=? WHERE user_id=?`).run(after, userId);
  db.prepare(
    `INSERT INTO wallet_transactions (user_id, amount, kind, ref, balance_after, created_at) VALUES (?,?,?,?,?,?)`
  ).run(userId, amount, kind, ref ?? null, after, now());
  return after;
}

export function addXp(userId: string, amount: number) {
  const p = db.prepare(`SELECT xp FROM player_profiles WHERE user_id=?`).get(userId) as any;
  if (!p) return { level: 1, xp: 0 };
  const xp = p.xp + amount;
  const lvl = levelFromXp(xp);
  db.prepare(`UPDATE player_profiles SET xp=?, level=? WHERE user_id=?`).run(xp, lvl.level, userId);
  return { level: lvl.level, xp };
}

export function claimDaily(userId: string) {
  const p = db.prepare(`SELECT * FROM player_profiles WHERE user_id=?`).get(userId) as any;
  if (!p) return { ok: false, error: 'Profile missing' };
  if (p.last_daily_claim === today()) return { ok: false, error: 'Already claimed today' };
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const streak = p.last_daily_claim === yesterday ? Math.min(6, p.daily_streak) + 1 : 1;
  const reward = DAILY_LOGIN_REWARDS[Math.min(streak - 1, DAILY_LOGIN_REWARDS.length - 1)];
  db.prepare(`UPDATE player_profiles SET last_daily_claim=?, daily_streak=? WHERE user_id=?`).run(today(), streak, userId);
  addCoins(userId, reward, 'daily_login', today());
  addXp(userId, 25);
  notify(userId, 'reward', 'Daily reward claimed', `+${reward} coins · ${streak}-day streak`);
  return { ok: true, reward, streak, coins: addCoins(userId, 0, 'noop') };
}

export function getChallenges(userId: string) {
  const period = today();
  const rows = db
    .prepare(`SELECT * FROM challenge_progress WHERE user_id=? AND period_key=?`)
    .all(userId, period) as any[];
  const map = new Map(rows.map((r) => [r.challenge_id, r]));
  return DAILY_CHALLENGES.map((c) => {
    const row = map.get(c.id);
    const progress = row?.progress ?? 0;
    return {
      id: c.id,
      title: c.title,
      target: c.target,
      progress: Math.min(progress, c.target),
      reward: c.reward,
      xp: c.xp,
      claimed: !!row?.claimed,
      complete: progress >= c.target,
    };
  });
}

export function bumpChallenges(userId: string, key: 'matches' | 'goals' | 'wins' | 'streak', amount: number) {
  const period = today();
  for (const c of DAILY_CHALLENGES) {
    if (c.kind !== key) continue;
    const row = db
      .prepare(`SELECT * FROM challenge_progress WHERE user_id=? AND challenge_id=? AND period_key=?`)
      .get(userId, c.id, period) as any;
    if (row) {
      db.prepare(
        `UPDATE challenge_progress SET progress=? WHERE user_id=? AND challenge_id=? AND period_key=?`
      ).run(row.progress + amount, userId, c.id, period);
    } else {
      db.prepare(
        `INSERT INTO challenge_progress (user_id, challenge_id, period_key, progress, claimed) VALUES (?,?,?,?,0)`
      ).run(userId, c.id, period, amount);
    }
  }
}

export function claimChallenge(userId: string, challengeId: string) {
  const c = DAILY_CHALLENGES.find((x) => x.id === challengeId);
  if (!c) return { ok: false, error: 'Unknown challenge' };
  const period = today();
  const row = db
    .prepare(`SELECT * FROM challenge_progress WHERE user_id=? AND challenge_id=? AND period_key=?`)
    .get(userId, challengeId, period) as any;
  if (!row || row.progress < c.target) return { ok: false, error: 'Challenge not complete' };
  if (row.claimed) return { ok: false, error: 'Already claimed' };
  db.prepare(`UPDATE challenge_progress SET claimed=1 WHERE user_id=? AND challenge_id=? AND period_key=?`).run(
    userId,
    challengeId,
    period
  );
  addCoins(userId, c.reward, 'challenge', challengeId);
  addXp(userId, c.xp);
  return { ok: true, coins: c.reward, xp: c.xp };
}

export function notify(userId: string, type: string, title: string, body = '') {
  db.prepare(`INSERT INTO notifications (user_id, type, title, body, created_at) VALUES (?,?,?,?,?)`).run(
    userId,
    type,
    title,
    body,
    now()
  );
}

// ---------------------------------------------------------------------------
// Match settlement (server-authoritative — clients never submit these numbers)
// ---------------------------------------------------------------------------

export interface SettlementInput {
  matchId: string;
  mode: string;
  teamA: { userId: string; goals: number; touches: number; shots: number }[];
  teamB: { userId: string; goals: number; touches: number; shots: number }[];
  scoreA: number;
  scoreB: number;
  winner: 'A' | 'B' | null;
  endReason: string;
  goalsToWin: number;
  timeLimitSec: number;
  durationSec: number;
  rated: boolean;
  tournamentId?: string | null;
  roomCode?: string | null;
}

export function settleMatch(input: SettlementInput) {
  // Matches are inserted as a 'waiting' placeholder when the room is created, so
  // idempotency must be keyed on the *settled* status, not on row existence.
  const existing = db.prepare(`SELECT status, created_at FROM matches WHERE id=?`).get(input.matchId) as any;
  if (existing?.status === 'ended') return { ok: false, error: 'Match already settled', duplicate: true };
  const createdAt = existing?.created_at ?? now();

  const loadRating = (id: string) =>
    (db.prepare(`SELECT * FROM player_ratings WHERE user_id=?`).get(id) as any) ?? {
      rating: START_RATING,
      matches: 0,
    };

  const FILLER = (tag: string, rating: number) => ({ id: `filler_${tag}`, rating, matches: 999 });
  // Elo needs two players per side; a bot partner is represented by a neutral filler.
  const rawA = input.teamA.map((p) => ({ id: p.userId, ...loadRating(p.userId) }));
  const rawB = input.teamB.map((p) => ({ id: p.userId, ...loadRating(p.userId) }));
  const avgOf = (list: { rating: number }[]) =>
    list.length ? Math.round(list.reduce((s, p) => s + p.rating, 0) / list.length) : START_RATING;
  const ratingA = [...rawA];
  const ratingB = [...rawB];
  while (ratingA.length < 2) ratingA.push(FILLER(`a${ratingA.length}`, avgOf(rawA.length ? rawA : rawB)));
  while (ratingB.length < 2) ratingB.push(FILLER(`b${ratingB.length}`, avgOf(rawB.length ? rawB : rawA)));
  const scoreA = input.winner === 'A' ? 1 : input.winner === 'B' ? 0 : 0.5;
  const ratingOut = calculateTeamRating(
    [ratingA[0], ratingA[1]] as any,
    [ratingB[0], ratingB[1]] as any,
    scoreA as 0 | 0.5 | 1
  );

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO matches (id, mode, status, team_a_score, team_b_score, goals_to_win, time_limit_sec, winner, end_reason, tournament_id, room_code, rated, started_at, ended_at, duration_sec, server_validated, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`
    ).run(
      input.matchId,
      input.mode,
      'ended',
      input.scoreA,
      input.scoreB,
      input.goalsToWin,
      input.timeLimitSec,
      input.winner,
      input.endReason,
      input.tournamentId ?? null,
      input.roomCode ?? null,
      input.rated ? 1 : 0,
      new Date(Date.now() - input.durationSec * 1000).toISOString(),
      now(),
      input.durationSec,
      createdAt
    );

    const record = (player: { userId: string; goals: number; touches: number; shots: number }, team: 'A' | 'B') => {
      const existsUser = db.prepare(`SELECT 1 FROM users WHERE id=?`).get(player.userId);
      const r = existsUser ? loadRating(player.userId) : { rating: START_RATING, matches: 0, streak: 0 };
      const out = ratingOut.players[player.userId] ?? { before: r.rating, delta: 0, after: r.rating };
      const won = input.winner === team;
      const draw = input.winner === null;
      const xp = xpForMatch(player.goals, won, r.streak ?? 0);
      const coins = coinsForMatch(player.goals, won);

      if (!existsUser) return { userId: player.userId, xp: 0, coins: 0, rating: null, won };

      db.prepare(
        `INSERT INTO match_players (match_id, user_id, team, slot, rating_before, rating_delta, rating_after, goals, touches, shots, xp_earned, coins_earned, connected)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`
      ).run(
        input.matchId,
        player.userId,
        team,
        0,
        input.rated ? out.before : null,
        input.rated ? out.delta : 0,
        input.rated ? out.after : null,
        player.goals,
        player.touches,
        player.shots,
        xp,
        coins
      );

      const streak = won ? (r.streak ?? 0) + 1 : draw ? r.streak ?? 0 : 0;
      db.prepare(
        `UPDATE player_ratings SET
           rating=?, matches=matches+1, wins=wins+?, losses=losses+?, draws=draws+?,
           goals_for=goals_for+?, goals_against=goals_against+?,
           streak=?, best_streak=MAX(best_streak, ?), highest_rating=MAX(highest_rating, ?)
         WHERE user_id=?`
      ).run(
        input.rated ? out.after : r.rating,
        won ? 1 : 0,
        input.winner !== null && !won ? 1 : 0,
        draw ? 1 : 0,
        player.goals,
        team === 'A' ? input.scoreB : input.scoreA,
        streak,
        streak,
        Math.max(r.rating, input.rated ? out.after : r.rating),
        player.userId
      );

      if (input.rated) {
        db.prepare(
          `INSERT INTO rating_history (user_id, match_id, rating_before, delta, rating_after, reason, created_at) VALUES (?,?,?,?,?,?,?)`
        ).run(player.userId, input.matchId, out.before, out.delta, out.after, 'match', now());
      }

      addCoins(player.userId, coins, 'match', input.matchId);
      addXp(player.userId, xp);
      bumpChallenges(player.userId, 'matches', 1);
      if (player.goals > 0) bumpChallenges(player.userId, 'goals', player.goals);
      if (won) {
        bumpChallenges(player.userId, 'wins', 1);
        bumpChallenges(player.userId, 'streak', 1);
      }
      return { userId: player.userId, xp, coins, rating: out, won };
    };

    const a = input.teamA.map((p) => record(p, 'A'));
    const b = input.teamB.map((p) => record(p, 'B'));

    [...input.teamA, ...input.teamB].forEach((p) => {
      if (db.prepare(`SELECT 1 FROM users WHERE id=?`).get(p.userId)) syncAchievements(p.userId);
    });

    db.prepare(
      `INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`
    ).run('server', 'match.settled', input.matchId, JSON.stringify({ scoreA: input.scoreA, scoreB: input.scoreB, winner: input.winner }), now());

    // anti-collusion: the same four players farming each other repeatedly
    const players = [...input.teamA, ...input.teamB].map((p) => p.userId);
    if (players.length === 4 && players.every((id) => db.prepare(`SELECT 1 FROM users WHERE id=?`).get(id))) {
      const pairCount = db
        .prepare(
          `SELECT COUNT(*) c FROM (
             SELECT m.id FROM matches m
             JOIN match_players p ON p.match_id = m.id
             WHERE m.status='ended' AND m.created_at > ? AND p.user_id IN (?,?,?,?)
             GROUP BY m.id HAVING COUNT(DISTINCT p.user_id) = 4
           )`
        )
        .get(new Date(Date.now() - 3 * 3600_000).toISOString(), ...players) as any;
      if (pairCount.c >= 8) {
        db.prepare(`INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`).run(
          'anticheat',
          'anticheat.repeat_lobby',
          input.matchId,
          JSON.stringify({ players, matchesIn3h: pairCount.c }),
          now()
        );
      }
    }

    return { ok: true, results: [...a, ...b], ratingOut };
  });

  return tx();
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export function leaderboard(scope: 'global' | 'weekly' | 'monthly' | 'friends' | 'country', userId?: string, country?: string) {
  if (scope === 'weekly' || scope === 'monthly') {
    const period = scope === 'weekly' ? isoWeek() : monthKey();
    const since = scope === 'weekly'
      ? new Date(Date.now() - 7 * 86400000).toISOString()
      : new Date(Date.now() - 30 * 86400000).toISOString();
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.avatar, u.country, r.rating, r.matches, r.wins,
                COALESCE(SUM(mp.rating_delta),0) AS period_delta
         FROM users u
         JOIN player_ratings r ON r.user_id = u.id
         LEFT JOIN match_players mp ON mp.user_id = u.id
         LEFT JOIN matches m ON m.id = mp.match_id AND m.created_at >= ?
         WHERE u.banned = 0
         GROUP BY u.id ORDER BY period_delta DESC, r.rating DESC LIMIT 100`
      )
      .all(since) as any[];
    return rows.map((r, i) => toLbEntry(r, i, r.period_delta));
  }

  let sql = `SELECT u.id, u.username, u.avatar, u.country, r.rating, r.matches, r.wins
             FROM users u JOIN player_ratings r ON r.user_id = u.id WHERE u.banned = 0`;
  const params: any[] = [];
  if (scope === 'country') {
    sql += ` AND u.country = ?`;
    params.push((country || 'BD').toUpperCase());
  }
  if (scope === 'friends' && userId) {
    sql += ` AND (u.id = ? OR u.id IN (SELECT friend_id FROM friendships WHERE user_id=? AND status='accepted'
              UNION SELECT user_id FROM friendships WHERE friend_id=? AND status='accepted'))`;
    params.push(userId, userId, userId);
  }
  sql += ` ORDER BY r.rating DESC, r.wins DESC LIMIT 100`;
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map((r, i) => toLbEntry(r, i, r.rating));
}

function toLbEntry(r: any, i: number, value: number) {
  return {
    rank: i + 1,
    userId: r.id,
    username: r.username,
    avatar: r.avatar,
    country: r.country,
    rating: value,
    tier: tierFor(value).tier,
    matches: r.matches,
    winRate: r.matches ? Math.round((r.wins / r.matches) * 1000) / 10 : 0,
  };
}

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export function friendsOf(userId: string) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.avatar, r.rating, u.last_seen FROM friendships f
       JOIN users u ON u.id = f.friend_id
       JOIN player_ratings r ON r.user_id = u.id
       WHERE f.user_id = ? AND f.status = 'accepted'
       UNION
       SELECT u.id, u.username, u.avatar, r.rating, u.last_seen FROM friendships f
       JOIN users u ON u.id = f.user_id
       JOIN player_ratings r ON r.user_id = u.id
       WHERE f.friend_id = ? AND f.status = 'accepted'`
    )
    .all(userId, userId)
    .map((f: any) => ({
      id: f.id,
      username: f.username,
      avatar: f.avatar,
      rating: f.rating,
      tier: tierFor(f.rating).tier,
      online: false,
      lastSeen: f.last_seen,
    }));
}

export function pendingRequests(userId: string) {
  return db
    .prepare(
      `SELECT f.id as requestId, u.id, u.username, u.avatar, r.rating FROM friendships f
       JOIN users u ON u.id = f.user_id JOIN player_ratings r ON r.user_id=u.id
       WHERE f.friend_id = ? AND f.status = 'pending'`
    )
    .all(userId);
}

export function sendFriendRequest(fromId: string, username: string) {
  const target = getUserByUsername(username);
  if (!target) return { ok: false, error: 'No player with that username' };
  if (target.id === fromId) return { ok: false, error: "You can't add yourself" };
  const blocked = db.prepare(`SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?`).get(target.id, fromId);
  if (blocked) return { ok: false, error: 'Unable to send request' };
  const existing = db
    .prepare(`SELECT * FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)`)
    .get(fromId, target.id, target.id, fromId) as any;
  if (existing?.status === 'accepted') return { ok: false, error: 'Already friends' };
  if (existing?.status === 'pending') return { ok: false, error: 'Request already pending' };
  db.prepare(`INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?,?,'pending',?)`).run(
    fromId,
    target.id,
    now()
  );
  notify(target.id, 'friend_request', 'New friend request', `${getUserById(fromId)?.username} wants to be friends`);
  return { ok: true };
}

export function respondFriendRequest(userId: string, requestId: number, accept: boolean) {
  const row = db.prepare(`SELECT * FROM friendships WHERE id=? AND friend_id=?`).get(requestId, userId) as any;
  if (!row) return { ok: false, error: 'Request not found' };
  if (accept) {
    db.prepare(`UPDATE friendships SET status='accepted' WHERE id=?`).run(requestId);
    notify(row.user_id, 'friend_accept', 'Friend request accepted', getUserById(userId)?.username ?? '');
    return { ok: true };
  }
  db.prepare(`DELETE FROM friendships WHERE id=?`).run(requestId);
  return { ok: true };
}

export function removeFriend(userId: string, friendId: string) {
  db.prepare(
    `DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)`
  ).run(userId, friendId, friendId, userId);
  return { ok: true };
}

export function recentOpponents(userId: string) {
  return db
    .prepare(
      `SELECT DISTINCT u.id, u.username, u.avatar, r.rating, MAX(m.created_at) AS last_played
       FROM match_players me
       JOIN matches m ON m.id = me.match_id
       JOIN match_players them ON them.match_id = m.id AND them.team != me.team
       JOIN users u ON u.id = them.user_id
       JOIN player_ratings r ON r.user_id = u.id
       WHERE me.user_id = ? AND u.id != ?
       GROUP BY u.id ORDER BY last_played DESC LIMIT 12`
    )
    .all(userId, userId)
    .map((r: any) => ({
      id: r.id,
      username: r.username,
      avatar: r.avatar,
      rating: r.rating,
      tier: tierFor(r.rating).tier,
      lastPlayed: r.last_played,
    }));
}

export function blockUser(userId: string, targetId: string) {
  db.prepare(`INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?,?,?)`).run(
    userId,
    targetId,
    now()
  );
  removeFriend(userId, targetId);
  return { ok: true };
}
export function unblockUser(userId: string, targetId: string) {
  db.prepare(`DELETE FROM blocks WHERE user_id=? AND blocked_id=?`).run(userId, targetId);
  return { ok: true };
}
export function blockedIds(userId: string) {
  return (db.prepare(`SELECT blocked_id FROM blocks WHERE user_id=?`).all(userId) as any[]).map(
    (r) => r.blocked_id
  );
}
export function reportUser(reporterId: string, targetId: string, reason: string, details: string, matchId?: string) {
  db.prepare(
    `INSERT INTO reports (reporter_id, target_id, match_id, reason, details, created_at) VALUES (?,?,?,?,?,?)`
  ).run(reporterId, targetId, matchId ?? null, reason.slice(0, 60), (details ?? '').slice(0, 500), now());
  db.prepare(`INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`).run(
    reporterId,
    'report.created',
    targetId,
    JSON.stringify({ reason }),
    now()
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Store / cosmetics
// ---------------------------------------------------------------------------

import { STORE_ITEMS } from '../shared/storeItems';
export { STORE_ITEMS };

const COLUMN_BY_KIND: Record<string, string> = {
  table_skin: 'table_skin',
  ball_skin: 'ball_skin',
  uniform: 'uniform',
  frame: 'frame',
  celebration: 'celebration',
};

/** Items the player owns (cosmetics are bought once and can be re-equipped free). */
export function ownedItems(userId: string): string[] {
  return (db.prepare(`SELECT item_id FROM owned_items WHERE user_id=?`).all(userId) as any[]).map(
    (r) => r.item_id
  );
}

export function buyItem(userId: string, itemId: string) {
  const item = STORE_ITEMS.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'Unknown item' };
  const p = db.prepare(`SELECT * FROM player_profiles WHERE user_id=?`).get(userId) as any;
  if (!p) return { ok: false, error: 'Profile missing' };
  const col = COLUMN_BY_KIND[item.kind];
  if (p[col] === itemId) return { ok: false, error: 'Already equipped' };

  const owned = ownedItems(userId).includes(itemId);
  if (!owned) {
    if (p.coins < item.price) {
      return { ok: false, error: `Not enough coins — you need ${item.price - p.coins} more` };
    }
    addCoins(userId, -item.price, 'store_purchase', itemId);
    db.prepare(`INSERT OR IGNORE INTO owned_items (user_id, item_id, purchased_at) VALUES (?,?,?)`).run(
      userId,
      itemId,
      now()
    );
    notify(userId, 'store', 'Item purchased', item.name);
  }
  db.prepare(`UPDATE player_profiles SET ${col}=? WHERE user_id=?`).run(itemId, userId);
  return { ok: true, item, equipped: true, charged: !owned };
}

export function equipItem(userId: string, itemId: string) {
  const item = STORE_ITEMS.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'Unknown item' };
  if (!ownedItems(userId).includes(itemId)) return { ok: false, error: 'You do not own that item' };
  const col = COLUMN_BY_KIND[item.kind];
  db.prepare(`UPDATE player_profiles SET ${col}=? WHERE user_id=?`).run(itemId, userId);
  return { ok: true };
}

export function updateSettings(userId: string, settings: any) {
  const current = getUserById(userId);
  const merged = { ...JSON.parse(current?.settings_json || '{}'), ...settings };
  db.prepare(`UPDATE users SET settings_json=? WHERE id=?`).run(JSON.stringify(merged), userId);
  return merged;
}

export function updateProfileFields(
  userId: string,
  fields: { bio?: string; avatar?: string; country?: string; frame?: string; tableSkin?: string; ballSkin?: string; uniform?: string }
) {
  if (fields.avatar) db.prepare(`UPDATE users SET avatar=? WHERE id=?`).run(fields.avatar.slice(0, 8), userId);
  if (fields.country) db.prepare(`UPDATE users SET country=? WHERE id=?`).run(fields.country.toUpperCase().slice(0, 2), userId);
  if (fields.bio !== undefined) db.prepare(`UPDATE player_profiles SET bio=? WHERE user_id=?`).run(fields.bio.slice(0, 200), userId);
  if (fields.frame) db.prepare(`UPDATE player_profiles SET frame=? WHERE user_id=?`).run(fields.frame, userId);
  if (fields.tableSkin) db.prepare(`UPDATE player_profiles SET table_skin=? WHERE user_id=?`).run(fields.tableSkin, userId);
  if (fields.ballSkin) db.prepare(`UPDATE player_profiles SET ball_skin=? WHERE user_id=?`).run(fields.ballSkin, userId);
  if (fields.uniform) db.prepare(`UPDATE player_profiles SET uniform=? WHERE user_id=?`).run(fields.uniform, userId);
  return { ok: true };
}

export function changePassword(userId: string, oldPw: string, newPw: string) {
  const u = getUserById(userId);
  if (!u) return { ok: false, error: 'User not found' };
  const { verifyPassword } = require('./auth') as typeof import('./auth');
  if (!verifyPassword(oldPw, u.password_hash)) return { ok: false, error: 'Current password is incorrect' };
  db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(hashPassword(newPw), userId);
  db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(userId);
  return { ok: true };
}

export function searchPlayers(q: string, exceptId?: string) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.avatar, u.country, r.rating FROM users u
       JOIN player_ratings r ON r.user_id=u.id
       WHERE lower(u.username) LIKE lower(?) AND u.id != ? AND u.banned=0 LIMIT 10`
    )
    .all(`%${q.slice(0, 20)}%`, exceptId ?? '')
    .map((r: any) => ({
      id: r.id,
      username: r.username,
      avatar: r.avatar,
      country: r.country,
      rating: r.rating,
      tier: tierFor(r.rating).tier,
    }));
}

export function notificationsFor(userId: string) {
  return db.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30`).all(userId);
}

export function markNotificationsRead(userId: string) {
  db.prepare(`UPDATE notifications SET read=1 WHERE user_id=?`).run(userId);
  return { ok: true };
}
