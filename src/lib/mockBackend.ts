/**
 * Client-side mock backend for static hosting (e.g. GitHub Pages) and offline play.
 *
 * Persists accounts, profiles, match histories, leaderboards, and store purchases
 * into browser localStorage so the entire competitive experience is immediately
 * playable without requiring a separate backend server.
 */

import {
  START_RATING,
  tierFor,
  coinsForMatch,
  xpForMatch,
  levelFromXp,
  DAILY_LOGIN_REWARDS,
  DAILY_CHALLENGES,
} from '../../shared/rating';
import type {
  PublicUser,
  ProfileResponse,
  LeaderboardEntry,
  MatchHistoryEntry,
  TournamentView,
} from '../../shared/types';
import { STORE_ITEMS } from '../../shared/storeItems';

const USERS_KEY = 'tsa.mock.users.v1';
const PROFILES_KEY = 'tsa.mock.profiles.v1';
const SESSION_KEY = 'tsa.mock.session.v1';
const TOURNAMENTS_KEY = 'tsa.mock.tournaments.v1';
const REPORTS_KEY = 'tsa.mock.reports.v1';
const AUDIT_KEY = 'tsa.mock.audit.v1';

// Initialize storage: purge all demo data, retain only the admin user
function initStorage() {
  if (typeof window === 'undefined') return;
  const raw = localStorage.getItem(USERS_KEY);
  let users: any[] = [];
  try {
    users = raw ? JSON.parse(raw) : [];
  } catch {
    users = [];
  }

  // Purge ALL users except the admin user rashedcse18@gmail.com
  users = users.filter((u) => u.email?.toLowerCase() === 'rashedcse18@gmail.com');

  // Ensure rashedcse18@gmail.com exists and is admin
  let rashed = users.find((u) => u.email?.toLowerCase() === 'rashedcse18@gmail.com');
  if (!rashed) {
    rashed = {
      id: 'usr_rashed',
      username: 'RashedAdmin',
      avatar: '👑',
      country: 'BD',
      rating: 1650,
      tier: 'Diamond',
      level: 12,
      xp: 6200,
      coins: 5000,
      role: 'admin',
      email: 'rashedcse18@gmail.com',
      password: 'password123',
      createdAt: '2026-11-20T08:00:00Z',
    };
    users = [rashed];
  } else {
    rashed.role = 'admin';
  }
  localStorage.setItem(USERS_KEY, JSON.stringify(users));

  // Prune profiles: keep ONLY admin user profile
  const profiles = getProfiles();
  const cleanProfiles: Record<string, ProfileResponse> = {};
  if (profiles[rashed.id]) {
    cleanProfiles[rashed.id] = profiles[rashed.id];
    cleanProfiles[rashed.id].user = rashed;
  } else {
    cleanProfiles[rashed.id] = createDefaultProfile(rashed);
  }
  saveProfiles(cleanProfiles);

  // Clear demo reports, tournaments, and any non-admin session
  localStorage.setItem(REPORTS_KEY, JSON.stringify([]));
  localStorage.setItem(TOURNAMENTS_KEY, JSON.stringify([]));

  const sessionRaw = localStorage.getItem(SESSION_KEY);
  if (sessionRaw) {
    try {
      const sess = JSON.parse(sessionRaw);
      if (sess?.userId && sess.userId !== rashed.id) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ token: `mock_token_${rashed.id}_admin`, userId: rashed.id }));
      }
    } catch {}
  }
}

initStorage();

function getReports(): any[] {
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveReports(reports: any[]) {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
}

function getAudit(): any[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    {
      id: 1,
      actor: 'system',
      action: 'system.boot',
      target: 'arena',
      meta: '{}',
      created_at: new Date(Date.now() - 14400000).toISOString(),
    },
    {
      id: 2,
      actor: 'rashed_admin',
      action: 'admin.grant_role',
      target: 'rashedcse18@gmail.com',
      meta: '{"role":"admin"}',
      created_at: new Date(Date.now() - 7200000).toISOString(),
    },
  ];
}

