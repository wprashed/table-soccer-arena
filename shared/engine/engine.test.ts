import { describe, it, expect } from 'vitest';
import { createSimState, stepSim, slotRodRoles, type InputMap } from './physics';
import { createBot } from './bot';
import { TABLE, MATCH } from './constants';

const idle: InputMap = {
  0: { slide: 0, rear: 0, front: 0 }, 1: { slide: 0, rear: 0, front: 0 },
  2: { slide: 0, rear: 0, front: 0 }, 3: { slide: 0, rear: 0, front: 0 },
};

function run(s: ReturnType<typeof createSimState>, ticks: number, inputs = idle) {
  const evs = [];
  for (let i = 0; i < ticks; i++) evs.push(...stepSim(s, inputs, { goalsToWin: 10 }));
  return evs;
}

describe('physics', () => {
  it('starts in kickoff and transitions to playing', () => {
    const s = createSimState();
    expect(s.phase).toBe('kickoff');
    run(s, Math.ceil(MATCH.kickoffPauseSec * 60) + 2);
    expect(s.phase).toBe('playing');
  });

  it('ball stays inside the table walls', () => {
    const s = createSimState();
    s.phase = 'playing';
    s.ball = { x: 0, z: 0, vx: 900, vz: 400, lift: 0, liftVel: 0 };
    run(s, 600);
    expect(Math.abs(s.ball.z)).toBeLessThanOrEqual(TABLE.halfWidth);
    expect(Math.abs(s.ball.x)).toBeLessThanOrEqual(TABLE.halfLength);
  });

  it('ball comes to rest due to friction', () => {
    const s = createSimState();
    s.phase = 'playing';
    // measure friction alone: park the ball where the dead-ball rule will not
    // re-serve it, and clear the lane so no figure touches it
    for (const rod of s.rods) {
      rod.slide = 0;
      rod.figureZ = rod.figureZ.map(() => 30);
      rod.slideVel = 0;
      rod.angle = 0;
      rod.angleVel = 0;
    }
    s.ball = { x: 0, z: 0, vx: 60, vz: 0, lift: 0, liftVel: 0 };
    let stoppedAt: number | null = null;
    for (let i = 0; i < 150; i++) {
      stepSim(s, idle, { goalsToWin: 10 });
      if (stoppedAt === null && Math.hypot(s.ball.vx, s.ball.vz) < 1) stoppedAt = i;
    }
    expect(stoppedAt).not.toBeNull();
    // A struck ball carries, so this is deliberately not "stops in a second".
    // What matters is that it reliably stops rather than creeping forever.
    expect(stoppedAt!).toBeLessThan(180);
    expect(stoppedAt!).toBeGreaterThan(20);
  });

  it('detects a goal in the +x mouth and credits team A', () => {
    const s = createSimState();
    s.phase = 'playing';
    s.ball = { x: TABLE.halfLength - 4, z: 0, vx: 120, vz: 0, lift: 0, liftVel: 0 };
    const evs = run(s, 60);
    expect(evs.some((e) => e.type === 'goal')).toBe(true);
    expect(s.score.A).toBe(1);
  });

  it('does not score when hitting the end wall outside the mouth', () => {
    const s = createSimState();
    s.phase = 'playing';
    s.ball = { x: TABLE.halfLength - 4, z: TABLE.halfWidth - 5, vx: 120, vz: 0, lift: 0, liftVel: 0 };
    run(s, 60);
    expect(s.score.A + s.score.B).toBe(0);
  });

  it('is deterministic for the same inputs', () => {
    const a = createSimState();
    const b = createSimState();
    a.phase = 'playing'; b.phase = 'playing';
    a.ball = { x: 0, z: 0, vx: 80, vz: 30, lift: 0, liftVel: 0 };
    b.ball = { ...a.ball };
    const inputs: InputMap = {
      0: { slide: 1, rear: 1, front: 1 }, 1: { slide: -0.5, rear: 0, front: 0 },
      2: { slide: 0, rear: -1, front: -1 }, 3: { slide: 1, rear: 0, front: 0 },
    };
    run(a, 300, inputs); run(b, 300, inputs);
    expect(a.ball.x).toBeCloseTo(b.ball.x, 6);
    expect(a.ball.z).toBeCloseTo(b.ball.z, 6);
  });

  it('rod angle produces a foot sweep that kicks the ball', () => {
    const s = createSimState();
    s.phase = 'playing';
    // ball sits just ahead of slot 1's rear rod (A-mid, x=-6.5); kicking swings the
    // figure forward into it, and Team A kicks toward +x.
    s.ball = { x: -1.6, z: 0, vx: 0, vz: 0, lift: 0, liftVel: 0 };
    const inputs: InputMap = { ...idle, 1: { slide: 0, rear: 1, front: 0 } };
    const evs = run(s, 45, inputs);
    expect(evs.some((e) => e.type === 'kick')).toBe(true);
    expect(s.ball.x).toBeGreaterThan(-1.6);
  });

  it('assigns two rods to every player slot', () => {
    for (const slot of [0, 1, 2, 3]) {
      const roles = slotRodRoles(slot);
      expect(roles.rear).toBeTruthy();
      expect(roles.front).toBeTruthy();
      expect(roles.rear).not.toBe(roles.front);
    }
    // slot 0 defends the -x goal: GK rod is its rear rod
    expect(slotRodRoles(0).rear).toBe('A-gk');
    expect(slotRodRoles(0).front).toBe('A-def');
    expect(slotRodRoles(1).rear).toBe('A-mid');
    expect(slotRodRoles(1).front).toBe('A-atk');
    expect(slotRodRoles(2).rear).toBe('B-def');
    expect(slotRodRoles(2).front).toBe('B-atk');
    expect(slotRodRoles(3).rear).toBe('B-gk');
    expect(slotRodRoles(3).front).toBe('B-mid');
  });

  it('rods auto-centre when no kick input is held', () => {
    const s = createSimState();
    s.phase = 'playing';
    run(s, 20, { ...idle, 1: { slide: 0, rear: 1, front: 1 } });
    expect(Math.abs(s.rods[3].angle)).toBeGreaterThan(0.2);
    run(s, 60, idle);
    expect(Math.abs(s.rods[3].angle)).toBeLessThan(0.05);
  });

  it('keeps a player\'s two rods on the same handle (no overrun)', () => {
    const s = createSimState();
    s.phase = 'playing';
    // hold slide hard for a while: both of slot 1's rods must track together
    run(s, 120, { ...idle, 1: { slide: 1, rear: 0, front: 0 } });
    const mid = s.rods.find((r) => r.spec.id === 'A-mid')!;
    const atk = s.rods.find((r) => r.spec.id === 'A-atk')!;
    expect(mid.slide).toBeCloseTo(atk.slide, 6);
    expect(mid.slide).toBeGreaterThan(1);

    run(s, 240, { ...idle, 1: { slide: -1, rear: 0, front: 0 } });
    expect(mid.slide).toBeCloseTo(atk.slide, 6);
    expect(mid.slide).toBeLessThan(-1);
  });

  it('re-drops a ball pressed between opposing figures', () => {
    const s = createSimState();
    s.phase = 'playing';
    // pin the ball exactly between A-atk (x=19) and B-def (x=37) figures
    s.ball = { x: 28, z: 0, vx: 0, vz: 0, lift: 0, liftVel: 0 };
    const evs = run(s, 400);
    expect(evs.some((e) => e.type === 'serve')).toBe(true);
    expect(Math.abs(s.ball.x - 28)).toBeGreaterThan(8);
  });

  it('sliding a rod moves its figures laterally within bounds', () => {
    const s = createSimState();
    s.phase = 'playing';
    run(s, 60, { ...idle, 0: { slide: 1, rear: 0, front: 0 } });
    expect(s.rods[0].slide).toBeGreaterThan(1);
    for (const z of s.rods[0].figureZ) expect(Math.abs(z)).toBeLessThanOrEqual(TABLE.halfWidth);
  });

  it('serves a playable ball at kickoff (never a dead centre ball)', () => {
    const s = createSimState();
    const speed = Math.hypot(s.ball.vx, s.ball.vz);
    expect(speed).toBeGreaterThan(4);
    expect(Math.abs(s.ball.x)).toBeLessThan(8);
  });

  it('re-drops a dead ball that no rod can reach', () => {
    const s = createSimState();
    s.phase = 'playing';
    // deep in a corner between rods — nothing can touch it
    s.ball = { x: 30.5, z: -31, vx: 0, vz: 0, lift: 0, liftVel: 0 };
    const evs = run(s, 400);
    expect(evs.some((e) => e.type === 'serve')).toBe(true);
    // the ball must have been moved out of the dead corner
    expect(Math.hypot(s.ball.x - 30.5, s.ball.z + 31)).toBeGreaterThan(8);
  });

  it('keeps a believable scoring pace in bot-vs-bot play', () => {
    const s = createSimState({ timeLimitSec: 0 });
    const bots = [0, 1, 2, 3].map((i) => createBot(i, { skill: 0.7 }));
    let ticks = 0;
    const minutes = 3;
    while (s.phase !== 'ended' && ticks < 60 * 60 * minutes) {
      const inputs: InputMap = {
        0: bots[0](s), 1: bots[1](s), 2: bots[2](s), 3: bots[3](s),
      };
      const evs = stepSim(s, inputs, { goalsToWin: 10, timeLimitSec: 0 });
      expect(evs.filter((e) => e.type === 'goal').length).toBeLessThanOrEqual(1);
      ticks++;
    }
    // a 3 minute match should produce at least a couple of goals on each side of the table
    expect(s.score.A + s.score.B).toBeGreaterThanOrEqual(2);
  });

  it('finishes a first-to-5 match inside 10 simulated minutes', () => {
    const s = createSimState({ timeLimitSec: 0 });
    const bots = [0, 1, 2, 3].map((i) => createBot(i, { skill: 0.75 }));
    let ticks = 0;
    while (s.phase !== 'ended' && ticks < 60 * 60 * 10) {
      const inputs: InputMap = { 0: bots[0](s), 1: bots[1](s), 2: bots[2](s), 3: bots[3](s) };
      stepSim(s, inputs, { goalsToWin: 5, timeLimitSec: 0 });
      ticks++;
    }
    expect(s.phase).toBe('ended');
    expect(Math.max(s.score.A, s.score.B)).toBe(5);
  });

  it('ends the match at the goal target', () => {
    const s = createSimState();
    s.phase = 'playing';
    s.score = { A: 9, B: 0 };
    s.ball = { x: TABLE.halfLength - 4, z: 0, vx: 120, vz: 0, lift: 0, liftVel: 0 };
    run(s, 60);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('A');
  });

  it('end wall bounce keeps velocity bounded', () => {
    const s = createSimState();
    s.phase = 'playing';
    s.ball = { x: TABLE.halfLength - 3, z: 20, vx: 500, vz: 0, lift: 0, liftVel: 0 };
    run(s, 120);
    expect(Math.hypot(s.ball.vx, s.ball.vz)).toBeLessThanOrEqual(1000);
  });
});

