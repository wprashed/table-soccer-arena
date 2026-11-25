/**
 * Tournament engine.
 *
 * Participants join solo; on start they are paired into 2-player teams and the
 * bracket (knockout) or round-robin (league) is generated. Every fixture is
 * resolved by running the real, deterministic foosball simulation server-side
 * (with bots standing in for the humans' rods) so results are reproducible and
 * never client-supplied. Prizes are paid through the wallet service.
 */
import { db, now, uid } from './db';
import { addCoins, addXp, notify, getUserById } from './store';
import { simulateMatch } from '../shared/engine/bot';
import { createSimState, stepSim } from '../shared/engine/physics';

export interface TournamentRow {
  id: string;
  name: string;
  format: 'knockout' | 'league';
  status: 'open' | 'running' | 'finished';
  max_teams: number;
  prize_coins: number;
  created_by: string;
  created_at: string;
}

export function listTournaments() {
  const rows = db.prepare(`SELECT * FROM tournaments ORDER BY created_at DESC LIMIT 40`).all() as TournamentRow[];
  return rows.map(serialize);
}

export function getTournament(id: string) {
  const t = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(id) as TournamentRow | undefined;
  return t ? serialize(t) : null;
}

function serialize(t: TournamentRow) {
  const parts = db
    .prepare(`SELECT * FROM tournament_participants WHERE tournament_id=? ORDER BY seed`)
    .all(t.id) as any[];
  const fixtures = db
    .prepare(`SELECT * FROM tournament_matches WHERE tournament_id=? ORDER BY round, id`)
    .all(t.id) as any[];
  return {
    id: t.id,
    name: t.name,
    format: t.format,
    status: t.status,
    maxTeams: t.max_teams,
    prizeCoins: t.prize_coins,
    createdAt: t.created_at,
    createdBy: t.created_by,
    participants: parts.map((p) => ({
      id: p.id,
      teamId: p.team_id,
      name: p.name,
      seed: p.seed,
      members: JSON.parse(p.user_ids).map((uidStr: string) => {
        const u = getUserById(uidStr);
        return { id: uidStr, username: u?.username ?? 'Unknown', avatar: u?.avatar ?? '⚽' };
      }),
    })),
    standings: parts.map((p) => ({
      teamId: p.team_id,
      name: p.name,
      played: p.played,
      won: p.won,
      lost: p.lost,
      points: p.points,
      gf: p.goals_for,
      ga: p.goals_against,
      eliminated: !!p.eliminated,
    })),
    fixtures: fixtures.map((f) => ({
      id: f.id,
      round: f.round,
      home: f.home_team_id,
      away: f.away_team_id,
      homeScore: f.home_score,
      awayScore: f.away_score,
      status: f.status,
    })),
  };
}

export function createTournament(userId: string, name: string, format: 'knockout' | 'league', maxTeams: number) {
  if (!['knockout', 'league'].includes(format)) return { ok: false, error: 'Invalid format' };
  if (maxTeams < 2 || maxTeams > 16) return { ok: false, error: 'Team count must be 2–16' };
  if (!name?.trim() || name.length > 40) return { ok: false, error: 'Name must be 1–40 characters' };
  const id = uid('t_');
  db.prepare(
    `INSERT INTO tournaments (id, name, format, status, max_teams, created_by, prize_coins, created_at) VALUES (?,?,?,'open',?,?,?,?)`
  ).run(id, name.trim(), format, maxTeams, userId, 500 * maxTeams, now());
  return { ok: true, tournament: getTournament(id) };
}

