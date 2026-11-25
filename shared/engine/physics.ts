/**
 * Deterministic foosball simulation.
 *
 * The exact same module runs on the server (authoritative) and — for local
 * prediction / practice mode — inside the browser. Fixed 60 Hz timestep,
 * no randomness inside the step function, no reliance on wall-clock time.
 */
import {
  BALL,
  FIGURE,
  MATCH,
  ROD,
  ROD_SPECS,
  TABLE,
  TEAM_GOAL_X,
  figureOffsets,
  type RodSpec,
  type Team,
} from './constants';

export interface RodState {
  spec: RodSpec;
  /** lateral offset of the whole rod (added to each figure's resting z) */
  slide: number;
  slideVel: number;
  /** rotation about the rod axis, radians */
  angle: number;
  angleVel: number;
  /** last computed figure centres (x, z) — reused for collisions & rendering */
  figureX: number;
  figureZ: number[];
}

export interface BallState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** purely cosmetic height for shadow / bounce rendering */
  lift: number;
  liftVel: number;
}

export interface SimPlayerInput {
  /** -1..1 lateral intent — slides both of the player's rods */
  slide: number;
  /** -1..1 rotation intent for the rod nearest the player's own goal */
  rear: number;
  /** -1..1 rotation intent for the rod nearest the opponent goal */
  front: number;
}

export type MatchPhase = 'kickoff' | 'playing' | 'paused' | 'ended';

export interface SimState {
  ball: BallState;
  rods: RodState[];
  score: Record<Team, number>;
  phase: MatchPhase;
  /** seconds remaining on the match clock */
  timeLeft: number;
  /** seconds until kickoff ends */
  kickoffLeft: number;
  /** monotonic step counter — clients use it for interpolation */
  tick: number;
  /** deterministic PRNG state (ball placement) — same seed, same match */
  rngSeed: number;
  /** ticks the ball has sat where no figure can reach it */
  unreachableTicks: number;
  lastTouch: { team: Team | null; slot: number | null };
  /** tick of the last figure contact — a jostled ball is not a dead ball */
  lastTouchTick: number;
  winner: Team | null;
  endReason: string | null;
  /** rods spring back to centre when no kick input — massively improves feel */
  autoCenter: boolean;
  /** consecutive ticks the ball has been motionless while live */
  idleTicks: number;
  events: SimEvent[];
}

export type SimEvent =
  | { type: 'serve'; x: number; z: number; reason: 'dead-ball' | 'kickoff' }
  | { type: 'goal'; team: Team; score: Record<Team, number>; x: number; z: number }
  | { type: 'kick'; x: number; z: number; power: number; team: Team | null; slot: number | null }
  | { type: 'wall'; x: number; z: number; power: number }
  | { type: 'end'; winner: Team | null; reason: string };

/** Inputs keyed by player slot (0..3). Each slot owns two rods. */
export type InputMap = Record<number, SimPlayerInput>;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function createRodState(spec: RodSpec): RodState {
  const offsets = figureOffsets(spec.count);
  return {
    spec,
    slide: 0,
    slideVel: 0,
    angle: 0,
    angleVel: 0,
    figureX: spec.x,
    figureZ: offsets,
  };
}

/**
 * Deterministic 32-bit PRNG (mulberry32).
 *
 * The simulation must be reproducible: two clients replaying the same inputs,
 * or the server re-running a match, have to land on the same ball position.
 * `Math.random()` silently broke that, so ball placement draws from a seed
 * carried on the sim state.
 */
