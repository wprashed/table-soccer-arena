# Deployment

## Production build

```bash
npm ci
npm run seed            # only on an empty database
npm run build           # -> dist/
NODE_ENV=production PORT=8080 npm start
```

The Express server serves the built SPA (`dist/`), the REST API under `/api` and
Socket.IO on the same origin — so there is no CORS surface in production and the
client talks to relative URLs only.

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | — | `production` serves `dist/`, otherwise Vite middleware |
| `DB_PATH` | `./data/arena.db` | SQLite file (use a mounted volume) |
| `DATA_DIR` | `./data` | directory created at boot |
| `REQUIRE_EMAIL_VERIFICATION` | `0` | when `1`, clients must verify before ranked play |

## Docker

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev && npm i tsx better-sqlite3
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/src ./src
COPY --from=build /app/vite.config.ts ./vite.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
VOLUME /data
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
```

```yaml
services:
  arena:
    build: .
    ports: ["3000:3000"]
    environment:
      NODE_ENV: production
      DATA_DIR: /data
    volumes: ["arena-data:/data"]
    restart: unless-stopped
volumes:
  arena-data:
```

## Health, monitoring, backups

* `GET /api/health` → `{ ok, at, uptime }`; point your uptime monitor and the
  container healthcheck at it.
* Logs go to stdout (structured enough to ship to any collector); the
  `audit_log` table is the durable security trail and is exposed in `/admin`.
* Backups: SQLite in WAL mode — either `sqlite3 arena.db ".backup /backups/arena-$(date).db"`
  on a cron, or snapshot the `arena-data` volume. Keep `arena.db-wal` and
  `arena.db-shm` with the main file.
* Put a TLS-terminating CDN/proxy in front (WebSocket upgrade must be allowed at
  the same origin so Socket.IO keeps working without CORS).

## Load testing

Suggested shape once deployed:

```bash
npx artillery run load/quick-match.yml   # 200 virtual players, 50 concurrent matches
```

Watch: event-loop lag (should stay under 20 ms with 50 live matches), socket
fan-out bandwidth (~30 snapshots/s × 4 players × ~400 B ≈ 48 kB/s per match) and
settlement latency. Scale horizontally by adding socket workers behind the
Socket.IO Redis adapter and moving match loops to dedicated workers.
