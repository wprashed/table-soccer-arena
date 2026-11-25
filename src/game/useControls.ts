/**
 * Control scheme: keyboard (rebindable), on-screen pad, mouse and touch.
 *
 * The same three axes are produced by every input device:
 *   slide  — lateral movement of both of the player's rods
 *   rear   — kick with the rod nearest your own goal (GK / defence)
 *   front  — kick with the rod nearest the opponent goal (mid / attack)
 *
 * Everything funnels through `controlModel` so the behaviour is identical no
 * matter which device produced it, and so the maths stays unit-testable.
 */
import { useCallback, useEffect, useRef } from 'react';
import { storage } from '../lib/safeStorage';
import { ROD } from '../../shared/engine/constants';
import {
  createControlState,
  deriveSlide,
  deriveKick,
  isFlick,
  flickTarget,
  type ControlState,
  type RodPair,
} from './controlModel';

export type Action = 'left' | 'right' | 'rearKick' | 'frontKick';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  rearKick: ['KeyW', 'ArrowUp'],
  frontKick: ['KeyS', 'ArrowDown', 'Space'],
};

export const CONTROL_LABELS: Record<Action, string> = {
  left: 'Slide left',
  right: 'Slide right',
  rearKick: 'Kick (back rod)',
  frontKick: 'Kick (front rod)',
};

const STORAGE_KEY = 'tsa.bindings';

export function loadBindings(): Record<Action, string[]> {
  try {
    const raw = storage.get(STORAGE_KEY);
    if (!raw) return DEFAULT_BINDINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BINDINGS, ...parsed };
  } catch {
    return DEFAULT_BINDINGS;
  }
}

export function saveBindings(b: Record<Action, string[]>) {
  storage.set(STORAGE_KEY, JSON.stringify(b));
}

export function prettyKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    Enter: 'Enter',
  };
  return map[code] ?? code.replace('Left', ' L').replace('Right', ' R');
}

interface HookOptions {
  enabled: boolean;
  bindings: Record<Action, string[]>;
  /** solo drill mode: drive all four seats from one keyboard */
  multiRod?: boolean;
  /** live rod slide values, read each frame for drag-to-position */
  readRodSlide?: () => number;
}

/** Solo-drill bindings: every rod gets its own slide + kick keys. */
export type SoloBinding = 'left' | 'right' | 'rearKick' | 'frontKick';

export const SOLO_BINDINGS: Record<number, Record<SoloBinding, string[]>> = {
  0: { left: ['KeyA'], right: ['KeyD'], rearKick: ['KeyW'], frontKick: ['KeyS'] },
  1: { left: ['ArrowLeft'], right: ['ArrowRight'], rearKick: ['KeyQ'], frontKick: ['KeyE'] },
  3: { left: ['KeyJ'], right: ['KeyL'], rearKick: ['KeyU'], frontKick: ['KeyO'] },
  2: { left: ['KeyN'], right: ['KeyM'], rearKick: ['KeyH'], frontKick: ['KeyK'] },
};

export const SOLO_LABELS = [
  { seat: 'Team A · GK + DEF', slide: 'A / D', rear: 'W', front: 'S' },
  { seat: 'Team A · MID + ATK', slide: '← / →', rear: 'Q', front: 'E' },
  { seat: 'Team B · DEF + ATK', slide: 'N / M', rear: 'H', front: 'K' },
  { seat: 'Team B · MID + GK', slide: 'J / L', rear: 'U', front: 'O' },
];

export interface ControlsApi {
  /** held on-screen arrow, -1 | 0 | 1 */
  padSlide: (v: number) => void;
  /** press/release a kick, used by the pad and keyboard hints */
  pressKick: (which: RodPair, on: boolean) => void;
  /** solo drill: drive a specific seat's pad */
  setSeatSlide: (seat: number, v: number) => void;
  pressSeatKick: (seat: number, which: RodPair, on: boolean) => void;
  /** drag-to-position: world-unit target for the rods, or null to release */
  setDragTarget: (target: number | null, velocity?: number) => void;
  /** fire a kick without a held button (flick gesture); `strength` is 0..1 */
  flickKick: (which: RodPair, strength?: number) => void;
  /** true while any input is active — used to retire the first-match hint */
  hasInput: () => boolean;
  /** fired the first time the player touches any control, for the hint */
  onFirstInput?: (fn: () => void) => void;
}

