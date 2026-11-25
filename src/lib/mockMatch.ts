/**
 * Client-side simulation and match runner for offline / GitHub Pages play.
 *
 * Runs the authoritative foosball physics engine and AI bots directly inside the
 * browser so that Quick Match, Solo Practice, and 2v2 bot drills work with zero latency.
 */
import {
  createSimState,
  snapshot,
  stepSim,
  type InputMap,
  type SimPlayerInput,
  type SimState,
} from '../../shared/engine/physics';
import { createBot } from '../../shared/engine/bot';
import { MATCH, type Team } from '../../shared/engine/constants';
import type { MatchView, PublicUser } from '../../shared/types';
import { getMockSessionUser, recordMockMatchResult } from './mockBackend';

interface LocalMatch {
  id: string;
  mode: 'quick' | 'practice';
  solo: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
  sim: SimState;
  bots: Record<number, (s: SimState) => SimPlayerInput>;
  user: PublicUser;
  view: MatchView;
  playerInput: SimPlayerInput;
  timer: any | null;
  startedAt: number;
  phase: 'countdown' | 'live' | 'ended';
  goalsToWin: number;
}

const activeMatches: Record<string, LocalMatch> = {};
let latestPlayerInput: SimPlayerInput = { slide: 0, rear: 0, front: 0 };

export function setLocalPlayerInput(input: any) {
  latestPlayerInput = {
    slide: typeof input?.slide === 'number' ? Math.max(-1, Math.min(1, input.slide)) : 0,
    rear: typeof input?.rear === 'number' ? Math.max(-1, Math.min(1, input.rear)) : 0,
    front: typeof input?.front === 'number' ? Math.max(-1, Math.min(1, input.front)) : 0,
  };
}

export function createLocalMatch(opts: {
  mode?: 'quick' | 'practice';
  solo?: boolean;
  difficulty?: 'easy' | 'normal' | 'hard';
  user?: PublicUser;
}): LocalMatch {
  const mode = opts.mode || 'practice';
  const solo = !!opts.solo;
  const difficulty = opts.difficulty || 'normal';
  const id = 'local_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const user = opts.user || getMockSessionUser() || {
    id: 'usr_local',
    username: 'You',
    avatar: '⚽',
    country: 'BD',
    rating: 1000,
    tier: 'Bronze',
    level: 1,
    xp: 0,
    coins: 100,
  };

  const sim = createSimState({
    goalsToWin: mode === 'practice' && solo ? 5 : 10,
    timeLimitSec: mode === 'practice' ? 300 : 360,
  });

  const skill = difficulty === 'hard' ? 0.85 : difficulty === 'easy' ? 0.4 : 0.65;
  const bots: Record<number, (s: SimState) => SimPlayerInput> = {};

  if (solo) {
    // In solo drill, AI controls opponent Team B (slots 2 and 3)
    bots[2] = createBot(2, { skill, seed: 102 });
    bots[3] = createBot(3, { skill, seed: 103 });
  } else {
    // In 2v2: player is slot 0 (Team A goalie/midfield)
    // Slot 1 is teammate bot
    // Slots 2 & 3 are opposing bots
    bots[1] = createBot(1, { skill, seed: 101 });
    bots[2] = createBot(2, { skill, seed: 102 });
    bots[3] = createBot(3, { skill, seed: 103 });
  }

  const view: MatchView = {
    id,
    mode: mode === 'quick' ? 'quick' : 'practice',
    phase: 'countdown',
    teamA: [
      { id: 'p0', userId: user.id, username: user.username, avatar: user.avatar, team: 'A', slot: 0, rating: user.rating, online: true },
      { id: 'p1', userId: 'bot_teammate', username: solo ? 'Drill Mode' : 'Bot Teammate', avatar: '🤖', team: 'A', slot: 1, rating: user.rating, online: true },
    ],
    teamB: [
      { id: 'p2', userId: 'bot_rival1', username: 'Bot Striker', avatar: '🦈', team: 'B', slot: 2, rating: user.rating + 20, online: true },
      { id: 'p3', userId: 'bot_rival2', username: 'Bot Keeper', avatar: '🔥', team: 'B', slot: 3, rating: user.rating - 15, online: true },
    ],
    score: { A: 0, B: 0 },
    goalsToWin: mode === 'practice' && solo ? 5 : 10,
    timeLimitSec: mode === 'practice' ? 300 : 360,
    startedAt: new Date().toISOString(),
    endedAt: null,
    winner: null,
  };

  const match: LocalMatch = {
    id,
    mode,
    solo,
    difficulty,
    sim,
    bots,
    user,
    view,
    playerInput: { slide: 0, rear: 0, front: 0 },
    timer: null,
    startedAt: Date.now(),
    phase: 'countdown',
    goalsToWin: mode === 'practice' && solo ? 5 : 10,
  };

  activeMatches[id] = match;
  return match;
}

