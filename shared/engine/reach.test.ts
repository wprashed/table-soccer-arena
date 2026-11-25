/**
 * The table must never leave the player poking at a dead ball.
 *
 * A real foosball table has strips between the defence and attack rods that no
 * figure can reach. Keeping that authentic spacing is a deliberate choice, but
 * on screen a ball resting there looks like the game has frozen — so the
 * simulation has to notice and re-serve it quickly. These tests pin both halves
 * of that contract:
 *
 *   1. reach() is the geometric truth used by the sim to decide reachability
 *   2. an unreachable ball is re-served within a second, not left sitting
 */
import { describe, it, expect } from 'vitest';
import { BALL, FIGURE, ROD_SPECS, TABLE, MATCH } from './constants';
import { createSimState, stepSim, anyRodCanReach } from './physics';

const back = FIGURE.radius + BALL.radius;
const ahead = FIGURE.footOffset + FIGURE.radius + BALL.radius;

/** [minX, maxX] a rod can touch. Team A sweeps toward +x, team B toward -x. */
export function reach(spec: (typeof ROD_SPECS)[number]): [number, number] {
  return spec.team === 'A' ? [spec.x - back, spec.x + ahead] : [spec.x - ahead, spec.x + back];
}

describe('rod coverage', () => {
  it('covers the centre of the table (the ball is always servable)', () => {
    const spans = ROD_SPECS.map(reach);
    expect(spans.some(([a, b]) => 0 >= a && 0 <= b)).toBe(true);
  });

  it('keeps the classic foosball look: rods inside the table and in order', () => {
    const xs = ROD_SPECS.map((r) => r.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    for (const spec of ROD_SPECS) {
      expect(Math.abs(spec.x)).toBeLessThanOrEqual(TABLE.halfLength);
    }
    // alternating teams, keeper nearest each goal
    expect(ROD_SPECS[0].role).toBe('gk');
    expect(ROD_SPECS[ROD_SPECS.length - 1].role).toBe('gk');
  });

  it('knows which positions are out of reach', () => {
    const s = createSimState();
    s.phase = 'playing';
    s.ball = { x: 0, z: 0, vx: 0, vz: 0, lift: 0, liftVel: 0 };
    expect(anyRodCanReach(s)).toBe(true);
    // the strip between the defence and attack rods is out of reach by design
    s.ball.x = ROD_SPECS[1].x + FIGURE.radius + FIGURE.footOffset + BALL.radius + 0.5;
    s.ball.z = 0;
    // it may or may not still be covered by the opposite rod, but the function
    // must agree with the geometry it is derived from
    const expected = ROD_SPECS.some((spec) => {
      const [a, b] = reach(spec);
      return s.ball.x >= a && s.ball.x <= b;
    });
    expect(anyRodCanReach(s)).toBe(expected);
  });

  it('re-serves a ball that no rod can reach, quickly', () => {
    const s = createSimState();
    s.phase = 'playing';
    // find a genuinely unreachable x by scanning
    let deadX: number | null = null;
    for (let x = -58; x <= 58; x += 0.25) {
      s.ball = { x, z: 0, vx: 0, vz: 0, lift: 0, liftVel: 0 };
      if (!anyRodCanReach(s)) {
        deadX = x;
        break;
      }
    }
    expect(deadX).not.toBeNull();

    s.ball = { x: deadX!, z: 0, vx: 0, vz: 0, lift: 0, liftVel: 0 };
    const idle = {
      0: { slide: 0, rear: 0, front: 0 }, 1: { slide: 0, rear: 0, front: 0 },
      2: { slide: 0, rear: 0, front: 0 }, 3: { slide: 0, rear: 0, front: 0 },
    };
    let served = false;
    for (let i = 0; i < MATCH.unreachableTicks + 5; i++) {
      const evs = stepSim(s, idle, { goalsToWin: 10 });
      if (evs.some((e) => e.type === 'serve')) {
        served = true;
        break;
      }
    }
    expect(served).toBe(true);
    expect(anyRodCanReach(s)).toBe(true);
  });

  it('re-serves an unreachable ball quickly, but not so fast it interrupts play', () => {
    // The threshold is a compromise: a ball parked where nothing can reach it
    // must not strand the player, but a ball merely passing through the gap
    // between rods must be allowed to keep rolling.
    expect(MATCH.unreachableTicks).toBeGreaterThan(10);
    expect(MATCH.unreachableTicks).toBeLessThanOrEqual(120);
    // and the rule now only counts a ball that has actually stopped
    expect(MATCH.reServeSpeedCutoff).toBeLessThan(12);
  });
});
