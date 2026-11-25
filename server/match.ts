/**
 * Authoritative match runtime.
 *
 * Every match is a fixed-timestep simulation running on the server, driven only
 * by validated input packets from the four seated players. Clients receive
 * snapshots (30 Hz) and events; they never send scores, ball positions or
 * ratings. Settlement happens exactly once, in `finalise()`.
 */
import type { Server, Socket } from 'socket.io';
import {
  createSimState,
  finishMatch,
  snapshot,
  stepSim,
  type InputMap,
  type SimPlayerInput,
  type SimState,
} from '../shared/engine/physics';
import { createBot } from '../shared/engine/bot';
import { MATCH, type Team } from '../shared/engine/constants';
import { db, now, uid } from './db';
import { settleMatch, getUserById, notify } from './store';

export interface Seat {
  userId: string;
  username: string;
  avatar: string;
  rating: number;
  team: Team;
  slot: number;
  connected: boolean;
  lockedUntil: number;
  disconnectAt: number | null;
  goals: number;
  touches: number;
  shots: number;
  isBot: boolean;
  bot?: (s: SimState) => SimPlayerInput;
}

export interface RuntimeMatch {
  id: string;
  mode: 'quick' | 'private' | 'tournament' | 'practice';
  roomCode: string | null;
  tournamentId: string | null;
  rated: boolean;
  sim: SimState;
  seats: Seat[];
  phase: 'waiting' | 'countdown' | 'live' | 'ended';
  goalsToWin: number;
  timeLimitSec: number;
  timer: NodeJS.Timeout | null;
  startedAt: number;
  lastSnapshot: number;
  endedAt: number | null;
  results: any | null;
  /** rolling anti-cheat counters */
  inputCount: number;
  suspicious: number;
  /** goals per seat — used for collusion / own-goal heuristics */
  goalTimeline: { at: number; team: Team; touchSlot: number | null }[];
}

const MAX_INPUT_HZ = 45;

export class MatchManager {
  matches = new Map<string, RuntimeMatch>();
  /** userId -> socket ids (a user may have several tabs) */
  sockets = new Map<string, Set<string>>();
  /** socket id -> {userId, matchId} */
  socketInfo = new Map<string, { userId: string | null; matchId?: string }>();

  constructor(private io: Server) {}

  // -- socket registry -----------------------------------------------------
  bindUserSocket(userId: string, socketId: string) {
    if (!this.sockets.has(userId)) this.sockets.set(userId, new Set());
    this.sockets.get(userId)!.add(socketId);
    this.socketInfo.set(socketId, { userId });
  }
  unbindSocket(socketId: string) {
    const info = this.socketInfo.get(socketId);
    this.socketInfo.delete(socketId);
    if (info?.userId) {
      this.sockets.get(info.userId)?.delete(socketId);
      if (this.sockets.get(info.userId)?.size === 0) this.sockets.delete(info.userId);
    }
  }
  isOnline(userId: string) {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }
  emitToUser(userId: string, event: string, payload: any) {
    for (const sid of this.sockets.get(userId) ?? []) this.io.to(sid).emit(event, payload);
  }

