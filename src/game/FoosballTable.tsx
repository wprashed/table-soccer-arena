/**
 * Canvas host: owns the render loop, the resize observer and the live frame data.
 *
 * Pointer handling is direct manipulation: you touch the table and the rod you
 * grabbed follows your finger. Dragging near the far end moves your attacking
 * rod, near your own end moves the defensive rod, and a fast sideways flick
 * strikes the ball without needing to reach the kick buttons.
 */
import { useEffect, useRef } from 'react';
import { renderTable, type RenderState, TABLE_SKINS } from './renderer';
import type { FrameData } from './useMatchSession';
import { isFlick } from './controlModel';

const TEAM_COLORS = {
  A: { color: '#3b82f6', color2: '#1d4ed8' },
  B: { color: '#ef4444', color2: '#b91c1c' },
};

export interface DragInfo {
  /** pointer position in normalised table space (-1..1 both axes) */
  nx: number;
  ny: number;
  /** which of the player's two rods the gesture is steering */
  rod: 'rear' | 'front';
  /** lateral speed in world units per second */
  velocity: number;
  phase: 'start' | 'move' | 'end';
}

/** Below this movement a drag still counts as "the player is positioning". */
/** kept for docs/tests: flick speed threshold lives in controlModel.isFlick */

export function FoosballTable({
  frameRef,
  skin = 'classic-green',
  ballSkin = 'classic-ball',
  onDrag,
  onFlick,
  interactive = true,
  getOverlay,
}: {
  frameRef: React.MutableRefObject<FrameData>;
  skin?: string;
  ballSkin?: string;
  /** direct-manipulation drag; `rod` says which rod the player grabbed */
  onDrag?: (info: DragInfo) => void;
  /** a fast horizontal swipe — treated as a strike */
  onFlick?: (rod: 'rear' | 'front', power: number) => void;
  interactive?: boolean;
  /** extra interaction state (wind-up, aim) sampled every frame */
  getOverlay?: () => { windup: number; aimZ: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // The overlay callback comes from a component that re-renders several times a
  // second. Holding it in a ref keeps the render loop (and therefore the canvas
  // buffer) alive: re-running the effect would call resize(), and assigning
  // canvas.width silently clears the whole canvas every time.
  const overlayRef = useRef(getOverlay);
  overlayRef.current = getOverlay;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const { w, h, dpr } = sizeRef.current;
      if (w < 10 || h < 10) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const f = frameRef.current;
      const overlay = overlayRef.current?.() ?? { windup: 0, aimZ: 0 };
      const state: RenderState = {
        rods: f.rods,
        ball: f.ball,
        score: f.score,
        teamA: TEAM_COLORS.A,
        teamB: TEAM_COLORS.B,
        controlledSlots: f.mySlot !== null ? [f.mySlot] : [],
        mySlot: f.mySlot,
        highlightRods: f.highlightRods,
        windup: overlay.windup,
        aimZ: overlay.aimZ,
        myTeam: f.mySlot === null ? null : f.mySlot < 2 ? 'A' : 'B',
      };
      renderTable(ctx, w, h, state, skin in TABLE_SKINS ? skin : 'classic-green', ballSkin, t);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [frameRef, skin, ballSkin]);

  // ------------------------------------------------------------- gestures ---
  const gesture = useRef<{
    active: boolean;
    pointerId: number;
    rod: 'rear' | 'front';
    startX: number;
    lastX: number;
    lastT: number;
    velocity: number;
    moved: number;
  } | null>(null);

  const toNorm = (el: HTMLElement, clientX: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    return {
      nx: ((clientX - rect.left) / rect.width) * 2 - 1,
      ny: ((clientY - rect.top) / rect.height) * 2 - 1,
    };
  };

  /**
   * Which rod did the player grab?
   *
   * Dragging in the half of the table nearer the opponent steers the attacking
   * rod; nearer your own goal steers the defensive one. This matches how people
   * intuitively reach for the rod closest to the action.
   */
  const pickRod = (nx: number): 'rear' | 'front' => {
    const f = frameRef.current;
    const team = f.mySlot !== null && f.mySlot >= 2 ? 'B' : 'A';
    const towardOpponent = team === 'A' ? nx > 0 : nx < 0;
    return towardOpponent ? 'front' : 'rear';
  };

  const handleDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    const el = e.currentTarget as HTMLElement;
    // capture keeps the drag alive past the canvas edge, but synthetic/partial
    // pointers can reject it — a lost capture must never break the gesture
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* no active pointer: the drag still works inside the element */
    }
    const { nx, ny } = toNorm(el, e.clientX, e.clientY);
    gesture.current = {
      active: true,
      pointerId: e.pointerId,
      rod: pickRod(nx),
      startX: nx,
      lastX: nx,
      lastT: performance.now(),
      velocity: 0,
      moved: 0,
    };
    onDrag?.({ nx, ny, rod: gesture.current.rod, velocity: 0, phase: 'start' });
  };

  const handleMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!interactive || !g?.active || g.pointerId !== e.pointerId) return;
    const el = e.currentTarget as HTMLElement;
    const { nx, ny } = toNorm(el, e.clientX, e.clientY);
    const now = performance.now();
    const dt = Math.max(8, now - g.lastT) / 1000;
    // normalised units per second, converted to world units by the caller
    const vNorm = (nx - g.lastX) / dt;
    g.velocity = g.velocity * 0.6 + vNorm * 0.4;
    g.moved = Math.max(g.moved, Math.abs(nx - g.startX));
    g.lastX = nx;
    g.lastT = now;
    onDrag?.({ nx, ny, rod: g.rod, velocity: g.velocity * 30, phase: 'move' });
  };

  const handleUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g?.active || g.pointerId !== e.pointerId) return;
    const el = e.currentTarget as HTMLElement;
    const { nx, ny } = toNorm(el, e.clientX, e.clientY);
    const speed = Math.abs(g.velocity * 30);
    g.active = false;
    onDrag?.({ nx, ny, rod: g.rod, velocity: 0, phase: 'end' });
    // a quick sideways swipe is a strike; slow positioning drags are not
    if (isFlick(speed) && Math.abs(nx - g.startX) > 0.04) {
      onFlick?.(g.rod, Math.min(1, speed / 140));
    }
    gesture.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none no-select"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
