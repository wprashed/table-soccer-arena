import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server } from 'socket.io';
import { buildApi } from './api';
import { MatchManager } from './match';
import { attachRealtime } from './realtime';
import { db } from './db';

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

/**
 * CORS for scripts/modules as well as the API.
 *
 * Embedded previews run the app inside an opaque-origin iframe, where every
 * module script is a cross-origin request. Without these headers the bundle
 * never loads and the frame stays blank. Safe here because authentication uses
 * a bearer token (never cookies), so there is nothing ambient to steal.
 */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// security headers (no external deps)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // NOTE: no X-Frame-Options / frame-ancestors — the game is meant to be
  // embeddable (platform preview, stream overlays). Auth is a bearer token in
  // storage rather than a cookie, so framing carries no CSRF risk.
  next();
});

// API responses are per-user and must never be cached by a proxy
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  pingInterval: 12_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e5,
});

const manager = new MatchManager(io);
app.use('/api', buildApi(manager));
attachRealtime(io, manager);

// ---------------------------------------------------------------------------
// Static client (built bundle in production) + Vite middleware in dev
// ---------------------------------------------------------------------------
const distDir = path.join(process.cwd(), 'dist');

async function setupFrontend() {
  const devMode = process.env.NODE_ENV !== 'production';
  if (devMode) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        // reuse the HTTP server for HMR so no extra socket/port is advertised
        hmr: { server },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[server] Vite dev middleware attached');
  } else {
    app.use(express.static(distDir, { maxAge: '1h', index: false }));
    // SPA history fallback (Express 5 no longer accepts the '*' route pattern)
    app.use((_req, res) => {
      const index = path.join(distDir, 'index.html');
      if (fs.existsSync(index)) res.sendFile(index);
      else res.status(404).send('Client bundle missing — run `npm run build`.');
    });
  }
}

setupFrontend().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Table Soccer Arena listening on http://0.0.0.0:${PORT}`);
    const users = (db.prepare(`SELECT COUNT(*) c FROM users`).get() as any).c;
    console.log(`[server] ${users} registered players`);
  });
});

process.on('SIGTERM', () => {
  manager.cleanup();
  process.exit(0);
});

export { app, server, io, manager };
