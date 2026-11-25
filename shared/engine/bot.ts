/**
 * Simple but effective foosball AI. Used for:
 *  - local practice mode,
 *  - filling quick-match queues in development ("vs bots"),
 *  - headless tournament resolution.
 *
 * The AI is intentionally stateless between matches: `createBot(slot, skill)`
 * returns a `think(state)` function; the server/client calls it every tick.
 */
import { TABLE, ROD_SPECS } from './constants';
import { slotRodRoles, type SimPlayerInput, type SimState } from './physics';

/**
 * Bot rng.
 *
 * This module lives in `shared/`, which means it runs inside the
 * server-authoritative simulation. `Math.random()` there made the match
 * non-reproducible: the server and a replaying client could diverge, and tests
 * of bot-vs-bot play passed or failed at random. Bots therefore draw from their
 * own seeded mulberry32 stream, keyed off the `seed` option and the sim tick.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BotOptions {
  /** 0..1 — higher reacts faster, aims better, panics less */
  skill?: number;
  seed?: number;
}

export function createBot(slot: number, opts: BotOptions = {}) {
  const skill = Math.max(0.2, Math.min(1, opts.skill ?? 0.6));
  const team = slot < 2 ? 'A' : 'B';
  const attackDir = team === 'A' ? 1 : -1;
  const roles = slotRodRoles(slot);
  const rearSpec = ROD_SPECS.find((r) => r.id === roles.rear)!;
  const frontSpec = ROD_SPECS.find((r) => r.id === roles.front)!;

  let kickHoldRear = 0;
  let kickHoldFront = 0;
  let wanderTarget = 0;
  let noise = 0;
  // deterministic per-bot stream: same seed + same tick => same decision
  let rnd = mulberry32((opts.seed ?? 0x5f3a) + slot * 7919);

  return function think(s: SimState): SimPlayerInput {
    if (s.phase === 'ended') return { slide: 0, rear: 0, front: 0 };
    const b = s.ball;

    // deterministic-ish per-slot noise so bots don't feel robotic
    noise = noise * 0.9 + (Math.sin(s.tick * 0.07 + slot * 7.3) * 0.5) * (1 - skill);

    const rearRod = s.rods.find((r) => r.spec.id === roles.rear)!;
    const frontRod = s.rods.find((r) => r.spec.id === roles.front)!;

    // Which of my rods is closest to the ball along x?
    const dRear = Math.abs(b.x - rearSpec.x);
    const dFront = Math.abs(b.x - frontSpec.x);
    const activeIsFront = dFront < dRear;
    const activeSpec = activeIsFront ? frontSpec : rearSpec;
    const activeRod = activeIsFront ? frontRod : rearRod;

    // predict the ball a little (skill dependent)
    const lookahead = (0.06 + 0.16 * skill) * 60;
    const predZ = b.z + b.vz * (lookahead / 60);
    const predX = b.x + b.vx * (lookahead / 60);

    const distX = Math.abs(predX - activeSpec.x);

    // --- slide: track the ball's z with a dead-zone so it looks intentional ---
    const rodCentre = activeRod.slide;
    const err = predZ + noise * 6 - rodCentre;
    let slide = 0;
    if (Math.abs(err) > 0.8 + (1 - skill) * 2.5) slide = Math.max(-1, Math.min(1, err / 3.5));

    // --- kick decision ---
    const reach = distX < 7.4 && Math.abs(b.z - rodCentre) < 7.5;
    const ballComingAtMe = Math.sign(b.vx) === -attackDir || Math.abs(b.vx) < 8;
    let rear = 0;
    let front = 0;

    if (kickHoldRear > 0) kickHoldRear--;
    if (kickHoldFront > 0) kickHoldFront--;

    if (reach && ballComingAtMe && rnd() < 0.55 + skill * 0.45) {
      // aim: strike slightly off-centre so the ball angles toward the goal mouth
      const aimOffset = -b.z * 0.12;
      const wantKick = Math.abs(err) < 6 + aimOffset;
      if (wantKick) {
        if (activeIsFront) kickHoldFront = 5 + Math.round(skill * 5);
        else kickHoldRear = 5 + Math.round(skill * 5);
      }
    }
    // shot on goal: when the ball is lined up in front of my attacking rod, swing hard
    const shootZone = Math.abs(b.x - frontSpec.x) < 9 && Math.abs(b.z) < TABLE.goalHalfWidth + 5;
    if (shootZone && Math.abs(err) < 5 && rnd() < 0.7) {
      kickHoldFront = Math.max(kickHoldFront, 6 + Math.round(skill * 6));
      slide = Math.max(-1, Math.min(1, (b.z * 0.5 - rodCentre) / 4));
    }

    // Defensive panic: ball about to enter our goal -> kick with everything nearby
    const ownGoalX = team === 'A' ? -TABLE.halfLength : TABLE.halfLength;
    const ballNearGoal = Math.abs(b.x - ownGoalX) < 20 && Math.sign(b.x - ownGoalX) === -attackDir;
    if (ballNearGoal && Math.abs(b.z) < TABLE.goalHalfWidth + 6) {
      if (rearRod && Math.abs(b.x - rearSpec.x) < 9) kickHoldRear = Math.max(kickHoldRear, 4);
    }

    if (kickHoldRear > 0) rear = 1;
    if (kickHoldFront > 0) front = 1;

    // occasionally reposition when idle (adds variety, avoids camping)
    if (slide === 0 && Math.abs(b.vx) + Math.abs(b.vz) < 2 && rnd() < 0.004 * (1 - skill)) {
      wanderTarget = (rnd() - 0.5) * 20;
      slide = Math.max(-1, Math.min(1, (wanderTarget - rodCentre) / 8));
    }

    return { slide, rear, front };
  };
}

/** Headless match: runs a bot-vs-bot (or mixed) simulation to completion. */
export function simulateMatch(
  create: () => SimState,
  step: (s: SimState, inputs: Record<number, SimPlayerInput>, opts: any) => any,
  skills: [number, number, number, number],
  goalsToWin = 5,
  maxTicks = 60 * 60 * 4
) {
  const s = create();
  const bots = skills.map((sk, i) => createBot(i, { skill: sk }));
  let ticks = 0;
  const events: any[] = [];
  while (s.phase !== 'ended' && ticks < maxTicks) {
    const inputs: Record<number, SimPlayerInput> = {};
    for (let i = 0; i < 4; i++) inputs[i] = bots[i](s);
    events.push(...step(s, inputs, { goalsToWin, timeLimitSec: 0 }));
    ticks++;
  }
  return { state: s, ticks, events };
}