function nextRandom(s: SimState): number {
  s.rngSeed = (s.rngSeed + 0x6d2b79f5) >>> 0;
  let t = s.rngSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createSimState(opts?: { timeLimitSec?: number; goalsToWin?: number; autoCenter?: boolean }): SimState {
  return {
    ball: { x: -3.5, z: 0, vx: 16, vz: 0, lift: 0, liftVel: 0 },
    rods: ROD_SPECS.map(createRodState),
    score: { A: 0, B: 0 },
    phase: 'kickoff',
    timeLeft: opts?.timeLimitSec ?? MATCH.defaultTimeLimitSec,
    kickoffLeft: MATCH.kickoffPauseSec,
    tick: 0,
    rngSeed: 0x9e3779b9,
    unreachableTicks: 0,
    lastTouch: { team: null, slot: null },
    lastTouchTick: 0,
    winner: null,
    endReason: null,
    autoCenter: opts?.autoCenter ?? true,
    idleTicks: 0,
    events: [],
  };
}

/**
 * Rods physically joined as one handle (standard table): A-gk + A-def, A-mid +
 * A-atk, and mirrored for team B.
 */
export const SHARED_ROD: Record<string, string> = {
  'A-gk': 'A-def',
  'A-def': 'A-gk',
  'A-mid': 'A-atk',
  'A-atk': 'A-mid',
  'B-gk': 'B-def',
  'B-def': 'B-gk',
  'B-mid': 'B-atk',
  'B-atk': 'B-mid',
};

export const FIGURE_RADIUS_EXPORT = FIGURE.radius;

/** For a player slot, which rod is 'rear' (own goal side) and which is 'front'. */
export function slotRodRoles(slot: number): { rear: string | null; front: string | null } {
  const team: Team = slot < 2 ? 'A' : 'B';
  const ownGoalX = team === 'A' ? -TABLE.halfLength : TABLE.halfLength;
  const rods = ROD_SPECS.filter((r) => r.slotIndex === slot);
  if (rods.length < 2) return { rear: rods[0]?.id ?? null, front: null };
  const sorted = [...rods].sort(
    (a, b) => Math.abs(a.x - ownGoalX) - Math.abs(b.x - ownGoalX)
  );
  return { rear: sorted[0].id, front: sorted[1].id };
}

export interface StepOptions {
  goalsToWin?: number;
  timeLimitSec?: number;
}

/** Advance the simulation by exactly one fixed tick. Returns events produced. */
export function stepSim(s: SimState, inputs: InputMap, opts: StepOptions = {}): SimEvent[] {
  const dt = MATCH.dt;
  s.events = [];
  s.tick++;

  if (s.phase === 'ended') return s.events;

  if (s.phase === 'kickoff') {
    s.kickoffLeft -= dt;
    applyRodControls(s, inputs, dt);
    if (s.kickoffLeft <= 0) {
      s.kickoffLeft = 0;
      s.phase = 'playing';
      if (Math.hypot(s.ball.vx, s.ball.vz) < 4) resetBall(s);
    }
    return s.events;
  }

  if (s.phase === 'paused') {
    applyRodControls(s, inputs, dt);
    return s.events;
  }

  // ---- clock ----
  const timeLimit = opts.timeLimitSec ?? MATCH.defaultTimeLimitSec;
  if (timeLimit > 0) {
    s.timeLeft = Math.max(0, s.timeLeft - dt);
    if (s.timeLeft <= 0) {
      finishMatch(s, s.score.A === s.score.B ? null : s.score.A > s.score.B ? 'A' : 'B', 'time');
      return s.events;
    }
  }

  applyRodControls(s, inputs, dt);
  moveBall(s, dt);
  resolveFigureCollisions(s, dt);
  resolveWallsAndGoals(s, dt, opts);

  // Dead-ball rule: a ball can come to rest in the gap between opposing rods
  // where no figure can reach it (exactly like a real table). Re-drop it.
  const speed = Math.hypot(s.ball.vx, s.ball.vz);
  const boxedIn = pressedBetweenRods(s);

  // A ball that has settled where no figure can reach it is unrecoverable: no
  // amount of sliding or kicking will touch it. Re-serve it promptly so the
  // player is never left poking at a dead table.
  // Only a ball that has actually *settled* somewhere untouchable needs help.
  // Re-serving one that is still rolling through the strip interrupted live
  // play several times a minute; a moving ball will usually leave on its own.
  if (s.phase === 'playing' && speed < MATCH.reServeSpeedCutoff && !anyRodCanReach(s)) {
    s.unreachableTicks++;
    if (s.unreachableTicks > MATCH.unreachableTicks) {
      s.unreachableTicks = 0;
      resetBall(s);
      s.events.push({ type: 'serve', x: s.ball.x, z: s.ball.z, reason: 'dead-ball' });
      return s.events;
    }
  } else {
    s.unreachableTicks = 0;
  }

  // A ball being repeatedly nudged by figures is not dead — it is a scrum, which
  // is normal foosball. Only count stillness when nobody has touched the ball
  // for a second, otherwise busy play gets interrupted by pointless re-serves.
  const jostled = s.tick - s.lastTouchTick < 60;
  if (s.phase === 'playing' && (speed < 1.2 || boxedIn) && !jostled) {
    s.idleTicks++;
    if (s.idleTicks > MATCH.deadBallTicks) {
      s.idleTicks = 0;
      resetBall(s);
      s.events.push({ type: 'serve', x: s.ball.x, z: s.ball.z, reason: 'dead-ball' });
    }
  } else {
    s.idleTicks = 0;
  }

  return s.events;
}

/**
 * Integrate one rod's slide + rotation. Exported so the browser can predict the
 * local player's rods with the exact same maths the server uses.
 */
export function stepRodControl(
  rod: RodState,
  slideInput: number,
  rotInput: number,
  teamSign: number,
  autoCenter: boolean,
  dt: number
) {
  const wantSlide = clamp(slideInput, -1, 1);
  if (wantSlide !== 0) {
    rod.slideVel += Math.sign(wantSlide) * ROD.slideAccel * Math.min(1, Math.abs(wantSlide)) * dt;
  } else {
    rod.slideVel *= Math.pow(0.0005, dt);
  }
  rod.slideVel = clamp(rod.slideVel, -ROD.slideSpeed, ROD.slideSpeed);
  rod.slide += rod.slideVel * dt;
  if (rod.slide > ROD.maxSlide) {
    rod.slide = ROD.maxSlide;
    rod.slideVel = 0;
  } else if (rod.slide < -ROD.maxSlide) {
    rod.slide = -ROD.maxSlide;
    rod.slideVel = 0;
  }

  const wantRot = clamp(rotInput, -1, 1);
  if (wantRot !== 0) {
    rod.angleVel += Math.sign(wantRot) * teamSign * ROD.angularAccel * Math.min(1, Math.abs(wantRot)) * dt;
  } else if (autoCenter) {
    rod.angleVel += (-rod.angle * 150 - rod.angleVel * 13) * dt;
  } else {
    rod.angleVel *= Math.pow(0.00001, dt);
  }
  rod.angleVel = clamp(rod.angleVel, -ROD.angularSpeed, ROD.angularSpeed);
  rod.angle += rod.angleVel * dt;
  if (rod.angle > ROD.maxAngle) {
    rod.angle = ROD.maxAngle;
    rod.angleVel = 0;
  } else if (rod.angle < -ROD.maxAngle) {
    rod.angle = -ROD.maxAngle;
    rod.angleVel = 0;
  }

  rod.figureX = rod.spec.x + FIGURE.footOffset * Math.sin(rod.angle);
  const offsets = figureOffsets(rod.spec.count);
  for (let i = 0; i < offsets.length; i++) {
    rod.figureZ[i] = clamp(
      offsets[i] + rod.slide,
      -TABLE.halfWidth + FIGURE.radius,
      TABLE.halfWidth - FIGURE.radius
    );
  }
}

function applyRodControls(s: SimState, inputs: InputMap, dt: number) {
  for (const rod of s.rods) {
    const inp = inputs[rod.spec.slotIndex] ?? { slide: 0, rear: 0, front: 0 };
    const roles = slotRodRoles(rod.spec.slotIndex);
    const wantRot = roles.rear === rod.spec.id ? inp.rear : inp.front;
    const teamSign = rod.spec.team === 'A' ? 1 : -1;
    stepRodControl(rod, inp.slide ?? 0, wantRot ?? 0, teamSign, s.autoCenter, dt);
  }
}

function moveBall(s: SimState, dt: number) {
  const b = s.ball;
  const speed = Math.hypot(b.vx, b.vz);
  if (speed > 0) {
    /**
     * Speed-dependent rolling friction.
     *
     * A real ball on a felt surface carries when struck hard but scrubs to a
     * stop quickly once it is slow. A single constant deceleration cannot do
     * both: strong enough to settle a slow ball means a hard shot dies on the
     * spot, and weak enough to let a shot run means slow balls creep for ever
     * and linger in the unreachable strips between rods.
     */
    // mild extra scrub once the ball is slow: enough to settle it, not so much
    // that it dies inside the gaps between rods (which are meant to be dead)
    const scrub = 0.7 + 0.6 * (1 - Math.min(1, speed / 40));
    const damped = Math.max(0, speed - BALL.rollingFriction * scrub * dt) * Math.exp(-BALL.drag * dt);
    if (damped < BALL.stopThreshold) {
      b.vx = 0;
      b.vz = 0;
    } else {
      const k = damped / speed;
      b.vx *= k;
      b.vz *= k;
    }
  }
  b.x += b.vx * dt;
  b.z += b.vz * dt;

  // cosmetic hop
  if (b.lift > 0 || b.liftVel !== 0) {
    b.liftVel -= 42 * dt;
    b.lift += b.liftVel * dt;
    if (b.lift <= 0) {
      b.lift = 0;
      b.liftVel = 0;
    }
  }
}

function footVelocity(rod: RodState, prevX: number[]) {
  // We don't store per-figure previous positions; instead derive ankle speed
  // analytically from the rod's angular velocity (deterministic + stable).
  return Math.cos(rod.angle) * FIGURE.footOffset * rod.angleVel;
}

/** solid-body collision between the ball and every figure on every rod */
function resolveFigureCollisions(s: SimState, dt: number) {
  const b = s.ball;
  const minDist = BALL.radius + FIGURE.radius;

  for (const rod of s.rods) {
    const ankleVx = footVelocity(rod, []);
    for (let i = 0; i < rod.figureZ.length; i++) {
      const fx = rod.figureX;
      const fz = rod.figureZ[i];
      let dx = b.x - fx;
      let dz = b.z - fz;
      let dist = Math.hypot(dx, dz);
      if (dist >= minDist) continue;
      if (dist < 1e-6) {
        dx = Math.sign(rod.spec.x - 0) || 0.01;
        dz = 0.01;
        dist = Math.hypot(dx, dz);
      }
      const nx = dx / dist;
      const nz = dz / dist;

      // separate
      const overlap = minDist - dist;
      b.x += nx * overlap;
      b.z += nz * overlap;

      /**
       * Contact model.
       *
       * A figure is far heavier than the ball, so the ball's new normal velocity
       * is a blend of the two surfaces:
       *
       *   vn' = -e * vn  +  (1 + e) * u_n
       *
       * where `u_n` is the figure's own contact-point velocity along the normal.
       * The first term bounces the ball off a stationary figure; the second
       * transfers the figure's momentum into the shot.
       *
       * This replaces "restitution impulse plus a separate power add", which
       * counted the figure's momentum twice and let a soft tap rocket the ball
       * while a hard swing barely differed.
       */
      // A figure's foot is a lever, not a point at the ankle: the toe travels
      // faster than `footOffset * omega / cos` suggests, and the moulding has
      // some give, so the effective strike speed is scaled by kickPower.
      const fvx = ankleVx * FIGURE.kickPower;
      const fvz = rod.slideVel;
      const vn = (b.vx - fvx) * nx + (b.vz - fvz) * nz;
      // approach speed of the figure onto the ball, along the normal
      const uN = fvx * nx + fvz * nz;
      const sweep = Math.abs(uN);

      if (vn < 0) {
        // Coefficient of restitution falls off at low approach speeds, exactly
        // like a real ball: soft contacts absorb energy instead of bouncing.
        // Without this the ball can oscillate between two figures forever and
        // never come to rest (which reads as the table being "stuck").
        const speedFactor = Math.min(1, Math.abs(vn) / 24);
        const e = FIGURE.restitution * speedFactor;
        // `vn` is already the *relative* approach speed, so the post-impact
        // relative normal velocity is simply -e*vn. The figure's own momentum
        // enters automatically: for a resting ball struck at uN this yields
        // (1+e)*uN — the standard result for a heavy paddle. Adding uN again
        // (the previous form) counted the swing twice.
        const target = -e * vn;
        const dvn = target - vn;
        b.vx += dvn * nx;
        b.vz += dvn * nz;

        // tangential friction: a moving figure drags the ball with it, which is
        // what gives a struck ball its sideways curl instead of a pure reflection
        const tx = -nz;
        const tz = nx;
        const vt = (b.vx - fvx) * tx + (b.vz - fvz) * tz;
        const uT = fvx * tx + fvz * tz;
        const slip = vt - uT * 0.35;
        const friction = Math.min(Math.abs(slip), FIGURE.contactFriction * Math.abs(dvn) * 0.05);
        if (slip !== 0) {
          b.vx -= Math.sign(slip) * friction * tx;
          b.vz -= Math.sign(slip) * friction * tz;
        }

        const power = Math.max(0, dvn);
        if (sweep > 3.5 || power > 12) {
          b.lift = Math.min(3.2, BALL.radius + power * 0.012);
          b.liftVel = Math.min(14, power * 0.08);
          s.lastTouch = { team: rod.spec.team, slot: rod.spec.slotIndex };
          s.lastTouchTick = s.tick;
          s.events.push({
            type: 'kick',
            x: b.x,
            z: b.z,
            power: Math.min(1, power / 90),
            team: rod.spec.team,
            slot: rod.spec.slotIndex,
          });
        } else if (power > 2) {
          // a soft touch — a nudge or a cushion, the most common contact
          s.lastTouch = { team: rod.spec.team, slot: rod.spec.slotIndex };
          s.lastTouchTick = s.tick;
          s.events.push({
            type: 'kick',
            x: b.x,
            z: b.z,
            power: Math.max(0.06, Math.min(1, power / 90)),
            team: rod.spec.team,
            slot: rod.spec.slotIndex,
          });
        }
      }

      // Every contact makes a sound, not just the hard ones. A figure pushing
      // or cushioning the ball (slow sweep, or just blocking it) is the most
      // common touch in a real game — without this the table looks silent.
      if (sweep <= 3.5 && vn < -1.5 && Math.hypot(b.vx, b.vz) > 3) {
        // The contact impulse was already applied by the restitution step above;
        // a resting ball must not be nudged again or it would creep forever.
        const strength = Math.min(1, Math.abs(vn) / 60);
        s.lastTouch = { team: rod.spec.team, slot: rod.spec.slotIndex };
        s.events.push({
          type: 'kick',
          x: b.x,
          z: b.z,
          power: Math.max(0.06, strength * 0.3),
          team: rod.spec.team,
          slot: rod.spec.slotIndex,
        });
      }

      // clamp speed
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > BALL.maxSpeed) {
        const k = BALL.maxSpeed / sp;
        b.vx *= k;
        b.vz *= k;
      }
    }
  }
}

