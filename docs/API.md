# API reference

All REST endpoints live under `/api`. Authenticated calls send
`Authorization: Bearer <token>`. Errors are `{ "error": "message" }` with a
matching 4xx status. Rate limits are per-IP sliding windows.

## Auth

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | email, username, password, country?, avatar? | 10/min. Creates profile, 1000 rating, 250 coins |
| POST | `/auth/login` | email, password | 20/min. Returns `{ token, user }` |
| POST | `/auth/logout` | — | invalidates the current token |
| GET | `/auth/me` | — | current user |
| GET | `/auth/verify?token=` | — | email verification |
| POST | `/auth/resend-verification` | — | dev returns the token |
| POST | `/auth/forgot-password` | email | 8/min, never leaks account existence |
| POST | `/auth/reset-password` | token, password | |

## Profile & players

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/profile/me` | stats, achievements, challenges, daily reward state, rating history |
| GET | `/profile/:username` | public profile (no settings/challenges) |
| PATCH | `/profile` | avatar, country, bio, cosmetics |
| PUT | `/settings` | merged JSON preferences |
| POST | `/account/password` | current, next (invalidates sessions) |
| GET | `/players/search?q=` | username autocomplete |
| GET | `/matches/history` | last 50 matches |
| GET | `/notifications`, POST `/notifications/read` | inbox |

## Leaderboards

`GET /leaderboard?scope=global|weekly|monthly|friends|country[&country=BD]`
`GET /leaderboard/tournaments`

## Social

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/friends` | friends + pending requests + recent opponents |
| POST | `/friends/request` | `{ username }` |
| POST | `/friends/respond` | `{ requestId, accept }` |
| DELETE | `/friends/:id` | |
| POST | `/users/:id/block`, `/users/:id/unblock`, GET `/users/blocked` | |
| POST | `/users/:id/report` | `{ reason, details?, matchId? }` (10/min) |

## Rewards & store

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/rewards/daily` | daily login streak reward |
| POST | `/rewards/challenge` | `{ id }` claims a completed daily challenge |
| GET | `/store` | items, coins, equipped cosmetics |
| POST | `/store/buy` | `{ itemId }` — cosmetic only |
| POST | `/store/equip` | `{ itemId }` |

## Tournaments

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/tournaments`, `/tournaments/:id` | list / detail with standings |
| POST | `/tournaments` | `{ name, format: knockout\|league, maxTeams }` |
| POST | `/tournaments/:id/join` | `{ teamName? }` (solo sign-up) |
| POST | `/tournaments/:id/start` | organiser only; pairs teams and plays fixtures server-side |

## Admin (role = admin)

`GET /admin/overview` · `POST /admin/ban` · `POST /admin/reports/:id/resolve`

---

# Socket.IO events

The client authenticates once per connection with `auth { token }` (or by passing
`token` on the first meaningful packet). Identity then sticks to the socket.

### Client → server

| Event | Payload | Purpose |
| --- | --- | --- |
| `auth` | `{ token }` | bind identity |
| `queue:join` / `queue:leave` | `{ allowBots }` | ranked matchmaking |
| `room:create` | `{ goalsToWin?, timeLimitSec?, rated? }` | → `{ ok, matchId, code }` |
| `room:join` | `{ code }` | join by 6-digit code |
| `room:add-bot` | `{ matchId, slot }` | host fills a seat with a bot |
| `room:invite` | `{ toUserId, matchId }` | notify a friend |
| `room:start` | `{ matchId }` | host only, needs 4 seats |
| `match:join` | `{ matchId }` | → view, snapshot, seat, recent chat |
| `match:spectate` | `{ matchId }` | read-only |
| `match:input` | `{ matchId, slide, rear, front }` or `{ matchId, allRods }` | 40 Hz, clamped server-side |
| `match:chat` | `{ matchId, text, emoji? }` | 120 chars max |
| `practice:start` | `{ difficulty, solo? }` | real match vs bots, unrated |

### Server → client

| Event | Payload |
| --- | --- |
| `queue:update` | `{ count, players[], online }` |
| `queue:matched` | `{ matchId, view }` |
| `match:countdown` / `match:live` | `{ matchId, view, countdownMs? }` |
| `match:state` | `{ matchId, snapshot, view }` @30 Hz |
| `match:event` | `{ matchId, event }` — `goal \| kick \| wall \| serve \| end` |
| `match:connection` | `{ matchId, userId, online }` |
| `match:chat` | message object |
| `match:end` | `{ winner, score, reason, durationSec, view, results }` |
| `presence` | `{ userId, online }` |

### Snapshot shape

```json
{ "t": 1732450000000, "tick": 4211, "phase": "playing",
  "score": { "A": 3, "B": 2 }, "timeLeft": 214.4, "kickoffLeft": 0,
  "ball": [12.3, -4.1, 88.0, 12.5],
  "rods": [[0.4, 0.12], [-1.1, -0.8], ...8 rods...],
  "lastTouch": { "team": "A", "slot": 1 } }
```