function logAudit(actor: string, action: string, target: string, meta: any = {}) {
  const audit = getAudit();
  audit.unshift({
    id: Date.now(),
    actor,
    action,
    target,
    meta: typeof meta === 'string' ? meta : JSON.stringify(meta),
    created_at: new Date().toISOString(),
  });
  if (audit.length > 100) audit.pop();
  localStorage.setItem(AUDIT_KEY, JSON.stringify(audit));
}

function getUsers(): (PublicUser & { email?: string; password?: string })[] {
  try {
    const list: any[] = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    return list.filter(
      (u) =>
        u.username !== 'AlexStriker' &&
        u.id !== 'usr_alex' &&
        u.email !== 'alex@arena.dev' &&
        u.username !== 'SamRocket' &&
        u.id !== 'usr_sam' &&
        u.email !== 'sam@arena.dev'
    );
  } catch {
    return [];
  }
}

function saveUsers(users: any[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getProfiles(): Record<string, ProfileResponse> {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveProfiles(profiles: Record<string, ProfileResponse>) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function getMockSessionUser(token?: string | null): PublicUser | null {
  const users = getUsers();
  let sessionUserId: string | null = null;
  const stored = typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null;

  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.userId) sessionUserId = parsed.userId;
      if (!token && parsed?.token) token = parsed.token;
    } catch {
      if (!token) token = stored;
    }
  }

  const checkAdmin = (u: any) => {
    if (!u) return u;
    if (u.email?.toLowerCase() === 'rashedcse18@gmail.com' || u.email?.toLowerCase() === 'admin@arena.dev') {
      u.role = 'admin';
    }
    return u;
  };

  // 1. Direct match by session userId
  if (sessionUserId) {
    const found = users.find((u) => u.id === sessionUserId);
    if (found) return checkAdmin(found);
  }

  // 2. Match by token content
  if (token) {
    const found = users.find((u) => token.includes(u.id) || u.id === token);
    if (found) return checkAdmin(found);

    const stripped = token.replace(/^mock_token_/, '');
    const found2 = users.find((u) => stripped.startsWith(u.id));
    if (found2) return checkAdmin(found2);
  }

  // 3. Fallback: return the first user if any exists (e.g. demo player)
  return checkAdmin(users[0]) || null;
}

export function computeDailyLogin(p: ProfileResponse) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const lastClaim = p.profile.lastDailyClaim ? p.profile.lastDailyClaim.slice(0, 10) : null;

  const canClaim = lastClaim !== todayStr;
  let streak = p.profile.dailyStreak || 1;
  if (lastClaim && lastClaim !== todayStr && lastClaim !== yesterdayStr) {
    // missed more than 1 day, streak resets to 1
    streak = 1;
    p.profile.dailyStreak = 1;
  }
  p.daily = {
    canClaim,
    streak,
    rewards: DAILY_LOGIN_REWARDS,
  };
}