function resolveWallsAndGoals(s: SimState, dt: number, opts: StepOptions) {
  const b = s.ball;

  // side walls
  const limitZ = TABLE.halfWidth - BALL.radius;
  if (b.z > limitZ) {
    b.z = limitZ;
    if (b.vz > 0) {
      b.vz = -b.vz * BALL.wallRestitution;
      if (Math.abs(b.vz) > 12) s.events.push({ type: 'wall', x: b.x, z: b.z, power: Math.min(1, Math.abs(b.vz) / 90) });
    }
  } else if (b.z < -limitZ) {
    b.z = -limitZ;
    if (b.vz < 0) {
      b.vz = -b.vz * BALL.wallRestitution;
      if (Math.abs(b.vz) > 12) s.events.push({ type: 'wall', x: b.x, z: b.z, power: Math.min(1, Math.abs(b.vz) / 90) });
    }
  }

  // ---- goalposts -----------------------------------------------------------
  // Resolved before the goal test so a shot that clips the post rebounds rather
  // than being counted. Without this, every shot that reached the end line
  // inside the mouth width scored, however wide it actually was.
  const postMin = BALL.radius + TABLE.postRadius;
  for (const side of [-1, 1] as const) {
    const gx = side * TABLE.halfLength;
    for (const zs of [-1, 1] as const) {
      const pz = zs * TABLE.goalHalfWidth;
      let dx = b.x - gx;
      let dz = b.z - pz;
      let dist = Math.hypot(dx, dz);
      if (dist >= postMin || dist < 1e-6) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      // push the ball clear of the post
      const overlap = postMin - dist;
      b.x += nx * overlap;
      b.z += nz * overlap;
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) {
        // posts are rigid steel: livelier than the wooden rails
        const e = 0.82;
        b.vx -= (1 + e) * vn * nx;
        b.vz -= (1 + e) * vn * nz;
        if (Math.abs(vn) > 10) {
          s.events.push({
            type: 'wall',
            x: b.x,
            z: b.z,
            power: Math.min(1, Math.abs(vn) / 90),
          });
        }
      }
      void dist;
      /* eslint-disable-next-line no-self-assign */
    }
  }

  // end walls / goals
  const limitX = TABLE.halfLength - BALL.radius;
  const inMouth = Math.abs(b.z) < TABLE.goalHalfWidth - BALL.radius * 0.35;

  if (b.x > limitX) {
    if (inMouth) {
      scoreGoal(s, 'A', opts); // ball entered the +x goal -> Team A scores
      return;
    }
    b.x = limitX;
    if (b.vx > 0) b.vx = -b.vx * BALL.wallRestitution;
    s.lastTouch = { team: s.lastTouch.team, slot: s.lastTouch.slot };
  } else if (b.x < -limitX) {
    if (inMouth) {
      scoreGoal(s, 'B', opts);
      return;
    }
    b.x = -limitX;
    if (b.vx < 0) b.vx = -b.vx * BALL.wallRestitution;
  }
}

