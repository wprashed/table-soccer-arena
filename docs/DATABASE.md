# Database design

Development uses SQLite (better-sqlite3, WAL). The DDL below is the PostgreSQL
equivalent the code is written against; column names and relationships are
identical, so the only changes needed to switch are the driver and type spellings
(`TEXT id` → `uuid`/`text`, `INTEGER` → `integer`, `REAL` → `double precision`).

## Tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | accounts | id, email (unique), username (unique), password_hash, country, role, email_verified, verification_token, reset_token/expires, banned, settings_json |
| `player_profiles` | progression & cosmetics | user_id PK→users, xp, level, coins, daily_streak, last_daily_claim, bio, frame, table_skin, ball_skin, uniform, celebration |
| `player_ratings` | competitive record | user_id PK→users, rating, matches, wins, losses, draws, goals_for, goals_against, streak, best_streak, highest_rating |
| `rating_history` | **auditable** Elo ledger | user_id, match_id, rating_before, delta, rating_after, reason, created_at |
| `teams` / `team_members` | persistent teams (tournaments) | id, name, created_by, tournament_id |
| `sessions` | auth tokens | token PK, user_id, expires_at, user_agent |
| `matches` | one row per match | id, mode, status, team_a_score, team_b_score, goals_to_win, time_limit_sec, winner, end_reason, rated, started_at, ended_at, duration_sec, server_validated |
| `match_players` | per-player match result | match_id, user_id, team, slot, rating_before/delta/after, goals, touches, shots, xp_earned, coins_earned, connected |
| `match_events` | replayable event log | match_id, tick, type, team, payload |
| `match_statistics` | extra per-player metrics | possession_ticks, kicks, max_ball_speed |
| `chat_messages` | match chat | match_id, user_id, username, text, created_at |
| `friendships` | social graph (pending/accepted) | user_id, friend_id, status |
| `blocks` | mute/block list | user_id, blocked_id |
| `reports` | moderation queue | reporter_id, target_id, reason, details, status |
| `match_invitations` | room invites | match_id, from_user, to_user, status |
| `tournaments` | cup metadata | id, name, format, status, max_teams, prize_coins, created_by |
| `tournament_participants` | standings | tournament_id, team_id, name, seed, user_ids (json), played/won/lost/points, goals_for/against |
| `tournament_matches` | fixtures | tournament_id, round, home_team_id, away_team_id, match_id, scores, status |
| `leaderboard_snapshots` | periodic rank snapshots | scope, period_key, user_id, value, rank |
| `achievements` | per-user unlocks | user_id, achievement_id, progress, unlocked_at |
| `challenge_progress` | daily challenges | user_id, challenge_id, period_key, progress, claimed |
| `wallet_transactions` | **auditable** coin ledger | user_id, amount, kind, ref, balance_after, created_at |
| `notifications` | in-app inbox | user_id, type, title, body, read |
| `audit_log` | admin + anti-cheat trail | actor, action, target, meta, created_at |

## Invariants enforced in code

* A match is settled **at most once** — guarded by `matches.status = 'ended'`;
  re-settlement returns `duplicate: true` and mutates nothing.
* Elo deltas across the four humans sum to zero (fillers absorb bot partners).
* Every rating change and every coin movement writes a ledger row
  (`rating_history`, `wallet_transactions`), so any balance can be reconstructed.
* `player_ratings.highest_rating` and `best_streak` are monotonic (`MAX(...)`).
* `match_players.connected` is flipped to 0 when a seat drops mid-match, which is
  what the abandonment penalty and the moderation tools read.

## Example queries

```sql
-- global leaderboard
SELECT u.username, r.rating, r.matches, r.wins
FROM users u JOIN player_ratings r ON r.user_id = u.id
WHERE u.banned = 0 ORDER BY r.rating DESC LIMIT 100;

-- weekly rating gain (used by /api/leaderboard?scope=weekly)
SELECT u.id, COALESCE(SUM(mp.rating_delta), 0) AS gain
FROM match_players mp
JOIN matches m ON m.id = mp.match_id
JOIN users u   ON u.id = mp.user_id
WHERE m.created_at >= now() - interval '7 days'
GROUP BY u.id ORDER BY gain DESC;

-- audit a player's full rating journey
SELECT created_at, rating_before, delta, rating_after, match_id
FROM rating_history WHERE user_id = $1 ORDER BY created_at;
```
