/** Single Socket.IO connection shared by the app. */
import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const serverUrl = (typeof window !== 'undefined' && localStorage.getItem('server_url')) || (import.meta as any).env?.VITE_SERVER_URL || undefined;
  socket = io(serverUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 4000,
    autoConnect: true,
  });
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
 * Promise wrapper around socket acks with a timeout so the UI never hangs.
 *
 * The auth token is attached to every request payload: the socket's own `auth`
 * handshake can still be in flight on first load, so handlers must be able to
 * resolve the caller from the packet itself rather than racing the handshake.
 */
export function request<T = any>(event: string, payload: any = {}, timeoutMs = 8000): Promise<T> {
  const token = getToken();
  const body =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, ...(token && !payload.token ? { token } : {}) }
      : payload;
  return new Promise((resolve, reject) => {
    const s = getSocket();
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
