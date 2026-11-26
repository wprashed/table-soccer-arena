/**
 * Socket.IO layer: lobby presence, private rooms, quick-match queue,
 * live match traffic (inputs in / snapshots out), chat and invitations.
 *
 * The client only ever *sends inputs*. Everything competitive is produced by
 * the server simulation in match.ts.
 */
import type { Server, Socket } from 'socket.io';
import { MatchManager, type RuntimeMatch } from './match';
import { userForToken } from './auth';
import { db, now, uid } from './db';
import { blockedIds, getUserById, notify, publicUser, touchUser } from './store';
import { balanceTeams, pairKey, shouldFillWithBots, tryFormMatch, type QueueEntry } from './matchmaking';
import { MATCH } from '../shared/engine/constants';
import { createBot } from '../shared/engine/bot';

const BOT_NAMES = ['Bot Bruno', 'Bot Nika', 'Bot Rex', 'Bot Mira', 'Bot Kai', 'Bot Lena'];
const recentPairsByUser = new Map<string, Set<string>>();

interface QueuePlayer extends QueueEntry {
  socketId: string;
  username: string;
  avatar: string;
  allowBots: boolean;
  position?: 'striker' | 'defence' | 'any';
}

export function attachRealtime(io: Server, manager: MatchManager) {
  const queue: QueuePlayer[] = [];
  const privateRooms = new Map<string, RuntimeMatch>();
  let queueTimer: NodeJS.Timeout | null = null;

  const onlineCount = () => manager.sockets.size;

  function broadcastPresence(userId: string, online: boolean) {
    for (const [, set] of manager.sockets) {
      for (const sid of set) io.to(sid).emit('presence', { userId, online });
    }
  }

  function queueView() {
    return {
      count: queue.length,
      players: queue.map((q) => ({
        userId: q.userId,
        username: q.username,
        avatar: q.avatar,
        rating: q.rating,
        waitedMs: Date.now() - q.joinedAt,
      })),
      online: onlineCount(),
    };
  }
  const emitQueue = () => io.to('queue').emit('queue:update', queueView());

  function removeFromQueue(userId: string) {
    const i = queue.findIndex((q) => q.userId === userId);
    if (i >= 0) queue.splice(i, 1);
  }

  function recentPairSet(userIds: string[]) {
    const set = new Set<string>();
    for (const u of userIds) for (const p of recentPairsByUser.get(u) ?? []) set.add(p);
    return set;
  }

  function rememberPairs(m: RuntimeMatch) {
    const ids = m.seats.filter((s) => !s.isBot).map((s) => s.userId);
    for (const a of ids) {
      const set = recentPairsByUser.get(a) ?? new Set<string>();
      for (const b of ids) if (a !== b) set.add(pairKey(a, b));
      recentPairsByUser.set(a, set);
    }
  }

  function launchQuickMatch(entries: QueuePlayer[]) {
    const m = manager.create({
      mode: 'quick',
      seats: [
        ...entries.map((e, i) => ({
          userId: e.userId,
          username: e.username,
          avatar: e.avatar,
          rating: e.rating,
          team: (i < 2 ? 'A' : 'B') as 'A' | 'B',
          slot: i,
        })),
      ],
    });
    for (const e of entries) removeFromQueue(e.userId);
    rememberPairs(m);
    io.to('queue').emit('queue:matched', { matchId: m.id, view: manager.view(m) });
    for (const seat of m.seats) manager.emitToUser(seat.userId, 'match:invited', { matchId: m.id, view: manager.view(m) });
    manager.start(m, 4000);
    emitQueue();
  }

  function fillWithBots(entries: QueuePlayer[]) {
    // create a casual match: humans + bots, explicitly unrated
    const m = manager.create({
      mode: 'quick',
      rated: false,
      seats: entries.map((e, i) => ({
        userId: e.userId,
        username: e.username,
        avatar: e.avatar,
        rating: e.rating,
        team: (i < 2 ? 'A' : 'B') as 'A' | 'B',
        slot: i,
      })),
    });
    // top up empty slots with bots balanced by rating
    const taken = new Set(m.seats.map((s) => s.slot));
    const empties = [0, 1, 2, 3].filter((s) => !taken.has(s));
    empties.forEach((slot, i) => {
      manager.addBot(m, slot, slot < 2 ? 'A' : 'B', 0.45 + Math.random() * 0.3, BOT_NAMES[i % BOT_NAMES.length]);
    });
    m.seats.sort((a, b) => a.slot - b.slot);
    for (const e of entries) removeFromQueue(e.userId);
    io.to('queue').emit('queue:matched', { matchId: m.id, view: manager.view(m), bots: true });
    for (const seat of m.seats.filter((s) => !s.isBot)) {
      manager.emitToUser(seat.userId, 'match:invited', { matchId: m.id, view: manager.view(m), bots: true });
    }
    manager.start(m, 4000);
    emitQueue();
  }

  function tickQueue() {
    if (queue.length === 0) return;
    const formed = tryFormMatch(queue, {
      recentPairs: recentPairSet(queue.map((q) => q.userId)),
      baseBand: 120,
      bandPerSecond: 35,
      now: () => Date.now(),
    });
    if (formed) {
      const pick = [...formed.teamA, ...formed.teamB].map(
        (e) => queue.find((q) => q.userId === e.userId)!
      );
      // order so teamA slots 0,1 and teamB slots 2,3
      const ordered = [...formed.teamA, ...formed.teamB].map((e) => queue.find((q) => q.userId === e.userId)!);
      launchQuickMatch(ordered);
      return;
    }
    if (shouldFillWithBots(queue, Date.now(), 18_000)) {
      // keep the balance rule: pair the waiting humans with bots
      const ready = queue.filter((q) => Date.now() - q.joinedAt >= 18_000);
      if (ready.length) fillWithBots(ready.slice(0, 4));
    }
  }

  queueTimer = setInterval(tickQueue, 1000);

  io.on('connection', (socket: Socket) => {
    let userId: string | null = null;

    const identify = (token?: string) => {
      if (!token) return null;
      const u = userForToken(token);
      if (!u) return null;
      userId = u.id;
      manager.bindUserSocket(u.id, socket.id);
      touchUser(u.id);
      broadcastPresence(u.id, true);
      socket.emit('ready', { userId: u.id, username: u.username, online: onlineCount() });
      return u;
    };

    socket.on('auth', ({ token }: { token?: string }) => identify(token));

    /**
     * Resolve the caller: prefer an explicit token (first packet after a
     * reconnect) but otherwise trust the identity this socket already
     * authenticated with, so clients never have to resend credentials.
     */
    const resolveCaller = (token?: string) => {
      if (token) {
        const u = userForToken(token);
        if (u) {
          if (userId !== u.id) identify(token);
          return u;
        }
      }
      if (!userId) return null;
      const row = getUserById(userId);
      return row ? { id: row.id, username: row.username, role: row.role } : null;
    };

    // ------------------------------------------------------------ presence
    socket.on('presence:ping', () => {
      if (userId) touchUser(userId);
      socket.emit('presence:pong', { online: onlineCount() });
    });

    socket.on('lobby:hello', () => {
      socket.emit('lobby:state', { online: onlineCount(), queue: queueView() });
    });

    // ---------------------------------------------------------- private room
    socket.on('room:create', ({ token, goalsToWin, timeLimitSec, rated }: any, ack?: Function) => {
      const u = resolveCaller(token);
      if (!u) return ack?.({ ok: false, error: 'Sign in to create a room' });
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const m = manager.create({
        mode: 'private',
        roomCode: code,
        rated: rated !== false,
        goalsToWin: clampInt(goalsToWin, 3, 10, 10),
        timeLimitSec: clampInt(timeLimitSec, 60, 900, MATCH.defaultTimeLimitSec),
        seats: [
          {
            userId: u.id,
            username: u.username,
            avatar: getUserById(u.id)?.avatar ?? '⚽',
            rating: ratingOf(u.id),
            team: 'A',
            slot: 0,
          },
        ],
      });
      privateRooms.set(code, m);
      socket.join(`match:${m.id}`);
      ack?.({ ok: true, matchId: m.id, code, view: manager.view(m) });
    });

    socket.on('room:join', ({ token, code }: any, ack?: Function) => {
      const u = resolveCaller(token);
      if (!u) return ack?.({ ok: false, error: 'Sign in to join a room' });
      const m = privateRooms.get(String(code ?? '').trim());
      if (!m) return ack?.({ ok: false, error: 'Room not found — check the code' });
      if (m.phase !== 'waiting') return ack?.({ ok: false, error: 'That match already started' });
      if (m.seats.some((s) => s.userId === u.id)) {
        socket.join(`match:${m.id}`);
        return ack?.({ ok: true, matchId: m.id, code: m.roomCode, view: manager.view(m) });
      }
      if (m.seats.length >= 4) return ack?.({ ok: false, error: 'Room is full' });
      const slot = [0, 1, 2, 3].find((s) => !m.seats.some((x) => x.slot === s))!;
      m.seats.push({
        userId: u.id,
        username: u.username,
        avatar: getUserById(u.id)?.avatar ?? '⚽',
        rating: ratingOf(u.id),
        team: slot < 2 ? 'A' : 'B',
        slot,
        connected: true,
        lockedUntil: 0,
        disconnectAt: null,
        goals: 0,
        touches: 0,
        shots: 0,
        isBot: false,
      });
      socket.join(`match:${m.id}`);
      manager.broadcast(m, 'room:update', { view: manager.view(m) });
      ack?.({ ok: true, matchId: m.id, code: m.roomCode, view: manager.view(m) });
    });

    socket.on('room:leave', ({ matchId }: any) => {
      if (!userId) return;
      const m = manager.matches.get(String(matchId));
      if (!m || m.phase === 'live') return;
      m.seats = m.seats.filter((s) => s.userId !== userId);
      socket.leave(`match:${m.id}`);
      manager.broadcast(m, 'room:update', { view: manager.view(m) });
    });

    socket.on('room:start', ({ matchId }: any, ack?: Function) => {
      if (!userId) return ack?.({ ok: false, error: 'Sign in first' });
      const m = manager.matches.get(String(matchId));
      if (!m) return ack?.({ ok: false, error: 'Room not found' });
      if (m.seats[0]?.userId !== userId) return ack?.({ ok: false, error: 'Only the host can start' });
      if (m.seats.length < 4) return ack?.({ ok: false, error: 'Need 4 players — invite a friend' });
      manager.start(m, 3500);
      ack?.({ ok: true });
    });

    socket.on('room:add-bot', ({ matchId, slot }: any, ack?: Function) => {
      if (!userId) return ack?.({ ok: false, error: 'Sign in first' });
      const m = manager.matches.get(String(matchId));
      if (!m) return ack?.({ ok: false, error: 'Room not found' });
      if (m.seats[0]?.userId !== userId) return ack?.({ ok: false, error: 'Only the host can add bots' });
      if (m.phase !== 'waiting') return ack?.({ ok: false, error: 'Too late' });
      const s = Number(slot);
      if (![0, 1, 2, 3].includes(s)) return ack?.({ ok: false, error: 'Bad slot' });
      manager.addBot(m, s, s < 2 ? 'A' : 'B', 0.6, BOT_NAMES[s]);
      m.seats.sort((a, b) => a.slot - b.slot);
      manager.broadcast(m, 'room:update', { view: manager.view(m) });
      ack?.({ ok: true, view: manager.view(m) });
    });

    socket.on('room:invite', ({ toUserId, matchId }: any, ack?: Function) => {
      if (!userId) return ack?.({ ok: false, error: 'Sign in first' });
      const m = manager.matches.get(String(matchId));
      if (!m) return ack?.({ ok: false, error: 'Room not found' });
      const target = getUserById(String(toUserId));
      if (!target) return ack?.({ ok: false, error: 'Player not found' });
      if (blockedIds(target.id).includes(userId)) return ack?.({ ok: false, error: 'Unable to invite' });
      db.prepare(
        `INSERT INTO match_invitations (match_id, from_user, to_user, created_at) VALUES (?,?,?,?)`
      ).run(m.id, userId, target.id, now());
      notify(target.id, 'invite', 'Match invitation', `${getUserById(userId)?.username} invited you to room ${m.roomCode}`);
      manager.emitToUser(target.id, 'room:invited', {
        matchId: m.id,
        code: m.roomCode,
        from: getUserById(userId)?.username,
      });
      ack?.({ ok: true });
    });

    // ---------------------------------------------------------- matchmaking
    socket.on('queue:join', ({ token, allowBots, position }: any, ack?: Function) => {
      const u = resolveCaller(token);
      if (!u) return ack?.({ ok: false, error: 'Sign in to play ranked' });
      const pos = position || 'striker';
      const existing = queue.find((q) => q.userId === u.id);
      if (existing) {
        existing.position = pos;
      } else {
        queue.push({
          userId: u.id,
          socketId: socket.id,
          username: u.username,
          avatar: getUserById(u.id)?.avatar ?? '⚽',
          rating: ratingOf(u.id),
          joinedAt: Date.now(),
          latency: 40,
          allowBots: allowBots !== false,
          position: pos,
        });
      }
      socket.join('queue');
      ack?.({ ok: true, queue: queueView() });
      emitQueue();
    });

    socket.on('match:swap_position', ({ matchId }: any) => {
      const m = manager.matches.get(String(matchId));
      if (!m || m.mode !== 'practice') return;
      const u = resolveCaller();
      if (!u) return;
      const mySeat = m.seats.find((s) => s.userId === u.id);
      const botSeat = m.seats.find((s) => s.team === 'A' && s.userId !== u.id);
      if (mySeat && botSeat) {
        const oldMySlot = mySeat.slot;
        mySeat.slot = botSeat.slot;
        botSeat.slot = oldMySlot;
        botSeat.bot = createBot(botSeat.slot, { skill: 0.65 });
        m.seats.sort((a, b) => a.slot - b.slot);
        io.to(`match:${m.id}`).emit('match:position_swapped', {
          matchId: m.id,
          newSlot: mySeat.slot,
          view: manager.view(m),
        });
      }
    });

    socket.on('queue:leave', (_p: any, ack?: Function) => {
      if (userId) {
        removeFromQueue(userId);
        socket.leave('queue');
      }
      ack?.({ ok: true });
      emitQueue();
    });

    // --------------------------------------------------------------- match
    socket.on('match:join', ({ matchId }: any, ack?: Function) => {
      const m = manager.matches.get(String(matchId));
      if (!m) return ack?.({ ok: false, error: 'Match not found' });
      socket.join(`match:${m.id}`);
      ack?.({
        ok: true,
        view: manager.view(m),
        snapshot: {
          tick: m.sim.tick,
          phase: m.sim.phase === 'playing' ? 'playing' : m.sim.phase,
          score: m.sim.score,
          timeLeft: m.sim.timeLeft,
          kickoffLeft: m.sim.kickoffLeft,
          ball: [m.sim.ball.x, m.sim.ball.z, m.sim.ball.vx, m.sim.ball.vz],
          rods: m.sim.rods.map((r) => [r.slide, r.angle]),
          lastTouch: m.sim.lastTouch,
          t: Date.now(),
        },
        phase: m.phase,
        seat: userId ? m.seats.find((s) => s.userId === userId)?.slot ?? null : null,
        solo: m.mode === 'practice' && m.seats.length === 1,
        chat: db
          .prepare(`SELECT * FROM chat_messages WHERE match_id=? ORDER BY id DESC LIMIT 30`)
          .all(m.id)
          .reverse(),
      });
    });

    // Client -> server: inputs only. 40 Hz.
    socket.on('match:input', ({ matchId, slide, rear, front, allRods }: any) => {
      if (!userId) return;
      const m = manager.matches.get(String(matchId));
      if (!m) return;
      if (allRods) manager.applyAllRodsInput(m, userId, allRods);
      else manager.applyInput(m, userId, { slide, rear, front });
    });

    socket.on('match:chat', ({ matchId, text, emoji }: any, ack?: Function) => {
      if (!userId) return ack?.({ ok: false, error: 'Sign in first' });
      const m = manager.matches.get(String(matchId));
      if (!m) return ack?.({ ok: false, error: 'Match not found' });
      const clean = String(text ?? '').slice(0, 120).trim();
      if (!clean) return ack?.({ ok: false, error: 'Empty message' });
      const u = getUserById(userId);
      const row = db
        .prepare(`INSERT INTO chat_messages (match_id, user_id, username, text, created_at) VALUES (?,?,?,?,?)`)
        .run(m.id, userId, u?.username ?? 'Player', clean, now());
      const msg = {
        id: String(row.lastInsertRowid),
        userId,
        username: u?.username ?? 'Player',
        avatar: u?.avatar,
        text: clean,
        emoji: !!emoji,
        at: Date.now(),
      };
      manager.broadcast(m, 'match:chat', msg);
      ack?.({ ok: true });
    });

    // ---------------------------------------------------------- practice
    /**
     * Practice: always a real server-simulated match.
     *  solo  -> the caller drives all four seats (their own two rods + bots elsewhere)
     *  2v2   -> the caller takes seat 0 and bots fill the rest
     */
    socket.on('practice:start', ({ token, difficulty, solo, position }: any, ack?: Function) => {
      const u = resolveCaller(token);
      const skill = difficulty === 'easy' ? 0.32 : difficulty === 'hard' ? 0.86 : 0.6;
      const playerSlot = position === 'defence' ? 0 : 1;
      const botSlot = playerSlot === 0 ? 1 : 0;
      const m = manager.create({
        mode: 'practice',
        rated: false,
        goalsToWin: 5,
        timeLimitSec: 240,
        seats: u
          ? [{ userId: u.id, username: u.username, avatar: '⚽', rating: 1000, team: 'A', slot: playerSlot }]
          : [],
      });
      const taken = new Set(m.seats.map((s) => s.slot));
      if (!solo) {
        if (u) {
          m.seats.push({
            userId: `bot_${m.id}_${botSlot}`,
            username: botSlot === 0 ? 'Bot Defender' : 'Bot Striker',
            avatar: botSlot === 0 ? '🛡️' : '⚽',
            rating: 1000,
            team: 'A',
            slot: botSlot,
            connected: true,
            lockedUntil: 0,
            disconnectAt: null,
            goals: 0,
            touches: 0,
            shots: 0,
            isBot: true,
            bot: createBot(botSlot, { skill }),
          });
          taken.add(botSlot);
        }
        [2, 3].forEach((slot) => {
          if (!taken.has(slot)) manager.addBot(m, slot, 'B', skill, slot === 2 ? 'Bot Rex' : 'Bot Mira');
        });
      }
      m.seats.sort((a, b) => a.slot - b.slot);
      socket.join(`match:${m.id}`);
      manager.start(m, 2500);
      ack?.({
        ok: true,
        matchId: m.id,
        slot: playerSlot,
        seat: playerSlot,
        solo: !!solo,
        view: manager.view(m),
      });
    });

    // ----------------------------------------------------------- spectators
    socket.on('match:spectate', ({ matchId }: any, ack?: Function) => {
      const m = manager.matches.get(String(matchId));
      if (!m) return ack?.({ ok: false, error: 'Match not found' });
      socket.join(`match:${m.id}`);
      ack?.({ ok: true, view: manager.view(m), slot: null });
    });

    socket.on('match:leave', ({ matchId }: any) => {
      socket.leave(`match:${String(matchId)}`);
    });

    socket.on('disconnect', () => {
      if (userId) {
        const stillOnline = manager.sockets.get(userId)?.size
          ? [...manager.sockets.get(userId)!].some((s) => s !== socket.id)
          : false;
        manager.unbindSocket(socket.id);
        if (!stillOnline) {
          broadcastPresence(userId, false);
          // keep them in the queue briefly? No — leaving the socket means they're gone.
          removeFromQueue(userId);
          emitQueue();
        }
      } else {
        manager.unbindSocket(socket.id);
      }
    });
  });

  return () => {
    if (queueTimer) clearInterval(queueTimer);
  };
}

function ratingOf(userId: string) {
  const r = db.prepare(`SELECT rating FROM player_ratings WHERE user_id=?`).get(userId) as any;
  return r?.rating ?? 1000;
}
function clampInt(v: any, min: number, max: number, dflt: number) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

export { balanceTeams };