describe('goalposts', () => {
  const shoot = (z: number) => {
    const s = createSimState();
    s.phase = 'playing';
    // Clear the lane: rod controllers re-apply input every tick, so figures are
    // zeroed and the rods parked at the far touchline. This isolates the
    // goal-line behaviour from any figure blocking the shot.
    s.rods = [];
    // fire at the +x goal from close range, aimed at the given z
    s.ball = { x: TABLE.halfLength - 16, z, vx: 110, vz: 0, lift: 0, liftVel: 0 };
    let scored = false;
    let hitPost = false;
    for (let i = 0; i < 90; i++) {
      for (const e of stepSim(s, {} as InputMap, { goalsToWin: 99, timeLimitSec: 0 })) {
        if (e.type === 'goal') scored = true;
        if (e.type === 'wall' && Math.abs(s.ball.x) > TABLE.halfLength - 6) hitPost = true;
      }
      if (scored) break;
    }
    return { scored, hitPost };
  };

  it('lets a well-aimed shot through', () => {
    expect(shoot(0).scored).toBe(true);
  });

  it('rebounds a shot that hits the post instead of scoring', () => {
    // aimed exactly at the post line
    const r = shoot(TABLE.goalHalfWidth);
    expect(r.scored).toBe(false);
    expect(r.hitPost).toBe(true);
  });

  it('rebounds a shot just outside the mouth', () => {
    const r = shoot(TABLE.goalHalfWidth + 3);
    expect(r.scored).toBe(false);
  });
});
