# Table Soccer Arena

> **Play Together. Compete. Climb the Rankings.**
> A complete browser-based 4-player (2v2) foosball platform with server-authoritative
> physics, Elo ratings, matchmaking, tournaments, friends, chat and a cosmetic economy.

No installation for players, no game engine to download — just a browser.

---

## Quick start

```bash
npm install
npm run seed          # demo accounts + simulated ranked history
npm run dev           # server + client on http://localhost:3000
```

Open <http://localhost:3000> and press **Demo player** on the auth screen.

| Account | Email | Password | Notes |
| --- | --- | --- | --- |
| Demo player | `alex@arena.dev` | `demo1234` | Silver, 7 matches of history |
| Demo rival | `sam@arena.dev` | `demo1234` | Plays on the other side of the net |
| Admin | `admin@arena.dev` | `demo1234` | Unlocks `/admin` moderation console |

Other seeded players: `rio@arena.dev`, `mira@arena.dev`, `kai@arena.dev`,
`lena@arena.dev`, `omar@arena.dev`, `zoe@arena.dev` — all with the same password.

**To try a genuine 4-player match by yourself:** open the site in two normal
browser windows and one incognito window, sign in as three different demo
players, and press **Play Now** in each. The matchmaker seats all four of you in
~1 second.

Other commands:

```bash
npm test               # 48 unit tests (physics, coverage, Elo, matchmaking, settlement)
npm run build          # production client bundle into dist/
npm start              # production server (serves dist/ + API + sockets)
npm run seed:reset     # wipe the database and rebuild the demo data
npm run test:e2e       # live 4-player socket test (needs the server running)
npm run test:practice  # live solo-practice test
npm run test:ui        # full browser journey (Playwright)
npx tsx e2e.mjs        # note: the socket tests import the engine directly,
                       #        so run them through tsx, not plain node
node room-test.mjs     # 4 browsers: private room, invite link, bot fill, start
node screens.mjs       # captures screens/ (desktop + mobile), asserts no overflow
```

---

## Controls

| input | action |
| --- | --- |
| `A` / `D` | slide both of your rods |
| `W` | kick with the rod nearest your own goal (GK / DEF) |
| `S` or `Space` | kick with the rod nearest the opponent (MID / ATK) |
| drag the table | grab a rod and put it where your finger is (mouse or touch) |
| flick the table | swipe fast sideways to strike the ball with the rod you grabbed |
| on-screen pad | `◀` `▶` to slide, **Kick back** / **Kick front** to shoot (phones, plus haptics) |

Power comes from how fast the rod is moving when it meets the ball — a tap is a
soft pass, a full swing is a shot. Every binding is rebindable in
*Settings → Controls*.

All four input devices funnel through one pure model (`src/game/controlModel.ts`)
so behaviour is identical whichever you use: a thumb-sized dead-zone stops jitter,
an active drag outranks the pad and keyboard (it's the most direct expression of
intent), and only a genuinely fast swipe counts as a flick, so positioning never
shoots by accident. Precedence, gain and flick threshold are unit-tested.

A **?** button in the match HUD opens the same guide at any time, and the
first-match hint retires the moment you touch a control.

Each player controls **two rods** (a back rod and a front rod) plus a shared
lateral slide — like a real foosball handle.

Rods are spring-loaded back to neutral, so a tap is a full swing. Every binding
can be remapped in **Settings → Controls**.

**Solo drill** (Practice → Solo drill) hands all four rods to one keyboard:

| Seat | Slide | Back kick | Front kick |
| --- | --- | --- | --- |
| Team A · GK + DEF | `A` / `D` | `W` | `S` |
| Team A · MID + ATK | `←` / `→` | `Q` | `E` |
| Team B · DEF + ATK | `N` / `M` | `H` | `K` |
| Team B · MID + GK | `J` / `L` | `U` | `O` |

---

## What is actually implemented

### Game
- **Deterministic 60 Hz physics** (`shared/engine/`) shared byte-for-byte between
  the authoritative server and the client's local prediction.
- 8 rods / 11 figures per side, extruded pseudo-3D table rendered on canvas with
  shaded figures, ball shadow + lift, goal nets, skins and scoreboard.
- Ball collision, restitution, rolling friction, wall bounces and ankle-sweep
  shots, with shot power derived from rod angular velocity (mashing creates real
  shots rather than taps).
- Contact uses **relative normal velocity** — `v' = -e·v` against the figure's
  moving surface, so momentum comes from the swing exactly once. A foot moving
  *away* from the ball transfers nothing, and tangential friction drags the ball
  sideways, which is what gives struck balls their curl.
- Friction is speed-dependent: a struck ball carries across the table, a slow one
  settles instead of creeping. Dead-ball re-serves only interrupt play when the
  ball has actually stopped somewhere no rod can reach it.
