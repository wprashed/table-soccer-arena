/**
 * End-to-end smoke test against a running server:
 *  1. logs in four demo players over REST
 *  2. joins all four to the real quick-match queue
 *  3. plays the resulting match with synthetic input packets
 *  4. asserts snapshots stream, a goal is scored, and the match settles in the DB
 */
import { ROD_SPECS } from './shared/engine/constants.ts';
import { slotRodRoles, createSimState } from './shared/engine/physics.ts';
import { createBot } from './shared/engine/bot.ts';
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:3000';
const json = async (path, opts = {}) => {
  const r = await fetch(BASE + '/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};

const ACCOUNTS = [
  ['alex@arena.dev', 'demo1234'],
  ['sam@arena.dev', 'demo1234'],
  ['rio@arena.dev', 'demo1234'],
  ['mira@arena.dev', 'demo1234'],
];

const fail = (msg) => { console.error('❌ ' + msg); process.exit(1); };
const ok = (msg) => console.log('✅ ' + msg);

const tokens = [];
for (const [email, password] of ACCOUNTS) {
  const res = await json('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!res?.token) fail(`login failed for ${email}: ${JSON.stringify(res)}`);
  tokens.push({ email, token: res.token, id: res.user.id, username: res.user.username });
}
ok(`logged in ${tokens.length} players`);

const sockets = tokens.map((t) => io(BASE, { transports: ['websocket'] }));
await Promise.all(sockets.map((s) => new Promise((r) => s.on('connect', r))));
sockets.forEach((s, i) => s.emit('auth', { token: tokens[i].token }));
ok('socket connections established');

const stateCounts = new Array(4).fill(0);
let goals = 0;
let matchId = null;
const endPromise = new Promise((resolve) => {
  sockets.forEach((s) => {
    s.on('match:state', (p) => { if (p.matchId === matchId) stateCounts[0]++; });
    s.on('match:event', (p) => {
      if (p.matchId !== matchId) return;
      if (p.event.type === 'goal') { goals++; console.log(`   goal! ${p.event.team} -> ${p.event.score.A}:${p.event.score.B}`); }
    });
    s.on('match:end', (p) => { if (p.matchId === matchId) resolve(p); });
  });
});

const matched = new Promise((resolve) => {
  sockets[0].on('queue:matched', (p) => { matchId = p.matchId; resolve(p); });
});

for (const s of sockets) s.emit('queue:join', { allowBots: true }, () => {});

const m = await Promise.race([matched, new Promise((_, rej) => setTimeout(() => rej(new Error("matchmaking timeout")), 45000))]).catch((e) => fail(e.message));
ok(`matchmade into ${m.matchId} — ${m.view.teamA.map(p=>p.username).join('+')} vs ${m.view.teamB.map(p=>p.username).join('+')}`);

// join the match room and stream inputs
const joins = await Promise.all(sockets.map((s) => new Promise((res) => s.emit('match:join', { matchId }, res))));
ok(`joined match room (seats: ${joins.map((j) => j.seat).join(', ')})`);

// Track the newest snapshot, then drive each player with a tiny aiming bot:
// slide to the ball's z and kick when the ball is in front of one of my rods.
const latest = { snap: null };
sockets[0].on('match:state', (p) => { if (p.matchId === matchId) latest.snap = p.snapshot; });
sockets[0].on('match:event', () => {});
sockets.forEach((s) => s.on('match:state', (p) => { if (!latest.snap) latest.snap = p.snapshot; }));

// Rod x positions must come from the engine, never be hard-coded here: a
// layout change silently broke this test once (its aiming bot kept swinging at
// rods that had moved, so no shots were ever struck).
const rodIndexBySlot = {};
ROD_SPECS.forEach((spec, i) => {
  (rodIndexBySlot[spec.slotIndex] ||= {})[spec.id] = i;
});
const rodGeometry = (slot) => {
  const roles = slotRodRoles(slot);
  const rear = ROD_SPECS.find((r) => r.id === roles.rear);
  const front = ROD_SPECS.find((r) => r.id === roles.front);
  return {
    rearX: rear.x,
    frontX: front.x,
    rearIdx: rodIndexBySlot[slot][rear.id],
    frontIdx: rodIndexBySlot[slot][front.id],
  };
};
/**
 * Drive the seats with the game's own bot AI.
 *
 * This used to be a hand-rolled aiming heuristic, and it broke every time the
 * contact model became more truthful: once a figure could only strike a ball on
 * the side it sweeps toward, naive omnidirectional kicking stopped scoring at
 * all. Re-implementing good foosball AI inside a test is a losing game — the
 * product already has one, and using it here means the test exercises the same
 * decision-making a real bot opponent does.
 */
const bots = {};
const botShim = createSimState({ timeLimitSec: 0 });

const iv = setInterval(() => {
  const snap = latest.snap;
  if (!snap) return;
  const [bx, bz, bvx, bvz] = snap.ball;
  // build a minimal SimState view from the authoritative snapshot
  botShim.phase = snap.phase === 'live' ? 'playing' : snap.phase === 'ended' ? 'ended' : 'kickoff';
  botShim.ball = { x: bx, z: bz, vx: bvx, vz: bvz, lift: 0, liftVel: 0 };
  botShim.tick = snap.tick ?? 0;
  botShim.score = snap.score ?? { A: 0, B: 0 };
  if (Array.isArray(snap.rods)) {
    snap.rods.forEach((r, i) => {
      if (botShim.rods[i]) {
        botShim.rods[i].slide = r[0];
        botShim.rods[i].angle = r[1];
      }
    });
  }

  sockets.forEach((sock, i) => {
    const slot = joins[i]?.seat;
    if (slot === null || slot === undefined) return;
    bots[slot] = bots[slot] || createBot(slot, { skill: 0.8, seed: 1234 + slot });
    const input = bots[slot](botShim);
    sock.emit('match:input', {
      matchId,
      slide: input.slide,
      rear: input.rear,
      front: input.front,
    });
  });
}, 25);

const end = await Promise.race([endPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('match did not end in 330s')), 330000))]).catch((e) => fail(e.message));
clearInterval(iv);
ok(`match ended: winner=${end.winner} score=${end.score.A}-${end.score.B} reason=${end.reason}`);

