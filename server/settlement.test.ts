import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// point the singleton DB at a throwaway file *before* importing the store
const dbPath = path.join(os.tmpdir(), `tsa-settle-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

let store: typeof import('./store');
let db: typeof import('./db');

beforeAll(async () => {
  db = await import('./db');
  store = await import('./store');
});

const mk = (username: string, rating: number) => {
  const u = store.createUser({ email: `${username}@t.dev`, username, password: 'passw0rd1' });
  db.db.prepare(`UPDATE player_ratings SET rating=?, matches=20 WHERE user_id=?`).run(rating, u.id);
  return u.id;
};

describe('match settlement', () => {
  it('settles a match that already exists as a waiting placeholder', () => {
    const a1 = mk('settle_a1', 1000);
    const a2 = mk('settle_a2', 1000);
    const b1 = mk('settle_b1', 1000);
    const b2 = mk('settle_b2', 1000);
    const id = 'm_test_settle_1';

    // the match runtime inserts this when the room is created
    db.db.prepare(`INSERT INTO matches (id, mode, status, created_at) VALUES (?,?,?,?)`).run(id, 'quick', 'waiting', new Date().toISOString());

    const res = store.settleMatch({
      matchId: id,
      mode: 'quick',
      teamA: [{ userId: a1, goals: 10, touches: 20, shots: 8 }, { userId: a2, goals: 0, touches: 18, shots: 5 }],
      teamB: [{ userId: b1, goals: 3, touches: 16, shots: 6 }, { userId: b2, goals: 2, touches: 15, shots: 4 }],
      scoreA: 10, scoreB: 5, winner: 'A', endReason: 'goals',
      goalsToWin: 10, timeLimitSec: 300, durationSec: 200, rated: true,
    });

    expect(res.ok).toBe(true);
    const row = db.db.prepare(`SELECT status, winner, team_a_score FROM matches WHERE id=?`).get(id) as any;
    expect(row.status).toBe('ended');
    expect(row.winner).toBe('A');
    expect(row.team_a_score).toBe(10);

    // ratings moved and are zero-sum
    const profits = db.db.prepare(`SELECT user_id, rating_delta FROM match_players WHERE match_id=?`).all(id) as any[];
    expect(profits).toHaveLength(4);
    expect(profits.reduce((s, p) => s + p.rating_delta, 0)).toBe(0);
    const winner = db.db.prepare(`SELECT rating, wins, matches FROM player_ratings WHERE user_id=?`).get(a1) as any;
    expect(winner.rating).toBeGreaterThan(1000);
    expect(winner.wins).toBe(1);
    expect(winner.matches).toBe(21);

    // rating history is auditable
    const hist = db.db.prepare(`SELECT * FROM rating_history WHERE match_id=?`).all(id);
    expect(hist).toHaveLength(4);
  });

  it('refuses to settle the same match twice (anti-cheat / replay protection)', () => {
    const id = 'm_test_settle_1';
    const dup = store.settleMatch({
      matchId: id, mode: 'quick',
      teamA: [{ userId: 'x', goals: 1, touches: 1, shots: 1 }],
      teamB: [{ userId: 'y', goals: 1, touches: 1, shots: 1 }],
      scoreA: 0, scoreB: 10, winner: 'B', endReason: 'goals',
      goalsToWin: 10, timeLimitSec: 300, durationSec: 10, rated: true,
    });
    expect(dup.ok).toBe(false);
    expect((dup as any).duplicate).toBe(true);
    const row = db.db.prepare(`SELECT winner, team_a_score FROM matches WHERE id=?`).get(id) as any;
    expect(row.winner).toBe('A'); // unchanged
    expect(row.team_a_score).toBe(10);
  });

  it('records wallet and xp rewards for each player', () => {
    const id = 'm_test_settle_1';
    const rows = db.db.prepare(`SELECT user_id, xp_earned, coins_earned FROM match_players WHERE match_id=?`).all(id) as any[];
    expect(rows.every((r) => r.xp_earned > 0 && r.coins_earned > 0)).toBe(true);
    for (const r of rows) {
      const wallet = db.db.prepare(`SELECT COUNT(*) c FROM wallet_transactions WHERE user_id=? AND kind='match'`).get(r.user_id) as any;
      expect(wallet.c).toBeGreaterThan(0);
    }
  });
});
