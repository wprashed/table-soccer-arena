/** Verifies solo practice: one human seat driving all four rods produces a live, scoring match. */
import { io } from 'socket.io-client';
const BASE = process.env.BASE || 'http://localhost:3000';
const res = await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'alex@arena.dev', password: 'demo1234' }),
})).json();
if (!res.token) { console.error('❌ login failed'); process.exit(1); }

const s = io(BASE, { transports: ['websocket'] });
await new Promise((r) => s.on('connect', r));
s.emit('auth', { token: res.token });

const start = await new Promise((r) => s.emit('practice:start', { difficulty: 'normal', solo: true }, r));
if (!start?.ok) { console.error('❌ practice start failed', start); process.exit(1); }
console.log(`✅ solo practice match created ${start.matchId} (solo=${start.solo})`);
if (!start.solo) { console.error('❌ server did not flag solo mode'); process.exit(1); }

const join = await new Promise((r) => s.emit('match:join', { matchId: start.matchId }, r));
console.log(`✅ seat ${join.seat}, solo=${join.solo}, players=${join.view.teamA.length + join.view.teamB.length}`);

let goals = 0, snaps = 0, ended = null;
s.on('match:state', (p) => { if (p.matchId === start.matchId) snaps++; });
s.on('match:event', (p) => { if (p.matchId === start.matchId && p.event.type === 'goal') { goals++; console.log(`   goal ${p.event.team} ${p.event.score.A}:${p.event.score.B}`); } });
s.on('match:end', (p) => { if (p.matchId === start.matchId) ended = p; });

// Drive all four seats toward the ball with alternating kicks.
let t = 0;
const iv = setInterval(() => {
  t++;
  const allRods = {};
  for (let seat = 0; seat < 4; seat++) {
    allRods[seat] = { slide: Math.sin(t / 14 + seat * 2), rear: t % 11 < 5 ? 1 : 0, front: t % 8 < 4 ? 1 : 0 };
  }
  s.emit('match:input', { matchId: start.matchId, allRods });
}, 25);

const deadline = Date.now() + 120000;
while (!ended && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
clearInterval(iv);
if (snaps < 50) { console.error(`❌ only ${snaps} snapshots`); process.exit(1); }
console.log(`✅ ${snaps} snapshots received`);
if (goals === 0) { console.error('❌ solo drill produced no goals'); process.exit(1); }
console.log(`✅ ${goals} goals scored in ${ended ? `${ended.score.A}-${ended.score.B}` : 'a live match'}`);
console.log('\n🎉 solo practice works end-to-end');
s.close();
process.exit(0);
