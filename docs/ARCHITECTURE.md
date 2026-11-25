# Architecture

## Process model

```
┌──────────────────────────── browser ─────────────────────────────┐
│ React SPA (Vite)                                                  │
│   Zustand store  ── REST /api ──┐                                 │
│   useMatchSession ── Socket.IO ─┤  inputs only, 40 Hz            │
│   Canvas renderer ◀── snapshots ┘  (30 Hz, interpolated)          │
│   rod prediction: shared/engine stepRodControl()                  │
└───────────────────────────────────────────────────────────────────┘
                │ HTTP                    │ WebSocket
┌───────────────▼─────────────────────────▼─────────────────────────┐
│ Node + Express + Socket.IO (single process)                       │
│                                                                   │
│  api.ts            REST routes, rate limits, auth middleware      │
│  realtime.ts       queue · rooms · match traffic · chat · practice│
│  match.ts          MatchManager: authoritative sim loop per match  │
│  matchmaking.ts    queue → balanced 4-player groups (pure)         │
│  tournaments.ts    bracket generation + server-side fixture sims   │
│  store.ts          domain services + all SQL (settlement, wallet)  │
│  db.ts             schema + migrations (SQLite/WAL)                │
└───────────────────────────────────────────────────────────────────┘
```

## Authority model (the important part)

1. A match is created by the server with four **seats**. Each seat owns a slot 0–3.
2. The server runs `stepSim()` at a fixed 60 Hz `setInterval` with an accumulator,
   capped so a slow tick never death-spirals.
3. Clients emit `match:input` packets containing three floats. The server
   - rejects packets from non-seated users or non-live matches,
   - throttles each seat to 45 Hz (`Seat.lockedUntil`),
   - clamps values into −1…1 and counts out-of-range packets as suspicious.
4. The server broadcasts `match:state` at 30 Hz plus discrete `match:event`
   packets (goal / kick / wall / serve / end). Clients never see authoritative
   scores they could echo back.
5. On `phase === 'ended'`, `finalise()` calls `settleMatch()` exactly once.
   `settleMatch` is idempotent on `matches.status = 'ended'`, recomputes Elo from
   stored ratings, writes `match_players`, `rating_history`, wallet and XP rows,
   bumps challenges/achievements, and appends an audit record.

Nothing in the client can write a score, a rating or a coin balance: the REST
surface literally has no such endpoint.

## Determinism

`shared/engine/physics.ts` has no randomness inside `stepSim` (the only random
calls are in `resetBall`, i.e. a serve, which both sides are told about through a
`serve` event/snapshot). Given the same starting state and input stream, server
and client produce identical trajectories — that is what makes client-side
prediction of the local rods safe and what makes `simulateMatch()` usable for
tournament fixtures.

## Netcode

* Remote rods and the ball are linearly interpolated between the last two
  snapshots (`alpha = (now - lastSnapshotRecv) / interval`, clamped).
* The local player's own two rods are integrated locally with the identical
  `stepRodControl()` and only hard-reconciled when they drift more than 7 units
  of slide or 0.75 rad of angle. This is why the controls feel instant.
* The ball is never predicted — it is server truth, so no rubber-banding.

## Matchmaking

`tryFormMatch()` is a pure function over the queue: it walks the longest-waiting
anchors, gathers their nearest-rated neighbours, checks the widened rating band
(`120 + 35/s`, cap 700), snake-drafts teams (1st+4th vs 2nd+3rd) and rejects
groups whose combined rating spread exceeds 1.6× the band. Recently-paired
players are avoided for 20 s. After ~18 s a short queue may be topped up with
bots, which forces the match to be **unrated**.

## Scaling notes

| Concern | Today | At scale |
| --- | --- | --- |
| Queue / presence / live matches | in-process singletons | Redis hash + pub/sub channel per match |
| Match loops | one `setInterval` per match in one process | dedicated "match" workers, sticky rooms |
| Sessions | `sessions` table | Redis with TTL mirror |
| DB | SQLite WAL, single writer | PostgreSQL (schema is already PostgreSQL-shaped) |
| Static assets | Express/`dist` | CDN in front of `dist/` |

The simulation is cheap (60 steps/s × 11 figures × 4 collisions), so a single
process comfortably hosts hundreds of concurrent matches; the bottleneck in
practice is socket fan-out, which Socket.IO's Redis adapter solves by adding
processes rather than by changing game code.