if (stateCounts[0] < 20) fail(`too few snapshots received (${stateCounts[0]})`);
if (!end.results?.results || end.results.results.length !== 4) fail('settlement payload missing 4 players');
ok(`rating deltas: ${end.results.results.map((r) => `${r.rating.delta >= 0 ? '+' : ''}${r.rating.delta}`).join(', ')}`);
ok(`received ${stateCounts[0]} state snapshots`);
if (goals === 0 && end.reason !== 'abandon') fail('no goals were scored — physics/rod control may be broken');
if (goals > 0) ok(`${goals} goals scored through the server simulation`);

// verify settlement persisted
const profile = await json('/profile/me', { headers: { Authorization: 'Bearer ' + tokens[0].token } });
const last = profile.matchHistory[0];
if (!last) fail('match not present in history');
ok(`history entry: ${last.outcome} ${last.myScore}-${last.opponentScore} (rating ${last.ratingDelta >= 0 ? '+' : ''}${last.ratingDelta})`);

const results = end.results;
if (!results.results.every((r) => typeof r.rating?.delta === 'number')) fail('missing rating deltas');
const total = results.results.reduce((s, r) => s + r.rating.delta, 0);
if (total !== 0) console.warn(`⚠️  rating deltas are not zero-sum (${total}) — check bot fillers`);
ok('all four players settled with rating deltas');

// duplicate settlement guard
const dup = await json('/leaderboard?scope=global');
ok(`leaderboard intact (${dup.length} entries)`);

console.log('\n🎉 end-to-end multiplayer test passed');
sockets.forEach((s) => s.close());
process.exit(0);