- **Shared rod handles** (a player's two rods move as one), **dead-ball re-drop**
  and **anti-trap** rules — the two ways a real table deadlocks.
- Kickoff countdown, goal flash, match clock, first-to-N target, time limit,
  draw handling, abandonment detection and reconnection window.
- Practice vs bots (solo drill or real 2v2 with a bot teammate), three difficulties.

### Multiplayer
- Socket.IO real-time traffic: clients **only send inputs** (rate-limited to 45 Hz,
  clamped to −1…1, out-of-range values flagged).
- Server sends 30 Hz snapshots; client interpolates remote rods and predicts its
  own rods locally, then gently reconciles against the server.
- Private rooms with 6-digit codes, host-only start, bot fill, invitation links.
- Matchmaking queue with widening rating bands, snake-draft team balancing,
  rematch avoidance, live queue UI and bot backfill (unrated) after ~18 s.
- Reconnection: a dropped player gets a 45 s window before the match is awarded
  to the opposition (and recorded as an abandonment).

### Competitive platform
- Elo for 2v2 (team average, K = 32/40/48 by experience, zero-sum, floor of 100).
- Seven tiers from Bronze → Legend with progress bars and badges.
- Profiles: rating, peak, win rate, streaks, goals for/against, XP/level, coins,
  achievements, rating graph, full match history.
- Leaderboards: global, weekly, monthly, friends, country, plus tournament table.

### Social & economy
- Friends (request/accept/remove), presence, invite-to-room, recent opponents,
  match chat + emoji quick-chat, blocking and reporting.
- Coins from matches, daily login streaks, daily challenges, achievements and
  tournaments. Cosmetics only: table skins, balls, uniforms, avatar frames,
  celebrations. **Nothing purchasable affects gameplay.**

### Tournaments
- Knockout or round-robin, 2–16 teams, solo sign-up, auto team pairing.
- Standings, goal difference and prize payout. Fixtures are resolved by running
  the real deterministic engine server-side (bots drive the rods), so results are
  reproducible and never client-supplied.

### Security
- scrypt password hashing, opaque session tokens with 30-day expiry, email
  verification tokens, password reset tokens.
- Every competitive number is produced server-side; clients cannot submit scores,
  ratings or coins. Idempotent settlement (replays rejected).
- Rate limiting per IP/bucket, input validation and clamping, security headers.
- Anti-cheat heuristics written to an audit log: own goals, rapid-fire scoring,
  illegal input magnitudes, four-player repeat lobbies, abandoned/repeated
  disconnects. Admin console for reports, bans and the audit trail.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite, Zustand, Tailwind CSS v4, Framer Motion |
| Game rendering | Canvas 2D pseudo-3D renderer (`src/game/renderer.ts`) |
| Physics | Custom deterministic simulation (`shared/engine/physics.ts`) |
| Realtime | Socket.IO (WebSocket with polling fallback) |
| Backend | Node.js + Express + TypeScript (tsx) |
| Database | SQLite via better-sqlite3 (WAL) — schema mirrors PostgreSQL 1:1 |
| Tests | Vitest (43 tests) + Playwright screenshot scripts |

**Why SQLite?** The sandbox this was built in has no PostgreSQL/Redis daemon.
All SQL lives in `server/store.ts` and `server/db.ts`, and the schema in
`docs/DATABASE.md` is written for PostgreSQL, so swapping the driver is a
contained change. Redis is likewise optional: the matchmaking queue, presence
and live match registry are in-memory singleton services that map 1:1 onto Redis
keys when you scale past one process (see `docs/ARCHITECTURE.md`).

---

## Project layout

```
seed.ts            demo data generator
e2e.mjs            live 4-player socket test
practice-test.mjs  live solo-practice test
journey.mjs        full browser journey (Playwright)
room-test.mjs      private-room flow across 3 browsers
screens.mjs        captures screens/ for visual QA
shared/            code used by BOTH client and server
  engine/          constants, physics simulation, bots (+ tests)
  rating.ts        Elo, tiers, XP, coins (+ tests)
  types.ts         API DTOs
server/
  index.ts         express + vite middleware + socket.io bootstrap
  api.ts           REST API (auth, profile, leaderboards, social, store, admin)
  realtime.ts      socket handlers: queue, rooms, matches, chat, practice
  match.ts         authoritative match runtime (sim loop, snapshots, reconnection)
  matchmaking.ts   queue balancing (+ tests)
  tournaments.ts   bracket/schedule generation + server-side fixture simulation
  store.ts         domain services & all SQL (settlement, achievements, wallet)
  db.ts            schema + migrations
  seed.ts          demo data
src/
  App.tsx          shell, router, nav
  pages/           Auth, Dashboard, QuickMatch, Leaderboard, Social,
                   Tournaments, Practice, Store, Profile, History, Settings, Admin
  game/            FoosballTable canvas host, MatchScreen HUD, useMatchSession,
                   useControls, renderer
  components/ui.tsx  badges, avatars, modal, toasts, segmented control
  lib/             api client, socket wrapper, zustand store, sfx, router
docs/              ARCHITECTURE.md, DATABASE.md, DEPLOYMENT.md, API.md
screens/           captured UI screenshots
public/sounds/     21 generated WAV assets (see "Sound")
tools/gen_sounds.py  regenerates them (numpy, ~30 s)
```

---

## Testing

```bash
npm test
```

* `shared/engine/engine.test.ts` — kickoff/transition, wall containment, friction,
  goal detection + mouth geometry, determinism, rod control, auto-centring,
  shared-rod coupling, dead-ball re-drop, anti-trap, scoring pace, solo tags.
* `shared/rating.test.ts` — expected score, symmetry, zero-sum, stronger/weaker
  opponents, draws, rating floor, provisional K, tiers, XP/levels/coins.
* `server/matchmaking.test.ts` — 4-player gating, band widening over time,
  combined-rating balance, rematch avoidance, no duplicate players, bot fill.
* `server/settlement.test.ts` — settling an existing `waiting` row, zero-sum
  deltas, rating history audit, wallet/XP payouts, duplicate-settlement refusal.

Live end-to-end (needs `npm run dev` running):

```bash
node practice-test.mjs   # one human seat driving all rods vs bots: snapshots + goals
node e2e.mjs            # 4 real socket clients: queue -> match -> goals -> settlement -> history
node room-test.mjs      # 3 browsers: private room, invite link, bot fill, host start, live play
node journey.mjs        # browser: register, rewards, store, rebind keys, play to the result screen
```

`screens/` holds fresh captures of every screen (desktop + mobile) from those runs.

---

## Sound

The game ships 21 real audio samples in `public/sounds/` — no CDN, no network at
runtime, works offline.

They are **physically modelled offline** by `tools/gen_sounds.py` (numpy only):

| sound | model |
| --- | --- |
| ball hits | band-passed noise burst + damped modes of a hollow plastic sphere; pitch and brightness rise with impact power |
| wall knocks | inharmonic modal sum with power-law decay over a wooden box resonance |
| rod clack | high inharmonic metal modes + broadband transient |
| goal net | filtered noise "ripple" + a low thud |
| whistle | two close tones + the pea's 26 Hz amplitude trill + breath noise |
| crowd | 46–70 formant-filtered noise "voices", each with its own syllable-rate amplitude wander, crossfaded into a seamless loop |
| victory fanfare | stacked harmonics with vibrato + a hall tail + crowd |

Regenerate everything with `python3 tools/gen_sounds.py` (about 30 s).

`src/lib/audio.ts` mixes them through a WebAudio graph:

```
samples ─┬─> sfx bus ──┐
         └─> ui bus  ──┼─> compressor/limiter ─> master ─> out
crowd loop ─> crowd bus┘        (+ short room delay on sfx)
```

Details that matter in play:

- **Round-robin voices** per sample, so overlapping hits ring out instead of
  cutting each other off.
- **Randomised playback rate** per hit (±6%), because a real table never sounds
  twice the same.
- **Stereo panning from the ball's x position** — a hit on the left rail comes
  out of the left speaker.
- **Crowd ambience follows the match**: calm while it flows, tense when the
  score is level or someone is one goal from winning, and a swell on every goal.
- **Volume sliders** for effects and crowd in *Settings → Audio*, with test
  buttons. Settings persist through `safeStorage`.
- Audio unlocks on the first user gesture (required by iOS/Safari).

## Embedded previews (sandboxed iframes)

The app also has to run inside an opaque-origin iframe (`sandbox="allow-scripts"`),
which is how platform previews embed it. Three things had to be handled:

1. **Storage** — `localStorage` throws a `SecurityError` *on access* there. All
   persistence goes through `src/lib/safeStorage.ts`, which falls back to
   sessionStorage → memory → `window.name`. Login no longer dies on write.
2. **Routing** — `history.pushState` throws for the same reason, so `src/lib/router.tsx`
   keeps path state internally (and mirrors into the hash when possible) instead
   of reloading the page. Views switch without any navigation.
3. **Module loading** — modules are cross-origin requests from an opaque origin,
   so the server sends permissive CORS / `Cross-Origin-Resource-Policy` headers
   and no `X-Frame-Options`. Auth is a bearer token (never a cookie), so this
   adds no CSRF surface.

HMR is disabled by default in `vite.config.ts` because a dead HMR socket makes
Vite fall back to full page reloads. Set `DISABLE_HMR=0` for live reload while
working locally with plain `vite`.

## Known limitations

- **Email delivery is not wired to an SMTP server.** Registration creates a real
  verification token (and `/api/auth/verify` validates it); outside production the
  token is returned to the client so the flow is testable end-to-end.
- **Google/social login is not implemented** (listed as optional in the brief);
  the auth layer is provider-agnostic and ready for an OAuth strategy.
- Bot-filled quick matches are deliberately **unrated** so a human can never farm
  rating against bots.
- Tournaments resolve their fixtures instantly server-side when the organiser
  starts them; live human-vs-human tournament lobbies are not yet wired.
- The audio samples are synthesised, not recordings of a real table. They are
  convincing in context but they are not studio foley.
- A ball that settles in the reach gap between the defence and attack rods
  (authentic to a real table) is re-served after ~0.75 s rather than being
  left for the player to chase.
- In a sandboxed preview the session lives in `window.name`/memory, so it is not
  shared with a full browser tab. Open the app in its own tab for a session that
  survives reloads.