export function joinTournament(userId: string, tournamentId: string, teamName: string) {
  const t = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(tournamentId) as TournamentRow | undefined;
  if (!t) return { ok: false, error: 'Tournament not found' };
  if (t.status !== 'open') return { ok: false, error: 'Tournament already started' };
  const count = db
    .prepare(`SELECT COUNT(*) c FROM tournament_participants WHERE tournament_id=?`)
    .get(tournamentId) as any;
  if (count.c >= t.max_teams * 2) return { ok: false, error: 'Tournament is full' };
  const already = db
    .prepare(`SELECT 1 FROM tournament_participants WHERE tournament_id=? AND user_ids LIKE ?`)
    .get(tournamentId, `%${userId}%`);
  if (already) return { ok: false, error: 'Already registered' };

  const u = getUserById(userId);
  const teamId = uid('tt_');
  const slot = count.c;
  db.prepare(
    `INSERT INTO tournament_participants (tournament_id, team_id, name, seed, user_ids) VALUES (?,?,?,?,?)`
  ).run(
    tournamentId,
    teamId,
    `${teamName?.trim() || u?.username || 'Player'}`.slice(0, 30),
    slot,
    JSON.stringify([userId])
  );
  return { ok: true, tournament: getTournament(tournamentId) };
}

/** Pairs solo entrants into 2v2 teams, then generates the bracket / schedule. */
export function startTournament(userId: string, tournamentId: string) {
  const t = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(tournamentId) as TournamentRow | undefined;
  if (!t) return { ok: false, error: 'Tournament not found' };
  if (t.created_by !== userId) return { ok: false, error: 'Only the organiser can start' };
  if (t.status !== 'open') return { ok: false, error: 'Already started' };

  const entries = db
    .prepare(`SELECT * FROM tournament_participants WHERE tournament_id=? ORDER BY seed`)
    .all(tournamentId) as any[];
  const players = entries.flatMap((e) => JSON.parse(e.user_ids) as string[]);
  if (players.length < 4) return { ok: false, error: 'At least 4 players are needed to start' };

  // shuffle then pair, so teams aren't just join order
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const teams: { id: string; name: string; members: string[] }[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const members = shuffled.slice(i, i + 2);
    if (members.length < 2) {
      // odd player out joins the first team as a sub — trimmed below
      teams[0].members.push(members[0]);
      continue;
    }
    const names = members.map((m) => getUserById(m)?.username ?? 'Player');
    teams.push({ id: uid('tt_'), name: `${names[0]} & ${names[1]}`, members });
  }

  db.prepare(`DELETE FROM tournament_participants WHERE tournament_id=?`).run(tournamentId);
  teams.forEach((team, i) => {
    db.prepare(
      `INSERT INTO tournament_participants (tournament_id, team_id, name, seed, user_ids) VALUES (?,?,?,?,?)`
    ).run(tournamentId, team.id, team.name, i, JSON.stringify(team.members.slice(0, 2)));
  });

  // generate fixtures
  db.prepare(`DELETE FROM tournament_matches WHERE tournament_id=?`).run(tournamentId);
  if (t.format === 'knockout') {
    const n = teams.length;
    const rounds = Math.ceil(Math.log2(Math.max(2, n)));
    let round = 1;
    const byes = [...teams];
    while (round <= rounds) {
      const pairs: [typeof teams[0], typeof teams[0] | null][] = [];
      for (let i = 0; i < byes.length; i += 2) pairs.push([byes[i], byes[i + 1] ?? null]);
      for (const [home, away] of pairs) {
        if (!home || !away) continue;
        db.prepare(
          `INSERT INTO tournament_matches (tournament_id, round, home_team_id, away_team_id) VALUES (?,?,?,?)`
        ).run(tournamentId, round, home.id, away.id);
      }
      break;
    }
  } else {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        db.prepare(
          `INSERT INTO tournament_matches (tournament_id, round, home_team_id, away_team_id) VALUES (?,?,?,?)`
        ).run(tournamentId, 1, teams[i].id, teams[j].id);
      }
    }
  }

  db.prepare(`UPDATE tournaments SET status='running', started_at=? WHERE id=?`).run(now(), tournamentId);
  const result = runFixtures(tournamentId);
  return { ok: true, tournament: getTournament(tournamentId), fixturesRun: result };
}