function scoreGoal(s: SimState, scoringTeam: Team, opts: StepOptions) {
  s.score[scoringTeam] += 1;
  s.events.push({
    type: 'goal',
    team: scoringTeam,
    score: { ...s.score },
    x: scoringTeam === 'A' ? TABLE.halfLength : -TABLE.halfLength,
    z: s.ball.z,
  });

  const goalsToWin = opts.goalsToWin ?? MATCH.goalsToWin;
  if (s.score[scoringTeam] >= goalsToWin) {
    finishMatch(s, scoringTeam, 'goals');
    return;
  }

  // reset for kickoff — conceding team restarts
  resetBall(s);
  s.phase = 'kickoff';
  s.kickoffLeft = MATCH.kickoffPauseSec;
  for (const rod of s.rods) {
    rod.slide = 0;
    rod.slideVel = 0;
    rod.angle = 0;
    rod.angleVel = 0;
    rod.figureX = rod.spec.x;
    rod.figureZ = figureOffsets(rod.spec.count);
  }
  s.lastTouch = { team: null, slot: null };
}

/**
 * Positions the ball for a kickoff.
 *
 * The ball is dropped just outside the centre circle and served gently toward
 * one side: a foosball table's centre gap is wider than a figure's static
 * reach, so a perfectly still centre ball would be unplayable by both teams.
 */