export function createDefaultProfile(user: PublicUser): ProfileResponse {
  const p: ProfileResponse = {
    user,
    profile: {
      bio: 'Foosball competitor on Table Soccer Arena!',
      frame: 'frame-default',
      tableSkin: 'skin-emerald',
      ballSkin: 'ball-gold',
      uniform: 'kit-away',
      celebration: 'celebration-confetti',
      dailyStreak: 1,
      lastDailyClaim: null,
    },
    stats: {
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      winRate: 0,
      streak: 0,
      bestStreak: 0,
      highestRating: user.rating || START_RATING,
    },
    achievements: [
      { id: 'first_kick', title: 'First Kick', description: 'Play your first match in the arena', icon: '⚽', unlocked: false, progress: 0, target: 1, reward: 50 },
      { id: 'first_win', title: 'First Victory', description: 'Win your first foosball match', icon: '🏆', unlocked: false, progress: 0, target: 1, reward: 100 },
      { id: 'hat_trick', title: 'Hat Trick', description: 'Score 3 goals in a single match', icon: '🎩', unlocked: false, progress: 0, target: 3, reward: 150 },
      { id: 'centurion', title: 'Centurion', description: 'Reach 1,200 Elo rating (Gold tier)', icon: '⭐', unlocked: false, progress: 1000, target: 1200, reward: 200 },
      { id: 'streak_3', title: 'On Fire', description: 'Win 3 matches in a row', icon: '🔥', unlocked: false, progress: 0, target: 3, reward: 250 },
      { id: 'legend', title: 'Foosball Legend', description: 'Reach 1,800 rating (Master)', icon: '👑', unlocked: false, progress: 1000, target: 1800, reward: 500 },
    ],
    matchHistory: [],
    daily: { canClaim: true, streak: 1, rewards: DAILY_LOGIN_REWARDS },
    challenges: DAILY_CHALLENGES.map((c) => ({
      ...c,
      progress: 0,
      complete: false,
      claimed: false,
    })),
  };
  computeDailyLogin(p);
  return p;
}

