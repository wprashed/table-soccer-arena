/**
 * Elo-based competitive rating for 2v2 team matches.
 *
 * Team rating = average of the two players' ratings.
 * Expected score from the standard Elo formula; the *team* delta is then
 * distributed: players whose personal rating is below the team average gain
 * slightly more on a win (and lose slightly less on a loss), which keeps
 * individual ratings from drifting apart on a fixed team.
 */

export const START_RATING = 1000;
export const K_FACTOR = 32;

export interface RatingPlayer {
  id: string;
  rating: number;
  matchesPlayed: number;
}

export interface TeamResult {
  before: number;
  delta: number;
  after: number;
}

export interface MatchRatingOutput {
  teamA: TeamResult;
  teamB: TeamResult;
  players: Record<string, { before: number; delta: number; after: number }>;
  expectedA: number;
  expectedB: number;
  kFactor: number;
}

/** Provisional players use a larger K so they converge to their true skill faster. */
export function kFactorFor(matchesPlayed: number): number {
  if (matchesPlayed < 10) return 48;
  if (matchesPlayed < 30) return 40;
  return K_FACTOR;
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * @param scoreA 1 = A won, 0 = B won, 0.5 = draw
 */
export function calculateTeamRating(
  teamA: [RatingPlayer, RatingPlayer],
  teamB: [RatingPlayer, RatingPlayer],
  scoreA: 0 | 0.5 | 1
): MatchRatingOutput {
  const avgA = (teamA[0].rating + teamA[1].rating) / 2;
  const avgB = (teamB[0].rating + teamB[1].rating) / 2;
  const expA = expectedScore(avgA, avgB);
  const expB = 1 - expA;

  // The more experienced (higher K) members drive the pace of change.
  const kA = (kFactorFor(teamA[0].matchesPlayed) + kFactorFor(teamA[1].matchesPlayed)) / 2;
  const kB = (kFactorFor(teamB[0].matchesPlayed) + kFactorFor(teamB[1].matchesPlayed)) / 2;

  const deltaA = kA * (scoreA - expA);
  const deltaB = kB * (0.5 * 0 + (1 - scoreA) - expB);

  const distribute = (
    team: [RatingPlayer, RatingPlayer],
    teamAvg: number,
    teamDelta: number
  ): { players: Record<string, { before: number; delta: number; after: number }>; team: TeamResult } => {
    const players: Record<string, { before: number; delta: number; after: number }> = {};
    // weight: weaker-than-average player absorbs slightly more of a gain on a win
    const weights = team.map((p) => {
      const rel = (teamAvg - p.rating) / 200; // + for under-rated
      const bonus = teamDelta > 0 ? 1 + rel * 0.25 : 1 - rel * 0.25;
      return Math.min(1.4, Math.max(0.6, bonus));
    });
    const wSum = weights[0] + weights[1];
    let applied = 0;
    team.forEach((p, i) => {
      const raw = (teamDelta * weights[i]) / wSum;
      const delta = i === 0 ? Math.round(raw) : Math.round(teamDelta) - applied;
      applied += delta;
      const after = Math.max(100, p.rating + delta);
      players[p.id] = { before: p.rating, delta: after - p.rating, after };
    });
    const before = Math.round(teamAvg);
    const after = Math.round((players[team[0].id].after + players[team[1].id].after) / 2);
    return { players, team: { before, delta: after - before, after } };
  };

  const a = distribute(teamA, avgA, deltaA);
  const b = distribute(teamB, avgB, deltaB);

  return {
    teamA: a.team,
    teamB: b.team,
    players: { ...a.players, ...b.players },
    expectedA: expA,
    expectedB: expB,
    kFactor: Math.round((kA + kB) / 2),
  };
}

export type Tier =
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Platinum'
  | 'Diamond'
  | 'Master'
  | 'Legend';

export interface TierInfo {
  tier: Tier;
  min: number;
  max: number;
  color: string;
  color2: string;
  icon: string;
}

export const TIERS: TierInfo[] = [
  { tier: 'Bronze', min: 0, max: 999, color: '#b06a3b', color2: '#7c4522', icon: '🥉' },
  { tier: 'Silver', min: 1000, max: 1199, color: '#b9c4cf', color2: '#7d8791', icon: '🥈' },
  { tier: 'Gold', min: 1200, max: 1399, color: '#f5c451', color2: '#b8860b', icon: '🥇' },
  { tier: 'Platinum', min: 1400, max: 1599, color: '#67e0d3', color2: '#1f9e91', icon: '💠' },
  { tier: 'Diamond', min: 1600, max: 1799, color: '#7db8ff', color2: '#2a6fd6', icon: '💎' },
  { tier: 'Master', min: 1800, max: 1999, color: '#c084fc', color2: '#7c3aed', icon: '🔮' },
  { tier: 'Legend', min: 2000, max: Infinity, color: '#ff8a4c', color2: '#e11d48', icon: '👑' },
];

export function tierFor(rating: number): TierInfo {
  return TIERS.find((t) => rating >= t.min && rating <= t.max) ?? TIERS[0];
}

/** progress 0..1 toward the next tier */
export function tierProgress(rating: number): number {
  const t = tierFor(rating);
  if (t.max === Infinity) return 1;
  return Math.min(1, Math.max(0, (rating - t.min) / (t.max + 1 - t.min)));
}

// ---------------------------------------------------------------------------
// XP / levels (kept strictly separate from competitive rating)
// ---------------------------------------------------------------------------

export function xpForMatch(goals: number, won: boolean, streak: number): number {
  const base = won ? 60 : 25;
  const goalXp = Math.min(40, goals * 5);
  const streakBonus = won ? Math.min(60, Math.max(0, streak - 1) * 12) : 0;
  return base + goalXp + streakBonus;
}

export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let remaining = xp;
  let need = 200;
  while (remaining >= need) {
    remaining -= need;
    level++;
    need = Math.round(200 + (level - 1) * 90);
  }
  return { level, into: remaining, need };
}

// ---------------------------------------------------------------------------
// Coins / rewards
// ---------------------------------------------------------------------------

export function coinsForMatch(goals: number, won: boolean): number {
  const base = won ? 120 : 45;
  return base + Math.min(80, goals * 10);
}

export const DAILY_LOGIN_REWARDS = [40, 55, 70, 85, 100, 130, 200];
export const DAILY_CHALLENGES = [
  { id: 'play2', title: 'Play 2 matches', target: 2, kind: 'matches' as const, reward: 60, xp: 40 },
  { id: 'score5', title: 'Score 5 goals', target: 5, kind: 'goals' as const, reward: 70, xp: 50 },
  { id: 'win1', title: 'Win 1 match', target: 1, kind: 'wins' as const, reward: 90, xp: 70 },
  { id: 'streak2', title: 'Reach a 2-win streak', target: 2, kind: 'streak' as const, reward: 120, xp: 90 },
];