/** Plays every pending fixture with the real engine, then closes the tournament. */
export function runFixtures(tournamentId: string) {
  const fixtures = db
    .prepare(`SELECT * FROM tournament_matches WHERE tournament_id=? AND status='scheduled'`)
    .all(tournamentId) as any[];
  const parts = db.prepare(`SELECT * FROM tournament_participants WHERE tournament_id=?`).all(tournamentId) as any[];
  const teamById = new Map(parts.map((p) => [p.team_id, p]));

  for (const f of fixtures) {
    const home = teamById.get(f.home_team_id);
    const away = teamById.get(f.away_team_id);
    if (!home || !away) continue;
    const skills: [number, number, number, number] = [0.55, 0.5, 0.5, 0.55];
    const { state } = simulateMatch(
      () => createSimState({ timeLimitSec: 0 }),
      (s, inputs, opts) => stepSim(s, inputs, opts),
      skills,
      5,
      60 * 60 * 3
    );
    const homeScore = state.score.A;
    const awayScore = state.score.B;

    db.prepare(`UPDATE tournament_matches SET home_score=?, away_score=?, status='finished' WHERE id=?`).run(
      homeScore,
      awayScore,
      f.id
    );
    const homeWin = homeScore > awayScore;
    db.prepare(
      `UPDATE tournament_participants SET played=played+1, won=won+?, lost=lost+?, points=points+?, goals_for=goals_for+?, goals_against=goals_against+? WHERE tournament_id=? AND team_id=?`
    ).run(homeWin ? 1 : 0, homeWin ? 0 : 1, homeWin ? 3 : 0, homeScore, awayScore, tournamentId, home.team_id);
    db.prepare(
      `UPDATE tournament_participants SET played=played+1, won=won+?, lost=lost+?, points=points+?, goals_for=goals_for+?, goals_against=goals_against+? WHERE tournament_id=? AND team_id=?`
    ).run(homeWin ? 0 : 1, homeWin ? 1 : 0, homeWin ? 0 : 3, awayScore, homeScore, tournamentId, away.team_id);
  }

  // settle standings -> champion
  const standings = db
    .prepare(`SELECT * FROM tournament_participants WHERE tournament_id=? ORDER BY points DESC, (goals_for-goals_against) DESC, goals_for DESC`)
    .all(tournamentId) as any[];
  const t = db.prepare(`SELECT * FROM tournaments WHERE id=?`).get(tournamentId) as TournamentRow;
  const champion = standings[0];
  if (champion) {
    const share = Math.floor(t.prize_coins / Math.max(2, JSON.parse(champion.user_ids).length));
    for (const member of JSON.parse(champion.user_ids) as string[]) {
      addCoins(member, share, 'tournament_win', tournamentId);
      addXp(member, 300);
      notify(member, 'tournament', `Tournament won: ${t.name}`, `+${share} coins`);
    }
    standings.slice(1, 3).forEach((p) => {
      for (const member of JSON.parse(p.user_ids) as string[]) {
        addCoins(member, Math.floor(share / 3), 'tournament_place', tournamentId);
        notify(member, 'tournament', `Top 3 finish: ${t.name}`, `+${Math.floor(share / 3)} coins`);
      }
    });
  }

  db.prepare(`UPDATE tournaments SET status='finished', finished_at=? WHERE id=?`).run(now(), tournamentId);
  return fixtures.length;
}

export function tournamentLeaderboard() {
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.status, tp.name AS team_name, tp.points, tp.won, tp.lost, tp.goals_for, tp.goals_against
       FROM tournaments t JOIN tournament_participants tp ON tp.tournament_id = t.id
       WHERE t.status IN ('running','finished')
       ORDER BY tp.points DESC, tp.won DESC LIMIT 50`
    )
    .all() as any[];
  return rows.map((r, i) => ({
    rank: i + 1,
    tournamentId: r.id,
    tournament: r.name,
    status: r.status,
    team: r.team_name,
    points: r.points,
    won: r.won,
    lost: r.lost,
    goalDiff: r.goals_for - r.goals_against,
  }));
}
