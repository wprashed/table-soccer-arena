/**
 * Shared table geometry + tuning constants.
 * Used by BOTH the server-authoritative simulation and the client renderer,
 * so the visual table is guaranteed to match the physics table.
 *
 * Coordinate system (top-down):
 *   x : along the table length, -HALF_LENGTH .. +HALF_LENGTH   (left goal = Team A's goal)
 *   z : across the table width, -HALF_WIDTH  .. +HALF_WIDTH
 * Team A defends the -x goal and attacks the +x goal.
 */

export const TABLE = {
  halfLength: 60,
  halfWidth: 34,
  goalHalfWidth: 13,
  goalDepth: 7,
  wallThickness: 2.6,
  /**
   * Radius of the goalpost at each side of the mouth. Posts are real on a
   * foosball table: a shot that clips one rebounds out instead of going in,
   * which is where a lot of the drama in a close game comes from.
   */
  postRadius: 1.15,
} as const;

export const BALL = {
  radius: 1.7,
  /** exponential velocity damping per second */
  drag: 0.45,
  /**
   * Constant rolling/static deceleration, so the ball eventually stops.
   *
   * Tuned down from 5.2: at that value the deceleration term dominated a hard
   * shot, so a top-speed ball died as quickly as a gentle one and the table
   * played like it was covered in sand. At 3.0 a struck ball carries across the
   * table while a nudge still settles.
   */
  rollingFriction: 2.4,
  stopThreshold: 0.9,
  wallRestitution: 0.72,
  maxSpeed: 175,
} as const;

export const FIGURE = {
  radius: 2.55,
  /**
   * Max forward/backward foot travel along x when the rod rotates.
   * Chosen so every gap between neighbouring rods is covered:
   * reach = footOffset + radius + ball radius must exceed half the widest gap,
   * otherwise the ball can stall in a strip no figure can touch.
   */
  footOffset: 3.6,
  restitution: 0.62,
  /** tangential drag applied to the ball where a figure's foot touches it */
  contactFriction: 9,
  /**
   * Lever/sweet-spot gain applied to a figure's ankle speed to get its real
   * strike speed. A foot is a lever and the moulding has give, so the toe moves
   * appreciably faster than `footOffset * omega`.
   */
  kickPower: 3.6,
  verticalBob: 0.5,
} as const;

export const ROD = {
  slideSpeed: 30,
  slideAccel: 260,
  angularSpeed: 8.4,
  angularAccel: 90,
  /** rotation clamp, radians (~83 degrees) — pull/push shot range */
  maxAngle: 1.45,
  /** how far a rod may slide from its resting position */
  maxSlide: TABLE.halfWidth - FIGURE.radius - 1.2,
} as const;

export const MATCH = {
  tickRate: 60,
  dt: 1 / 60,
  snapshotRate: 30,
  goalsToWin: 10,
  defaultTimeLimitSec: 300,
  kickoffPauseSec: 2.0,
  reconnectionWindowSec: 45,
  /** ~3.5 s of a motionless ball triggers a re-drop */
  deadBallTicks: 210,
  /**
   * Ticks before a ball that no rod can reach is re-served. Short on purpose:
   * the player should never be left kicking at a ball that cannot be touched.
   */
  unreachableTicks: 75,
  /**
   * A ball slower than this on the floor whose lane no figure covers is treated
   * as settled. Above it the ball is still rolling and will usually escape the
   * gap on its own, so interrupting live play would be wrong.
   */
  reServeSpeedCutoff: 6,
  maxMatchDurationSec: 900,
} as const;

export type Team = 'A' | 'B';
export type RodRole = 'gk' | 'def' | 'mid' | 'atk';

export interface RodSpec {
  id: string;
  team: Team;
  role: RodRole;
  x: number;
  count: number;
  /** which of the four seats controls this rod (0-3) */
  slotIndex: 0 | 1 | 2 | 3;
}

/** Standard foosball rod layout (8 rods, 4 per team). */
/**
 * Rod layout.
 *
 * A real table has gaps between rods: a figure covers
 * `x - (r + R)` to `x + footOffset + r + R` in its sweep direction, and the
 * strips between the defence and attack rods are genuinely out of reach. That is
 * authentic, but on screen a ball sitting there looks like a frozen game, so the
 * simulation re-serves it almost immediately (see the unreachable-ball rule in
 * physics.ts). These positions keep the classic foosball look; they are
 * deliberately NOT spaced to eliminate every gap.
 */
export const ROD_SPECS: RodSpec[] = [
  { id: 'A-gk', team: 'A', role: 'gk', x: -52, count: 1, slotIndex: 0 },
  { id: 'A-def', team: 'A', role: 'def', x: -37, count: 2, slotIndex: 0 },
  { id: 'B-atk', team: 'B', role: 'atk', x: -21.5, count: 3, slotIndex: 2 },
  { id: 'A-mid', team: 'A', role: 'mid', x: -7.5, count: 5, slotIndex: 1 },
  { id: 'B-mid', team: 'B', role: 'mid', x: 7.5, count: 5, slotIndex: 3 },
  { id: 'A-atk', team: 'A', role: 'atk', x: 21.5, count: 3, slotIndex: 1 },
  { id: 'B-def', team: 'B', role: 'def', x: 37, count: 2, slotIndex: 2 },
  { id: 'B-gk', team: 'B', role: 'gk', x: 52, count: 1, slotIndex: 3 },
];

/** Resting z positions of the figures on a rod with `count` figures. */
export function figureOffsets(count: number): number[] {
  const span = TABLE.halfWidth * 2;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(-span / 2 + (span * (i + 0.5)) / count);
  }
  return out;
}

export const TEAM_GOAL_X: Record<Team, number> = {
  A: -TABLE.halfLength,
  B: TABLE.halfLength,
};

export const TEAM_ATTACK_X: Record<Team, number> = {
  A: TABLE.halfLength,
  B: -TABLE.halfLength,
};
