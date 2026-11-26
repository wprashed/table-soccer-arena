/** Shared API/DTO types used by client and server. */
import type { Team } from './engine/constants';

export type PlayerPosition = 'striker' | 'defence' | 'any';

export interface PublicUser {
  id: string;
  username: string;
  avatar: string;
  country: string;
  rating: number;
  tier: string;
  level: number;
  xp: number;
  coins: number;
  frame?: string;
  position?: PlayerPosition;
  online?: boolean;
  role?: 'player' | 'admin';
  email?: string;
  banned?: boolean;
  banReason?: string;
  createdAt?: string;
}

export interface ProfileStats {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  winRate: number;
  streak: number;
  bestStreak: number;
  highestRating: number;
}

export interface ProfileCosmetics {
  bio: string;
  frame: string;
  tableSkin: string;
  ballSkin: string;
  uniform: string;
  celebration: string;
  preferredPosition?: PlayerPosition;
  dailyStreak: number;
  lastDailyClaim: string | null;
}

export interface ProfileResponse {
  user: PublicUser;
  profile: ProfileCosmetics;
  stats: ProfileStats;
  achievements: AchievementView[];
  matchHistory: MatchHistoryEntry[];
  daily: { canClaim: boolean; streak: number; rewards: number[] };
  challenges: ChallengeView[];
}

export interface AchievementView {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  progress: number;
  target: number;
  reward: number;
  unlockedAt?: string;
}

export interface ChallengeView {
  id: string;
  title: string;
  target: number;
  progress: number;
  reward: number;
  xp: number;
  claimed: boolean;
  complete: boolean;
}

export interface MatchHistoryEntry {
  id: string;
  mode: string;
  playedAt: string;
  team: Team | null;
  myScore: number;
  opponentScore: number;
  outcome: 'win' | 'loss' | 'draw';
  ratingDelta: number;
  goals: number;
  partners: { username: string; avatar: string }[];
  opponents: { username: string; avatar: string }[];
  durationSec: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string;
  country: string;
  rating: number;
  tier: string;
  matches: number;
  winRate: number;
}

export interface MatchPlayerView {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  team: Team;
  slot: number;
  position?: 'striker' | 'defence';
  rating: number;
  online: boolean;
}

export interface MatchView {
  id: string;
  mode: 'quick' | 'private' | 'tournament' | 'practice';
  phase: 'waiting' | 'countdown' | 'live' | 'ended' | 'abandoned';
  teamA: MatchPlayerView[];
  teamB: MatchPlayerView[];
  score: { A: number; B: number };
  goalsToWin: number;
  timeLimitSec: number;
  startedAt: string | null;
  endedAt: string | null;
  winner: Team | null;
  roomCode?: string | null;
}

export interface ChatMessage {
  id: string;
  userId: string | null;
  username: string;
  avatar?: string;
  text: string;
  at: number;
  emoji?: boolean;
}

export interface FriendView {
  id: string;
  username: string;
  avatar: string;
  rating: number;
  tier: string;
  online: boolean;
  lastSeen: string | null;
}

export interface TournamentView {
  id: string;
  name: string;
  format: 'knockout' | 'league';
  status: 'open' | 'running' | 'finished';
  maxTeams: number;
  teams: { id: string; name: string; members: { username: string; avatar: string; rating: number }[]; seed: number }[];
  createdAt: string;
  standings: { teamId: string; name: string; played: number; won: number; lost: number; points: number; gf: number; ga: number }[];
}

export interface WsMatchReady {
  matchId: string;
  mode: string;
  opponents: PublicUser[];
  countdown: number;
}
