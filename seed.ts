/**
 * Seeds development data: demo accounts, ranked history, achievements and a
 * finished tournament — so leaderboards and profiles look alive on first load.
 *
 *   npm run seed          # idempotent, safe to re-run
 *   npm run seed -- --reset   # wipe and rebuild
 */
import { db, now, uid } from './server/db';
import { createUser, getUserByEmail, settleMatch, syncAchievements, addCoins } from './server/store';
import { createTournament, joinTournament, startTournament } from './server/tournaments';
import { calculateTeamRating } from './shared/rating';

const PASSWORD = 'demo1234';

const PLAYERS = [
  { email: 'alex@arena.dev', username: 'alexrod', avatar: '⚡', country: 'BD', role: 'player' },
  { email: 'sam@arena.dev', username: 'samspin', avatar: '🔥', country: 'BD', role: 'player' },
  { email: 'rio@arena.dev', username: 'rio_flick', avatar: '🦈', country: 'BR', role: 'player' },
  { email: 'mira@arena.dev', username: 'mira_mid', avatar: '🚀', country: 'DE', role: 'player' },
  { email: 'kai@arena.dev', username: 'kai_keeper', avatar: '🐉', country: 'JP', role: 'player' },
  { email: 'lena@arena.dev', username: 'lena_light', avatar: '👑', country: 'SE', role: 'player' },
  { email: 'omar@arena.dev', username: 'omar_opener', avatar: '🎯', country: 'BD', role: 'player' },
  { email: 'zoe@arena.dev', username: 'zoe_zeta', avatar: '🦅', country: 'US', role: 'player' },
  { email: 'admin@arena.dev', username: 'arena_admin', avatar: '🛡️', country: 'BD', role: 'admin' },
];

function reset() {
  const tables = [
    'wallet_transactions', 'challenge_progress', 'achievements', 'notifications', 'reports',
    'blocks', 'friendships', 'chat_messages', 'match_statistics', 'match_events', 'match_players',
    'matches', 'tournament_matches', 'tournament_participants', 'tournaments', 'sessions',
    'rating_history', 'team_members', 'teams', 'leaderboard_snapshots', 'audit_log',
    'player_ratings', 'player_profiles', 'users',
  ];
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
}

function ensureUsers() {
  const created: Record<string, string> = {};
  for (const p of PLAYERS) {
    let u = getUserByEmail(p.email);
    if (!u) {
      u = createUser({ ...p, password: PASSWORD });
      db.prepare(`UPDATE users SET email_verified=1, verification_token=NULL WHERE id=?`).run(u.id);
      console.log(`  + ${p.username} (${p.email})`);
    }
    created[p.username] = u.id;
  }
  return created;
}

/** Simulates a plausible ranked 2v2 result and settles it through the real pipeline. */
function seedMatch(
  ids: Record<string, string>,
  teamA: [string, string],
  teamB: [string, string],
  scoreA: number,
  scoreB: number,
  minutesAgo: number,
  mode: 'quick' | 'private' = 'quick'
) {
  const id = uid('m_');
  const winner = scoreA === scoreB ? null : scoreA > scoreB ? 'A' : 'B';
  const goals = (n: number, total: number) => {
    const out = [0, 0];
    for (let i = 0; i < total; i++) out[i % 2]++;
    return out;
  };
  const gA = goals(0, scoreA);
  const gB = goals(0, scoreB);
  const r = settleMatch({
    matchId: id,
    mode,
    teamA: [
      { userId: ids[teamA[0]], goals: gA[0], touches: 24, shots: 9 },
      { userId: ids[teamA[1]], goals: gA[1], touches: 31, shots: 12 },
    ],
    teamB: [
      { userId: ids[teamB[0]], goals: gB[0], touches: 22, shots: 8 },
      { userId: ids[teamB[1]], goals: gB[1], touches: 28, shots: 10 },
    ],
    scoreA,
    scoreB,
    winner,
    endReason: 'goals',
    goalsToWin: 10,
    timeLimitSec: 300,
    durationSec: 180 + Math.floor(Math.random() * 200),
    rated: true,
  });
  // backdate so weekly/monthly leaderboards and history look real
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  db.prepare(`UPDATE matches SET created_at=?, ended_at=?, started_at=? WHERE id=?`).run(at, at, at, id);
  db.prepare(`UPDATE rating_history SET created_at=? WHERE match_id=?`).run(at, id);
  return r;
}