export function resetBall(s: SimState, towards?: Team) {
  const dir = towards === 'B' ? 1 : towards === 'A' ? -1 : nextRandom(s) < 0.5 ? -1 : 1;
  s.ball = {
    x: dir * -3.5,
    z: (nextRandom(s) - 0.5) * 10,
    vx: dir * 16,
    vz: 0,
    lift: 0,
    liftVel: 0,
  };
}

/**
 * Could any rod, from any slide position, touch the ball where it currently is?
 * A rod sweeps `x - (r + R)` .. `x + footOffset + r + R` toward its attacking
 * direction, and the mirror of that when defending.
 */
export function anyRodCanReach(s: SimState): boolean {
  const reach = BALL.radius + FIGURE.radius;
  const sweep = FIGURE.footOffset;
  const b = s.ball;
  return s.rods.some((rod) => {
    const lo = rod.spec.team === 'A' ? rod.spec.x - reach : rod.spec.x - reach - sweep;
    const hi = rod.spec.team === 'A' ? rod.spec.x + reach + sweep : rod.spec.x + reach;
    if (b.x < lo || b.x > hi) return false;
    // and it must be reachable laterally, within the rod's slide range
    return Math.abs(b.z) <= TABLE.halfWidth - FIGURE.radius + BALL.radius;
  });
}

