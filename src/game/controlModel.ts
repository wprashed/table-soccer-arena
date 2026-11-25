/**
 * Pure control-state model.
 *
 * Every input device (keyboard, on-screen pad, mouse drag, touch drag) writes
 * into a single `ControlState`, and `deriveInput()` turns that into the three
 * axes the server understands (slide / rear / front).
 *
 * Keeping the maths out of React makes the tricky parts testable:
 *  - a small dead-zone so thumb jitter doesn't make the rods twitch
 *  - drag-to-position (the rod follows your finger) instead of raw deltas
 *  - flick detection, which turns a fast sideways drag into a kick
 */
import { ROD } from '../../shared/engine/constants';

export type RodPair = 'rear' | 'front';

export interface ControlState {
  /** keyboard slide intent, -1 | 0 | 1 */
  keySlide: number;
  /** held on-screen arrow, -1 | 0 | 1 */
  padSlide: number;
  /** when a drag is active: the destination for the rod slide, in world units */
  dragTarget: number | null;
  /** measured lateral speed of an active drag, world units/sec */
  dragVel: number;
  /** kick held for each rod pair */
  rear: boolean;
  front: boolean;
  /** auto-kick fired by a flick gesture (decays over time) */
  flick: { rear: boolean; front: boolean };
  /**
   * How hard each flick swung (0..1). A gentle swipe is a pass, a hard one is a
   * shot — the same way a real player controls power by how fast they spin the
   * handle rather than by whether they touched it.
   */
  flickPower: { rear: number; front: number };
}

export function createControlState(): ControlState {
  return {
    keySlide: 0,
    padSlide: 0,
    dragTarget: null,
    dragVel: 0,
    rear: false,
    front: false,
    flick: { rear: false, front: false },
    flickPower: { rear: 1, front: 1 },
  };
}

/** Thumb-sized dead-zone: below this the axis reads as zero. */
export const SLIDE_DEADZONE = 0.14;

/**
 * Drag responsiveness: fraction of full travel per frame that maps to full
 * rod speed. 3.2 means a finger a third of the table away moves the rod flat
 * out, while small corrections stay gentle.
 */
export const DRAG_GAIN = 3.2;

/**
 * Resolve the slide axis.
 *
 * An active drag wins over the pad and keyboard, because it is the most direct
 * expression of intent ("put the rod here").
 */
export function deriveSlide(s: ControlState, currentSlide: number): number {
  if (s.dragTarget !== null) {
    // Proportional controller toward the finger. The gain is normalised by the
    // rod's full travel so the gesture feels the same at any table size: a
    // third of the table away moves at a third of full speed, never teleporting.
    const err = s.dragTarget - currentSlide;
    const out = Math.max(-1, Math.min(1, (err / ROD.maxSlide) * DRAG_GAIN));
    return Math.abs(out) < 0.05 ? 0 : out;
  }
  const raw = s.keySlide !== 0 ? s.keySlide : s.padSlide;
  if (Math.abs(raw) < SLIDE_DEADZONE) return 0;
  // re-scale above the dead-zone so the usable range starts at 0
  const sign = Math.sign(raw);
  return sign * Math.min(1, (Math.abs(raw) - SLIDE_DEADZONE) / (1 - SLIDE_DEADZONE));
}

/** Rotate intent per rod pair, including flicks and held buttons/keys. */
export function deriveKick(s: ControlState, which: RodPair): number {
  if (s[which]) return 1;
  if (s.flick[which]) return 1;
  return 0;
}

/**
 * Decide whether a horizontal swipe should count as a kick.
 *
 * A real player flicks the handle to strike the ball; on a phone the natural
 * gesture is a quick sideways swipe. We only fire on speed, so slow positioning
 * drags never shoot by accident.
 */
export function isFlick(velocity: number): boolean {
  return Math.abs(velocity) > 46;
}

/** Which rod pair a swipe should kick: the one nearer the ball. */
export function flickTarget(ballX: number, rearX: number, frontX: number, attackingDir: 1 | -1): RodPair {
  // the rod the ball is about to reach (goal-side of it) is the useful one
  const dRear = Math.abs(ballX - rearX);
  const dFront = Math.abs(ballX - frontX);
  if (dRear === dFront) return attackingDir > 0 ? 'front' : 'rear';
  return dRear < dFront ? 'rear' : 'front';
}

/** World units a full-width drag should move the rods across. */
export const DRAG_FULL_RANGE = ROD.maxSlide * 2;
