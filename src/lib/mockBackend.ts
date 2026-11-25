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

// Seed demo users if storage is fresh
function initStorage() {
  if (typeof window === 'undefined') return;
  if (!localStorage.getItem(USERS_KEY)) {
    const demoUsers: PublicUser[] = [
      {
        id: 'usr_alex',
        username: 'AlexStriker',
        avatar: '⚽',
        country: 'BD',
        rating: 1120,
        tier: 'Silver',
        level: 4,
        xp: 950,
        coins: 480,
      },
      {
        id: 'usr_sam',
        username: 'SamRocket',
        avatar: '🚀',
        country: 'US',
        rating: 1280,
        tier: 'Gold',
        level: 6,
        xp: 1600,
        coins: 750,
      },
    ];
    localStorage.setItem(USERS_KEY, JSON.stringify(demoUsers));
  }
}

initStorage();

function getUsers(): (PublicUser & { email?: string; password?: string })[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
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
  if (!token) {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    try {
      token = JSON.parse(stored)?.token;
    } catch {
      token = stored;
    }
  }
  if (!token) return null;
  const userId = token.replace(/^mock_token_/, '').split('_')[0];
  const users = getUsers();
  return users.find((u) => u.id === userId) || null;
}

export function createDefaultProfile(user: PublicUser): ProfileResponse {
  return {
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
    const newUser: PublicUser & { email: string; password: string } = {
      id,
      email: email.toLowerCase(),
      username: username.trim(),
      password,
      avatar: avatar || '⚽',
      country: (country || 'BD').toUpperCase().slice(0, 2),
      rating: START_RATING,
      tier,
      level: 1,
      xp: 0,
      coins: 200,
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
    
    // Support demo logins out of the box
    if (!user && (email === 'alex@arena.dev' || email === 'sam@arena.dev')) {
      const demoId = email === 'alex@arena.dev' ? 'usr_alex' : 'usr_sam';
      const demoUsername = email === 'alex@arena.dev' ? 'AlexStriker' : 'SamRocket';
      const demoAvatar = email === 'alex@arena.dev' ? '⚽' : '🚀';
      const rating = email === 'alex@arena.dev' ? 1120 : 1280;
      const demoUser = {
        id: demoId,
        email,
        username: demoUsername,
        password: 'demo1234',
        avatar: demoAvatar,
        country: 'BD',
        rating,
        tier: tierFor(rating).tier,
        level: 4,
        xp: 800,
        coins: 500,
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
      saveProfiles(profiles);
    }
    profile.user = currentUser;
    return profile;
  }

  // 7. UPDATE PROFILE
  if (normPath === '/profile' && method === 'PATCH') {
    if (!currentUser) throw new Error('Unauthorized');
    const users = getUsers();
    const uIdx = users.findIndex((u) => u.id === currentUser.id);
    if (uIdx >= 0) {
      if (body.avatar) users[uIdx].avatar = body.avatar;
      if (body.country) users[uIdx].country = body.country;
      saveUsers(users);
    }
    const profiles = getProfiles();
    if (profiles[currentUser.id]) {
      if (body.avatar) profiles[currentUser.id].user.avatar = body.avatar;
      if (body.country) profiles[currentUser.id].user.country = body.country;
      if (body.bio !== undefined) profiles[currentUser.id].profile.bio = body.bio;
      saveProfiles(profiles);
    }
    return { ok: true };
  }

  // 8. UPDATE PASSWORD
  if (normPath === '/account/password' && method === 'POST') {
    return { ok: true };
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
    const reward = 50;
    currentUser.coins += reward;
    const users = getUsers();
    const idx = users.findIndex((u) => u.id === currentUser.id);
    if (idx >= 0) {
      users[idx].coins = currentUser.coins;
      saveUsers(users);
    }
    return { reward, streak: 2 };
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
      return [
        { rank: 1, name: 'Champions League S1', winner: 'AlexStriker', format: 'knockout', date: '2026-11-20' },
        { rank: 2, name: 'Winter Arena Cup', winner: 'SamRocket', format: 'league', date: '2026-11-15' },
      ];
    }

    const baseLeaders: LeaderboardEntry[] = [
      { rank: 1, userId: 'bot_pro1', username: 'ThunderKick', avatar: '⚡', country: 'DE', rating: 1890, tier: 'Master', matches: 142, winRate: 74 },
      { rank: 2, userId: 'bot_pro2', username: 'ApexPredator', avatar: '🦈', country: 'BR', rating: 1765, tier: 'Diamond', matches: 118, winRate: 68 },
      { rank: 3, userId: 'bot_pro3', username: 'GoldenStriker', avatar: '👑', country: 'ES', rating: 1640, tier: 'Diamond', matches: 95, winRate: 64 },
      { rank: 4, userId: 'usr_sam', username: 'SamRocket', avatar: '🚀', country: 'US', rating: 1280, tier: 'Gold', matches: 45, winRate: 58 },
      { rank: 5, userId: 'usr_alex', username: 'AlexStriker', avatar: '⚽', country: 'BD', rating: 1120, tier: 'Silver', matches: 32, winRate: 53 },
      { rank: 6, userId: 'bot_mid1', username: 'DragonSpin', avatar: '🐉', country: 'JP', rating: 1090, tier: 'Silver', matches: 28, winRate: 50 },
      { rank: 7, userId: 'bot_mid2', username: 'SwiftEagle', avatar: '🦅', country: 'FR', rating: 1040, tier: 'Silver', matches: 22, winRate: 48 },
    ];

    if (currentUser) {
      const exists = baseLeaders.find((l) => l.userId === currentUser.id);
      if (!exists) {
        baseLeaders.push({
          rank: 0,
          userId: currentUser.id,
          username: currentUser.username,
          avatar: currentUser.avatar,
          country: currentUser.country,
          rating: currentUser.rating,
          tier: currentUser.tier,
          matches: 6,
          winRate: 60,
        });
      }
    }

    baseLeaders.sort((a, b) => b.rating - a.rating);
    baseLeaders.forEach((l, i) => (l.rank = i + 1));
    return baseLeaders;
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
          {
            id: 'team_bots1',
            name: 'Cyber Wolves',
            members: [{ username: 'WolfBot', avatar: '🐺', rating: 1050 }],
            seed: 2,
          },
          {
            id: 'team_bots2',
            name: 'Solar Sharks',
            members: [{ username: 'SharkBot', avatar: '🦈', rating: 1100 }],
            seed: 3,
          },
          {
            id: 'team_bots3',
            name: 'Iron Eagles',
            members: [{ username: 'EagleBot', avatar: '🦅', rating: 1020 }],
            seed: 4,
          },
        ],
        createdAt: new Date().toISOString(),
        standings: [],
      };
      return { tournament: t };
    }

    return [
      {
        id: 't_weekend_cup',
        name: 'Weekly Challenger Cup',
        format: 'knockout',
        status: 'open',
        maxTeams: 8,
        teams: [
          { id: 'tm_1', name: 'Thunderbolts', members: [{ username: 'ThunderKick', avatar: '⚡', rating: 1890 }], seed: 1 },
          { id: 'tm_2', name: 'Apex Strikers', members: [{ username: 'ApexPredator', avatar: '🦈', rating: 1765 }], seed: 2 },
        ],
        createdAt: new Date().toISOString(),
        standings: [],
      },
    ];
  }

  // 16. FRIENDS
  if (normPath === '/friends') {
    return {
      friends: [
        { id: 'usr_alex', username: 'AlexStriker', avatar: '⚽', rating: 1120, tier: 'Silver', online: true, lastSeen: null },
        { id: 'usr_sam', username: 'SamRocket', avatar: '🚀', rating: 1280, tier: 'Gold', online: false, lastSeen: '2h ago' },
      ],
      incoming: [],
      outgoing: [],
      recent: [],
    };
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