export async function handleMockApi(path: string, method: string, body?: any, token?: string | null): Promise<any> {
  const normPath = path.replace(/^\/api/, '').replace(/\/$/, '');
  const currentUser = getMockSessionUser(token);

  // 1. REGISTER
  if (normPath === '/auth/register' && method === 'POST') {
    const { email, username, password, country, avatar } = body;
    if (!email || !username || !password) {
      throw new Error('Email, username, and password are required');
    }
    const users = getUsers();
    if (users.some((u) => u.email?.toLowerCase() === email.toLowerCase())) {
      throw new Error('An account with this email already exists');
    }
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw new Error('This username is already taken');
    }

    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const tier = tierFor(START_RATING).tier;
    const isAdmin =
      email.toLowerCase() === 'rashedcse18@gmail.com' ||
      email.toLowerCase() === 'admin@arena.dev';
    const newUser: PublicUser & { email: string; password: string } = {
      id,
      email: email.toLowerCase(),
      username: username.trim(),
      password,
      avatar: avatar || (isAdmin ? '👑' : '⚽'),
      country: (country || 'BD').toUpperCase().slice(0, 2),
      rating: START_RATING,
      tier,
      level: 1,
      xp: 0,
      coins: isAdmin ? 5000 : 200,
      role: isAdmin ? 'admin' : 'player',
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    saveUsers(users);

    const profile = createDefaultProfile(newUser);
    const profiles = getProfiles();
    profiles[id] = profile;
    saveProfiles(profiles);

    const newToken = `mock_token_${id}_${Date.now()}`;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: newToken, userId: id }));

    return {
      token: newToken,
      user: newUser,
      verification: { devToken: 'demo-verified', link: null },
    };
  }

  // 2. LOGIN
  if (normPath === '/auth/login' && method === 'POST') {
    const { email, password } = body;
    const users = getUsers();
    const user = users.find((u) => u.email?.toLowerCase() === email?.toLowerCase());
    
    // Support admin & demo logins out of the box
    if (!user && (email?.toLowerCase() === 'rashedcse18@gmail.com' || email === 'admin@arena.dev')) {
      const demoId = 'usr_rashed';
      const demoUsername = 'RashedAdmin';
      const demoUser = {
        id: demoId,
        email: email.toLowerCase(),
        username: demoUsername,
        password: password || 'password123',
        avatar: '👑',
        country: 'BD',
        rating: 1650,
        tier: 'Diamond',
        level: 12,
        xp: 6200,
        coins: 5000,
        role: 'admin' as const,
        createdAt: new Date().toISOString(),
      };
      users.push(demoUser);
      saveUsers(users);
      const profiles = getProfiles();
      profiles[demoId] = createDefaultProfile(demoUser);
      saveProfiles(profiles);
      const newToken = `mock_token_${demoId}_${Date.now()}`;
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: newToken, userId: demoId }));
      return { token: newToken, user: demoUser };
    }

    if (!user || (user.password && user.password !== password)) {
      throw new Error('Invalid email or password');
    }

    if (user.email?.toLowerCase() === 'rashedcse18@gmail.com' || user.email?.toLowerCase() === 'admin@arena.dev') {
      user.role = 'admin';
      saveUsers(users);
    }

    const newToken = `mock_token_${user.id}_${Date.now()}`;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: newToken, userId: user.id }));
    return { token: newToken, user };
  }

  // 3. AUTH ME
  if (normPath === '/auth/me') {
    if (!currentUser) throw new Error('Unauthorized');
    return { user: currentUser };
  }

  // 4. LOGOUT
  if (normPath === '/auth/logout') {
    localStorage.removeItem(SESSION_KEY);
    return { ok: true };
  }

  // 5. FORGOT & RESET PASSWORD
  if (normPath === '/auth/forgot-password') {
    return { message: 'Reset token generated (Offline Mode)', devToken: 'demo-reset-token-123' };
  }
  if (normPath === '/auth/reset-password') {
    return { ok: true };
  }

  // 6. PROFILE ME
  if (normPath === '/profile/me') {
    if (!currentUser) throw new Error('Unauthorized');
    const profiles = getProfiles();
    let profile = profiles[currentUser.id];
    if (!profile) {
      profile = createDefaultProfile(currentUser);
      profiles[currentUser.id] = profile;
    }
    profile.user = currentUser;
    computeDailyLogin(profile);
    profiles[currentUser.id] = profile;
    saveProfiles(profiles);
    return profile;
  }

  // 7. UPDATE PROFILE
  if (normPath === '/profile' && method === 'PATCH') {
    if (!currentUser) throw new Error('Unauthorized');
    const users = getUsers();
    const uIdx = users.findIndex((u) => u.id === currentUser.id);
    if (uIdx < 0) throw new Error('User not found');

    // Update username if requested
    if (body.username && body.username.trim() !== users[uIdx].username) {
      const cleanUsername = body.username.trim();
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
        throw new Error('Username must be 3-20 characters and contain only letters, numbers, or underscores');
      }
      const taken = users.some((u) => u.id !== currentUser.id && u.username.toLowerCase() === cleanUsername.toLowerCase());
      if (taken) {
        throw new Error(`Username "${cleanUsername}" is already taken`);
      }
      users[uIdx].username = cleanUsername;
      currentUser.username = cleanUsername;
    }

    // Update email if requested
    if (body.email && body.email.trim().toLowerCase() !== (users[uIdx].email || '').toLowerCase()) {
      const cleanEmail = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error('Please enter a valid email address');
      }
      const emailTaken = users.some((u) => u.id !== currentUser.id && (u.email || '').toLowerCase() === cleanEmail);
      if (emailTaken) {
        throw new Error(`Email "${cleanEmail}" is already registered`);
      }
      users[uIdx].email = cleanEmail;
      currentUser.email = cleanEmail;
    }

    // Avatar, Country, Position
    if (body.avatar) {
      users[uIdx].avatar = body.avatar;
      currentUser.avatar = body.avatar;
    }
    if (body.country) {
      users[uIdx].country = body.country.toUpperCase().slice(0, 2);
      currentUser.country = users[uIdx].country;
    }
    const pos = body.preferredPosition || body.position;
    if (pos) {
      users[uIdx].position = pos;
      currentUser.position = pos;
    }
    saveUsers(users);
    saveCurrentUser(currentUser);

    const profiles = getProfiles();
    if (profiles[currentUser.id]) {
      profiles[currentUser.id].user = { ...currentUser };
      if (body.bio !== undefined) profiles[currentUser.id].profile.bio = body.bio.slice(0, 200);
      if (pos) {
        profiles[currentUser.id].profile.preferredPosition = pos;
      }
      saveProfiles(profiles);
    }
    return { ok: true, user: users[uIdx] };
  }

  // 8. UPDATE PASSWORD
  if (normPath === '/account/password' && method === 'POST') {
    if (!currentUser) throw new Error('Unauthorized');
    const users = getUsers();
    const uIdx = users.findIndex((u) => u.id === currentUser.id);
    if (uIdx < 0) throw new Error('User not found');

    const { current, next } = body || {};
    if (users[uIdx].password && current !== users[uIdx].password) {
      throw new Error('Current password is incorrect');
    }
    if (!next || next.length < 6) {
      throw new Error('New password must be at least 6 characters');
    }

    users[uIdx].password = next;
    saveUsers(users);
    logAudit('PASSWORD_CHANGED', `User ${users[uIdx].username} updated their password`, currentUser.id);
    return { ok: true, message: 'Password updated successfully' };
  }

  // 9. STORE
  if (normPath === '/store' && method === 'GET') {
    const profiles = getProfiles();
    const p = currentUser ? profiles[currentUser.id] : null;
    return {
      items: STORE_ITEMS,
      coins: currentUser?.coins ?? 200,
      equipped: p?.profile ?? {
        tableSkin: 'skin-emerald',
        ballSkin: 'ball-gold',
        uniform: 'kit-away',
        frame: 'frame-gold',
        celebration: 'celebration-confetti',
      },
      owned: ['skin-emerald', 'ball-gold', 'kit-away'],
    };
  }

  // 10. STORE BUY & EQUIP
  if (normPath === '/store/buy' && method === 'POST') {
    if (!currentUser) throw new Error('Unauthorized');
    const item = STORE_ITEMS.find((i) => i.id === body.itemId);
    if (!item) throw new Error('Unknown item');
    if (currentUser.coins < item.price) {
      throw new Error(`Need ${item.price - currentUser.coins} more coins`);
    }
    currentUser.coins -= item.price;
    const users = getUsers();
    const idx = users.findIndex((u) => u.id === currentUser.id);
    if (idx >= 0) {
      users[idx].coins = currentUser.coins;
      saveUsers(users);
    }
    return { charged: true, item };
  }

  if (normPath === '/store/equip' && method === 'POST') {
    return { charged: false };
  }

  // 11. REWARDS DAILY
  if (normPath === '/rewards/daily' && method === 'POST') {
    if (!currentUser) throw new Error('Unauthorized');
    const profiles = getProfiles();
    const p = profiles[currentUser.id] || createDefaultProfile(currentUser);
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const lastClaim = p.profile.lastDailyClaim ? p.profile.lastDailyClaim.slice(0, 10) : null;

    if (lastClaim === todayStr) {
      throw new Error('Daily reward already claimed today. Come back tomorrow!');
    }

    const nextStreak = lastClaim === yesterdayStr ? Math.min(7, (p.profile.dailyStreak || 1) + 1) : 1;
    const reward = DAILY_LOGIN_REWARDS[Math.min(nextStreak - 1, DAILY_LOGIN_REWARDS.length - 1)] || 50;

    currentUser.coins += reward;
    p.user.coins = currentUser.coins;
    p.profile.lastDailyClaim = new Date().toISOString();
    p.profile.dailyStreak = nextStreak;
    p.daily = {
      canClaim: false,
      streak: nextStreak,
      rewards: DAILY_LOGIN_REWARDS,
    };

    profiles[currentUser.id] = p;
    saveProfiles(profiles);

    const users = getUsers();
    const idx = users.findIndex((u) => u.id === currentUser.id);
    if (idx >= 0) {
      users[idx].coins = currentUser.coins;
      saveUsers(users);
    }
    return { ok: true, reward, streak: nextStreak, coins: currentUser.coins };
  }

  // 12. REWARDS CHALLENGE
  if (normPath === '/rewards/challenge' && method === 'POST') {
    if (!currentUser) throw new Error('Unauthorized');
    currentUser.coins += 70;
    currentUser.xp += 50;
    const users = getUsers();
    const idx = users.findIndex((u) => u.id === currentUser.id);
    if (idx >= 0) {
      users[idx].coins = currentUser.coins;
      users[idx].xp = currentUser.xp;
      saveUsers(users);
    }
    return { coins: 70, xp: 50 };
  }

  // 13. LEADERBOARD
  if (normPath.startsWith('/leaderboard')) {
    if (normPath === '/leaderboard/tournaments') {
      return [];
    }

    const users = getUsers();
    const profiles = getProfiles();
    const leaders: LeaderboardEntry[] = users.map((u, i) => {
      const p = profiles[u.id];
      return {
        rank: i + 1,
        userId: u.id,
        username: u.username,
        avatar: u.avatar || '👑',
        country: u.country || 'BD',
        rating: u.rating || START_RATING,
        tier: u.tier || tierFor(u.rating || START_RATING).tier,
        matches: p?.stats?.matches || 0,
        winRate: p?.stats?.winRate || 0,
      };
    });

    leaders.sort((a, b) => b.rating - a.rating);
    leaders.forEach((l, i) => (l.rank = i + 1));
    return leaders;
  }

  // 14. MATCH HISTORY
  if (normPath === '/matches/history') {
    if (!currentUser) return [];
    const profiles = getProfiles();
    return profiles[currentUser.id]?.matchHistory || [];
  }

  // 15. TOURNAMENTS
  if (normPath === '/tournaments') {
    if (method === 'POST') {
      const { name, format, maxTeams } = body;
      const t: TournamentView = {
        id: 'tourney_' + Date.now().toString(36),
        name: name || 'Arena Championship',
        format: format || 'knockout',
        status: 'open',
        maxTeams: maxTeams || 4,
        teams: [
          {
            id: 'team_you',
            name: currentUser?.username || 'Team Alpha',
            members: [{ username: currentUser?.username || 'You', avatar: currentUser?.avatar || '⚽', rating: currentUser?.rating || 1000 }],
            seed: 1,
          },
        ],
        createdAt: new Date().toISOString(),
        standings: [],
      };
      const stored = (() => {
        try {
          return JSON.parse(localStorage.getItem(TOURNAMENTS_KEY) || '[]');
        } catch {
          return [];
        }
      })();
      stored.unshift(t);
      localStorage.setItem(TOURNAMENTS_KEY, JSON.stringify(stored));
      return { tournament: t };
    }

    try {
      return JSON.parse(localStorage.getItem(TOURNAMENTS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  // 16. FRIENDS
  if (normPath === '/friends') {
    const users = getUsers().filter((u) => u.id !== currentUser?.id);
    const friendsList = users.map((u) => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar || '⚽',
      rating: u.rating || 1000,
      tier: tierFor(u.rating || 1000).tier,
      online: true,
      lastSeen: null,
    }));
    return {
      friends: friendsList,
      requests: [],
      incoming: [],
      outgoing: [],
      recent: [],
    };
  }

  if (normPath === '/friends/request' && method === 'POST') {
    const { username } = body || {};
    const users = getUsers();
    const target = users.find((u) => u.username?.toLowerCase() === username?.toLowerCase());
    if (!target) {
      throw new Error('User not found');
    }
    return { ok: true, message: 'Friend request sent' };
  }

  if (normPath === '/friends/respond' && method === 'POST') {
    return { ok: true };
  }

  if (normPath.startsWith('/friends/') && method === 'DELETE') {
    return { ok: true };
  }

  if (normPath.startsWith('/users/') && normPath.endsWith('/block') && method === 'POST') {
    return { ok: true };
  }

  if (normPath.startsWith('/users/') && normPath.endsWith('/report') && method === 'POST') {
    const parts = normPath.split('/');
    const targetUserId = parts[2];
    const { reason, details } = body || {};
    const reports = getReports();
    reports.unshift({
      id: Date.now(),
      targetUserId,
      targetUsername: getUsers().find((u) => u.id === targetUserId)?.username || 'Unknown',
      reportedBy: currentUser?.username || 'anonymous',
      reason: reason || 'abuse',
      details: details || '',
      status: 'open',
      createdAt: new Date().toISOString(),
    });
    saveReports(reports);
    return { ok: true };
  }

  // 17. ADMIN OVERVIEW
  if (normPath === '/admin/overview') {
    const users = getUsers();
    const reports = getReports().filter((r) => r.status === 'open');
    const audit = getAudit();
    const profiles = getProfiles();
    const totalCoins = Object.values(profiles).reduce((acc, p) => acc + (p.user.coins || 0), 0);
    const totalMatches = Object.values(profiles).reduce((acc, p) => acc + (p.stats.matches || 0), 0);

    return {
      users: users.length,
      bannedUsers: users.filter((u) => u.banned).length,
      matches: totalMatches || 0,
      liveMatches: 0,
      reports,
      audit,
      economy: { coins: totalCoins || (users[0]?.coins ?? 5000) },
    };
  }

  // 18. ADMIN USERS LIST
  if (normPath === '/admin/users') {
    const users = getUsers().map((u) => {
      const isAdmin =
        u.role === 'admin' ||
        u.email?.toLowerCase() === 'rashedcse18@gmail.com' ||
        u.email?.toLowerCase() === 'admin@arena.dev';
      return {
        ...u,
        role: isAdmin ? ('admin' as const) : (u.role || 'player'),
        banned: !!u.banned,
        createdAt: u.createdAt || '2026-11-20T10:00:00Z',
      };
    });
    return { users };
  }

  // 19. ADMIN BAN/UNBAN
  if (normPath === '/admin/ban' && method === 'POST') {
    const { userId, ban, reason } = body || {};
    const users = getUsers();
    const target = users.find((u) => u.id === userId);
    if (target) {
      target.banned = !!ban;
      target.banReason = ban ? reason || 'Policy violation' : undefined;
      saveUsers(users);
      logAudit(currentUser?.username || 'admin', ban ? 'admin.ban' : 'admin.unban', target.username, { reason });
    }
    return { ok: true };
  }

  // 20. ADMIN SET ROLE
  if (normPath === '/admin/user/role' && method === 'POST') {
    const { userId, role } = body || {};
    const users = getUsers();
    const target = users.find((u) => u.id === userId);
    if (target) {
      target.role = role;
      saveUsers(users);
      logAudit(currentUser?.username || 'admin', 'admin.set_role', target.username, { role });
    }
    return { ok: true };
  }

  // 21. ADMIN ADJUST USER (COINS / RATING)
  if (normPath === '/admin/user/adjust' && method === 'POST') {
    const { userId, deltaCoins, deltaRating } = body || {};
    const users = getUsers();
    const target = users.find((u) => u.id === userId);
    if (target) {
      if (typeof deltaCoins === 'number') {
        target.coins = Math.max(0, (target.coins || 0) + deltaCoins);
      }
      if (typeof deltaRating === 'number') {
        target.rating = Math.max(100, (target.rating || 1000) + deltaRating);
        target.tier = tierFor(target.rating).tier;
      }
      saveUsers(users);
      const profiles = getProfiles();
      if (profiles[userId]) {
        profiles[userId].user = target;
        saveProfiles(profiles);
      }
      logAudit(currentUser?.username || 'admin', 'admin.adjust_user', target.username, { deltaCoins, deltaRating });
    }
    return { ok: true };
  }

  // 22. ADMIN DELETE USER
  if (normPath === '/admin/user/delete' && method === 'POST') {
    const { userId } = body || {};
    let users = getUsers();
    const target = users.find((u) => u.id === userId);
    if (target) {
      users = users.filter((u) => u.id !== userId);
      saveUsers(users);
      const profiles = getProfiles();
      delete profiles[userId];
      saveProfiles(profiles);
      logAudit(currentUser?.username || 'admin', 'admin.delete_user', target.username);
    }
    return { ok: true };
  }

  // 23. ADMIN RESOLVE REPORT
  if (normPath.startsWith('/admin/reports/') && normPath.endsWith('/resolve') && method === 'POST') {
    const parts = normPath.split('/');
    const reportId = Number(parts[parts.length - 2]);
    const reports = getReports();
    const rep = reports.find((r) => r.id === reportId);
    if (rep) {
      rep.status = body?.status === 'dismiss' ? 'dismissed' : 'resolved';
      saveReports(reports);
      logAudit(currentUser?.username || 'admin', 'admin.resolve_report', `report_${reportId}`);
    }
    return { ok: true };
  }

  // 24. ADMIN CLAIM / ELEVATE PRIVILEGES
  if (normPath === '/admin/claim' && method === 'POST') {
    if (!currentUser) throw new Error('Unauthorized');
    currentUser.role = 'admin';
    const users = getUsers();
    const idx = users.findIndex((u) => u.id === currentUser.id);
    if (idx >= 0) {
      users[idx].role = 'admin';
      users[idx].coins = Math.max(users[idx].coins || 0, 5000);
      saveUsers(users);
    }
    const profiles = getProfiles();
    if (profiles[currentUser.id]) {
      profiles[currentUser.id].user.role = 'admin';
      profiles[currentUser.id].user.coins = Math.max(profiles[currentUser.id].user.coins || 0, 5000);
      saveProfiles(profiles);
    }
    logAudit(currentUser.username, 'admin.claim_access', currentUser.username, { role: 'admin' });
    return { ok: true, user: currentUser };
  }

  // Default fallback
  return { ok: true };
}

/** Record match results to local player profile */
export function recordMockMatchResult(userId: string, result: {
  won: boolean;
  score: { A: number; B: number };
  myGoals: number;
  durationSec: number;
}) {
  const users = getUsers();
  const u = users.find((usr) => usr.id === userId);
  if (!u) return;

  const delta = result.won ? 25 : -18;
  u.rating = Math.max(100, u.rating + delta);
  u.tier = tierFor(u.rating).tier;
  u.coins += coinsForMatch(result.myGoals, result.won);
  u.xp += xpForMatch(result.myGoals, result.won, result.won ? 2 : 0);
  u.level = levelFromXp(u.xp).level;
  saveUsers(users);

  const profiles = getProfiles();
  const p = profiles[userId] || createDefaultProfile(u);
  p.user = u;
  p.stats.matches += 1;
  if (result.won) {
    p.stats.wins += 1;
    p.stats.streak += 1;
    if (p.stats.streak > p.stats.bestStreak) p.stats.bestStreak = p.stats.streak;
  } else {
    p.stats.losses += 1;
    p.stats.streak = 0;
  }
  p.stats.goalsFor += result.myGoals;
  p.stats.goalsAgainst += (result.won ? result.score.B : result.score.A);
  p.stats.winRate = Math.round((p.stats.wins / p.stats.matches) * 100);
  p.stats.highestRating = Math.max(p.stats.highestRating, u.rating);

  const entry: MatchHistoryEntry = {
    id: 'm_' + Date.now().toString(36),
    mode: 'quick',
    playedAt: new Date().toISOString(),
    team: 'A',
    myScore: result.score.A,
    opponentScore: result.score.B,
    outcome: result.won ? 'win' : 'loss',
    ratingDelta: delta,
    goals: result.myGoals,
    partners: [{ username: 'Bot Teammate', avatar: '🤖' }],
    opponents: [{ username: 'Bot Rival 1', avatar: '🦈' }, { username: 'Bot Rival 2', avatar: '🔥' }],
    durationSec: result.durationSec,
  };

  p.matchHistory.unshift(entry);
  if (p.matchHistory.length > 30) p.matchHistory.pop();
  profiles[userId] = p;
  saveProfiles(profiles);
}