export function startLocalMatchLoop(matchId: string, socket: any) {
  const match = activeMatches[matchId];
  if (!match) return;

  // 1. Initial countdown
  socket.emit('match:countdown', { matchId, countdownMs: 2500, view: match.view });

  setTimeout(() => {
    if (!activeMatches[matchId]) return;
    match.phase = 'live';
    match.view.phase = 'live';
    socket.emit('match:live', { matchId, view: match.view });

    // 2. Physics simulation loop at 30 Hz
    let tickCount = 0;
    const interval = setInterval(() => {
      if (!activeMatches[matchId] || match.phase === 'ended') {
        clearInterval(interval);
        return;
      }

      tickCount++;
      const inputMap: InputMap = {};

      if (match.solo) {
        // Solo drill: player controls slot 0 and slot 1
        inputMap[0] = { ...latestPlayerInput };
        inputMap[1] = { ...latestPlayerInput };
      } else {
        inputMap[0] = { ...latestPlayerInput };
      }

      // Step bots
      for (const [slotStr, botFn] of Object.entries(match.bots)) {
        const slot = Number(slotStr);
        try {
          inputMap[slot] = botFn(match.sim);
        } catch {
          inputMap[slot] = { slide: 0, rear: 0, front: 0 };
        }
      }

      // Step authoritative physics
      const events = stepSim(match.sim, inputMap);

      // Forward events to audio/visuals
      for (const ev of events) {
        socket.emit('match:event', { matchId, event: ev });
      }

      // Sync score
      match.view.score = { ...match.sim.score };

      // Stream snapshot
      const snap = snapshot(match.sim);
      socket.emit('match:state', {
        matchId,
        snapshot: snap,
        view: match.view,
      });

      // Check win condition
      const target = match.goalsToWin;
      const timeUp = match.sim.timeLeftSec <= 0;
      const aWon = match.sim.score.A >= target;
      const bWon = match.sim.score.B >= target;

      if (aWon || bWon || timeUp) {
        match.phase = 'ended';
        match.view.phase = 'ended';
        const winner: Team | null = aWon ? 'A' : bWon ? 'B' : match.sim.score.A > match.sim.score.B ? 'A' : match.sim.score.B > match.sim.score.A ? 'B' : null;
        match.view.winner = winner;
        match.view.endedAt = new Date().toISOString();

        clearInterval(interval);

        const durationSec = Math.round((Date.now() - match.startedAt) / 1000);
        const won = winner === 'A';

        // Record stats to player profile
        recordMockMatchResult(match.user.id, {
          won,
          score: match.sim.score,
          myGoals: match.sim.score.A,
          durationSec,
        });

        socket.emit('match:end', {
          matchId,
          winner,
          score: match.sim.score,
          reason: aWon || bWon ? 'score_target' : 'time_limit',
          durationSec,
          view: match.view,
          results: {
            elo: {
              before: match.user.rating,
              delta: won ? 25 : -18,
              after: match.user.rating + (won ? 25 : -18),
            },
          },
        });
      }
    }, 1000 / 30);

    match.timer = interval;
  }, 2500);
}

export function cleanupLocalMatch(matchId: string) {
  const match = activeMatches[matchId];
  if (match) {
    if (match.timer) clearInterval(match.timer);
    delete activeMatches[matchId];
  }
}