/** True when the ball is pinned between two opposing figures with no escape. */
function pressedBetweenRods(s: SimState): boolean {
  const b = s.ball;
  if (Math.hypot(b.vx, b.vz) > 26) return false;
  let left: RodState | null = null;
  let right: RodState | null = null;
  for (const rod of s.rods) {
    for (let i = 0; i < rod.figureZ.length; i++) {
      const dx = b.x - rod.figureX;
      const dz = b.z - rod.figureZ[i];
      if (Math.hypot(dx, dz) > BALL.radius + FIGURE.radius + 0.35) continue;
      if (rod.figureX < b.x) {
        if (!left || rod.figureX > left.figureX) left = rod;
      } else if (!right || rod.figureX < right.figureX) right = rod;
    }
  }
  return !!(left && right && left.spec.team !== right.spec.team);
}

export function finishMatch(s: SimState, winner: Team | null, reason: string) {
  if (s.phase === 'ended') return;
  s.phase = 'ended';
  s.winner = winner;
  s.endReason = reason;
  s.events.push({ type: 'end', winner, reason });
}

/** Compact snapshot for the wire / for the renderer. */
export interface SimSnapshot {
  t: number;
  tick: number;
  phase: MatchPhase;
  score: Record<Team, number>;
  timeLeft: number;
  kickoffLeft: number;
  ball: [number, number, number, number];
  rods: Array<[number, number]>;
  lastTouch: { team: Team | null; slot: number | null };
}

export function snapshot(s: SimState): SimSnapshot {
  return {
    t: Date.now(),
    tick: s.tick,
    phase: s.phase,
    score: { ...s.score },
    timeLeft: s.timeLeft,
    kickoffLeft: s.kickoffLeft,
    ball: [round2(s.ball.x), round2(s.ball.z), round2(s.ball.vx), round2(s.ball.vz)],
    rods: s.rods.map((r) => [round2(r.slide), round2(r.angle)]),
    lastTouch: { ...s.lastTouch },
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export { TEAM_GOAL_X };