export function useControls(
  inputRef: React.MutableRefObject<{ slide: number; rear: number; front: number }>,
  opts: HookOptions
): ControlsApi {
  const held = useRef(new Set<string>());
  const soloSlide = useRef<number[]>([0, 0, 0, 0]);
  const state = useRef<ControlState>(createControlState());
  const { enabled, bindings, multiRod, readRodSlide } = opts;
  const flickTimers = useRef<Record<RodPair, number>>({ rear: 0, front: 0 });
  /** last frame's keyboard kick state, so pad presses are not clobbered */
  const keyboard = useRef<{ rear: boolean; front: boolean }>({ rear: false, front: false });
  /** one-shot listeners fired the first time the player inputs anything */
  const firstInputCbs = useRef<Array<() => void>>([]);
  const fired = useRef(false);
  const markInput = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    firstInputCbs.current.forEach((fn) => fn());
    firstInputCbs.current = [];
  }, []);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    if (!enabled) return;
    const isMapped = (code: string, action: Action) => bindings[action]?.includes(code);

    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      markInput();
      const codes = [e.code];
      if (e.key) codes.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      const match = codes.some((c) =>
        (['left', 'right', 'rearKick', 'frontKick'] as Action[]).some((a) => isMapped(c, a))
      );
      if (match) e.preventDefault();
      held.current.add(e.code);
      // an explicit key press means the player is steering: cancel any drag
      state.current.dragTarget = null;
    };
    const up = (e: KeyboardEvent) => held.current.delete(e.code);
    const blur = () => held.current.clear();

    window.addEventListener('keydown', down, { passive: false });
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [enabled, bindings, markInput]);

  // ------------------------------------------------------- per-frame resolve
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const apply = () => {
      raf = requestAnimationFrame(apply);
      const s = state.current;
      const has = (a: Action) => bindings[a]?.some((code) => held.current.has(code));

      s.keySlide = (has('right') ? 1 : 0) - (has('left') ? 1 : 0);

      // `s.rear`/`s.front` hold the *on-screen button* state and are owned by
      // pressKick; the keyboard is read fresh each frame. Combining them here
      // (instead of writing back into `s`) stops one clearing the other.
      keyboard.current.rear = has('rearKick');
      keyboard.current.front = has('frontKick');
      const eff: ControlState = {
        ...s,
        rear: s.rear || keyboard.current.rear,
        front: s.front || keyboard.current.front,
      };

      const currentSlide = readRodSlide ? readRodSlide() : inputRef.current.slide * ROD.maxSlide;
      const slide = deriveSlide(s, currentSlide);

      const allRods: Record<number, { slide: number; rear: number; front: number }> = {};
      if (multiRod) {
        for (let seat = 0; seat < 4; seat++) {
          const b = SOLO_BINDINGS[seat];
          const on = (codes: string[]) => (codes.some((c) => held.current.has(c)) ? 1 : 0);
          let s2 = on(b.left) * -1 + on(b.right);
          if (s2 === 0) s2 = soloSlide.current[seat];
          allRods[seat] = { slide: s2, rear: on(b.rearKick), front: on(b.frontKick) };
        }
      }

      inputRef.current = {
        slide,
        rear: deriveKick(eff, 'rear'),
        front: deriveKick(eff, 'front'),
        allRods,
      } as any;
    };
    raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [enabled, bindings, inputRef, multiRod, readRodSlide]);

  // clear a flick after it has had time to register as a swing
  const fireFlick = useCallback((which: RodPair, strength = 1) => {
    markInput();
    const s = state.current;
    s.flick[which] = true;
    // Gesture strength sets the swing, exactly like how hard you'd spin the
    // handle: a soft swipe is a pass, a hard one is a shot.
    s.flickPower[which] = Math.max(0.25, Math.min(1, strength));
    window.clearTimeout(flickTimers.current[which]);
    flickTimers.current[which] = window.setTimeout(() => {
      s.flick[which] = false;
    }, 110);
  }, []);

  /**
   * Called by the table while a gesture is in progress. Turns the finger's
   * world-space position into a rod target, and a fast swipe into a kick.
   */
  const setDragTarget = useCallback(
    (target: number | null, velocity = 0) => {
      const s = state.current;
      if (target === null) {
        s.dragTarget = null;
        s.dragVel = 0;
        return;
      }
      markInput();
      s.dragTarget = Math.max(-ROD.maxSlide, Math.min(ROD.maxSlide, target));
      s.dragVel = velocity;
    },
    []
  );

  const api: ControlsApi = {
    padSlide: (v) => {
      if (v !== 0) markInput();
      state.current.padSlide = Math.max(-1, Math.min(1, v));
      // pressing the pad takes control back from a finished drag
      if (v === 0) state.current.dragTarget = null;
    },
    pressKick: (which, on) => {
      if (on) markInput();
      state.current[which] = on;
    },
    setSeatSlide: (seat, v) => {
      soloSlide.current[seat] = Math.max(-1, Math.min(1, v));
    },
    pressSeatKick: (seat, which, on) => {
      const codes = SOLO_BINDINGS[seat][which === 'rear' ? 'rearKick' : 'frontKick'];
      if (on) codes.forEach((c) => held.current.add(c));
      else codes.forEach((c) => held.current.delete(c));
    },
    setDragTarget,
    flickKick: fireFlick,
    hasInput: () => {
      const s = state.current;
      return s.keySlide !== 0 || s.padSlide !== 0 || s.dragTarget !== null || s.rear || s.front || held.current.size > 0;
    },
    onFirstInput: (fn) => {
      if (fired.current) fn();
      else firstInputCbs.current.push(fn);
    },
  };

  return api;
}

export { isFlick, flickTarget };