function seedFriends(ids: Record<string, string>) {
  const pairs: [string, string][] = [
    ['alexrod', 'samspin'], ['alexrod', 'mira_mid'], ['samspin', 'rio_flick'],
    ['kai_keeper', 'lena_light'], ['mira_mid', 'lena_light'],
  ];
  for (const [a, b] of pairs) {
    const exists = db
      .prepare(`SELECT 1 FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)`)
      .get(ids[a], ids[b], ids[b], ids[a]);
    if (!exists) {
      db.prepare(`INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?,?,'accepted',?)`).run(
        ids[a], ids[b], now()
      );
    }
  }
  const pending = db.prepare(`SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?`).get(ids['zoe_zeta'], ids['alexrod']);
  if (!pending) {
    db.prepare(`INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?,?,'pending',?)`).run(
      ids['zoe_zeta'], ids['alexrod'], now()
    );
  }
}

export function seed(opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    console.log('Resetting database…');
    reset();
  }
  console.log('Seeding demo accounts (password: demo1234)');
  const ids = ensureUsers();

  const existing = (db.prepare(`SELECT COUNT(*) c FROM matches`).get() as any).c;
  if (existing === 0) {
    console.log('Simulating ranked history…');
    const schedule: [ [string, string], [string, string], number, number, number][] = [
      [['alexrod', 'samspin'], ['rio_flick', 'mira_mid'], 10, 7, 60 * 24 * 6],
      [['alexrod', 'mira_mid'], ['kai_keeper', 'lena_light'], 10, 8, 60 * 24 * 5],
      [['samspin', 'rio_flick'], ['omar_opener', 'zoe_zeta'], 6, 10, 60 * 24 * 4],
      [['alexrod', 'samspin'], ['kai_keeper', 'lena_light'], 10, 4, 60 * 24 * 3],
      [['mira_mid', 'lena_light'], ['rio_flick', 'omar_opener'], 9, 10, 60 * 24 * 2],
      [['alexrod', 'samspin'], ['rio_flick', 'zoe_zeta'], 10, 9, 60 * 12],
      [['kai_keeper', 'omar_opener'], ['mira_mid', 'lena_light'], 10, 5, 60 * 8],
      [['alexrod', 'mira_mid'], ['samspin', 'kai_keeper'], 10, 6, 60 * 5],
      [['samspin', 'lena_light'], ['omar_opener', 'zoe_zeta'], 10, 10, 60 * 3],
      [['alexrod', 'samspin'], ['rio_flick', 'mira_mid'], 10, 8, 90],
    ];
    for (const [a, b, sa, sb, mins] of schedule) seedMatch(ids, a, b, sa, sb, mins);
  }

  seedFriends(ids);
  for (const username of Object.keys(ids)) syncAchievements(ids[username]);

  // a finished tournament so the tournament leaderboard isn't empty
  const tourneyCount = (db.prepare(`SELECT COUNT(*) c FROM tournaments`).get() as any).c;
  if (tourneyCount === 0) {
    console.log('Running a demo tournament…');
    const t = createTournament(ids['alexrod'], 'Opening Night Cup', 'league', 4);
    if (t.ok) {
      const tid = (t as any).tournament.id;
      for (const u of ['alexrod', 'samspin', 'rio_flick', 'mira_mid', 'kai_keeper', 'lena_light', 'omar_opener', 'zoe_zeta']) {
        joinTournament(ids[u], tid, u);
      }
      startTournament(ids['alexrod'], tid);
    }
  }

  // a few notifications for the demo player
  const notif = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id=?`).get(ids['alexrod']) as any;
  if (notif.c === 0) {
    addCoins(ids['alexrod'], 0, 'seed');
    db.prepare(`INSERT INTO notifications (user_id, type, title, body, created_at) VALUES (?,?,?,?,?)`).run(
      ids['alexrod'], 'welcome', 'Welcome to Table Soccer Arena', 'Your first 2v2 is one click away.', now()
    );
    db.prepare(`INSERT INTO notifications (user_id, type, title, body, created_at) VALUES (?,?,?,?,?)`).run(
      ids['alexrod'], 'invite', 'samspin invited you to a private room', 'Room code 482913', now()
    );
  }

  const summary = db.prepare(`SELECT username, (SELECT rating FROM player_ratings WHERE user_id=users.id) rating FROM users ORDER BY rating DESC`).all() as any[];
  console.log('\nPlayers:');
  for (const s of summary) console.log(`  ${String(s.rating).padStart(5)}  ${s.username}`);
  console.log(`\n${(db.prepare(`SELECT COUNT(*) c FROM matches`).get() as any).c} matches, ${(db.prepare(`SELECT COUNT(*) c FROM tournaments`).get() as any).c} tournament(s) in the database.`);
  console.log('Demo login: alex@arena.dev / demo1234   (admin: admin@arena.dev / demo1234)');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ reset: process.argv.includes('--reset') });
}