  // -- lifecycle -----------------------------------------------------------
  create(opts: {
    mode: RuntimeMatch['mode'];
    seats: Omit<Seat, 'connected' | 'lockedUntil' | 'disconnectAt' | 'goals' | 'touches' | 'shots' | 'isBot'>[];
    roomCode?: string | null;
    tournamentId?: string | null;
    rated?: boolean;
    goalsToWin?: number;
    timeLimitSec?: number;
  }): RuntimeMatch {
    const id = uid('m_');
    const m: RuntimeMatch = {
      id,
      mode: opts.mode,
      roomCode: opts.roomCode ?? null,
      tournamentId: opts.tournamentId ?? null,
      rated: opts.rated ?? opts.mode !== 'practice',
      sim: createSimState({ timeLimitSec: opts.timeLimitSec ?? MATCH.defaultTimeLimitSec }),
      seats: opts.seats.map((s) => ({
        ...s,
        connected: true,
        lockedUntil: 0,
        disconnectAt: null,
        goals: 0,
        touches: 0,
        shots: 0,
        isBot: false,
      })),
      phase: 'waiting',
      goalsToWin: opts.goalsToWin ?? MATCH.goalsToWin,
      timeLimitSec: opts.timeLimitSec ?? MATCH.defaultTimeLimitSec,
      timer: null,
      startedAt: 0,
      lastSnapshot: 0,
      endedAt: null,
      results: null,
      inputCount: 0,
      suspicious: 0,
      goalTimeline: [],
    };
    this.matches.set(id, m);
    db.prepare(
      `INSERT OR IGNORE INTO matches (id, mode, status, goals_to_win, time_limit_sec, room_code, tournament_id, rated, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      m.mode,
      'waiting',
      m.goalsToWin,
      m.timeLimitSec,
      m.roomCode,
      m.tournamentId,
      m.rated ? 1 : 0,
      now()
    );
    return m;
  }

  seatFor(m: RuntimeMatch, userId: string) {
    return m.seats.find((s) => s.userId === userId);
  }

  /** Assign a bot to an empty seat (practice mode / queue tops-up). */
  addBot(m: RuntimeMatch, slot: number, team: Team, skill: number, name: string) {
    const seat: Seat = {
      userId: `bot_${m.id}_${slot}`,
      username: name,
      avatar: '🤖',
      rating: 1000,
      team,
      slot,
      connected: true,
      lockedUntil: 0,
      disconnectAt: null,
      goals: 0,
      touches: 0,
      shots: 0,
      isBot: true,
      bot: createBot(slot, { skill }),
    };
    const idx = m.seats.findIndex((s) => s.slot === slot);
    if (idx >= 0) m.seats[idx] = seat;
    else m.seats.push(seat);
  }

  start(m: RuntimeMatch, countdownMs = 3500) {
    if (m.phase !== 'waiting') return;
    m.phase = 'countdown';
    this.broadcast(m, 'match:countdown', { matchId: m.id, countdownMs, view: this.view(m) });
    setTimeout(() => {
      if (m.phase !== 'countdown') return;
      m.phase = 'live';
      m.startedAt = Date.now();
      m.sim.phase = 'kickoff';
      m.sim.kickoffLeft = MATCH.kickoffPauseSec;
      this.broadcast(m, 'match:live', { matchId: m.id, view: this.view(m) });
      this.runLoop(m);
    }, Math.max(0, countdownMs));
  }

  private runLoop(m: RuntimeMatch) {
    const interval = 1000 / MATCH.tickRate;
    let last = process.hrtime.bigint();
    let acc = 0;
    m.timer = setInterval(() => {
      const t = process.hrtime.bigint();
      const elapsed = Number(t - last) / 1e6;
      last = t;
      acc = Math.min(acc + elapsed, 250); // never death-spiral

      const inputs: InputMap = {};
      for (let slot = 0; slot < 4; slot++) inputs[slot] = { slide: 0, rear: 0, front: 0 };
      const soloPractice = m.mode === 'practice' && m.seats.length === 1 && !m.seats[0].isBot;
      for (const seat of m.seats) {
        if (seat.isBot && seat.bot) inputs[seat.slot] = seat.bot(m.sim);
        else inputs[seat.slot] = this.currentInputs.get(seat.userId) ?? { slide: 0, rear: 0, front: 0 };
      }
      if (soloPractice) {
        for (let slot = 0; slot < 4; slot++) {
          if (!m.seats.some((s) => s.slot === slot)) {
            inputs[slot] = this.allRodInputs[slot] ?? { slide: 0, rear: 0, front: 0 };
          }
        }
      }

      while (acc >= interval) {
        acc -= interval;
        const events = stepSim(m.sim, inputs, {
          goalsToWin: m.goalsToWin,
          timeLimitSec: m.timeLimitSec,
        });
        for (const ev of events) {
          if (ev.type === 'goal') {
            const scorerTeam = ev.team;
            // attribute the goal to the last toucher on that team if we know them
            const toucher = m.seats.find(
              (s) => s.team === scorerTeam && s.slot === m.sim.lastTouch.slot
            );
            if (toucher) toucher.goals++;
            m.goalTimeline.push({ at: Date.now(), team: scorerTeam, touchSlot: m.sim.lastTouch.slot });
            this.logEvent(m, m.sim.tick, 'goal', scorerTeam, { score: ev.score });
            this.flagSuspiciousScoring(m, scorerTeam);
            this.broadcast(m, 'match:event', { matchId: m.id, event: ev, view: this.view(m) });
          } else if (ev.type === 'kick') {
            const toucher = m.seats.find((s) => s.slot === ev.slot);
            if (toucher) {
              toucher.touches++;
              if (ev.power > 0.25) toucher.shots++;
            }
            this.broadcast(m, 'match:event', { matchId: m.id, event: ev });
          } else if (ev.type === 'end') {
            this.broadcast(m, 'match:event', { matchId: m.id, event: ev });
          }
        }
        if (m.sim.phase === 'ended') break;
      }

      const nowMs = Date.now();
      if (nowMs - m.lastSnapshot >= 1000 / MATCH.snapshotRate) {
        m.lastSnapshot = nowMs;
        this.broadcast(m, 'match:state', {
          matchId: m.id,
          snapshot: snapshot(m.sim),
          view: this.view(m),
        });
      }

      this.checkConnections(m);
      if (m.sim.phase === 'ended') this.finalise(m);
    }, interval);
  }

  currentInputs = new Map<string, SimPlayerInput>();

  /**
   * Solo practice: one human seat owns every rod. The four packets the client
   * sends (one per slot) are mapped back onto that single user id.
   */
  applyAllRodsInput(m: RuntimeMatch, userId: string, perSlot: Record<number, SimPlayerInput>) {
    const seat = this.seatFor(m, userId);
    if (!seat || m.phase !== 'live') return;
    const t = Date.now();
    if (t < seat.lockedUntil) return;
    seat.lockedUntil = t + 1000 / MAX_INPUT_HZ;
    for (let slot = 0; slot < 4; slot++) {
      const raw = perSlot[slot] ?? { slide: 0, rear: 0, front: 0 };
      const clean = (v: any) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        if (Math.abs(n) > 1.0001) m.suspicious++;
        return Math.max(-1, Math.min(1, n));
      };
      this.allRodInputs[slot] = { slide: clean(raw.slide), rear: clean(raw.rear), front: clean(raw.front) };
    }
  }

  allRodInputs: Record<number, SimPlayerInput> = {};

  /** Called from the socket handler. Rate-limited + validated. */
  applyInput(m: RuntimeMatch, userId: string, raw: any) {
    const seat = this.seatFor(m, userId);
    if (!seat || m.phase !== 'live') return;
    const t = Date.now();
    if (t < seat.lockedUntil) return;
    seat.lockedUntil = t + 1000 / MAX_INPUT_HZ;

    const clean = (v: any) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      // illegal input detection: clients are only ever allowed -1..1
      if (Math.abs(n) > 1.0001) m.suspicious++;
      return Math.max(-1, Math.min(1, n));
    };
    this.currentInputs.set(userId, {
      slide: clean(raw?.slide),
      rear: clean(raw?.rear),
      front: clean(raw?.front),
    });
  }

  private checkConnections(m: RuntimeMatch) {
    const cut = Date.now() - MATCH.reconnectionWindowSec * 1000;
    const humans = m.seats.filter((s) => !s.isBot);
    for (const seat of humans) {
      const online = this.isOnline(seat.userId);
      if (!online && seat.connected) {
        seat.connected = false;
        seat.disconnectAt = Date.now();
        db.prepare(`UPDATE match_players SET connected=0 WHERE match_id=? AND user_id=?`).run(m.id, seat.userId);
        this.broadcast(m, 'match:connection', { matchId: m.id, userId: seat.userId, online: false });
        this.currentInputs.delete(seat.userId);
      } else if (online && !seat.connected) {
        seat.connected = true;
        seat.disconnectAt = null;
        db.prepare(`UPDATE match_players SET connected=1 WHERE match_id=? AND user_id=?`).run(m.id, seat.userId);
        this.broadcast(m, 'match:connection', { matchId: m.id, userId: seat.userId, online: true });
      }
    }

    const teamAbandoned = (team: Team) => {
      const members = humans.filter((s) => s.team === team);
      return members.length > 0 && members.every((s) => s.disconnectAt !== null && s.disconnectAt < cut);
    };
    if (teamAbandoned('A') || teamAbandoned('B')) {
      const winner: Team = teamAbandoned('A') ? 'B' : 'A';
      finishMatch(m.sim, winner, 'abandon');
      this.finalise(m);
    }
  }

  finalise(m: RuntimeMatch) {
    if (m.phase === 'ended') return;
    m.phase = 'ended';
    m.endedAt = Date.now();
    if (m.timer) clearInterval(m.timer);
    m.timer = null;

    const winner = m.sim.winner;
    const durationSec = Math.max(1, Math.round((m.endedAt - (m.startedAt || m.endedAt)) / 1000));
    const humans = m.seats.filter((s) => !s.isBot);

    if (m.mode !== 'practice' && humans.length) {
      const pack = (team: Team) =>
        m.seats
          .filter((s) => s.team === team)
          .map((s) => ({ userId: s.userId, goals: s.goals, touches: s.touches, shots: s.shots }));

      const aAll = pack('A');
      const bAll = pack('B');
      const aHumans = aAll.filter((p) => !p.userId.startsWith('bot_'));
      const bHumans = bAll.filter((p) => !p.userId.startsWith('bot_'));

      m.results = settleMatch({
        matchId: m.id,
        mode: m.mode,
        teamA: aHumans,
        teamB: bHumans,
        scoreA: m.sim.score.A,
        scoreB: m.sim.score.B,
        winner: m.sim.winner,
        endReason: m.sim.endReason ?? 'goals',
        goalsToWin: m.goalsToWin,
        timeLimitSec: m.timeLimitSec,
        durationSec,
        // A ranked match needs two humans a side; bot partners make it casual
        rated: m.rated && aHumans.length === 2 && bHumans.length === 2,
        tournamentId: m.tournamentId,
        roomCode: m.roomCode,
      });

      this.logEvent(m, m.sim.tick, 'end', winner, {
        score: m.sim.score,
        reason: m.sim.endReason,
        durationSec,
      });

      for (const seat of humans) {
        notify(
          seat.userId,
          'match_end',
          winner === seat.team ? 'Victory!' : winner === null ? 'Draw' : 'Defeat',
          `${seat.team === 'A' ? 'A' : 'B'}: ${m.sim.score.A} — ${m.sim.score.B}`
        );
      }
    }

    this.broadcast(m, 'match:end', {
      matchId: m.id,
      winner,
      score: m.sim.score,
      reason: m.sim.endReason,
      durationSec,
      view: this.view(m),
      results: m.results,
    });
  }

  /**
   * Heuristics for result manipulation. Nothing is auto-punished from a single
   * match — flags are written to the audit log for moderators to review.
   */
  private flagSuspiciousScoring(m: RuntimeMatch, scoringTeam: Team) {
    const last = m.sim.lastTouch;
    if (last.team && last.team !== scoringTeam) {
      // the scorer's own team did not touch the ball last => own goal
      db.prepare(`INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`).run(
        'anticheat',
        'anticheat.own_goal',
        m.id,
        JSON.stringify({ scoringTeam, lastTouch: last, score: m.sim.score }),
        now()
      );
      m.suspicious += 2;
    }
    // rapid-fire scoring (< 3s apart) usually means a feeding collusion pattern
    const recent = m.goalTimeline.filter((g) => Date.now() - g.at < 3000);
    if (recent.length >= 4) {
      db.prepare(`INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`).run(
        'anticheat',
        'anticheat.rapid_scoring',
        m.id,
        JSON.stringify({ goals: recent.length, score: m.sim.score }),
        now()
      );
      m.suspicious += 3;
    }
    if (m.suspicious >= 10) {
      db.prepare(`INSERT INTO audit_log (actor, action, target, meta, created_at) VALUES (?,?,?,?,?)`).run(
        'anticheat',
        'anticheat.flag_match',
        m.id,
        JSON.stringify({ suspicious: m.suspicious, score: m.sim.score }),
        now()
      );
    }
  }

  private logEvent(m: RuntimeMatch, tick: number, type: string, team: Team | null, payload: any) {
    db.prepare(
      `INSERT INTO match_events (match_id, tick, type, team, payload, created_at) VALUES (?,?,?,?,?,?)`
    ).run(m.id, tick, type, team, JSON.stringify(payload), now());
  }

  view(m: RuntimeMatch) {
    const p = (s: Seat) => ({
      id: s.userId,
      userId: s.userId,
      username: s.username,
      avatar: s.avatar,
      team: s.team,
      slot: s.slot,
      rating: s.rating,
      online: s.isBot ? true : this.isOnline(s.userId),
    });
    return {
      id: m.id,
      mode: m.mode,
      phase: m.phase,
      teamA: m.seats.filter((s) => s.team === 'A').sort((a, b) => a.slot - b.slot).map(p),
      teamB: m.seats.filter((s) => s.team === 'B').sort((a, b) => a.slot - b.slot).map(p),
      score: { ...m.sim.score },
      goalsToWin: m.goalsToWin,
      timeLimitSec: m.timeLimitSec,
      startedAt: m.startedAt ? new Date(m.startedAt).toISOString() : null,
      endedAt: m.endedAt ? new Date(m.endedAt).toISOString() : null,
      winner: m.sim.winner,
      roomCode: m.roomCode,
    };
  }

  broadcast(m: RuntimeMatch, event: string, payload: any) {
    this.io.to(`match:${m.id}`).emit(event, payload);
  }

  cleanup() {
    for (const m of this.matches.values()) {
      if (m.timer) clearInterval(m.timer);
    }
  }

  findPrivateRoom(code: string) {
    for (const m of this.matches.values()) {
      if (m.roomCode === code && m.phase === 'waiting') return m;
    }
    return null;
  }
}

export type { Socket };
