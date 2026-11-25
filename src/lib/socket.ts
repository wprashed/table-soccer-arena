/** Single Socket.IO connection shared by the app, with seamless offline / static fallback. */
import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';
import {
  createLocalMatch,
  startLocalMatchLoop,
  cleanupLocalMatch,
  setLocalPlayerInput,
} from './mockMatch';
import { snapshot } from '../../shared/engine/physics';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const serverUrl =
    (typeof window !== 'undefined' && localStorage.getItem('server_url')) ||
    (import.meta as any).env?.VITE_SERVER_URL ||
    undefined;

  socket = io(serverUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 4000,
    autoConnect: !!serverUrl, // don't spam errors on pure static github pages
  });

  // Intercept emits for local simulation
  const originalEmit = socket.emit.bind(socket);
  socket.emit = function (event: string, ...args: any[]) {
    if (event === 'match:input') {
      const p = args[0];
      setLocalPlayerInput(p?.input || p);
    } else if (event === 'match:leave') {
      const p = args[0];
      cleanupLocalMatch(p?.matchId);
    }
    return originalEmit(event, ...args);
  };

  socket.on('connect', () => {
    const t = getToken();
    if (t) socket?.emit('auth', { token: t });
  });

  return socket;
}

export function reconnectAuth() {
  const s = getSocket();
  const t = getToken();
  if (t && s.connected) s.emit('auth', { token: t });
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/**
 * Promise wrapper around socket acks with fallback for offline / GitHub Pages mode.
 */
export function request<T = any>(event: string, payload: any = {}, timeoutMs = 8000): Promise<T> {
  const token = getToken();
  const body =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, ...(token && !payload.token ? { token } : {}) }
      : payload;

  const s = getSocket();

  // If matchId is local or socket is not connected to a live server, handle locally
  const isLocalMatch = typeof payload?.matchId === 'string' && payload.matchId.startsWith('local_');
  if (!s.connected || isLocalMatch) {
    if (event === 'practice:start') {
      const match = createLocalMatch({
        mode: 'practice',
        solo: payload?.solo,
        difficulty: payload?.difficulty,
      });
      return Promise.resolve({ ok: true, matchId: match.id, solo: match.solo } as any);
    }

    if (event === 'queue:join') {
      const match = createLocalMatch({ mode: 'quick', solo: false });
      setTimeout(() => {
        s.emit('queue:matched', { matchId: match.id, view: match.view });
      }, 1200);
      return Promise.resolve({
        ok: true,
        queue: {
          count: 1,
          players: [
            {
              userId: 'p0',
              username: 'You',
              avatar: '⚽',
              rating: 1000,
              waitedMs: 0,
            },
          ],
          online: 18,
        },
      } as any);
    }

    if (event === 'queue:leave') {
      return Promise.resolve({ ok: true } as any);
    }

    if (event === 'match:join' || event === 'match:spectate') {
      const matchId = payload?.matchId || 'local_match';
      const match = createLocalMatch({ mode: 'practice', solo: false });
      match.id = matchId;
      startLocalMatchLoop(matchId, s);
      return Promise.resolve({
        ok: true,
        view: match.view,
        seat: 0,
        solo: match.solo,
        snapshot: snapshot(match.sim),
        chat: [],
      } as any);
    }

    if (event === 'room:create') {
      const match = createLocalMatch({ mode: 'practice', solo: false });
      return Promise.resolve({
        ok: true,
        roomCode: 'ROOM' + Math.floor(1000 + Math.random() * 9000),
        matchId: match.id,
      } as any);
    }

    if (event === 'room:join') {
      const match = createLocalMatch({ mode: 'practice', solo: false });
      return Promise.resolve({ ok: true, matchId: match.id } as any);
    }
  }

  // Live socket request to backend server
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error('Network timeout — check your connection'));
      }
    }, timeoutMs);

    s.emit(event, body, (res: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res);
    });
  });
}
