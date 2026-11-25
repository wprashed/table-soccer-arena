/** Global client state (Zustand): session, profile, toasts, notification feed. */
import { create } from 'zustand';
import type { ProfileResponse, PublicUser } from '../../shared/types';
import { api, getToken, setToken } from './api';
import { storage } from './safeStorage';
import { getVolumes, setVolumes, unlockAudio } from './audio';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface AppState {
  user: PublicUser | null;
  profile: ProfileResponse | null;
  booting: boolean;
  toasts: Toast[];
  online: number;
  soundOn: boolean;
  musicOn: boolean;
  sfxVolume: number;
  crowdVolume: number;

  boot: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; username: string; password: string; country?: string; avatar?: string }) => Promise<any>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: PublicUser | null) => void;
  setOnline: (n: number) => void;
  toast: (message: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
  toggleSound: () => void;
  toggleMusic: () => void;
  setSfxVolume: (v: number) => void;
  setCrowdVolume: (v: number) => void;
}

export const useApp = create<AppState>((set, get) => ({
  user: null,
  profile: null,
  booting: true,
  toasts: [],
  online: 0,
  soundOn: getVolumes().enabled,
  musicOn: getVolumes().music > 0,
  sfxVolume: getVolumes().sfx,
  crowdVolume: getVolumes().music,

  boot: async () => {
    if (!getToken()) {
      set({ booting: false });
      return;
    }
    try {
      const { user } = await api.get<{ user: PublicUser }>('/auth/me');
      set({ user });
      await get().refresh();
    } catch {
      setToken(null);
      set({ user: null, profile: null });
    } finally {
      set({ booting: false });
    }
  },

  login: async (email, password) => {
    const res = await api.post<{ token: string; user: PublicUser }>('/auth/login', { email, password });
    setToken(res.token);
    set({ user: res.user });
    // a profile fetch failure must not undo a successful login
    try {
      await get().refresh();
    } catch {
      /* keep the session; the dashboard will retry */
    }
  },

  register: async (input) => {
    const res = await api.post<{ token: string; user: PublicUser; verification: any }>('/auth/register', input);
    setToken(res.token);
    set({ user: res.user });
    try {
      await get().refresh();
    } catch {
      /* keep the session */
    }
    return res;
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    setToken(null);
    set({ user: null, profile: null });
  },

  refresh: async () => {
    if (!getToken()) return;
    try {
      const profile = await api.get<ProfileResponse>('/profile/me');
      set({ profile, user: profile.user });
    } catch {
      /* keep stale data */
    }
  },

  setUser: (user) => set({ user }),
  setOnline: (online) => set({ online }),

  toast: (message, kind = 'info') => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismiss(id), 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  toggleSound: () => {
    const next = !get().soundOn;
    // the first toggle is also the gesture that unlocks audio on iOS
    if (next) unlockAudio();
    setVolumes({ enabled: next });
    storage.set('tsa.sound', next ? '1' : '0');
    set({ soundOn: next });
  },
  setSfxVolume: (v: number) => {
    setVolumes({ sfx: v, enabled: v > 0 ? true : get().soundOn });
    set({ sfxVolume: v, soundOn: v > 0 ? true : get().soundOn });
    if (v > 0) unlockAudio();
  },
  setCrowdVolume: (v: number) => {
    setVolumes({ music: v });
    set({ crowdVolume: v, musicOn: v > 0 });
    storage.set('tsa.music', v > 0 ? '1' : '0');
  },
  toggleMusic: () => {
    const next = !get().musicOn;
    storage.set('tsa.music', next ? '1' : '0');
    set({ musicOn: next });
  },
}));
